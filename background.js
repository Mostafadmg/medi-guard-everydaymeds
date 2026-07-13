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
    .slice(0, 3);
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
- NEVER invent dates, doses, order numbers, diagnoses, side effects, or patient statements.
- NEVER claim you reviewed SCR, documents, or chat unless that data is in context or attachments.
- If information is missing, ask specific questions — do not assume.
- Prefer precise, cautious clinical language over vague reassurance.
- When web results conflict with order context, trust order context for this patient; use web only for general UK clinical facts.

WEB SEARCH (when provided):
- Use web results for up-to-date UK NHS/NICE/SmPC facts: dosing, missed doses, side effects, contraindications, monitoring.
- Do not copy web text verbatim — synthesise into plain patient-friendly language.
- Do not cite URLs in the patient message unless the prescriber asks.

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
      max_tokens: 2400,
      temperature: 0.2,
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

async function generatePatientEmail(payload) {
  const userMessage = (payload?.userMessage || payload?.scenario || "").trim();
  const history = Array.isArray(payload?.history) ? payload.history : [];
  const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
  const webSearch = !!payload?.webSearch;
  const context = payload?.context || "";

  if (!userMessage && !attachments.length) {
    throw new Error("Describe the scenario or attach a file first.");
  }

  const { serverUrl, openaiKey, tavilyKey } = await getAiSettingsFromStorage();
  if (!openaiKey && !serverUrl) {
    throw new Error("Add your OpenAI API key in extension Settings → Save, then try again.");
  }

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
    generatePatientEmail(message)
      .then((text) => sendResponse({ success: true, text }))
      .catch((e) => sendResponse({ success: false, error: e?.message || "Generation failed" }));
    return true;
  }

  return true;
});
