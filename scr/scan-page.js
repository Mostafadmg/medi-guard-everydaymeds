import { scanReferenceFolderKeywords } from "./referenceFolderKeywordEngine.js";

const CONDITION_KEY = "edmSelectedCondition";
if (!window.__mgScrScanStarted) {
  window.__mgScrScanStarted = true;

  let lastText = "";
  let rulesCache = { id: "", rules: null, label: "" };

  function clinicalRoot() {
    const wrapped = document.querySelector(".scr-print-wrapper, .clinicals-page");
    if (wrapped) return wrapped;
    const heading = [...document.querySelectorAll("h1, h2, h3")].find((el) =>
      /General Practice Summary/i.test(el.textContent || "")
    );
    if (!heading) return null;
    let node = heading.parentElement;
    while (node && node.parentElement && node.parentElement !== document.body) {
      const parent = node.parentElement;
      const besideNav = [...parent.children].some((child) =>
        child !== node && /Acute Medications/i.test(child.innerText || "")
      );
      if (besideNav) return node;
      node = parent;
    }
    return node;
  }

  async function rulesFor(conditionId) {
    if (rulesCache.id === conditionId && rulesCache.rules) return rulesCache;
    const registry = await (await fetch(chrome.runtime.getURL("scr/conditions/registry.json"))).json();
    const entry = registry.find((item) => item.id === conditionId)
      || registry.find((item) => item.default)
      || registry[0];
    const rules = await (await fetch(chrome.runtime.getURL(entry.rulesFile))).json();
    rulesCache = { id: entry.id, label: entry.label, rules };
    return rulesCache;
  }

  function pack(findings) {
    const rank = { reject: 0, flag: 1, counsel: 2 };
    const seen = new Set();
    const unique = [];
    for (const finding of findings || []) {
      if (!finding?.ruleId || seen.has(finding.ruleId)) continue;
      seen.add(finding.ruleId);
      unique.push({
        ruleId: finding.ruleId,
        ruleName: finding.ruleName,
        outcome: finding.outcome,
        keyword: finding.keyword,
        snippet: String(finding.snippet || "").slice(0, 220),
        rationale: String(finding.rationale || "").slice(0, 280)
      });
    }
    unique.sort((a, b) => (rank[a.outcome] ?? 9) - (rank[b.outcome] ?? 9));
    return unique.slice(0, 30);
  }

  async function scanIfReady() {
    if (!/\/app\/patient\b/.test(location.pathname)) return;
    const root = clinicalRoot();
    if (!root) return;
    const text = (root.innerText || "").replace(/\s+/g, " ").trim();
    if (text.length < 40 || text === lastText) return;
    lastText = text;
    const stored = await chrome.storage.local.get(CONDITION_KEY);
    const loaded = await rulesFor(stored[CONDITION_KEY] || "weight-loss");
    const result = scanReferenceFolderKeywords(text, loaded.rules, { conditionId: loaded.id });
    chrome.runtime.sendMessage({
      type: "SCR_KEYWORD_SCAN",
      conditionId: loaded.id,
      conditionLabel: loaded.label,
      overallPass: result.overallPass,
      productVerdicts: result.productVerdicts || null,
      findings: pack(result.findings)
    }).catch(() => {});
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[CONDITION_KEY]) {
      lastText = "";
      rulesCache = { id: "", rules: null, label: "" };
      scanIfReady().catch(() => {});
    }
  });

  setInterval(() => {
    scanIfReady().catch((err) => console.warn("MediGuard SCR scan failed:", err));
  }, 1500);
  scanIfReady().catch(() => {});
}
