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
const RX_ORDER_RE = /rx\.everydaymeds\.co\.uk\/order\//i;

function tabGet(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(tab);
    });
  });
}

function tabsQuery(query) {
  return new Promise((resolve) => {
    chrome.tabs.query(query, (tabs) => resolve(tabs || []));
  });
}

function tabUpdate(tabId, props) {
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, props, (tab) => {
      void chrome.runtime.lastError;
      resolve(tab || null);
    });
  });
}

function tabsRemove(tabIds) {
  return new Promise((resolve) => {
    if (!tabIds.length) { resolve(); return; }
    chrome.tabs.remove(tabIds, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function windowUpdate(windowId, props) {
  return new Promise((resolve) => {
    chrome.windows.update(windowId, props, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function orderPathname(url) {
  try { return new URL(url).pathname; } catch { return null; }
}

function isScrWorkflowTab(url) {
  if (!url) return false;
  return /portal\.spineservices\.nhs\.uk\/nationalcarerecordsservice/i.test(url)
    || /keywords-tool\.html/i.test(url);
}

async function findExistingRxTab(returnTabId, returnUrl, windowId) {
  if (returnTabId) {
    const tab = await tabGet(returnTabId);
    if (tab?.id && tab.url && RX_ORDER_RE.test(tab.url)) return tab.id;
  }
  const wantPath = returnUrl ? orderPathname(returnUrl) : null;
  if (windowId != null) {
    const tabs = await tabsQuery({ windowId });
    if (wantPath) {
      for (const tab of tabs) {
        if (tab.id && tab.url && RX_ORDER_RE.test(tab.url) && orderPathname(tab.url) === wantPath) {
          return tab.id;
        }
      }
    }
    for (const tab of tabs) {
      if (tab.id && tab.url && RX_ORDER_RE.test(tab.url)) return tab.id;
    }
  }
  try {
    const matches = await tabsQuery({ url: "https://rx.everydaymeds.co.uk/order/*" });
    if (wantPath) {
      const exact = matches.find((t) => t.id && orderPathname(t.url) === wantPath);
      if (exact?.id) return exact.id;
    }
    return matches[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function collectScrTabsToClose(windowId, trackedIds, senderTabId, rxTabId) {
  const toClose = new Set(Array.isArray(trackedIds) ? trackedIds : []);
  if (senderTabId) toClose.add(senderTabId);
  const tabs = windowId != null ? await tabsQuery({ windowId }) : await tabsQuery({});
  for (const tab of tabs) {
    if (!tab.id || tab.id === rxTabId) continue;
    if (isScrWorkflowTab(tab.url)) toClose.add(tab.id);
  }
  if (rxTabId) toClose.delete(rxTabId);
  return [...toClose];
}

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

async function inferScrSessionFromNewTab(tab) {
  if (!tab?.id || tab.windowId == null) return;
  const session = await getScrSession();
  if (session) return;
  const url = tab.pendingUrl || tab.url || "";
  if (!/portal\.spineservices\.nhs\.uk/i.test(url)) return;
  const tabs = await tabsQuery({ windowId: tab.windowId });
  const rxTab = tabs.find((t) => t.id !== tab.id && t.url && RX_ORDER_RE.test(t.url));
  if (!rxTab?.id) return;
  await startScrSession(rxTab.id, rxTab.url, tab.windowId);
  await addOpenedTab(tab.id);
}

chrome.tabs.onCreated.addListener((tab) => {
  inferScrSessionFromNewTab(tab);
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

async function closeScrAndReturn(senderTabId) {
  const session = await getScrSession();
  const senderTab = senderTabId ? await tabGet(senderTabId) : null;
  let windowId = session?.windowId ?? senderTab?.windowId ?? null;
  const returnTabId = session?.returnTabId ?? null;
  const returnUrl = session?.returnUrl ?? null;
  const tracked = session?.openedTabIds ?? [];

  const rxTabId = await findExistingRxTab(returnTabId, returnUrl, windowId);
  if (session) await setScrSession(null);

  if (rxTabId) {
    await tabUpdate(rxTabId, { active: true });
    const rxTab = await tabGet(rxTabId);
    if (rxTab?.windowId != null) {
      windowId = rxTab.windowId;
      await windowUpdate(rxTab.windowId, { focused: true });
    }
  }

  const idsToRemove = await collectScrTabsToClose(windowId, tracked, senderTabId, rxTabId);
  await tabsRemove(idsToRemove);

  return { success: true, activatedTabId: rxTabId || null, closedCount: idsToRemove.length };
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
    closeScrAndReturn(sender.tab && sender.tab.id)
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, error: e && e.message }));
    return true;
  }

  return true;
});
