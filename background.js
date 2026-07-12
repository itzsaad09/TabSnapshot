// Background Service Worker for TabSnapshot extension
// Utilizes Manifest V3 APIs asynchronously and statelessly.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_WORKSPACE') {
    captureWorkspace()
      .then(snapshot => sendResponse({ success: true, snapshot }))
      .catch(err => {
        console.error('Error capturing workspace:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'RESTORE_WORKSPACE') {
    restoreWorkspace(message.snapshot)
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('Error restoring workspace:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  }
});

// In-memory map to store pending scroll data for tabs (tabId -> scrollData)
const pendingScrollRestorations = new Map();

// Listener to restore scroll when a deferred tab becomes active
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  const scrollData = pendingScrollRestorations.get(tabId);
  if (scrollData) {
    pendingScrollRestorations.delete(tabId);
    // Apply scroll immediately on activation
    await injectScroll(tabId, scrollData);
  }
});

// Listener to restore scroll when a window with a deferred active tab is focused
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, windowId: windowId });
    if (activeTab && pendingScrollRestorations.has(activeTab.id)) {
      const scrollData = pendingScrollRestorations.get(activeTab.id);
      pendingScrollRestorations.delete(activeTab.id);
      await injectScroll(activeTab.id, scrollData);
    }
  } catch (e) {
    // Ignore window query errors
  }
});

// Helper to determine if a URL is scriptable
function isScriptable(url) {
  return url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://'));
}

/**
 * Captures all open windows, their dimensions, states, tabs, scroll positions, and tab group information.
 */
async function captureWorkspace() {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  let tabGroups = [];
  try {
    tabGroups = await chrome.tabGroups.query({});
  } catch (e) {
    console.warn("Tab Groups API not available or empty:", e);
  }

  const snapshotWindows = [];

  for (const win of windows) {
    // Filter groups belonging to this window
    const winGroups = tabGroups.filter(g => g.windowId === win.id);

    const tabPromises = win.tabs.map(async (tab) => {
      const tabUrl = tab.url || tab.pendingUrl || '';
      let scrollData = { windowX: 0, windowY: 0, elements: [] };

      // Extract scroll position for scriptable and loaded tabs
      if (isScriptable(tabUrl) && !tab.discarded) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const getSelector = (el) => {
                if (el.id) return '#' + CSS.escape(el.id);
                const path = [];
                let current = el;
                while (current && current.nodeType === Node.ELEMENT_NODE) {
                  let selector = current.nodeName.toLowerCase();
                  if (current.className && typeof current.className === 'string') {
                    const classes = current.className.trim().split(/\s+/).filter(c => c && !c.includes(':') && !c.includes('[') && !c.includes('(') && !c.includes(')'));
                    if (classes.length > 0) {
                      selector += '.' + classes.map(c => CSS.escape(c)).join('.');
                    }
                  }
                  let sib = current, index = 1;
                  while (sib = sib.previousElementSibling) {
                    if (sib.nodeName.toLowerCase() === current.nodeName.toLowerCase()) {
                      index++;
                    }
                  }
                  selector += `:nth-of-type(${index})`;
                  path.unshift(selector);
                  current = current.parentNode;
                }
                return path.join(' > ');
              };

              const elementsData = [];
              const allElements = document.querySelectorAll('*');
              allElements.forEach(el => {
                if (el.scrollTop > 0 || el.scrollLeft > 0) {
                  try {
                    elementsData.push({
                      selector: getSelector(el),
                      x: el.scrollLeft,
                      y: el.scrollTop
                    });
                  } catch (e) {}
                }
              });

              return {
                windowX: window.scrollX,
                windowY: window.scrollY,
                elements: elementsData
              };
            }
          });
          if (results && results[0] && results[0].result) {
            scrollData = results[0].result;
          }
        } catch (err) {
          console.warn(`Could not capture scroll position for tab ${tab.id} (${tabUrl}):`, err);
        }
      }

      return {
        url: tabUrl,
        title: tab.title || '',
        active: tab.active,
        pinned: tab.pinned,
        groupId: tab.groupId,
        scrollData
      };
    });

    const processedTabs = await Promise.all(tabPromises);

    snapshotWindows.push({
      state: win.state,
      top: win.top,
      left: win.left,
      width: win.width,
      height: win.height,
      incognito: win.incognito,
      tabs: processedTabs,
      groups: winGroups.map(g => ({
        id: g.id,
        title: g.title,
        color: g.color,
        collapsed: g.collapsed
      }))
    });
  }

  return {
    windows: snapshotWindows,
    capturedAt: Date.now()
  };
}

/**
 * Restores a captured workspace snapshot.
 * Creates new windows and tabs, restores scroll coordinates when loaded,
 * recreates groups, and closes previous active windows.
 */
async function restoreWorkspace(snapshot) {
  if (!snapshot || !snapshot.windows || snapshot.windows.length === 0) {
    throw new Error("Invalid snapshot structure or empty snapshot.");
  }



  for (const winData of snapshot.windows) {
    const createParams = {
      incognito: winData.incognito,
      state: winData.state
    };

    // Apply geometry only to normal windows to avoid API exceptions
    if (winData.state === 'normal') {
      if (winData.left !== undefined) createParams.left = winData.left;
      if (winData.top !== undefined) createParams.top = winData.top;
      if (winData.width !== undefined) createParams.width = winData.width;
      if (winData.height !== undefined) createParams.height = winData.height;
    }

    const tabsData = winData.tabs || [];
    if (tabsData.length > 0) {
      // Set the first tab URL to be opened on window creation
      createParams.url = tabsData[0].url;
    }

    // Create the window
    const newWindow = await chrome.windows.create(createParams);

    // Query for the first tab automatically created
    const initialTabs = await chrome.tabs.query({ windowId: newWindow.id });
    const firstTab = initialTabs[0];

    const createdTabsInfo = [];

    if (tabsData.length > 0) {
      // Update the first tab's state
      await chrome.tabs.update(firstTab.id, {
        active: tabsData[0].active,
        pinned: tabsData[0].pinned
      });
      createdTabsInfo.push({
        id: firstTab.id,
        groupId: tabsData[0].groupId
      });

      // Store and queue scroll restoration for the first tab
      if (tabsData[0].scrollData) {
        pendingScrollRestorations.set(firstTab.id, tabsData[0].scrollData);
      }
      applyScrollWhenReady(firstTab.id, tabsData[0].scrollData);

      // Create the rest of the tabs
      for (let i = 1; i < tabsData.length; i++) {
        const tabData = tabsData[i];
        const newTab = await chrome.tabs.create({
          windowId: newWindow.id,
          url: tabData.url,
          active: tabData.active,
          pinned: tabData.pinned
        });
        createdTabsInfo.push({
          id: newTab.id,
          groupId: tabData.groupId
        });

        // Store and queue scroll restoration for the current tab
        if (tabData.scrollData) {
          pendingScrollRestorations.set(newTab.id, tabData.scrollData);
        }
        applyScrollWhenReady(newTab.id, tabData.scrollData);
      }
    }

    // Group tabs if applicable
    const tabsToGroup = {};
    for (const tabInfo of createdTabsInfo) {
      if (tabInfo.groupId !== undefined && tabInfo.groupId !== -1) {
        if (!tabsToGroup[tabInfo.groupId]) {
          tabsToGroup[tabInfo.groupId] = [];
        }
        tabsToGroup[tabInfo.groupId].push(tabInfo.id);
      }
    }

    const groupsData = winData.groups || [];
    for (const groupSpec of groupsData) {
      const tabIds = tabsToGroup[groupSpec.id];
      if (tabIds && tabIds.length > 0) {
        try {
          const newGroupId = await chrome.tabs.group({
            tabIds: tabIds,
            createProperties: { windowId: newWindow.id }
          });
          
          await chrome.tabGroups.update(newGroupId, {
            title: groupSpec.title,
            color: groupSpec.color,
            collapsed: groupSpec.collapsed
          });
        } catch (e) {
          console.error("Error setting up tab group restoration:", e);
        }
      }
    }
  }


}

/**
 * Registers update listener and applies scroll position as soon as tab loading is complete.
 */
async function applyScrollWhenReady(tabId, scrollData) {
  if (!scrollData) return;
  const hasWindowScroll = scrollData.windowX || scrollData.windowY;
  const hasElementScroll = scrollData.elements && scrollData.elements.length > 0;
  if (!hasWindowScroll && !hasElementScroll) return;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      await injectScroll(tabId, scrollData);
      return;
    }
  } catch (e) {
    // Tab might be invalid or already closed
  }

  const listener = async (updatedTabId, changeInfo) => {
    if (updatedTabId === tabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      // Wait briefly for layout and rendering pipelines to stabilize
      setTimeout(() => injectScroll(tabId, scrollData), 250);
    }
  };

  chrome.tabs.onUpdated.addListener(listener);
}

/**
 * Executes a window and nested container scrollTo injection inside a tab.
 */
async function injectScroll(tabId, scrollData) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (windowX, windowY, elements) => {
        // Disable native browser scroll restoration to prevent conflicts
        if ('scrollRestoration' in history) {
          history.scrollRestoration = 'manual';
        }
        
        const performScroll = () => {
          window.scrollTo(windowX, windowY);
          if (elements && Array.isArray(elements)) {
            elements.forEach(item => {
              try {
                const el = document.querySelector(item.selector);
                if (el) {
                  el.scrollTop = item.y;
                  el.scrollLeft = item.x;
                }
              } catch (e) {}
            });
          }
        };

        // Immediate scroll
        performScroll();

        // Successive retries to override content loading and layout shifting
        const intervals = [100, 300, 600, 1000, 1500, 2500];
        intervals.forEach(delay => {
          setTimeout(performScroll, delay);
        });
      },
      args: [scrollData.windowX || 0, scrollData.windowY || 0, scrollData.elements || []]
    });
  } catch (err) {
    console.warn(`Failed to scroll tab ${tabId}:`, err);
  }
}
