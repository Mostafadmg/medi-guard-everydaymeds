// MediGuard AI (EverydayMeds) — Background Service Worker

// Side panel is Chrome-only. Guard so Safari's background worker doesn't
// throw on first load (chrome.sidePanel is undefined there), which would
// stop the listeners below from registering.
if (typeof chrome !== "undefined" && chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === "function") {
  try {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error(error));
  } catch (e) {
    console.warn("sidePanel not available:", e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("MediGuard AI (EverydayMeds) Installed");
});

// ── NHS SCR session — track tabs opened after "Go to NHS SCR" ───────────────
const SCR_SESSION_KEY = "scrSession";
const SCR_TRACK_MS = 10 * 60 * 1000;

async function getScrSession() {
  const r = await chrome.storage.session.get(SCR_SESSION_KEY);
  return r[SCR_SESSION_KEY] || null;
}

async function setScrSession(session) {
  if (session) await chrome.storage.session.set({ [SCR_SESSION_KEY]: session });
  else await chrome.storage.session.remove(SCR_SESSION_KEY);
}

async function startScrSession(returnTabId, returnUrl, windowId) {
  const session = {
    returnTabId,
    returnUrl,
    windowId,
    openedTabIds: [],
    startedAt: Date.now(),
  };
  await setScrSession(session);
  return session;
}

async function addOpenedTab(tabId) {
  const session = await getScrSession();
  if (!session || !tabId || tabId === session.returnTabId) return;
  if (Date.now() - session.startedAt > SCR_TRACK_MS) return;
  if (!session.openedTabIds.includes(tabId)) {
    session.openedTabIds.push(tabId);
    await setScrSession(session);
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  getScrSession().then((session) => {
    if (!session || !tab.id) return;
    if (Date.now() - session.startedAt > SCR_TRACK_MS) return;
    if (tab.windowId !== session.windowId) return;
    addOpenedTab(tab.id);
  });
});

const SCR_CLOSE_INJECT_URL_RE =
  /portal\.spineservices\.nhs\.uk\/nationalcarerecordsservice/i;

async function injectScrCloseButton(tabId) {
  const session = await getScrSession();
  if (!session) return;
  if (Date.now() - session.startedAt > SCR_TRACK_MS) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["scr-portal.js"],
    });
  } catch (_) {}
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  if (!SCR_CLOSE_INJECT_URL_RE.test(tab.url)) return;
  injectScrCloseButton(tabId);
  addOpenedTab(tabId);
});

async function closeScrAndReturn() {
  const session = await getScrSession();
  if (!session) return { success: false, error: "No SCR session" };

  const { returnTabId, returnUrl, openedTabIds } = session;
  await setScrSession(null);

  try {
    await chrome.tabs.update(returnTabId, { active: true });
  } catch {
    try {
      await chrome.tabs.create({ url: returnUrl, active: true });
    } catch (_) {}
  }

  const toClose = [...new Set(openedTabIds)].filter((id) => id !== returnTabId);
  if (toClose.length) {
    try {
      await chrome.tabs.remove(toClose);
    } catch (_) {}
  }

  return { success: true };
}

// Forward messages from content script to side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message.type === "ORDER_DATA_SCANNED" ||
    message.type === "TAB_COMPLETION_CHANGED" ||
    message.type === "ACTIVE_TAB_CHANGED"
  ) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch (e) {}
  }

  if (message.type === "SCR_LINK_CLICKED") {
    const tabId = sender.tab && sender.tab.id;
    const windowId = sender.tab && sender.tab.windowId;
    if (tabId && windowId) {
      startScrSession(tabId, message.returnUrl || sender.tab.url, windowId)
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  if (message.type === "SCR_PATIENT_PAGE_OPENED") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) {
      addOpenedTab(tabId)
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  if (message.type === "SCR_CLOSE_AND_RETURN") {
    closeScrAndReturn()
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, error: e && e.message }));
    return true;
  }

  return true;
});
