# TabSnapshot - Workspace Manager

TabSnapshot is a high-performance, developer-friendly Chrome Extension built on Manifest V3. It allows users to take complete visual and structural snapshots of their entire active browser window setup—including multiple windows, window dimensions/positions, active tab groups, and tab metadata—so they can save, clear, and restore complex workspaces in one click.

Additionally, TabSnapshot features deep **Scroll Synchronization**, saving and restoring both window scroll coordinates and nested container scroll offsets (such as chat windows in Gemini/ChatGPT) for background-loaded tabs.

---

## 🚀 Key Features

* **Complete Workspace Capture**: Instantly snapshots window state, top/left positioning, dimensions, active tab groups (with color, title, and collapsed state), and all tab URLs.
* **Scroll Synchronization**: Restores your exact viewport reading position. Works with root window scrolling and modern single-page apps (SPAs) containing nested scrollable containers.
* **Focus-Deferred Restoration**: Background tabs restored in Chrome are held in a lazy-scroll queue. Their positions are applied immediately upon activation (when clicked) to resolve layout conflicts and lazy-rendering offsets.
* **Premium Dark Theme UI**: A sleek, card-based interface matching the gradient logo theme. Includes inline renaming, workspace statistics, quick restoration, and deletion features.
* **Stateless & Asynchronous Architecture**: Implemented with custom background service worker scripts utilizing stateless storage hooks (`chrome.storage.local`).

---

## 🛠️ Installation

1. Clone or download this project repository.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left.
5. Select the extension directory: `d:\Extension Development\TabSnapshot`.
6. TabSnapshot is now loaded and available in your browser toolbar!

---

## 📂 Code Architecture

```
TabSnapshot/
├── manifest.json       # Manifest V3 configurations, permissions & scopes
├── background.js      # Service Worker handling async capture/restoration loops
├── popup.html         # Premium theme user interface
├── popup.js           # popup DOM controllers and local state sync
└── icons/             # Custom logo assets
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

---

## 👨‍💻 Author

Developed by **Hafiz Muhammad Saad**

* [GitHub](https://github.com/itzsaad09)
* [LinkedIn](https://www.linkedin.com/in/itzsaad09/)
