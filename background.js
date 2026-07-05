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

function stripEmailSubject(text) {
  return String(text)
    .replace(/^(\[[^\]]+\]\s*\n+)?Subject:\s*[^\n]+\n+/i, "")
    .trim();
}

function getAiSettingsFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["server_url", "openai_key"], (r) => {
      resolve({
        serverUrl: (r && r.server_url) ? String(r.server_url).replace(/\/$/, "") : "",
        openaiKey: (r && r.openai_key) ? String(r.openai_key) : "",
      });
    });
  });
}

async function callOpenAiEmail(messages, openaiKey) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
      max_tokens: 900,
      temperature: 0.35,
    }),
  });
  if (!r.ok) {
    let msg = `OpenAI error (${r.status})`;
    try {
      const err = await r.json();
      if (err?.error?.message) msg = err.error.message;
    } catch (_) {}
    throw new Error(msg);
  }
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned an empty response.");
  return text;
}

async function callServerEmail(messages, serverUrl) {
  const r = await fetch(`${serverUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!r.ok) throw new Error(`Server error (${r.status})`);
  const j = await r.json();
  const text = j.response || j.message || j.content;
  if (!text) throw new Error("Server returned an empty response.");
  return text;
}

async function generatePatientEmail(scenario, context) {
  const prompt = (scenario || "").trim();
  if (!prompt) throw new Error("Describe the scenario first.");

  const { serverUrl, openaiKey } = await getAiSettingsFromStorage();
  if (!openaiKey && !serverUrl) {
    throw new Error("Add your OpenAI API key in extension Settings → Save, then try again.");
  }

  const sys = `You are an expert clinical message writer for EverydayMeds, a UK online GLP-1 weight loss pharmacy (Mounjaro, Wegovy, etc.).

You write patient chat messages the way ChatGPT would for a skilled prescriber: you understand their INTENT from their scenario note, not random checklist items.

PRIMARY RULE — FOLLOW THE PRESCRIBER'S SCENARIO:
- The prescriber's scenario description is your main instruction. Address EXACTLY what they are asking about.
- Do NOT invent unrelated topics (thyroid cancer, eating disorders, SCR conditions, etc.) unless the prescriber explicitly mentions them.
- Do NOT dump generic consultation or contraindication questions into the message.
- If the scenario mentions a treatment gap, last injection date, last order date, or another provider — that is the focus of the message.

CLINICAL REASONING (when relevant to the scenario):
- Each pen order typically covers ~4 weeks of weekly injections.
- If the patient's last order with EverydayMeds was months ago (e.g. February) but they say their last injection was recent (e.g. June/July), the supply from that old order would not last until now — politely explain this and ask whether they received medication from another provider during the gap.
- Ask for: date of last injection, strength/dose, and whether treatment came from another provider — when the scenario implies a supply/timeline mismatch.
- If there has been a long gap, mention the order may need dose adjustment after clinical review — do not approve or reject the prescription in the message.
- Use the order context below for dates, order numbers, and declared answers — weave in specific facts (e.g. "your last order with us was in February 2026") when available.

Message format:
- Write for the patient's encrypted chat thread (not external email — no Subject line).
- Start with "Dear {first name}," using the patient's first name from context.
- Professional, warm, British English — UK online pharmacy tone.
- Be specific about what you need from the patient.
- Mention the order is on hold while awaiting a response when appropriate.
- Do NOT include phone numbers or MedExpress branding.
- End with exactly:
Kind regards,
EveryDayMeds Clinical Team
- Keep focused and concise unless the scenario needs more detail.

Order context:
${context || "No additional order context available."}`;

  const messages = [
    { role: "system", content: sys },
    {
      role: "user",
      content: `Draft the patient message. Follow the prescriber's scenario closely — do not add unrelated clinical questions.\n\nPrescriber scenario:\n${prompt}`,
    },
  ];

  if (openaiKey) {
    try {
      return stripEmailSubject(await callOpenAiEmail(messages, openaiKey));
    } catch (e) {
      const msg = e?.message || "OpenAI request failed.";
      if (/failed to fetch|networkerror/i.test(msg)) {
        throw new Error("Network error — check your internet connection and OpenAI API key in Settings.");
      }
      throw new Error(msg);
    }
  }

  try {
    return stripEmailSubject(await callServerEmail(messages, serverUrl));
  } catch (e) {
    const msg = e?.message || "Server request failed.";
    if (/404/.test(msg)) {
      throw new Error("Server URL is not available. Add your OpenAI API key in Settings → Save.");
    }
    if (/failed to fetch|networkerror/i.test(msg)) {
      throw new Error("Network error — add your OpenAI API key in Settings → Save.");
    }
    throw new Error(msg);
  }
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

  if (message.type === "GENERATE_PATIENT_EMAIL") {
    generatePatientEmail(message.scenario, message.context)
      .then((text) => sendResponse({ success: true, text }))
      .catch((e) => sendResponse({ success: false, error: e?.message || "Generation failed" }));
    return true;
  }

  return true;
});
