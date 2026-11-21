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
chrome.storage.local.remove("mgReopenPanel");

// Pull a newer copy from GitHub. The updater program replaces the files;
// this restarts the extension once those files are in place.
const UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/Mostafadmg/medi-guard-everydaymeds/main/manifest.json";
const UPDATE_RETRY_MS = 30 * 60 * 1000;

function isNewerVersion(remote, local) {
  const a = String(remote || "").split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(local || "").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function checkForExtensionUpdate() {
  try {
    const local = chrome.runtime.getManifest().version;
    const res = await fetch(UPDATE_MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) return;
    const remoteManifest = await res.json();
    const remote = remoteManifest && remoteManifest.version;
    if (!isNewerVersion(remote, local)) return;
    const stored = await chrome.storage.local.get("mgUpdateAttempt");
    const attempt = stored.mgUpdateAttempt || {};
    if (attempt.version === remote && Date.now() - (attempt.at || 0) < UPDATE_RETRY_MS) return;
    await chrome.storage.local.set({ mgUpdateAttempt: { version: remote, at: Date.now() } });
    chrome.runtime.reload();
  } catch (e) {
    console.warn("update check failed", e);
  }
}

checkForExtensionUpdate();
if (chrome.alarms) {
  chrome.alarms.create("mgUpdateCheck", { periodInMinutes: 30 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "mgUpdateCheck") checkForExtensionUpdate();
  });
}

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
    || /national-care-records-service\.nhs\.uk\/nationalcarerecordsservice/i.test(url)
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
  }
  try {
    const matches = await tabsQuery({ url: "https://rx.everydaymeds.co.uk/order/*" });
    if (wantPath) {
      const exact = matches.find((t) => t.id && orderPathname(t.url) === wantPath);
      if (exact?.id) return exact.id;
    }
  } catch {
    return null;
  }
  return null;
}

function isSearchResultsUrl(url) {
  return /\/nationalcarerecordsservice\/app\/search_results(?:[/?#]|$)/i.test(url || "");
}

function isKeywordsToolUrl(url) {
  return /keywords-tool\.html/i.test(url || "");
}

async function chooseScrTabsToClose(senderTab, rxTabId) {
  if (!senderTab?.id) return [];
  const url = senderTab.url || senderTab.pendingUrl || "";
  if (isSearchResultsUrl(url)) return [senderTab.id];

  const tabs = senderTab.windowId != null
    ? await tabsQuery({ windowId: senderTab.windowId })
    : await tabsQuery({});
  const ordered = tabs
    .filter((tab) => tab.id && tab.id !== rxTabId)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  if (isKeywordsToolUrl(url)) {
    const ids = [senderTab.id];
    const index = ordered.findIndex((tab) => tab.id === senderTab.id);
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = ordered[i];
      if (!candidate?.id || candidate.id === rxTabId) continue;
      if (isScrWorkflowTab(candidate.url) && !isKeywordsToolUrl(candidate.url)) {
        ids.push(candidate.id);
        break;
      }
    }
    if (ids.length < 2) {
      const previous = [...ordered].reverse().find((tab) =>
        tab.id !== senderTab.id
        && tab.id !== rxTabId
        && isScrWorkflowTab(tab.url)
        && !isKeywordsToolUrl(tab.url)
      );
      if (previous?.id) ids.push(previous.id);
    }
    return ids;
  }

  const workflow = ordered.filter((tab) => isScrWorkflowTab(tab.url));
  if (workflow.length <= 1) return [senderTab.id];
  const lastTwo = workflow.slice(-2).map((tab) => tab.id);
  if (!lastTwo.includes(senderTab.id)) lastTwo.push(senderTab.id);
  return [...new Set(lastTwo)];
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

  const idsToRemove = (await chooseScrTabsToClose(senderTab, rxTabId))
    .filter((id) => id && id !== rxTabId);
  if (keywordToolTabId && idsToRemove.includes(keywordToolTabId)) keywordToolTabId = null;
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
    chrome.storage.sync.get(["server_url", "openai_key", "tavily_api_key"], (r) => {
      resolve({
        serverUrl: (r && r.server_url) ? String(r.server_url).replace(/\/$/, "") : "",
        openaiKey: (r && r.openai_key) ? String(r.openai_key) : "",
        tavilyKey: (r && r.tavily_api_key) ? String(r.tavily_api_key) : "",
      });
    });
  });
}

function buildWebSearchQueries(context, userMessage) {
  const msg = (userMessage || "").trim();
  const ctx = context || "";
  const combined = `${msg}\n${ctx}`.toLowerCase();
  const queries = [];

  if (msg.length >= 6) {
    queries.push(`${msg} UK clinical pharmacy`.slice(0, 260));
  }

  const medLine = ctx.match(/^Medication ordered: (.+)$/m);
  const med = medLine ? medLine[1].trim() : "";
  if (med && msg) {
    queries.push(`${med} UK SmPC NHS patient advice ${msg}`.slice(0, 260));
  } else if (med) {
    queries.push(`${med} UK prescribing information NHS`.slice(0, 260));
  }

  const topicQueries = [];
  const trackingIds = [...new Set(
    [...`${msg}\n${ctx}`.matchAll(/\b([A-Z]{2}\d{9}[A-Z]{2})\b/gi)].map((match) => match[1].toUpperCase())
  )];
  if (trackingIds.length && /not receiv|not arrived|where is my|tracking|royal mail|haven't got|have not got/i.test(combined)) {
    queries.unshift(`Royal Mail tracking ${trackingIds[0]} delivery status`);
  }
  if (/treatment gap|supply check|another provider|last injection|switched provider/i.test(combined)) {
    topicQueries.push("GLP-1 weight loss treatment gap another provider UK prescribing continuity");
  }
  if (/side effect|nausea|vomit|diarr|pancreatitis|injection site/i.test(combined)) {
    topicQueries.push(`${med || "Mounjaro Wegovy"} common side effects UK NHS management`);
  }
  if (/bmi|weight loss|comorbid|eligible|obesity/i.test(combined)) {
    topicQueries.push("GLP-1 obesity weight management BMI eligibility UK NICE");
  }
  if (/mounjaro|tirzepatide/i.test(combined)) {
    topicQueries.push("Mounjaro tirzepatide UK missed dose storage pen expiry");
  }
  if (/wegovy|semaglutide|ozempic/i.test(combined)) {
    topicQueries.push("Wegovy semaglutide UK missed dose storage pen expiry");
  }
  if (/thyroid|medullary|men2/i.test(combined)) {
    topicQueries.push("GLP-1 thyroid monitoring UK prescribing guidance");
  }
  if (/mental health|depression|suicid|anxiety/i.test(combined)) {
    topicQueries.push("GLP-1 weight loss mental health depression warning UK");
  }
  if (/metformin|diabetes|hypoglyc|sick day/i.test(combined)) {
    topicQueries.push("GLP-1 metformin sick day rule hypoglycaemia UK diabetes");
  }
  if (/fatty liver|nafld|liver/i.test(combined)) {
    topicQueries.push("GLP-1 fatty liver NAFLD UK prescribing liver function monitoring");
  }
  if (/pregn|breastfeed|conceive/i.test(combined)) {
    topicQueries.push("GLP-1 pregnancy breastfeeding contraindication UK");
  }
  if (/gallbladder|cholecyst|gallstone/i.test(combined)) {
    topicQueries.push("GLP-1 gallbladder gallstones cholecystectomy UK contraindication");
  }

  topicQueries.forEach((q) => queries.push(q.slice(0, 260)));

  const seen = new Set();
  return queries
    .map((q) => q.trim())
    .filter((q) => q.length >= 8 && !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase()))
    .slice(0, 4);
}

async function searchWebOnce(query, tavilyKey) {
  const q = (query || "").trim();
  if (!q) return "";

  if (tavilyKey) {
    try {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: q,
          search_depth: "advanced",
          max_results: 6,
          include_answer: true,
          topic: "general",
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const parts = [];
        if (j.answer) parts.push(`Answer: ${j.answer}`);
        (j.results || []).slice(0, 6).forEach((item, i) => {
          parts.push(`${i + 1}. ${item.title || "Result"}\n${item.content || ""}\nSource: ${item.url || "unknown"}`.trim());
        });
        if (parts.length) return parts.join("\n\n");
      }
    } catch (_) {}
  }

  try {
    const r = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(q + " UK NHS")}&format=json&no_html=1&skip_disambig=1`
    );
    if (r.ok) {
      const j = await r.json();
      const parts = [];
      if (j.AbstractText) parts.push(j.AbstractText);
      if (j.AbstractURL) parts.push(`Source: ${j.AbstractURL}`);
      (j.RelatedTopics || []).slice(0, 5).forEach((t) => {
        if (t.Text) parts.push(t.Text);
        else if (Array.isArray(t.Topics)) {
          t.Topics.slice(0, 2).forEach((x) => { if (x.Text) parts.push(x.Text); });
        }
      });
      if (parts.length) return parts.join("\n");
    }
  } catch (_) {}

  return "";
}

async function searchWebForAi(queries, tavilyKey) {
  const list = Array.isArray(queries) ? queries : [queries];
  const blocks = [];
  for (const q of list) {
    const result = await searchWebOnce(q, tavilyKey);
    if (result) blocks.push(`=== Search: ${q} ===\n${result}`);
  }
  return blocks.join("\n\n");
}

function deliveryComplaint(text) {
  return /not receiv|haven'?t receiv|has not receiv|didn'?t receiv|did not receiv|not arrived|hasn'?t arrived|never arrived|where is my (order|parcel|item|delivery)|missing parcel|not been delivered|have not got|haven't got|not got (it|my|the)|has not received the order/i.test(text || "");
}

function extractTrackingIds(text) {
  const ids = [];
  const seen = new Set();
  const add = (value) => {
    const id = String(value || "").toUpperCase();
    if (!/\d{6,}/.test(id)) return;
    if (!/^[A-Z0-9]{11,22}$/.test(id)) return;
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  const source = String(text || "");
  for (const match of source.matchAll(/\b([A-Z]{2}\d{9}[A-Z]{2})\b/gi)) add(match[1]);
  for (const match of source.matchAll(/tracking-results\/([A-Z0-9]{10,24})/gi)) add(match[1]);
  for (const match of source.matchAll(/trackNumber=([A-Z0-9]{10,24})/gi)) add(match[1]);
  return ids.slice(0, 2);
}

function trackingPageUrl(id) {
  if (/^(EA|EB|EC|ED|EE|CP)/.test(id)) {
    return `https://www.parcelforce.com/track-trace?trackNumber=${encodeURIComponent(id)}`;
  }
  return `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(id)}`;
}

const trackingStatusCache = new Map();
const trackingStatusInflight = new Map();

function waitForTab(tabId, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch (_) {}
      resolve();
    }, ms);
    function onUpdated(updatedId, info) {
      if (updatedId === tabId && info.status === "complete") {
        clearTimeout(timer);
        try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch (_) {}
        resolve();
      }
    }
    try { chrome.tabs.onUpdated.addListener(onUpdated); } catch (_) { resolve(); }
  });
}

async function readTrackingPage(id) {
  const tab = await chrome.tabs.create({ url: trackingPageUrl(id), active: false });
  try {
    await waitForTab(tab.id, 9000);
    await new Promise((r) => setTimeout(r, 4000));
    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (document.body && (document.body.innerText || "")).slice(0, 4000),
    });
    const first = Array.isArray(injected) ? injected[0] : null;
    return String(first && first.result || "").replace(/[ \t]+\n/g, "\n").trim();
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch (_) {}
  }
}

function trackingLineFromPage(id, page) {
  const flat = String(page || "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const patterns = [
    /delivered[^.]{0,90}/i,
    /delivery attempted[^.]{0,90}/i,
    /out for delivery[^.]{0,70}/i,
    /we(?:'re| are) expecting it[^.]{0,90}/i,
    /we have your item[^.]{0,90}/i,
    /ready for collection[^.]{0,90}/i,
    /returned to sender[^.]{0,80}/i,
    /sorry, we (?:can't|cannot|could not) find[^.]{0,90}/i,
    /item (?:was )?not found[^.]{0,50}/i,
  ];
  const hit = patterns.map((re) => flat.match(re)).find(Boolean);
  if (!hit) return "";
  return `Tracking ${id} — text read from the courier tracking page. Status: ${hit[0].trim()}. Page text: ${flat.slice(0, 700)}`;
}

async function lookupOneTracking(id) {
  const cached = trackingStatusCache.get(id);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.text;
  if (trackingStatusInflight.has(id)) return trackingStatusInflight.get(id);
  const job = (async () => {
    let line = "";
    try {
      line = trackingLineFromPage(id, await readTrackingPage(id));
    } catch (_) {
      line = "";
    }
    if (!line) {
      try {
        const { tavilyKey } = await getAiSettingsFromStorage();
        const search = await searchWebOnce(`Royal Mail tracking status ${id}`, tavilyKey);
        if (search) {
          line = `Tracking ${id} — web search. Use this only if it is clearly about this number:\n${search.slice(0, 800)}`;
        }
      } catch (_) {}
    }
    if (!line) {
      line = `Tracking ${id} — the number is in the patient's messages. A live Royal Mail status could not be read. Give the patient this number and the Royal Mail link from the messages. Do not say the parcel was delivered or delayed.`;
    }
    trackingStatusCache.set(id, { at: Date.now(), text: line });
    return line;
  })();
  trackingStatusInflight.set(id, job);
  try {
    return await job;
  } finally {
    trackingStatusInflight.delete(id);
  }
}

async function withTrackingLookup(context) {
  const text = String(context || "");
  if (!deliveryComplaint(text)) return text;
  const ids = extractTrackingIds(text);
  if (!ids.length) return text;
  const blocks = [];
  for (const id of ids) blocks.push(await lookupOneTracking(id));
  return `${text}\n\n=== TRACKING LOOKUP ===\n${blocks.join("\n\n")}`;
}

function buildEmailSystemPrompt(context, webResults) {
  let sys = `You are an expert UK clinical prescriber assistant for EverydayMeds, an online GLP-1 weight loss pharmacy (Mounjaro/tirzepatide, Wegovy/semaglutide, etc.).

You work like ChatGPT for a skilled prescriber: deeply understand intent, reason carefully, use all available data, and write accurate patient messages.

HOW TO THINK (internal — do not output these steps):
1. Read the prescriber's instructions and identify the exact goal.
2. Extract every relevant fact from order context, consultation Q&A, chat, attachments, and web results.
3. Note what is UNKNOWN — ask the patient rather than guessing.
4. Apply UK GLP-1 prescribing logic (supply gaps, dose continuity, contraindications, safety-netting).
5. Draft a clear, accurate patient message.

PRIMARY RULE — FOLLOW THE PRESCRIBER:
- Their instructions are your main task. Address EXACTLY what they ask.
- Do NOT invent unrelated topics unless they appear in context or the prescriber mentions them.
- If the scenario mentions treatment gap, last injection, last order date, or another provider — focus on that.

ACCURACY & ANTI-HALLUCINATION (CRITICAL):
- Ground every statement in order context, consultation answers, attachments, or web search results.
- NEVER invent dates, doses, order numbers, diagnoses, side effects, tracking numbers, or patient statements.
- NEVER claim you reviewed SCR, documents, photos, or chat unless that data is in context or attachments.
- The FULL ORDER RECORD is copied from the live page: clinical, consultation, documents, order history, monitoring, notes, activity, and communications on this order and earlier orders.
- If a fact is not written there, it is unknown. Ask the patient. Do not fill the gap.
- Only mention a patient question (tracking, delay, side effect, another provider, wrong item) when that question is written in the communications, notes, or monitoring.
- If the record has no open question, do not invent one. Follow the prescriber's instruction and nothing else.
- Mention an ID or weight photo only when the context says the photo was readable and disagreed with the name or weight on the order.
- If information is missing, ask specific questions — do not assume.
- Prefer precise, cautious clinical language over vague reassurance.
- When web results conflict with order context, trust order context for this patient; use web only for general UK clinical facts.

DELIVERY AND TRACKING:
- If the record says the patient has not received the order, or is asking where it is, the message must answer that.
- If a tracking number or a Royal Mail / Parcelforce link is written in the record, include that exact number and that exact link. Never invent a different number or a different link.
- This tracking link is the one URL you include even when the prescriber did not ask for a URL.
- If TRACKING LOOKUP gives a status for that number, tell the patient that status in plain words. Use only a status written there.
- If TRACKING LOOKUP says the live status could not be read, still give the number and the link. Do not say the parcel was delivered, delayed, lost, or still in transit.

WEB SEARCH (when provided):
- Use web results for up-to-date UK NHS/NICE/SmPC facts: dosing, missed doses, side effects, contraindications, monitoring.
- When web search is available, check a clinical claim against NICE, the BNF, NHS, or the SmPC before you state it. If you could not verify it, do not state it as fact.
- Do not copy web text verbatim — synthesise into plain patient-friendly language.
- Do not cite URLs in the patient message unless the prescriber asks, except a Royal Mail or Parcelforce tracking link that is already written in the messages when the patient has not received the order.

REFINEMENT (multi-turn):
- Follow-up notes ("shorter", "add order on hold", "mention February order") → revise the previous draft.
- Return the FULL revised patient message only — no commentary.

ATTACHMENTS:
- Extract facts from screenshots (SCR, chat, consultation, documents) and weave naturally into the message.
- If unreadable, ask for clearer information.

CLINICAL REASONING (when relevant):
- Each pen order ≈ 4 weeks of weekly injections.
- Gap since last order + recent injection claim → ask about another provider/source.
- Do not approve or reject — request info or explain next steps.

Message format:
- Encrypted patient chat (not email — no Subject line).
- Start with "Dear {first name}," using first name from context.
- Professional, warm, British English.
- Mention order on hold when appropriate.
- No phone numbers or MedExpress branding.
- End with exactly:
Kind regards,
EveryDayMeds Clinical Team

Order context:
${context || "No additional order context available."}`;

  if (webResults) {
    sys += `\n\nWeb search results (factual UK clinical reference — synthesise accurately, do not invent beyond this):\n${webResults}`;
  } else {
    sys += `\n\n(No web search results for this request — rely only on order context and attachments.)`;
  }
  return sys;
}

function buildUserMessageContent(userMessage, attachments, isRefine) {
  const intro = isRefine
    ? "Revise the patient message based on this instruction:"
    : "Draft the patient message. Follow the prescriber's instructions closely — do not add unrelated clinical questions.\n\nPrescriber instructions:";
  let text = `${intro}\n${userMessage || "(see attachments)"}`;

  const parts = [];
  for (const att of attachments || []) {
    if (att.kind === "image" && att.dataUrl) {
      parts.push({ type: "image_url", image_url: { url: att.dataUrl, detail: "high" } });
    } else if (att.kind === "text" && att.text) {
      text += `\n\n[Attached file: ${att.name}]\n${att.text}`;
    }
  }
  parts.unshift({ type: "text", text });
  return parts.length === 1 ? text : parts;
}

const AI_MODEL = "gpt-6.2-astra";
const AI_MODEL_FALLBACK = "gpt-4o";
const CLINICAL_SEARCH_DOMAINS = [
  "nice.org.uk",
  "nhs.uk",
  "medicines.org.uk",
  "gov.uk",
  "sps.nhs.uk",
  "mhra.gov.uk",
  "bnf.org",
  "rcgp.org.uk",
];

function messagesToResponseInput(messages) {
  const instructions = [];
  const input = [];
  for (const message of messages || []) {
    const role = message?.role;
    const content = message?.content;
    if (role === "system") {
      instructions.push(typeof content === "string" ? content : JSON.stringify(content || ""));
      continue;
    }
    const outRole = role === "assistant" ? "assistant" : "user";
    if (typeof content === "string" || content == null) {
      input.push({ role: outRole, content: String(content || "") });
      continue;
    }
    if (Array.isArray(content)) {
      const parts = [];
      for (const part of content) {
        if (part?.type === "text" && part.text) parts.push({ type: "input_text", text: String(part.text) });
        else if (part?.type === "image_url") {
          const url = part.image_url?.url || part.image_url;
          if (url) parts.push({ type: "input_image", image_url: String(url) });
        }
      }
      input.push({ role: outRole, content: parts.length ? parts : "" });
    }
  }
  return { instructions: instructions.join("\n\n"), input };
}

function extractResponseText(payload) {
  if (payload?.output_text) return String(payload.output_text).trim();
  const chunks = [];
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const part of item.content || []) {
      if (part?.text) chunks.push(String(part.text));
    }
  }
  return chunks.join("\n").trim();
}

async function readOpenAiError(response) {
  let msg = `OpenAI error (${response.status})`;
  try {
    const err = await response.json();
    if (err?.error?.message) msg = err.error.message;
  } catch (_) {}
  return msg;
}

async function callOpenAiResponses(messages, openaiKey, options) {
  const opts = options || {};
  const { instructions, input } = messagesToResponseInput(messages);
  const body = {
    model: AI_MODEL,
    instructions: instructions || "Follow the user's request.",
    input: input.length ? input : "",
    max_output_tokens: opts.maxTokens || 1600,
    reasoning: { effort: opts.reasoning || "low" },
  };
  if (opts.webSearch) {
    const tool = {
      type: "web_search",
      search_context_size: "high",
      user_location: { type: "approximate", approximate: { country: "GB" } },
    };
    if (Array.isArray(opts.searchDomains) && opts.searchDomains.length) {
      tool.filters = { allowed_domains: opts.searchDomains };
    }
    body.tools = [tool];
    body.tool_choice = "auto";
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readOpenAiError(response));
  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) throw new Error("OpenAI returned an empty response.");
  return text;
}

async function callOpenAiChatCompletions(messages, openaiKey, options) {
  const opts = options || {};
  let outgoing = messages;
  if (opts.webSearch) {
    try {
      const { tavilyKey } = await getAiSettingsFromStorage();
      const lastUser = [...messages].reverse().find((message) => message?.role === "user");
      const question = typeof lastUser?.content === "string" ? lastUser.content : "";
      const queries = buildWebSearchQueries("", question).slice(0, 2);
      const web = queries.length ? await searchWebForAi(queries, tavilyKey) : "";
      if (web) {
        outgoing = messages.slice();
        outgoing.splice(1, 0, {
          role: "system",
          content: "Web search results. For clinical facts, prefer NICE, NHS, the BNF, and the SmPC. Do not treat forums or news as guidance.\n" + web,
        });
      }
    } catch (_) {}
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: AI_MODEL_FALLBACK,
      messages: outgoing,
      max_tokens: opts.maxTokens || 2400,
      temperature: opts.temperature != null ? opts.temperature : 0.2,
    }),
  });
  if (!response.ok) throw new Error(await readOpenAiError(response));
  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned an empty response.");
  return text;
}

async function callOpenAiEmail(messages, openaiKey, options) {
  try {
    return await callOpenAiResponses(messages, openaiKey, options);
  } catch (error) {
    const msg = String(error?.message || "");
    if (/401|403|incorrect api key|invalid_api_key|insufficient_quota/i.test(msg)) throw error;
    return callOpenAiChatCompletions(messages, openaiKey, options);
  }
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

async function generatePatientEmail(payload) {
  const userMessage = (payload?.userMessage || payload?.scenario || "").trim();
  const history = Array.isArray(payload?.history) ? payload.history : [];
  const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
  const webSearch = !!payload?.webSearch;
  let context = payload?.context || "";

  if (!userMessage && !attachments.length) {
    throw new Error("Describe the scenario or attach a file first.");
  }

  const { serverUrl, openaiKey, tavilyKey } = await getAiSettingsFromStorage();
  if (!openaiKey && !serverUrl) {
    throw new Error("Add your OpenAI API key in extension Settings → Save, then try again.");
  }

  context = await withTrackingLookup(context);

  let webResults = "";
  if (webSearch) {
    const queries = buildWebSearchQueries(context, userMessage);
    if (queries.length) {
      webResults = await searchWebForAi(queries, tavilyKey);
    }
  }

  const isRefine = history.length > 0;
  const sys = buildEmailSystemPrompt(context, webResults);
  const messages = [{ role: "system", content: sys }];

  for (const turn of history.slice(-16)) {
    if (turn?.role === "user" || turn?.role === "assistant") {
      messages.push({ role: turn.role, content: turn.content });
    }
  }

  messages.push({
    role: "user",
    content: buildUserMessageContent(userMessage, attachments, isRefine),
  });

  if (openaiKey) {
    try {
      const clinical = /dose|side effect|nice|smpc|bnf|eligib|contraindic|pregnan|pancreat|thyroid|missed|storage|mounjaro|wegovy|semaglutide|tirzepatide|bmi|nausea|guideline|interaction|sick day|gallbladder/i.test(userMessage);
      const tracking = /track|royal mail|parcel|not receiv|deliver/i.test(`${userMessage}\n${context}`);
      return stripEmailSubject(await callOpenAiEmail(messages, openaiKey, {
        maxTokens: 2400,
        reasoning: "low",
        webSearch,
        searchDomains: webSearch && clinical && !tracking ? CLINICAL_SEARCH_DOMAINS : null,
      }));
    } catch (e) {
      const msg = e?.message || "OpenAI request failed.";
      if (/failed to fetch|networkerror/i.test(msg)) {
        throw new Error("Network error — check your internet connection and OpenAI API key in Settings.");
      }
      throw new Error(msg);
    }
  }

  try {
    const plainMessages = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));
    return stripEmailSubject(await callServerEmail(plainMessages, serverUrl));
  } catch (e) {
    const msg = e?.message || "Server request failed.";
    if (/404/.test(msg)) {
      throw new Error("Server URL is not available. Add your OpenAI API key in Settings → Save.");
    }
    throw new Error(msg);
  }
}

function normaliseBriefPoint(p) {
  if (p && typeof p === "object") {
    let order = String(p.order || "").trim();
    if (order && !/^#/.test(order) && /\d/.test(order)) order = "#" + order.replace(/^#/, "");
    return {
      when: String(p.when || "").trim(),
      order,
      where: String(p.where || p.source || "").trim(),
      text: String(p.text || p.fact || "").trim(),
      said: String(p.said || p.quote || "").trim(),
    };
  }
  return { when: "", order: "", where: "", text: String(p || "").trim(), said: "" };
}

function parseOrderBrief(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(raw.slice(start, end + 1));
      const points = Array.isArray(obj.points)
        ? obj.points.map(normaliseBriefPoint).filter((p) => p.text || p.said).slice(0, 5)
        : [];
      return { relevant: !!obj.relevant && points.length > 0, points };
    } catch (_) {}
  }
  return { relevant: false, points: [] };
}

function buildOrderBriefSystemPrompt() {
  return `You brief a UK EverydayMeds prescriber before they reply to a patient. You do not write the patient message and you do not approve or reject the order.

You are given text copied from this order's tabs (clinical, consultation, documents, history, monitoring, notes, activity) and from the patient's messages on this order and earlier orders. Any images are ID/weight photos or still frames captured from patient-uploaded videos on the documents tab.

Rules:
- Use only facts written in the text, or text you can actually read in a photo.
- Never invent a date, dose, tracking number, side effect, name, order number, or message.
- Never say a photo matches or does not match unless the name or weight is readable.
- If a photo is blurry or unreadable, ignore it.
- Set relevant to true only when one of these is present: the patient asked a question, requested something, said they expect something (a photo, a higher dose, a refund, a cancellation, a delivery), reported a problem (tracking, delay, not received, side effect, wrong item, dose, another provider), a prescriber note flags something that changes the reply, or a readable photo disagrees with the patient name or the recorded weight.
- Read the consultation answers, not only the message thread. If they ticked or typed a request or a question, that is relevant. said must be their wording.
- A patient saying the order was not received, has not arrived, or asking where it is IS relevant, even when a staff message already contains a tracking link. A routine "your order has been dispatched" with no complaint is not relevant.
- When a DELIVERY AND TRACKING section is present and it says the patient has not received the order, the first point must be that issue. text is "Not received" plus the tracking number when one is written. said is the patient's own sentence from "Patient wording". If TRACKING LOOKUP gives a status, add that status to text. If it says the status could not be read, do not invent one.
- Routine order updates with no question are not relevant.
- If nothing meets that bar, return {"relevant":false,"points":[]}
- If something does, return JSON with at most 5 points. Each point is an object:
  {"relevant":true,"points":[{"when":"18 Nov 2026, 12:19","order":"#27065","where":"Consultation","text":"Side effects","said":"Nausea & vomiting, constipation, dizziness, hair loss, changes in taste."}]}
- when: the date and the clock time written next to that fact, for example "18 Nov 2026, 12:19". Use a "Submitted" time, a message time, or a note time when one is written. If only a date is written, use the date. If no time is written, do not invent one.
- order: the order number that fact belongs to, with a #. Use the current order number when the fact is on the order open now. If no order number is written, use "".
- where: one of Consultation, Messages, Notes, Monitoring, Documents, History, Activity, Clinical.
- text: a short label of the topic only, such as "Side effects" or "Tracking". Do not put the patient's words here.
- said: what the patient wrote or ticked, in their wording. Copy the answer, the comment, or the message. A tick-list is the options they chose, as written on the page. A typed comment is that comment. You may shorten a long comment, but do not rewrite it as "Patient reported". Do not add anything they did not write.
- No advice to approve or reject. No drafted reply.
Return JSON only.`;
}

async function summariseOrderContext(payload) {
  let context = String(payload?.context || "").trim();
  const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
  if (!context && !attachments.length) return { relevant: false, points: [] };

  const { openaiKey, serverUrl } = await getAiSettingsFromStorage();
  if (!openaiKey && !serverUrl) {
    throw new Error("Add your OpenAI API key in extension Settings → Save, then try again.");
  }
  context = await withTrackingLookup(context);

  let text = "Read this order record. Return JSON only.\n";
  const orderNo = String(payload?.orderNo || "").replace(/^#/, "").trim();
  const orderDate = String(payload?.orderDate || "").trim();
  if (orderNo || orderDate) {
    text += `Current order on screen: ${orderNo ? "#" + orderNo : "unknown number"}`;
    if (orderDate) text += `, dated ${orderDate}`;
    text += ". Facts on this page belong to this order unless the text names a different order.\n";
  }
  text += "\n" + (context || "(no page text)");
  const parts = [{ type: "text", text }];
  let images = 0;
  for (const att of attachments) {
    if (images >= 6) break;
    if (att?.kind === "image" && att.dataUrl) {
      parts.push({ type: "text", text: `Photo or video frame from the documents tab: ${att.name || "document"}` });
      parts.push({ type: "image_url", image_url: { url: att.dataUrl, detail: "high" } });
      images += 1;
    }
  }
  const userContent = parts.length === 1 ? text : parts;
  const messages = [
    { role: "system", content: buildOrderBriefSystemPrompt() },
    { role: "user", content: userContent },
  ];

  let raw = "";
  if (openaiKey) {
    raw = await callOpenAiEmail(messages, openaiKey, { temperature: 0, maxTokens: 1800, reasoning: "low" });
  } else {
    const plain = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));
    raw = await callServerEmail(plain, serverUrl);
  }
  return parseOrderBrief(raw);
}

function buildOrderOverviewPrompt() {
  return `You brief the prescriber about one EverydayMeds order. You are not writing to the patient, and you do not approve or reject.

Use only the order record. Never invent an SCR result, a date, a time, a dose, a weight, or something the patient said.

Write a short summary in plain sentences, with these headings only when the record has something for them:
Order — number, date and time, medicine, dose, quantity.
Patient — age, BMI, height, weight, if written.
SCR — exactly what is logged (for example accessed, no record, consent). If the record does not mention SCR, write "SCR: not on this page."
What they said — important consultation answers or messages in the patient's own wording, with the date and time when one is written.
Delivery — if the record says the order was not received, include the tracking number, the tracking link, and the Royal Mail status from TRACKING LOOKUP. If no live status was read, say the status could not be read. Do not invent one.
Documents — verified, missing, or rejected.
History and monitoring — earlier orders, weight change, side effects they reported.
Notes — prescriber notes that still matter.

Skip a heading when the record is silent on it. No patient letter.`;
}

async function summariseOrderOverview(payload) {
  let context = String(payload?.context || "").trim();
  if (!context) throw new Error("This order's tabs were not on the page.");
  const { openaiKey, serverUrl } = await getAiSettingsFromStorage();
  if (!openaiKey && !serverUrl) {
    throw new Error("Add your OpenAI API key in extension Settings → Save, then try again.");
  }
  context = await withTrackingLookup(context);
  const orderNo = String(payload?.orderNo || "").replace(/^#/, "").trim();
  const orderDate = String(payload?.orderDate || "").trim();
  let user = "Summarise this order for the prescriber.\n";
  if (orderNo || orderDate) {
    user += `Current order: ${orderNo ? "#" + orderNo : "unknown number"}`;
    if (orderDate) user += `, ${orderDate}`;
    user += ".\n";
  }
  user += "\n" + context.slice(0, 16000);
  const messages = [
    { role: "system", content: buildOrderOverviewPrompt() },
    { role: "user", content: user },
  ];
  if (openaiKey) return (await callOpenAiEmail(messages, openaiKey, { temperature: 0, maxTokens: 1800, reasoning: "low" })).trim();
  const plain = messages.map((m) => ({ role: m.role, content: m.content }));
  return (await callServerEmail(plain, serverUrl)).trim();
}

function buildOrderAskPrompt(overview) {
  let sys = `You are the prescriber's clinical assistant for this one EverydayMeds order. You are chatting with the prescriber, not with the patient.

This is a continuing conversation. Earlier turns are their questions and your answers. Use them. Do not drop a fact already established in this chat, and do not answer as if this is the first message.

Read the consultation answers and the messages. Notice when the patient asks a question, requests something, or expects something. Say that in their wording. A request for a higher dose, a refund, a cancellation, a delay, a different pen, or a photo they say they will upload is a request, not a vague update.

Facts about this patient come only from the order record, attached photos/video frames from the documents tab, and this chat. If an order summary is included, the record wins if they differ. Never invent a date, time, dose, SCR result, tracking number, or something the patient did not write. If it is not in the record or readable in an attachment, say it is not on the order.

When images are attached, treat them as documents-tab photos or still frames from patient-uploaded videos (ID, weight/scale, selfies, packaging). Read visible text, names, weights, and what the video frames show. If a frame is blurry or unreadable, say so — do not guess.

Clinical facts that are not about this patient's own words (a dose rule, a side effect, eligibility, a missed dose, storage, a contraindication) must be checked with web search against NICE, the BNF, NHS, or the SmPC on medicines.org.uk. Prefer those sources. If you could not verify a clinical point, say so. Do not invent a guideline.

If they ask where the parcel is, use the tracking number and link from the record. Use a delivery status only when TRACKING LOOKUP states it. If the lookup says it could not be read, say that, and still give the number and the link.
When they ask what the patient said, quote the patient's wording and include the date and time if it is written.
If they ask you to write the patient message, write the full draft and start it with "Draft only — nothing is sent."
Keep the answer short enough to read while working.`;
  if (overview) sys += `\n\nOrder summary already prepared:\n${overview}`;
  return sys;
}

function buildAskUserContent(question, attachments) {
  let text = String(question || "").trim() || "Review the attached order documents and video frames.";
  const parts = [];
  let images = 0;
  for (const att of attachments || []) {
    if (att?.kind === "image" && att.dataUrl && images < 8) {
      parts.push({ type: "text", text: `Document/video frame from the order: ${att.name || "document"}` });
      parts.push({ type: "image_url", image_url: { url: att.dataUrl, detail: "high" } });
      images += 1;
    } else if (att?.kind === "text" && att.text) {
      text += `\n\n[Attached file: ${att.name || "file"}]\n${String(att.text).slice(0, 12000)}`;
    }
  }
  parts.unshift({ type: "text", text });
  return parts.length === 1 ? text : parts;
}

async function askAboutOrder(payload) {
  const question = String(payload?.question || "").trim();
  const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
  if (!question && !attachments.length) throw new Error("Type a question about this order.");
  let context = String(payload?.context || "").trim();
  const overview = String(payload?.overview || "").trim();
  const history = Array.isArray(payload?.history) ? payload.history : [];
  const { openaiKey, serverUrl } = await getAiSettingsFromStorage();
  if (!openaiKey && !serverUrl) {
    throw new Error("Add your OpenAI API key in extension Settings → Save, then try again.");
  }
  context = await withTrackingLookup(context);
  const messages = [{ role: "system", content: buildOrderAskPrompt(overview) }];
  if (context) {
    messages.push({
      role: "system",
      content: "Order record:\n" + context.slice(0, 14000),
    });
  }
  for (const turn of history.slice(-20)) {
    if (turn?.role === "user" || turn?.role === "assistant") {
      messages.push({ role: turn.role, content: String(turn.content || "").slice(0, 6000) });
    }
  }
  messages.push({ role: "user", content: buildAskUserContent(question, attachments) });
  const blob = `${question}\n${history.map((turn) => turn?.content || "").join("\n")}`;
  const clinical = /dose|side effect|nice|smpc|bnf|eligib|contraindic|pregnan|pancreat|thyroid|missed|storage|mounjaro|wegovy|semaglutide|tirzepatide|bmi|nausea|guideline|interaction|sick day|gallbladder|clinical|document|video|photo|id|weight|scale/i.test(blob);
  const tracking = /track|royal mail|parcel|not receiv|deliver/i.test(blob);
  if (openaiKey) {
    return (await callOpenAiEmail(messages, openaiKey, {
      temperature: 0.2,
      maxTokens: 1600,
      reasoning: "medium",
      webSearch: payload?.webSearch !== false,
      searchDomains: clinical && !tracking ? CLINICAL_SEARCH_DOMAINS : null,
    })).trim();
  }
  const plain = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));
  return (await callServerEmail(plain, serverUrl)).trim();
}

const PARALLEL_POOL_KEY = "clinical_parallel_pool";

function getParallelPool() {
  return new Promise((resolve) => {
    chrome.storage.session.get([PARALLEL_POOL_KEY], (r) => {
      resolve(r[PARALLEL_POOL_KEY] || null);
    });
  });
}

function saveParallelPool(pool) {
  return new Promise((resolve) => {
    if (pool) chrome.storage.session.set({ [PARALLEL_POOL_KEY]: pool }, () => resolve());
    else chrome.storage.session.remove(PARALLEL_POOL_KEY, () => resolve());
  });
}

function broadcastParallelPool(pool, event) {
  try {
    chrome.runtime.sendMessage({
      type: "CLINICAL_PARALLEL_UPDATE",
      event: event || "progress",
      data: pool ? {
        active: !!pool.active,
        pending: (pool.pending || []).length,
        processed: pool.processed || 0,
        failed: pool.failed || 0,
        workers: (pool.workerTabIds || []).length,
        lastError: pool.lastError || null,
      } : null,
    }).catch(() => {});
  } catch (_) {}
}

async function claimParallelOrder(tabId) {
  const pool = await getParallelPool();
  if (!pool?.active || !tabId) return { url: null, scrMode: pool?.scrMode, done: !pool?.active };
  while ((pool.pending || []).length) {
    const url = pool.pending.shift();
    if (!pool.inProgress) pool.inProgress = {};
    pool.inProgress[String(tabId)] = url;
    await saveParallelPool(pool);
    broadcastParallelPool(pool, "progress");
    return { url, scrMode: pool.scrMode, done: false };
  }
  if (pool.inProgress) delete pool.inProgress[String(tabId)];
  const stillBusy = pool.inProgress && Object.keys(pool.inProgress).length;
  if (!stillBusy) {
    pool.active = false;
    await saveParallelPool(pool);
    broadcastParallelPool(pool, "done");
    return { url: null, scrMode: pool.scrMode, done: true };
  }
  await saveParallelPool(pool);
  return { url: null, scrMode: pool.scrMode, done: false, idle: true };
}

async function completeParallelOrder(tabId, success, error) {
  const pool = await getParallelPool();
  if (!pool) return null;
  if (pool.inProgress) delete pool.inProgress[String(tabId)];
  if (success) pool.processed = (pool.processed || 0) + 1;
  else {
    pool.failed = (pool.failed || 0) + 1;
    pool.lastError = error || "Clinical check failed";
    if (pool.stopOnError !== false) pool.active = false;
  }
  await saveParallelPool(pool);
  broadcastParallelPool(pool, success ? "progress" : "error");
  return pool;
}

async function startParallelClinicalPool(message, sender) {
  const tabId = sender.tab && sender.tab.id;
  const windowId = sender.tab && sender.tab.windowId;
  if (!tabId || windowId == null) {
    return { success: false, error: "Open the prescription queue in this tab first" };
  }
  const existing = await getParallelPool();
  if (existing?.active) {
    return { success: false, error: "Parallel clinical check is already running" };
  }
  const urls = Array.isArray(message.urls) ? message.urls.filter(Boolean) : [];
  if (!urls.length) return { success: false, error: "No orders to process" };
  let workerCount = parseInt(message.workerCount, 10);
  if (!Number.isFinite(workerCount)) workerCount = 3;
  workerCount = Math.max(2, Math.min(20, workerCount));
  const queueUrl = message.queueUrl || "https://rx.everydaymeds.co.uk/pending-orders-new?tab=rx_approved";
  const scrMode = message.scrMode === "accessed" ? "accessed" : "not_accessed";

  const pool = {
    active: true,
    pending: urls.slice(),
    inProgress: {},
    processed: 0,
    failed: 0,
    scrMode,
    queueUrl,
    workerTabIds: [tabId],
    lastError: null,
    stopOnError: message.stopOnError === true,
  };
  await saveParallelPool(pool);
  broadcastParallelPool(pool, "started");

  const workerLanding = `${queueUrl}${queueUrl.includes("?") ? "&" : "?"}mg_clinical_worker=1`;
  for (let i = 1; i < workerCount; i++) {
    const tab = await tabCreate({ url: workerLanding, windowId, active: false });
    if (tab?.id) pool.workerTabIds.push(tab.id);
  }
  await saveParallelPool(pool);

  const kick = (id) => {
    chrome.tabs.sendMessage(id, { type: "CLINICAL_PARALLEL_WORK" }).catch(() => {});
  };
  kick(tabId);
  pool.workerTabIds.slice(1).forEach((id, i) => {
    setTimeout(() => kick(id), 500 * (i + 1));
  });

  return { success: true, workers: pool.workerTabIds.length, total: urls.length };
}

function tabCreate(props) {
  return new Promise((resolve) => {
    chrome.tabs.create(props, (tab) => {
      void chrome.runtime.lastError;
      resolve(tab || null);
    });
  });
}

async function stopParallelClinicalPool() {
  const pool = await getParallelPool();
  if (!pool) return { success: true };
  pool.active = false;
  pool.lastError = "Stopped by user";
  pool.pending = [];
  await saveParallelPool(pool);
  broadcastParallelPool(pool, "stopped");
  return { success: true };
}

// Forward messages from content script to side panel
const FIND_PATIENT_RE = /\/nationalcarerecordsservice\/app\/find_patient/;
const SEARCH_RESULTS_RE = /\/nationalcarerecordsservice\/app\/search_results/;
const PATIENT_RE = /\/nationalcarerecordsservice\/app\/patient\b/;
const NHS_FIND_PATIENT_URL = "https://portal.spineservices.nhs.uk/nationalcarerecordsservice/app/find_patient";
const nhsFillTimers = new Map();

function patientFromScanData(data) {
  const name = String(data?.patientName || "").trim();
  if (!name) return null;
  const parts = name.split(/\s+/).filter(Boolean);
  const genderRaw = String(data.gender || "").toLowerCase();
  const gender = genderRaw.startsWith("f") ? "Female" : genderRaw.startsWith("m") ? "Male" : "";
  if (!parts[0] || parts.length < 2) return null;
  const currentVital = Array.isArray(data.bmiHistory)
    ? data.bmiHistory.find((row) => row.isCurrent) || data.bmiHistory[0]
    : null;
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
    dateOfBirth: data.dob || "",
    dob: data.dob || "",
    gender,
    address: data.address || "",
    height: data.height || currentVital?.height || "",
    weight: data.weight || currentVital?.weight || "",
    bmi: data.bmi != null ? String(data.bmi) : (currentVital?.bmi != null ? String(currentVital.bmi) : ""),
    heightWeightDate: currentVital?.date || ""
  };
}

function readOrderDemographics() {
  const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  const blank = (value) => !value || value === "—" || value === "-" || value === "–";
  const card = document.querySelector(".od2-patient-card") || document.body;
  const name = text(card.querySelector(".patient-name-text, .od2-patient-name, h3.odhr-pname"));
  const dobEl = card.querySelector('span.meta-val-text[data-meta="dob"], [data-meta="dob"]');
  let dob = text(dobEl).replace(/^DOB\s*/i, "");
  let address = "";
  card.querySelectorAll(".od2-meta-row").forEach((row) => {
    const raw = text(row);
    const value = text(row.querySelector(".val, .meta-val-text"));
    if (!dob && /^dob\b/i.test(raw)) dob = (value || raw).replace(/^DOB\s*/i, "").trim();
    if (!address && /^address\b/i.test(raw)) {
      const body = value && !/^address$/i.test(value) ? value : raw;
      address = body.replace(/^ADDRESS\s*/i, "").trim();
    }
  });
  let height = "";
  let weight = "";
  let bmi = "";
  let heightWeightDate = "";
  const table = document.querySelector("table.od2-bmi-table") || document.querySelector("table.odm-bmi-tbl");
  const rows = table ? Array.from(table.querySelectorAll("tbody tr")) : [];
  const row = rows.find((entry) => /\bcurrent\b/i.test(text(entry))) || rows[0];
  if (row) {
    const dateText = text(row.querySelector("td"));
    heightWeightDate = (dateText.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/) || [])[0] || "";
    const cols = Array.from(row.querySelectorAll("td.col-num"));
    const figure = (cell, unit) => {
      const value = text(cell);
      const match = value.match(new RegExp(`\\d+(?:\\.\\d+)?\\s*${unit}`, "i"));
      return match ? match[0].replace(/\s+/g, " ") : "";
    };
    bmi = (text(cols[0]).match(/\d+(?:\.\d+)?/) || [])[0] || "";
    height = figure(cols[1], "cm");
    weight = figure(cols[2], "kg");
  }
  if (blank(dob)) dob = "";
  if (blank(address)) address = "";
  return { name, dob, address, height, weight, bmi, heightWeightDate };
}

function samePatientName(expected, found) {
  const left = String(expected || "").toLowerCase().replace(/\s+/g, " ").trim();
  const right = String(found || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!left || !right) return false;
  return left === right;
}

async function readOrderTabDemographics() {
  const stored = await chrome.storage.session.get(["mgOrderTabId", "mgExpectedPatient"]);
  const tabId = stored.mgOrderTabId;
  const tab = tabId ? await tabGet(tabId) : null;
  if (!tab?.id || !/rx\.everydaymeds\.co\.uk\/order\//i.test(tab.url || "")) return null;
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readOrderDemographics
    });
    const live = injected?.result || null;
    const expected = stored.mgExpectedPatient;
    const expectedName = [expected?.firstName, expected?.lastName].filter(Boolean).join(" ");
    if (live?.name && expectedName && !samePatientName(expectedName, live.name)) return null;
    return live;
  } catch (err) {
    console.warn("MediGuard could not read this order's BMI row:", err);
    return null;
  }
}

function fillFindPatientMainWorld(patient) {
  const MONTHS = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };
  function formatDob(p) {
    if (p.dateOfBirth && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(p.dateOfBirth).trim())) {
      const [d, m, y] = String(p.dateOfBirth).trim().split("/");
      return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
    }
    const raw = String(p.dob || p.dateOfBirth || "").trim();
    const named = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/);
    if (named) {
      const mm = MONTHS[named[2].slice(0, 3).toLowerCase()];
      if (mm) return `${named[1].padStart(2, "0")}/${mm}/${named[3]}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, d] = raw.split("-");
      return `${d}/${m}/${y}`;
    }
    return raw;
  }
  function clickEl(el) {
    el.scrollIntoView({ block: "nearest", behavior: "instant" });
    el.focus();
    el.click();
  }
  function setInputValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const roleBtn = document.getElementById("confirm-current-role");
  if (roleBtn) {
    clickEl(roleBtn.closest("a") || roleBtn);
    return "role-confirmed";
  }
  if (!/\/app\/find_patient/.test(location.pathname)) return "waiting";
  const firstNameEl = document.querySelector("#advanced-search-form-firstname");
  if (!firstNameEl) {
    const tab = document.querySelector("#advanced-search-tab, a#advanced-search-tab, [href='#advanced-search']");
    if (tab) { clickEl(tab); return "tab-clicked"; }
    return "form-loading";
  }
  const genderSelector = patient.gender === "Male"
    ? "#advanced-search-form-gender-2"
    : patient.gender === "Female"
      ? "#advanced-search-form-gender-1"
      : "#advanced-search-form-gender-3";
  const genderRadio = document.querySelector(genderSelector);
  const lastNameEl = document.querySelector("#advanced-search-form-surname");
  const dobInput = document.querySelector("#advanced-search-form-dob-single")
    || document.querySelector("#advanced-search-form input[id*='dob-single']")
    || document.querySelector("#advanced-search-form input[placeholder*='any format']")
    || document.querySelector("#advanced-search-form input[placeholder*='Type or paste']");
  if (!dobInput) {
    const singleDate = [...document.querySelectorAll("a")].find((link) => {
      return (link.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === "single date";
    });
    if (singleDate) { clickEl(singleDate); return "dob-switched"; }
  }
  if (!genderRadio || !lastNameEl || !dobInput) return "form-loading";
  clickEl(genderRadio);
  genderRadio.dispatchEvent(new Event("change", { bubbles: true }));
  setInputValue(firstNameEl, patient.firstName || "");
  setInputValue(lastNameEl, patient.lastName || "");
  setInputValue(dobInput, formatDob(patient));
  const submitBtn = document.querySelector("#advanced-search-form button[type='submit']");
  if (!submitBtn) return "no-submit";
  clickEl(submitBtn);
  return "submitted";
}

function clickSearchResultMainWorld(patient) {
  function clickEl(el) {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }
  if (/\/app\/patient\b/.test(location.pathname)) return "opened";
  if (window.__mgScrRowClicked) return "waiting-open";
  const rows = [...document.querySelectorAll(".query-results-table__data-row")];
  const fallbackRows = rows.length ? rows : [...document.querySelectorAll("table tbody tr")].filter((row) => {
    const cells = row.querySelectorAll("td");
    return cells.length >= 4 && /\b(male|female)\b/i.test(row.innerText || "");
  });
  if (!fallbackRows.length) return "waiting";
  const first = String(patient.firstName || "").toLowerCase();
  const last = String(patient.lastName || "").toLowerCase();
  const matches = fallbackRows.filter((row) => {
    const name = (
      row.querySelector(".query-results-table__data-row-name")?.innerText
      || row.querySelector("td")?.innerText
      || ""
    ).toLowerCase();
    return name.includes(first) && name.includes(last);
  });
  const chosen = matches.length === 1 ? matches[0] : (fallbackRows.length === 1 ? fallbackRows[0] : null);
  if (!chosen) return matches.length > 1 ? "many" : "waiting";
  window.__mgScrRowClicked = true;
  clickEl(chosen.querySelector("a[href]") || chosen);
  return "clicked";
}

function openClinicalRecordMainWorld(patient) {
  function clickEl(el) {
    try { el.scrollIntoView({ block: "center", behavior: "instant" }); } catch (_) {}
    const opts = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
    } catch (_) {}
    el.click();
  }
  const pageText = document.body?.innerText || "";
  if (/General Practice Summary/i.test(pageText)) return "done";
  if (document.querySelector(".clinicals-page, .scr-print-wrapper, table.scr-table, #AllergiesandAdverseReactions, #CurrentRepeatMedications")) {
    return "done";
  }
  const yes = document.getElementById("access-management-yes");
  if (yes) {
    window.__mgScrYesClicks = (window.__mgScrYesClicks || 0) + 1;
    if (window.__mgScrYesClicks <= 3) clickEl(yes);
    return "yes-clicked";
  }
  const clinical = document.getElementById("patient-clinicals-navigation-tab")
    || [...document.querySelectorAll("a, button, [role='tab']")].find((el) =>
      (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === "clinical"
    );
  const selected = clinical && (
    clinical.getAttribute("aria-selected") === "true"
    || clinical.classList.contains("nhsuk-tab-set__tab--selected")
    || clinical.getAttribute("aria-current") === "page"
  );
  if (clinical && !selected) {
    window.__mgScrClinicalClicked = (window.__mgScrClinicalClicked || 0) + 1;
    if (window.__mgScrClinicalClicked <= 6) {
      clickEl(clinical);
      return "clinical-clicked";
    }
  }
  if (clinical && selected) return "waiting-modal";
  const last = String(patient?.lastName || "").toLowerCase();
  if (last && !pageText.toLowerCase().includes(last)) return "waiting";
  return "waiting";
}

async function watchNhsPatientName() {
  const stored = await chrome.storage.session.get(["mgExpectedPatient"]);
  const expected = stored.mgExpectedPatient;
  if (!expected?.firstName || !expected?.lastName) return;
  const orderName = `${expected.firstName} ${expected.lastName}`.trim();
  let active = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    active = tab || null;
  } catch (err) {
    return;
  }
  if (!active?.id || !/nationalcarerecordsservice/.test(active.url || "")) {
    chrome.runtime.sendMessage({ type: "NHS_NAME_STATUS", status: "clear" }).catch(() => {});
    return;
  }
  const tabs = [active];
  let mismatch = null;
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: (patient) => {
          function clean(value) {
            return String(value || "").replace(/\s+/g, " ").trim();
          }
          function labeled(label) {
            const body = document.body?.innerText || "";
            const match = body.match(new RegExp("(?:^|\\n)\\s*" + label + "\\s*:\\s*([^\\n]+)", "i"));
            return match ? clean(match[1]) : "";
          }
          function norm(value) {
            return String(value || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
          }
          function firstOf(value) {
            return norm(value).split(" ").filter(Boolean)[0] || "";
          }
          function lastOf(value) {
            const parts = norm(value).split(" ").filter(Boolean);
            return parts[parts.length - 1] || "";
          }
          function agree(shownFirst, shownLast) {
            const expectedFirst = firstOf(patient.firstName);
            const expectedLast = lastOf(patient.lastName);
            const pageFirst = firstOf(shownFirst);
            const pageLast = lastOf(shownLast || shownFirst);
            if (!pageFirst || !pageLast || !expectedFirst || !expectedLast) return "empty";
            return pageFirst === expectedFirst && pageLast === expectedLast ? "match" : "mismatch";
          }
          const rows = [...document.querySelectorAll("table tbody tr")].filter((row) => {
            return row.querySelectorAll("td").length >= 4 && /\b(male|female)\b/i.test(row.innerText || "");
          });
          const page = {
            formFirst: clean(document.querySelector("#advanced-search-form-firstname")?.value),
            formLast: clean(document.querySelector("#advanced-search-form-surname")?.value),
            criteriaFirst: labeled("First name"),
            criteriaLast: labeled("Last name"),
            rowNames: rows.map((row) => clean(row.querySelector("td")?.innerText)).filter(Boolean)
          };
          const rowCheck = page.rowNames.length === 1 ? agree(page.rowNames[0], page.rowNames[0]) : "empty";
          const checks = [
            agree(page.formFirst, page.formLast),
            agree(page.criteriaFirst, page.criteriaLast),
            rowCheck
          ].filter((status) => status !== "empty");
          const status = !checks.length ? "empty" : (checks.includes("mismatch") ? "mismatch" : "match");
          const pageName = (page.rowNames.length === 1 && rowCheck === "mismatch" ? page.rowNames[0] : "")
            || [page.criteriaFirst, page.criteriaLast].filter(Boolean).join(" ")
            || [page.formFirst, page.formLast].filter(Boolean).join(" ")
            || "";
          const orderName = `${patient.firstName} ${patient.lastName}`.trim();
          const existing = document.getElementById("mg-name-mismatch");
          if (status !== "mismatch") {
            existing?.remove();
          } else {
            const banner = existing || document.createElement("div");
            banner.id = "mg-name-mismatch";
            banner.setAttribute("role", "alert");
            banner.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:560px;background:#7f1d1d;color:#fff;padding:12px 16px;border-radius:10px;font:600 14px/1.45 Segoe UI,system-ui,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.28);";
            banner.textContent = `Names don't match. This page shows ${pageName || "a different patient"}. The order is ${orderName}. Refresh the page.`;
            if (!existing) document.documentElement.appendChild(banner);
          }
          return { status, pageName };
        },
        args: [expected]
      });
      if (injected?.result?.status === "mismatch") mismatch = injected.result;
    } catch (err) {
      // Page scripts are not ready on every navigation.
    }
  }
  chrome.runtime.sendMessage({
    type: "NHS_NAME_STATUS",
    status: mismatch ? "mismatch" : "match",
    pageName: mismatch?.pageName || "",
    orderName
  }).catch(() => {});
}

setInterval(() => {
  watchNhsPatientName().catch(() => {});
}, 1200);
chrome.tabs.onActivated.addListener(() => {
  watchNhsPatientName().catch(() => {});
});

function scheduleNhsPrefill(tabId) {
  if (nhsFillTimers.has(tabId)) clearTimeout(nhsFillTimers.get(tabId));
  let attempts = 0;
  const tick = async () => {
    attempts += 1;
    const stored = await chrome.storage.session.get(["pendingNhsPatient", "nhsPrefillTabId"]);
    const patient = stored.pendingNhsPatient;
    if (!patient || stored.nhsPrefillTabId !== tabId) return;
    const tab = await tabGet(tabId);
    if (!tab || tab.status !== "complete") {
      if (attempts < 160) nhsFillTimers.set(tabId, setTimeout(tick, 250));
      return;
    }
    const url = tab.url || "";
    const onNhs = /nationalcarerecordsservice/.test(url);
    try {
      if (SEARCH_RESULTS_RE.test(url)) {
        const [injected] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: clickSearchResultMainWorld,
          args: [patient]
        });
        const result = injected?.result;
        if (result === "many") {
          await chrome.storage.session.set({ pendingNhsPatient: null });
          nhsFillTimers.delete(tabId);
          return;
        }
        if (result === "clicked" || result === "opened" || result === "waiting-open") {
          if (attempts < 40) nhsFillTimers.set(tabId, setTimeout(tick, 1000));
          return;
        }
      } else if (PATIENT_RE.test(url)) {
        const [injected] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: openClinicalRecordMainWorld,
          args: [patient]
        });
        const result = injected?.result;
        if (result === "done") {
          await chrome.storage.session.set({ pendingNhsPatient: null });
          nhsFillTimers.delete(tabId);
          return;
        }
        if (result === "clinical-clicked" || result === "yes-clicked" || result === "waiting-modal" || result === "waiting") {
          if (attempts < 160) nhsFillTimers.set(tabId, setTimeout(tick, 700));
          return;
        }
      } else if (onNhs) {
        const [injected] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: fillFindPatientMainWorld,
          args: [patient]
        });
        const result = injected?.result;
        if (result === "submitted" || result === "role-confirmed" || result === "dob-switched") {
          if (attempts < 120) nhsFillTimers.set(tabId, setTimeout(tick, result === "role-confirmed" ? 700 : 400));
          return;
        }
      }
    } catch (err) {
      console.warn("MediGuard NHS prefill failed:", err);
    }
    if (attempts < 120) nhsFillTimers.set(tabId, setTimeout(tick, 250));
  };
  tick();
}

let keywordToolTabId = null;

function tabSend(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(resp || null);
    });
  });
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, 5000);
    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function showKeywordTool(html, focus) {
  const stored = await chrome.storage.session.get(["mgExpectedPatient"]);
  const patient = { ...(stored.mgExpectedPatient || {}) };
  const live = await readOrderTabDemographics();
  if (live) {
    if (live.dob) patient.dateOfBirth = patient.dob = live.dob;
    if (live.address) patient.address = live.address;
    if (live.height) patient.height = live.height;
    if (live.weight) patient.weight = live.weight;
    if (live.bmi) patient.bmi = live.bmi;
    if (live.heightWeightDate) patient.heightWeightDate = live.heightWeightDate;
    await chrome.storage.session.set({ mgExpectedPatient: patient });
  }
  await chrome.storage.session.set({
    scrPendingHtml: html,
    scrPendingPatient: {
      firstName: patient.firstName || "",
      lastName: patient.lastName || "",
      dateOfBirth: patient.dateOfBirth || patient.dob || "",
      dob: patient.dob || patient.dateOfBirth || "",
      address: patient.address || "",
      gender: patient.gender || "",
      height: patient.height || "",
      weight: patient.weight || "",
      bmi: patient.bmi || "",
      heightWeightDate: patient.heightWeightDate || ""
    }
  });
  const url = chrome.runtime.getURL("keywords-tool.html");
  let tab = keywordToolTabId ? await tabGet(keywordToolTabId) : null;
  if (!tab?.id) {
    tab = await new Promise((resolve) => {
      chrome.tabs.create({ url, active: focus === true }, (created) => resolve(created || null));
    });
    if (!tab?.id) return;
    keywordToolTabId = tab.id;
    await waitForTabComplete(tab.id);
  } else if (focus) {
    await new Promise((resolve) => chrome.tabs.update(tab.id, { active: true }, () => resolve()));
  }
  const payload = {
    action: "renderSCRContent",
    content: html,
    userData: {
      firstName: patient.firstName || "",
      lastName: patient.lastName || "",
      dateOfBirth: patient.dateOfBirth || patient.dob || "",
      dob: patient.dob || patient.dateOfBirth || "",
      address: patient.address || "",
      gender: patient.gender || "",
      height: patient.height || "",
      weight: patient.weight || "",
      bmi: patient.bmi || "",
      heightWeightDate: patient.heightWeightDate || ""
    }
  };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const resp = await tabSend(tab.id, payload);
    if (resp?.success) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function injectScrScan(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: ["scr/capture.js"]
  }).catch((err) => console.warn("MediGuard SCR capture inject failed:", err));
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || "";
  if (!/nationalcarerecordsservice/.test(url)) return;
  if (PATIENT_RE.test(url)) injectScrScan(tabId);
  if (changeInfo.status !== "complete") return;
  scheduleNhsPrefill(tabId);
});

chrome.tabs.query({
  url: [
    "https://national-care-records-service.nhs.uk/nationalcarerecordsservice/app/patient*",
    "https://portal.spineservices.nhs.uk/nationalcarerecordsservice/app/patient*"
  ]
}, (tabs) => {
  (tabs || []).forEach((tab) => { if (tab.id) injectScrScan(tab.id); });
});

async function openNhsScrFromOrder(message, sender) {
  await chrome.storage.session.set({ mgScrDeliveredTabs: [] });
  let patient = message.patient;
  if (!patient?.firstName || !patient?.lastName || !(patient.dateOfBirth || patient.dob)) {
    const orderTabs = await tabsQuery({ url: "https://rx.everydaymeds.co.uk/order/*" });
    const orderTab = orderTabs.find((t) => t.active) || orderTabs[0];
    if (orderTab?.id) {
      try {
        const resp = await chrome.tabs.sendMessage(orderTab.id, { type: "GET_SCAN_DATA" });
        patient = patientFromScanData(resp?.data);
      } catch (err) {
        console.warn("MediGuard could not read the order page:", err);
      }
    }
  }
  if (!patient?.firstName || !patient?.lastName) {
    return { success: false, error: "Open an order first so the name and date of birth can be filled in." };
  }
  const tab = await new Promise((resolve) => {
    chrome.tabs.create({ url: NHS_FIND_PATIENT_URL, active: true }, (created) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(created);
    });
  });
  if (!tab?.id) return { success: false, error: "Could not open NHS SCR" };
  const sessionPatch = {
    pendingNhsPatient: patient,
    nhsPrefillTabId: tab.id,
    mgExpectedPatient: patient
  };
  if (sender.tab?.id && /rx\.everydaymeds\.co\.uk\/order\//i.test(sender.tab.url || "")) {
    sessionPatch.mgOrderTabId = sender.tab.id;
  }
  await chrome.storage.session.set(sessionPatch);
  await addOpenedTab(tab.id);
  scheduleNhsPrefill(tab.id);
  return { success: true, tabId: tab.id };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCR_HTML_READY" && message.html) {
    const nhsTabId = sender.tab?.id;
    chrome.storage.session.get("mgScrDeliveredTabs", (stored) => {
      const list = stored.mgScrDeliveredTabs || [];
      if (nhsTabId && list.includes(nhsTabId)) return;
      showKeywordTool(message.html, true)
        .then(() => {
          if (!nhsTabId) return;
          chrome.storage.session.set({ mgScrDeliveredTabs: [...list, nhsTabId] });
        })
        .catch((err) => console.warn("MediGuard keyword tool failed:", err));
    });
  }

  if (message.type === "OPEN_NHS_SCR") {
    openNhsScrFromOrder(message, sender)
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, error: e?.message || "Could not open NHS SCR" }));
    return true;
  }

  if (message.type === "ORDER_URL_CHANGED") {
    chrome.storage.session.remove(["mgExpectedPatient", "pendingNhsPatient"]);
    chrome.storage.session.set({
      mgOrderTabId: sender.tab?.id || null,
      mgOrderUrl: message.url || sender.tab?.url || ""
    });
  }

  if (message.type === "ORDER_DATA_SCANNED" && message.data?.patientName) {
    const scanned = patientFromScanData(message.data);
    const orderUrl = message.data.pageUrl || sender.tab?.url || "";
    if (scanned) scanned.orderUrl = orderUrl;
    chrome.storage.session.set({
      mgExpectedPatient: scanned || null,
      mgOrderTabId: sender.tab?.id || null,
      mgOrderUrl: orderUrl
    }, () => watchNhsPatientName().catch(() => {}));
  }

  if (
    message.type === "ORDER_URL_CHANGED" ||
    message.type === "ORDER_DATA_SCANNED" ||
    message.type === "TAB_COMPLETION_CHANGED" ||
    message.type === "ACTIVE_TAB_CHANGED" ||
    message.type === "CLINICAL_CHECK_BATCH_UPDATE" ||
    message.type === "CLINICAL_PARALLEL_UPDATE"
  ) {
    try {
      const tabId = sender.tab && sender.tab.id;
      const tabUrl = sender.tab && sender.tab.url;
      chrome.runtime.sendMessage({
        ...message,
        tabId: tabId ?? message.tabId ?? null,
        tabUrl: tabUrl ?? message.tabUrl ?? null,
      }).catch(() => {});
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

  if (message.type === "SCR_CLOSE_AND_RETURN" || message.action === "closeScrAndReturn") {
    closeScrAndReturn(sender.tab && sender.tab.id)
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, error: e && e.message }));
    return true;
  }

  if (message.type === "GENERATE_PATIENT_EMAIL") {
    generatePatientEmail(message)
      .then((text) => sendResponse({ success: true, text }))
      .catch((e) => sendResponse({ success: false, error: e?.message || "Generation failed" }));
    return true;
  }

  if (message.type === "SUMMARISE_ORDER_CONTEXT") {
    summariseOrderContext(message)
      .then((brief) => sendResponse({ success: true, brief }))
      .catch((e) => sendResponse({ success: false, error: e?.message || "Could not read the order" }));
    return true;
  }

  if (message.type === "SUMMARISE_ORDER_OVERVIEW") {
    summariseOrderOverview(message)
      .then((text) => sendResponse({ success: true, text }))
      .catch((e) => sendResponse({ success: false, error: e?.message || "Could not summarise the order" }));
    return true;
  }

  if (message.type === "ASK_ABOUT_ORDER") {
    askAboutOrder(message)
      .then((text) => sendResponse({ success: true, text }))
      .catch((e) => sendResponse({ success: false, error: e?.message || "Could not answer" }));
    return true;
  }

  if (message.type === "CLINICAL_PARALLEL_START") {
    startParallelClinicalPool(message, sender).then(sendResponse);
    return true;
  }

  if (message.type === "CLINICAL_PARALLEL_STOP") {
    stopParallelClinicalPool().then(sendResponse);
    return true;
  }

  if (message.type === "CLINICAL_PARALLEL_CLAIM") {
    claimParallelOrder(sender.tab && sender.tab.id).then(sendResponse);
    return true;
  }

  if (message.type === "CLINICAL_PARALLEL_COMPLETE") {
    completeParallelOrder(sender.tab && sender.tab.id, !!message.success, message.error)
      .then((pool) => {
        if (pool?.active) {
          return claimParallelOrder(sender.tab && sender.tab.id);
        }
        return { url: null, done: true, scrMode: pool?.scrMode };
      })
      .then(sendResponse);
    return true;
  }

  if (message.type === "CLINICAL_PARALLEL_STATUS") {
    getParallelPool().then((pool) => {
      sendResponse({
        success: true,
        active: !!(pool && pool.active),
        pending: pool ? (pool.pending || []).length : 0,
        processed: pool?.processed || 0,
        failed: pool?.failed || 0,
        workers: pool?.workerTabIds?.length || 0,
      });
    });
    return true;
  }

  if (message.type === "CLINICAL_PARALLEL_GET_TAB_ASSIGNMENT") {
    getParallelPool().then((pool) => {
      const tabId = sender.tab && sender.tab.id;
      const url = pool && tabId != null ? pool.inProgress?.[String(tabId)] : null;
      sendResponse({
        active: !!(pool && pool.active),
        url: url || null,
        scrMode: pool?.scrMode || "not_accessed",
      });
    });
    return true;
  }

  return true;
});
