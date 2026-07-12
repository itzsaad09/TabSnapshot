// DOM Elements
const captureBtn = document.getElementById('capture-btn');
const snapshotList = document.getElementById('snapshot-list');
const snapshotCountEl = document.getElementById('snapshot-count');
const toastEl = document.getElementById('toast');
const toastMessageEl = document.getElementById('toast-message');

// State variables
let snapshots = [];

// Initialize Popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  setupEventListeners();
  renderUI();
});

// Load state from chrome.storage.local
async function loadState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['snapshots'], (result) => {
      snapshots = result.snapshots || [];
      resolve();
    });
  });
}

// Save state to chrome.storage.local
async function saveState() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ snapshots }, () => {
      resolve();
    });
  });
}

// Setup Event Listeners
function setupEventListeners() {
  captureBtn.addEventListener('click', handleCapture);
}

// Render dynamic UI components
function renderUI() {
  // Update snapshot count label
  const totalCount = snapshots.length;
  snapshotCountEl.textContent = `${totalCount} ${totalCount === 1 ? 'workspace' : 'workspaces'} saved`;

  // Clear current snapshot elements
  snapshotList.innerHTML = '';

  if (snapshots.length === 0) {
    snapshotList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <div class="empty-title">No Workspaces Found</div>
        <div class="empty-desc">Capture your current window and tab layout to get started.</div>
      </div>
    `;
    return;
  }

  // Populate lists
  snapshots.forEach((snap, idx) => {
    const totalTabs = snap.windows.reduce((acc, win) => acc + (win.tabs ? win.tabs.length : 0), 0);
    const totalWindows = snap.windows.length;
    const dateStr = new Date(snap.capturedAt).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const snapEl = document.createElement('div');
    snapEl.className = 'snapshot-item';
    
    snapEl.innerHTML = `
      <div class="snapshot-row-top">
        <div class="snapshot-title-group">
          <input type="text" class="snapshot-name-input" value="${escapeHtml(snap.name)}" data-index="${idx}">
          <div class="snapshot-meta">Captured ${dateStr}</div>
        </div>
        <div class="snapshot-actions">
          <button class="action-btn restore" data-index="${idx}" title="Restore Workspace">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
            </svg>
          </button>
          <button class="action-btn delete" data-index="${idx}" title="Delete Snapshot">
            <svg viewBox="0 0 24 24">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="snapshot-details-row">
        <span class="detail-tag">${totalWindows} ${totalWindows === 1 ? 'Window' : 'Windows'}</span>
        <span class="detail-tag">${totalTabs} ${totalTabs === 1 ? 'Tab' : 'Tabs'}</span>
      </div>
    `;

    // Handle inline rename on input change/blur
    const nameInput = snapEl.querySelector('.snapshot-name-input');
    nameInput.addEventListener('change', async (e) => {
      const index = parseInt(e.target.dataset.index);
      const newName = e.target.value.trim() || `Workspace ${index + 1}`;
      snapshots[index].name = newName;
      await saveState();
      showToast('Workspace renamed!');
    });

    // Handle restore action
    const restoreBtn = snapEl.querySelector('.restore');
    restoreBtn.addEventListener('click', async (e) => {
      const index = parseInt(restoreBtn.dataset.index);
      const targetSnapshot = snapshots[index];
      showToast('Restoring workspace layout...');
      
      chrome.runtime.sendMessage({
        type: 'RESTORE_WORKSPACE',
        snapshot: targetSnapshot
      }, (response) => {
        if (response && response.success) {
          showToast('Workspace restored successfully!');
        } else {
          showToast(`Error restoring: ${response?.error || 'Unknown error'}`);
        }
      });
    });

    // Handle delete action
    const deleteBtn = snapEl.querySelector('.delete');
    deleteBtn.addEventListener('click', async (e) => {
      const index = parseInt(deleteBtn.dataset.index);
      snapshots.splice(index, 1);
      await saveState();
      renderUI();
      showToast('Workspace snapshot deleted.');
    });

    snapshotList.appendChild(snapEl);
  });
}

// Trigger Capture
async function handleCapture() {
  showToast('Capturing current workspace...');
  
  chrome.runtime.sendMessage({ type: 'CAPTURE_WORKSPACE' }, async (response) => {
    if (response && response.success) {
      const newSnap = response.snapshot;
      const count = snapshots.length + 1;
      newSnap.name = `Workspace Snapshot #${count}`;
      
      snapshots.push(newSnap);
      await saveState();
      renderUI();
      showToast('Workspace captured successfully!');
    } else {
      showToast(`Capture failed: ${response?.error || 'Unknown error'}`);
    }
  });
}

// Show clean feedback toast messages
function showToast(message) {
  toastMessageEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2500);
}

// HTML sanitizer helper
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
