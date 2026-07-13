// MediGuard AI — EverydayMeds Workflow Dashboard
// Self-contained, bundled into the extension zip.

let serverUrl = "https://6953ffd7-1719-4bf3-8baf-cd9245046e01-00-2kzcudwa3v17m.picard.replit.dev";
let openaiKey = null;
let currentOrderData = null;
let lastSeenOrderKey = null;
let conversationHistory = [];
let isChatRunning = false;

const TAB_ORDER = ["clinical", "consultation", "documents", "history", "counselling", "monitoring", "notes", "activity"];
const TABS_WITH_DONE = new Set(["clinical", "consultation", "documents", "history", "counselling", "monitoring"]);

const TAB_LABELS = {
  clinical: "Clinical Review", consultation: "Consultation",
  documents: "Documents", history: "Order History",
  counselling: "Patient Counselling", monitoring: "Monitoring",
  notes: "Notes", activity: "Activity"
};

const TAB_HINTS = {
  clinical:     "Check BMI history, order summary and NHS SCR",
  consultation: "Review patient answers for contraindications",
  documents:    "Verify ID, weight video and scale reading",
  history:      "Check previous orders and dose escalation",
  counselling:  "Send counselling message and confirm consent",
  monitoring:   "Review monitoring requirements and flags",
  notes:        "Add or review clinical notes",
  activity:     "Review order activity log and timeline"
};

// ═══════════════════════════════════════════════
//  ELIGIBILITY RULES
// ═══════════════════════════════════════════════

// BMI threshold colours
function bmiTagClass(bmi) {
  if (bmi == null) return "slate";
  if (bmi >= 30) return "green";              // ✓ eligible
  if (bmi >= 27.5) return "yellow";           // needs comorbidity
  return "red";                               // ineligible
}

function ageTagClass(age) {
  if (age == null) return "slate";
  if (age >= 18 && age < 75) return "green";
  return "red";
}

// Consultation answer classification
// Returns: { level: 'green'|'yellow'|'red'|null }
function classifyConsultationAnswer(qRaw, aRaw) {
  if (!qRaw || !aRaw) return { level: null };
  const q = qRaw.toLowerCase();
  const a = aRaw.toLowerCase().trim();
  const isYes = a === "yes" || a.startsWith("yes ") || a.startsWith("yes,");
  const isNo = a === "no" || a.startsWith("no ") || a.startsWith("no,") || a === "none" || a === "n/a";

  // ─── HARD CONTRAINDICATIONS — Yes = RED, No = GREEN ───
  if (q.includes("pregnant") || q.includes("breastfeed"))         return { level: isNo ? "green" : "red" };
  if (q.includes("allergic reaction"))                            return { level: isNo ? "green" : "red" };
  if (q.includes("medullary thyroid") || q.includes("men2"))      return { level: isNo ? "green" : "red" };
  if (q.includes("eating disorder"))                              return { level: isNo ? "green" : "red" };

  // ─── AGE 18–75 — Yes = GREEN, No = RED ───
  if (q.includes("aged 18") || q.includes("aged between 18") || q.includes("between 18 and 75")) {
    return { level: isYes ? "green" : "red" };
  }

  // ─── FREE-TEXT FOLLOW-UPS — always YELLOW (only appear when previous answer was Yes) ───
  if (q.includes("please indicate which condition") || q.includes("indicate which condition") ||
      (q.includes("which condition") && q.includes("diagnos")) ||
      q.includes("which treatment") || q.includes("which health condition") ||
      q.includes("which medication") || q.includes("brief details") ||
      q.includes("which injectable") || q.includes("when did you last")) {
    return { level: "yellow" };
  }

  // ─── CAUTIONS — Yes = YELLOW, No = GREEN ───
  // (Diagnoses, medications, prior treatments — need extra review but not auto-reject)
  if (q.includes("diagnosed with or had surgery"))                return { level: isYes ? "yellow" : "green" };
  if (q.includes("previous or current health conditions"))        return { level: isYes ? "yellow" : "green" };
  if (q.includes("prescribed") && q.includes("drugs"))            return { level: isYes ? "yellow" : "green" };
  if (q.includes("type 2 diabetes"))                              return { level: isYes ? "yellow" : "green" };
  if (q.includes("oral contraceptive"))                           return { level: isYes ? "yellow" : "green" };
  // High-risk drug interaction list (amiodarone, lithium, ciclosporin, warfarin, anti-epileptics, digoxin)
  if (q.includes("amiodarone") || q.includes("ciclosporin") || q.includes("warfarin") ||
      q.includes("lithium") || q.includes("anti-epileptic") || q.includes("digoxin")) {
    return { level: isYes ? "yellow" : "green" };
  }
  // First-time injectable user — Yes = yellow (needs counselling), No = green (has experience)
  if (q.includes("new to using injectable") || q.includes("new to injectable")) {
    return { level: isYes ? "yellow" : "green" };
  }
  // Previously bought from us — informational, but No = yellow (verify dose escalation elsewhere)
  if (q.includes("purchase") && q.includes("previous")) {
    return { level: isNo ? "yellow" : "green" };
  }

  // ─── CONSENT & AGREEMENTS — Yes = GREEN, No = RED ───
  if (q.includes("consent") || q.includes("agree") || q.includes("by proceeding") || q.includes("i confirm")) {
    return { level: isYes ? "green" : "red" };
  }

  return { level: null };
}

// Build overall eligibility verdict + flags from order data
function evaluateEligibility(data) {
  const flags = [];
  if (!data) return { level: "green", flags, alertable: false };

  // BMI check
  if (data.bmi != null) {
    if (data.bmi < 27.5) {
      flags.push({ level: "red", text: `BMI ${data.bmi} below threshold (need ≥27.5 with comorbidity or ≥30)` });
    } else if (data.bmi < 30) {
      flags.push({ level: "yellow", text: `BMI ${data.bmi} requires confirmed comorbidity (T2DM, hypertension etc.)` });
    } else if (data.bmi >= 45) {
      flags.push({ level: "yellow", text: `BMI ${data.bmi} ≥ 45 — extra monitoring required` });
    } else {
      flags.push({ level: "green", text: `BMI ${data.bmi} within eligible range (≥30)` });
    }
  }

  // Age check
  if (data.age != null) {
    if (data.age < 18) flags.push({ level: "red", text: `Age ${data.age} — under 18, must REJECT` });
    else if (data.age >= 75) flags.push({ level: "red", text: `Age ${data.age} — ≥75, specialist review required` });
    else flags.push({ level: "green", text: `Age ${data.age} within eligible range (18–74)` });
  }

  // Consultation flag-throughs (red AND yellow bubble up to the alert)
  if (data.consultationAnswers?.length) {
    data.consultationAnswers.forEach(qa => {
      const c = classifyConsultationAnswer(qa.question, qa.answer);
      if (c.level === "red" || c.level === "yellow") {
        const qShort = qa.question.length > 70 ? qa.question.substring(0, 70) + "…" : qa.question;
        const aShort = qa.answer.length > 80 ? qa.answer.substring(0, 80) + "…" : qa.answer;
        flags.push({ level: c.level, text: `${qShort} — "${aShort}"` });
      }
    });
  }

  const hasRed = flags.some(f => f.level === "red");
  const hasYellow = flags.some(f => f.level === "yellow");
  return {
    level: hasRed ? "red" : hasYellow ? "yellow" : "green",
    flags,
    alertable: hasRed || hasYellow
  };
}

// ═══════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════

let toastTimer = null;
function toast(msg, type = "default", ms = 3000) {
  const el = document.getElementById("toast");
  if (!el) return;
  if (toastTimer) clearTimeout(toastTimer);
  el.textContent = msg;
  el.className = `show t-${type}`;
  toastTimer = setTimeout(() => { el.className = ""; }, ms);
}

// ═══════════════════════════════════════════════
//  CONTENT SCRIPT MESSAGING
// ═══════════════════════════════════════════════

// Detect Chrome extension context. In the iPhone PWA the sidepanel is
// loaded in a sibling iframe and `chrome.tabs` doesn't exist, so we fall
// back to a postMessage bridge that hops: panel → parent (MobilePage) →
// proxied browser iframe (which runs our injected MediGuard bridge).
const IS_EXT = !!(typeof chrome !== "undefined" && chrome?.tabs?.sendMessage);
const _mgPending = new Map();
const _mgUuid = () => (window.crypto?.randomUUID?.() || ("mg_" + Math.random().toString(36).slice(2) + Date.now()));
if (!IS_EXT && typeof window !== "undefined") {
  window.addEventListener("message", (ev) => {
    // Only accept replies from our same-origin parent relay (MobilePage).
    if (ev.origin !== window.location.origin) return;
    if (ev.source !== window.parent) return;
    const d = ev.data;
    if (!d || d.__mg_to !== "panel" || !d.__mg_id) return;
    const entry = _mgPending.get(d.__mg_id);
    if (!entry) return;
    _mgPending.delete(d.__mg_id);
    entry.resolve(d.result);
  });
}
const BRIDGE_TIMEOUT_MS = 20000;
function msgContent(payload) {
  if (IS_EXT) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) { reject(new Error("No active tab")); return; }
        chrome.tabs.sendMessage(tabs[0].id, payload).then(resolve).catch(reject);
      });
    });
  }
  // PWA bridge fallback
  return new Promise((resolve) => {
    const id = _mgUuid();
    const timer = setTimeout(() => {
      if (_mgPending.delete(id)) {
        resolve({ success: false, error: "No response from page — open the order in the in-app browser, then retry" });
      }
    }, BRIDGE_TIMEOUT_MS);
    _mgPending.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r); } });
    try {
      window.parent.postMessage({ ...payload, __mg_to: "page", __mg_id: id }, window.location.origin);
    } catch (e) {
      clearTimeout(timer);
      _mgPending.delete(id);
      resolve({ success: false, error: "Bridge unavailable: " + (e?.message || e) });
    }
  });
}

// ═══════════════════════════════════════════════
//  PATIENT BANNER
// ═══════════════════════════════════════════════

function renderBanner(data) {
  const banner = document.getElementById("patient-banner");
  if (!banner || !data) return;

  const initial = data.patientInitial || (data.patientName ? data.patientName.charAt(0).toUpperCase() : "?");
  document.getElementById("pb-avatar").textContent = initial;
  document.getElementById("pb-name").textContent = data.patientName || "Patient";

  // DOB + age line
  const dobEl = document.getElementById("pb-dob");
  if (dobEl) {
    if (data.dob || data.age != null) {
      const parts = [];
      if (data.dob) {
        parts.push(`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`);
        parts.push(`DOB ${escapeHtml(data.dob)}`);
      } else {
        parts.push(`Age`);
      }
      if (data.age != null) parts.push(`<span class="pb-age">${data.age} yrs</span>`);
      dobEl.innerHTML = parts.join(" ");
      dobEl.style.display = "flex";
    } else {
      dobEl.style.display = "none";
    }
  }

  const med = data.medication ? data.medication.replace("® Injectable Pen", "").replace("®", "").trim() : null;
  let html = "";
  // Patient status tags first (New Patient, 1st Dose, etc.) — orange/blue for emphasis
  (data.patientTags || []).forEach(tag => {
    const lower = tag.toLowerCase();
    const cls = lower.includes("new") ? "tag-yellow"
      : (lower.includes("1st") || lower.includes("first")) ? "tag-blue"
      : "tag-slate";
    html += `<span class="tag ${cls}">${escapeHtml(tag)}</span>`;
  });
  if (med || data.dose) html += `<span class="tag tag-blue">💊 ${escapeHtml([med, data.dose].filter(Boolean).join(" "))}</span>`;
  if (data.bmi != null) html += `<span class="tag tag-${bmiTagClass(data.bmi)}">BMI ${data.bmi}</span>`;
  if (data.ethnicity && data.ethnicity !== "—") {
    // Highlight BAME / non-white ethnicities since they unlock the BMI 27.5-29.9
    // pathway under the SOP. White / unknown stay neutral slate.
    const ethLow = String(data.ethnicity).toLowerCase();
    const isBame = /asian|black|african|caribbean|mixed|arab|middle eastern|other ethnic/i.test(ethLow);
    const ethCls = isBame ? "tag-blue" : "tag-slate";
    const ethShort = String(data.ethnicity).replace(/\s*\([^)]*\)\s*/g, "").trim();
    html += `<span class="tag ${ethCls}" title="Ethnicity: ${escapeHtml(data.ethnicity)}">🌐 ${escapeHtml(ethShort)}${isBame ? " · BAME" : ""}</span>`;
  }
  if (data.weight && data.weight !== "—") {
    // Show kg as scraped, then append the stones+lb equivalent (UK convention)
    // so clinicians don't have to convert in their head. 1 kg = 2.20462 lb;
    // 14 lb = 1 stone. e.g. "⚖ 95 kg · 14st 13lb"
    const kg = parseFloat(String(data.weight).replace(/[^0-9.]/g, ""));
    let extra = "";
    if (Number.isFinite(kg) && kg > 0) {
      const totalLb = kg * 2.2046226218;
      const stones = Math.floor(totalLb / 14);
      const lbsRem = Math.round(totalLb - stones * 14);
      // Handle the 14-lb rounding carry (e.g. 13.6 lb → 14 lb → next stone)
      const s = lbsRem === 14 ? stones + 1 : stones;
      const l = lbsRem === 14 ? 0 : lbsRem;
      const totalLbRounded = Math.round(totalLb);
      // Thin spaces around the bullet separators so kg / stones / pounds are
      // easier to scan at a glance while staying inside a single tag.
      const sep = '<span style="opacity:.45; margin:0 4px;">•</span>';
      extra = `${sep}${s} st ${l} lb${sep}${totalLbRounded} lb`;
    }
    html += `<span class="tag tag-slate">⚖ ${escapeHtml(data.weight)}${extra}</span>`;
  }
  if (data.height && data.height !== "—") html += `<span class="tag tag-slate">↕ ${escapeHtml(data.height)}</span>`;
  // (Removed the "0/6 done" tag — the same count is shown in the
  // Prescription Steps collapse header so showing it twice was noisy.)
  document.getElementById("pb-tags").innerHTML = html;
  banner.classList.add("visible");
}

// ═══════════════════════════════════════════════
//  PROGRESS BAR
// ═══════════════════════════════════════════════

function updateProgress(completion) {
  const done = [...TABS_WITH_DONE].filter(t => completion[t]).length;
  const total = TABS_WITH_DONE.size;
  const pct = Math.round((done / total) * 100);
  const fill = document.getElementById("pg-fill");
  const label = document.getElementById("pg-label");
  const pctEl = document.getElementById("pg-pct");
  if (fill) fill.style.width = pct + "%";
  if (label) label.textContent = `${done} of ${total} steps complete`;
  if (pctEl) pctEl.textContent = pct + "%";
}

function applyWorkflowStepsVisibility(show) {
  const section = document.getElementById("workflow-steps-section");
  if (!section) return;
  section.classList.toggle("is-hidden", !show);
  if (!show) setWorkflowStepsOpen(false);
}

function setWorkflowStepsOpen(open) {
  const section = document.getElementById("workflow-steps-section");
  const toggle = document.getElementById("progress-wrap-toggle");
  if (!section || !toggle) return;
  section.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function initWorkflowStepsPanel() {
  const section = document.getElementById("workflow-steps-section");
  const toggle = document.getElementById("progress-wrap-toggle");
  if (!section || !toggle) return;

  const closeSteps = () => setWorkflowStepsOpen(false);
  const toggleSteps = () => setWorkflowStepsOpen(!section.classList.contains("is-open"));

  toggle.addEventListener("click", toggleSteps);
  toggle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSteps();
    }
    if (e.key === "Escape") closeSteps();
  });

  try {
    chrome.storage.sync.get({ show_workflow_steps: true }, (r) => {
      applyWorkflowStepsVisibility(r.show_workflow_steps !== false);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.show_workflow_steps) return;
      applyWorkflowStepsVisibility(changes.show_workflow_steps.newValue !== false);
    });
  } catch (_) {
    applyWorkflowStepsVisibility(true);
  }

  setWorkflowStepsOpen(false);
}

// ═══════════════════════════════════════════════
//  WORKFLOW STEPS
// ═══════════════════════════════════════════════

function showWorkflow(data) {
  const empty = document.getElementById("wf-empty");
  const content = document.getElementById("wf-content");
  if (!data) {
    empty.style.display = "flex";
    content.style.display = "none";
    return;
  }
  empty.style.display = "none";
  content.style.display = "flex";
  renderWorkflow(data);
  populateGapCalculatorFromOrder(data);
}

function populateGapCalculatorFromOrder(data) {
  if (!data) return;
  const gDateInp = document.getElementById("gap-last-order-date");
  const gSupply = document.getElementById("gap-supply-duration");
  const gBmi = document.getElementById("gap-current-bmi");
  const gMedSel = document.getElementById("gap-medication");
  const gDoseSel = document.getElementById("gap-last-dose");
  if (data.fulfilledDateIso && gDateInp) gDateInp.value = data.fulfilledDateIso;
  if (data.fulfilledQty && gSupply) gSupply.value = String(qtyToSupplyWeeks(data.fulfilledQty));
  if (data.bmi != null && gBmi && !gBmi.value) gBmi.value = String(data.bmi);
  if (gMedSel && data.medication) {
    const medLow = data.medication.toLowerCase();
    if (medLow.includes("mounjaro")) gMedSel.value = "mounjaro";
    else if (medLow.includes("wegovy")) gMedSel.value = "wegovy";
    else if (medLow.includes("nevolat")) gMedSel.value = "nevolat";
    if (gMedSel.value && gDoseSel && typeof window.__mgPopulateGapDoses === "function") {
      window.__mgPopulateGapDoses(gDoseSel, gMedSel.value);
    }
  }
  if (data.dose && gDoseSel) {
    const opt = [...gDoseSel.options].find(o => o.value === data.dose || data.dose.includes(o.value));
    if (opt) gDoseSel.value = opt.value;
  }
}

function qtyToSupplyWeeks(qty) {
  return Math.max(4, (parseInt(qty, 10) || 1) * 4);
}

function renderWorkflow(data) {
  const list = document.getElementById("steps-list");
  if (!list || !data) return;

  const completion = data.tabCompletion || {};
  const activeTab = data.activeTab || null;
  updateProgress(completion);
  updateBulkApproveButton(completion);

  // Preserve expanded state across re-renders
  const prevExpanded = !!document.querySelector(".step-card.is-expanded");

  list.innerHTML = TAB_ORDER.map((tab, idx) => buildStepCardHtml(tab, idx, completion[tab], activeTab === tab)).join("");
  bindStepEvents();

  // Render the docs dropdown content
  renderDocsDropdown(data.documents, data.modalOpenDocId);

  // Dropdown is closed by default — only restore if user had it open in this session.
  if (prevExpanded) toggleDropdown("documents", true);
}

function toggleDropdown(tab, forceOpen) {
  const card = document.getElementById(`step-${tab}`);
  const dd = card?.querySelector(`[data-dropdown="${tab}"]`);
  if (!card || !dd) return;
  const wasOpen = dd.classList.contains("open");
  const shouldOpen = forceOpen !== undefined ? forceOpen : !wasOpen;
  dd.classList.toggle("open", shouldOpen);
  card.classList.toggle("is-expanded", shouldOpen);
  // Track manual user intent (only when this isn't a forced/auto open)
  if (forceOpen === undefined && tab === "documents") {
    window.__mgDocsUserCollapsed = !shouldOpen;
  }
}

function buildStepCardHtml(tab, idx, isDone, isActive) {
  const hasDone = TABS_WITH_DONE.has(tab);
  const num = idx + 1;
  const sub = isDone ? "Marked as done" : isActive ? "Currently viewing" : hasDone ? "Pending" : "View only";
  const hasDropdown = tab === "documents";
  let cls = "step-card";
  if (isDone) cls += " is-done";
  else if (isActive) cls += " is-active";

  const goBtn = `<button class="btn-go" data-goto="${tab}">Go</button>`;
  let actionBtn = "";
  if (hasDone) {
    actionBtn = isDone
      ? `<button class="btn-undo" data-undo="${tab}" title="Un-mark as done">
           <span class="undo-icon">↺</span> Undo
         </button>`
      : `<button class="btn-mark" data-mark="${tab}" title="Mark as done">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
           Approve
         </button>`;
  }
  const expandBtn = hasDropdown
    ? `<button class="step-expand-toggle" data-expand="${tab}" title="Show / hide documents" type="button">
         <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
       </button>`
    : `<span class="step-expand-toggle is-placeholder" aria-hidden="true"></span>`;

  return `<div class="${cls}" id="step-${tab}" data-has-dropdown="${hasDropdown}">
    <div class="step-done-badge">✓ Done</div>
    <div class="step-body">
      <div class="step-num">
        <span class="num-label">${num}</span>
        <span class="check-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
      </div>
      <div class="step-text">
        <div class="step-name">${TAB_LABELS[tab]}</div>
        <div class="step-sub">${sub}</div>
      </div>
      <div class="step-btns">${expandBtn}${goBtn}${actionBtn}</div>
    </div>
    ${hasDropdown ? `<div class="step-dropdown" data-dropdown="${tab}"></div>` : ""}
  </div>`;
}

// ── Render the documents dropdown content ──
function renderDocsDropdown(documents, modalOpenDocId) {
  const dd = document.querySelector('[data-dropdown="documents"]');
  if (!dd) return;
  const docs = documents || [];

  if (!docs.length) {
    dd.innerHTML = `<div style="font-size:11px;color:var(--slate-light);text-align:center;padding:10px;">No documents detected on the page.</div>`;
    return;
  }

  const anyVerifiable = docs.some(d => d.hasVerify);

  const kindIcon = (kind) => kind === "video"
    ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`
    : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

  const statusLabel = {
    verified: "Verified",
    pending_review: "Pending",
    missing: "Not uploaded",
    rejected: "Rejected",
    unknown: ""
  };
  const statusKey = (s) => s === "pending_review" ? "pending" : s; // for css class

  let html = `<button class="doc-verify-all" data-verify-all="1" ${anyVerifiable ? "" : "disabled"}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    Verify All ${anyVerifiable ? `(${docs.filter(d => d.hasVerify).length})` : "— none pending"}
  </button>`;

  docs.forEach(d => {
    const sKey = statusKey(d.status);
    const isOpen = modalOpenDocId && modalOpenDocId === d.id;
    const viewLabel = isOpen ? "Close photo" : "View";
    const viewIcon = isOpen
      ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
      : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    html += `<div class="doc-row is-${sKey}" data-doc-row="${d.id}">
      <div class="doc-row-head">
        <span class="doc-row-kind">${kindIcon(d.kind)}</span>
        <span class="doc-row-title">${escapeHtml(d.title)}</span>
        <span class="doc-row-badge b-${sKey}">${statusLabel[d.status] || ""}</span>
      </div>
      <div class="doc-row-btns">
        <button class="doc-row-btn b-view${isOpen ? " is-open" : ""}" data-doc-act="view" data-doc-id="${d.id}" ${d.hasView ? "" : "disabled"}>
          ${viewIcon}
          ${viewLabel}
        </button>
        <button class="doc-row-btn b-verify" data-doc-act="verify" data-doc-id="${d.id}" ${d.hasVerify ? "" : "disabled"}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          Verify
        </button>
        <button class="doc-row-btn b-reject" data-doc-act="reject" data-doc-id="${d.id}" ${d.hasReject ? "" : "disabled"}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Reject
        </button>
      </div>
    </div>`;
  });

  dd.innerHTML = html;

  // Wire up per-doc actions
  dd.querySelectorAll("[data-doc-act]").forEach(b => {
    b.addEventListener("click", e => {
      e.stopPropagation();
      const action = b.dataset.docAct;
      const docId = b.dataset.docId;
      docAction(docId, action, b);
    });
  });
  dd.querySelector("[data-verify-all]")?.addEventListener("click", e => {
    e.stopPropagation();
    docVerifyAll();
  });
}

function docAction(docId, action, btn) {
  if (btn) { btn.disabled = true; btn.style.opacity = "0.55"; }
  msgContent({ type: "DOC_ACTION", docId, action })
    .then(resp => {
      if (resp?.success) {
        toast(`${action.charAt(0).toUpperCase() + action.slice(1)} → ${docId.replace(/_/g, " ")}`, "success");
        // Refresh data so the row badge/buttons update
        setTimeout(() => doScan(), 700);
      } else {
        toast(resp?.error || `Could not ${action}`, "error");
        if (btn) { btn.disabled = false; btn.style.opacity = ""; }
      }
    })
    .catch(() => {
      toast("Could not connect — are you on the order page?", "error");
      if (btn) { btn.disabled = false; btn.style.opacity = ""; }
    });
}

// ── Quick-comment buttons ──
// User-configurable chips rendered above the rx-comment textarea. Clicking
// a chip drops its pre-written text into the comment box (append on new
// line if there's already content). Defaults to a single "Repeat" chip
// out of the box; the list is fully editable in the options page and
// persisted to chrome.storage.sync under `quick_comment_buttons`.
const BUILTIN_QUICK_COMMENTS = [
  {
    name: "Repeat",
    text: "patient is a repeat patient, has filled the consultation with no changes and no side effect requesting a repeat prescription after reviewing the records happy to continue with the request",
  },
  {
    name: "Last Injected Dose Valid",
    text: "Patient Last Injected dose is within less than 4weeks, happy to prescribe.",
  },
  {
    name: "Transfer Patient",
    text: "Patient previous use evidence is valid, happy to approve the requested strength and provide continued care.",
  },
];
function getQuickComments() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(["quick_comment_buttons"], (r) => {
        const v = r && r.quick_comment_buttons;
        resolve(Array.isArray(v) && v.length ? v : BUILTIN_QUICK_COMMENTS);
      });
    } catch {
      resolve(BUILTIN_QUICK_COMMENTS);
    }
  });
}
async function renderQuickComments() {
  const wrap = document.getElementById("rx-quick-comments");
  if (!wrap) return;
  const items = await getQuickComments();
  wrap.innerHTML = "";
  items.forEach((it) => {
    if (!it || !it.name) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rx-quick-chip";
    btn.textContent = it.name;
    btn.title = it.text || "";
    btn.addEventListener("click", () => {
      const ta = document.getElementById("rx-comment");
      if (!ta) return;
      // Replace (not append) so users don't have to clear the textarea
      // between clicking different chips.
      ta.value = it.text || "";
      ta.focus();
      try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    wrap.appendChild(btn);
  });
}
// ── Quick HOLD-reason buttons ──
// Same chip pattern as the rx-comment quick buttons, but for #hold-comment
// (the textarea under "Place on hold"). Stored separately under
// `quick_hold_buttons` so the two button sets stay independently editable.
const BUILTIN_QUICK_HOLDS = [
  {
    name: "Previous Prescription",
    text: "Patient needs to upload a valid previous prescription that includes:\n- Name\n- Date of dispensing/order\n- Medication name and dose\n- Pharmacy / prescriber details",
  },
  { name: "Loose Clothing", text: "Loose Clothing, patient should upload a new video with appropriate clothes showing body shape." },
  { name: "Invalid Full Body Video", text: "Invalid Full Body Video, cannot see the entire body to establish BMI eligibility" },
  { name: "Check Comorbidity", text: "check comorbidity as patient is not currently eligible, and may be eligible if has known comorbidity" },
  { name: "PP Date Missing", text: "Previous Prescription does not contain Date of Order/Dispense" },
  { name: "Last Injection", text: "need to confirm last injected dose, to establish dose appropriateness" },
  { name: "Weight and Height", text: "Patient Must Enter Both Weight and Height To establish BMI" },
  { name: "Invalid Scale Video", text: "Invalid Scale Video not meeting criteria, must show face and scale readings must be visible" },
  { name: "Documents", text: "Waiting for patient to upload the required documents to verify identity and proof of previous use." },
];
function getQuickHolds() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(["quick_hold_buttons"], (r) => {
        const v = r && r.quick_hold_buttons;
        resolve(Array.isArray(v) && v.length ? v : BUILTIN_QUICK_HOLDS);
      });
    } catch {
      resolve(BUILTIN_QUICK_HOLDS);
    }
  });
}
async function renderQuickHolds() {
  const wrap = document.getElementById("hold-quick-comments");
  if (!wrap) return;
  const items = await getQuickHolds();
  wrap.innerHTML = "";
  items.forEach((it) => {
    if (!it || !it.name) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rx-quick-chip";
    // Subtle amber palette so users can visually tell hold chips from
    // approval (blue) chips at a glance.
    btn.style.color = "#92400e";
    btn.style.background = "#fffbeb";
    btn.style.borderColor = "#fde68a";
    btn.textContent = it.name;
    btn.title = it.text || "";
    btn.addEventListener("click", () => {
      const ta = document.getElementById("hold-comment");
      if (!ta) return;
      // Replace (not append) so picking a different hold-reason chip
      // overwrites the previous one instead of stacking.
      ta.value = it.text || "";
      ta.focus();
      try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      setHoldQuickDropdownOpen(false);
    });
    wrap.appendChild(btn);
  });
}

function setHoldQuickDropdownOpen(open) {
  const dropdown = document.getElementById("hold-quick-dropdown");
  const toggle = document.getElementById("hold-quick-toggle");
  if (!dropdown || !toggle) return;
  dropdown.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function initHoldQuickDropdown() {
  const dropdown = document.getElementById("hold-quick-dropdown");
  const toggle = document.getElementById("hold-quick-toggle");
  if (!dropdown || !toggle || toggle.dataset.bound) return;
  toggle.dataset.bound = "1";
  setHoldQuickDropdownOpen(false);
  toggle.addEventListener("click", () => {
    setHoldQuickDropdownOpen(!dropdown.classList.contains("is-open"));
  });
}

// ── Email macros (templates the user can copy-paste into a real email) ──
// User-configurable templates rendered as chips above the email-body textarea
// in the sidepanel. Stored under `email_macros` in chrome.storage.sync.
// The token {patient_name} (or {{patient_name}}) is substituted with the
// current patient's name on render. Line breaks, blank lines and indentation
// are preserved verbatim when the user copies the body — plain-text clipboard.
const BUILTIN_EMAIL_MACROS = typeof EDMS_FLAT_MACROS !== "undefined" ? EDMS_FLAT_MACROS : [];
function getEmailMacros() {
  // Stored in chrome.storage.local — the full builtin set is ~8.4KB, which
  // exceeds chrome.storage.sync's 8192-byte per-item quota and would silently
  // fail to save. Version bump forces stale saves to be replaced with the
  // current BUILTIN library (so new templates like Comorbidity show up).
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(["email_macros", "email_macros_version"], (r) => {
        const v = r && r.email_macros;
        const ver = r && r.email_macros_version;
        if (!Array.isArray(v) || !v.length || ver !== EMAIL_MACROS_VERSION) {
          try { chrome.storage.local.set({ email_macros: BUILTIN_EMAIL_MACROS, email_macros_version: EMAIL_MACROS_VERSION }); } catch {}
          resolve(BUILTIN_EMAIL_MACROS);
          return;
        }
        resolve(v);
      });
    } catch {
      resolve(BUILTIN_EMAIL_MACROS);
    }
  });
}
function currentPatientName() {
  try {
    if (typeof currentOrderData !== "undefined" && currentOrderData && currentOrderData.patientName) {
      return String(currentOrderData.patientName).trim();
    }
    const el = document.getElementById("pb-name");
    if (el && el.textContent && el.textContent !== "Patient") return el.textContent.trim();
  } catch {}
  return "patient";
}
function substituteEmail(text) {
  const name = currentPatientName();
  return (text || "").replace(/\{\{?\s*patient_name\s*\}?\}/gi, name);
}
async function renderEmailMacros() {
  const chips = document.getElementById("email-macros");
  const body  = document.getElementById("email-body");
  if (!chips) return;
  const items = await getEmailMacros();
  chips.innerHTML = "";
  items.forEach((it, idx) => {
    if (!it || !it.name) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rx-quick-chip";
    btn.style.color = "#5b21b6";
    btn.style.background = "#f5f3ff";
    btn.style.borderColor = "#ddd6fe";
    btn.textContent = it.name;
    btn.title = it.text || "";
    btn.addEventListener("click", () => {
      if (!body) return;
      body.value = substituteEmail(it.text || "");
      body.focus();
      try { body.setSelectionRange(body.value.length, body.value.length); } catch {}
    });
    chips.appendChild(btn);
    // Auto-load the first macro's content into the body if it's empty.
    if (idx === 0 && body && !body.value) body.value = substituteEmail(it.text || "");
  });
}

async function copyEmailBody() {
  const body = document.getElementById("email-body");
  const btn  = document.getElementById("btn-copy-email");
  if (!body) return;
  const text = body.value || "";
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    } else {
      body.focus();
      body.select();
      ok = document.execCommand && document.execCommand("copy");
    }
  } catch { ok = false; }
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = ok
      ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied`
      : `Copy failed`;
    setTimeout(() => { btn.innerHTML = orig; }, 1400);
  }
  if (ok) toast("Email copied — paste into your mail client", "success", 1800);
}

function showEmptyEmailModal() {
  const modal = document.getElementById("mg-empty-email-modal");
  if (!modal) return;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function hideEmptyEmailModal() {
  const modal = document.getElementById("mg-empty-email-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}

async function emailPatient() {
  const body = document.getElementById("email-body");
  const btn  = document.getElementById("btn-email-patient");
  if (!body) return;
  const text = (body.value || "").trim();
  if (!text) {
    showEmptyEmailModal();
    return;
  }

  const message = substituteEmail(body.value);
  if (btn) btn.disabled = true;
  try {
    const resp = await msgContent({ type: "SEND_PATIENT_MESSAGE", text: message });
    if (resp?.success) {
      toast("Message sent to patient", "success", 2200);
    } else {
      toast(resp?.error || "Could not send message", "error");
    }
  } catch {
    toast("Could not connect — open the order page first", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Optional-section visibility ──
// These blocks are disabled by default and only shown when the user turns them
// on in Settings. Stored as booleans in chrome.storage.sync.
function applyEmailSectionVisibility(show) {
  const block = document.getElementById("email-patient-block");
  if (!block) return;
  block.classList.toggle("is-hidden", !show);
}

// The two Tools calculators (GLP-1 switcher + gap-in-treatment) share the
// "Tools" divider, which is only shown when at least one calculator is visible.
let __showDoseCalc = false;
let __showGapCalc = false;
function applyToolsVisibility() {
  const dose = document.getElementById("dose-calculator-section");
  const gap = document.getElementById("gap-calculator-section");
  const divider = document.getElementById("tools-divider");
  if (dose) dose.classList.toggle("is-hidden", !__showDoseCalc);
  if (gap) gap.classList.toggle("is-hidden", !__showGapCalc);
  if (divider) divider.classList.toggle("is-hidden", !(__showDoseCalc || __showGapCalc));
}

// Re-render whenever the user saves new buttons in the options page.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      if (changes.quick_comment_buttons) renderQuickComments();
      if (changes.quick_hold_buttons) renderQuickHolds();
      if (changes.show_email_section) applyEmailSectionVisibility(changes.show_email_section.newValue === true);
      if (changes.show_dose_calculator) { __showDoseCalc = changes.show_dose_calculator.newValue === true; applyToolsVisibility(); }
      if (changes.show_gap_calculator) { __showGapCalc = changes.show_gap_calculator.newValue === true; applyToolsVisibility(); }
    }
    if (area === "local" && changes.email_macros) renderEmailMacros();
  });
} catch {}
// Initial render — runs after the script tag at end-of-body, so DOM is ready.
renderQuickComments();
renderQuickHolds();
initHoldQuickDropdown();
renderEmailMacros();
try {
  chrome.storage.sync.get(
    { show_email_section: false, show_dose_calculator: false, show_gap_calculator: false },
    (r) => {
      applyEmailSectionVisibility(r.show_email_section === true);
      __showDoseCalc = r.show_dose_calculator === true;
      __showGapCalc = r.show_gap_calculator === true;
      applyToolsVisibility();
    }
  );
} catch (_) {
  applyEmailSectionVisibility(false);
  applyToolsVisibility();
}
document.addEventListener("DOMContentLoaded", () => {
  const cb = document.getElementById("btn-copy-email");
  if (cb) cb.addEventListener("click", copyEmailBody);
  const ep = document.getElementById("btn-email-patient");
  if (ep) ep.addEventListener("click", emailPatient);
  const emptyOk = document.getElementById("mg-empty-email-ok");
  const emptyBackdrop = document.getElementById("mg-empty-email-backdrop");
  if (emptyOk) emptyOk.addEventListener("click", hideEmptyEmailModal);
  if (emptyBackdrop) emptyBackdrop.addEventListener("click", hideEmptyEmailModal);
}, { once: true });

// ── SCR mode toggles (segmented radio) ──
function formatScrModeTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function updateScrModeTimestamp(mode, iso) {
  const el = document.getElementById("scr-mode-time");
  if (!el) return;
  const label = mode === "accessed" ? "SCR accessed" : "SCR not accessed";
  const when = formatScrModeTime(iso);
  el.textContent = when ? `${label} · ${when}` : "";
}

function getScrMode() {
  const accessed = document.getElementById("scr-accessed");
  return accessed && accessed.checked ? "accessed" : "not_accessed";
}

function initScrModeToggles() {
  const notAccessed = document.getElementById("scr-not-accessed");
  const accessed = document.getElementById("scr-accessed");
  if (!notAccessed || !accessed) return;

  function applyMode(mode, atIso) {
    const isAccessed = mode === "accessed";
    notAccessed.checked = !isAccessed;
    accessed.checked = isAccessed;
    updateScrModeTimestamp(mode, atIso);
  }

  try {
    chrome.storage.sync.get(["scr_mode", "scr_mode_at"], (r) => {
      const mode = r && r.scr_mode === "accessed" ? "accessed" : "not_accessed";
      applyMode(mode, r && r.scr_mode_at);
    });
  } catch {}

  function saveMode(mode) {
    const at = new Date().toISOString();
    updateScrModeTimestamp(mode, at);
    try { chrome.storage.sync.set({ scr_mode: mode, scr_mode_at: at }); } catch {}
  }

  notAccessed.addEventListener("change", () => {
    if (notAccessed.checked) saveMode("not_accessed");
  });
  accessed.addEventListener("change", () => {
    if (accessed.checked) saveMode("accessed");
  });
}

// ── Approve & Issue Rx — opens drawer + auto-fills both steps + clicks Approve ──
async function issueRx() {
  const btn = document.getElementById("btn-issue-rx");
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Issuing…`;
  try {
    const commentEl = document.getElementById("rx-comment");
    const comment = (commentEl?.value || "").trim();
    const scrMode = getScrMode();
    const resp = await msgContent({ type: "RX_APPROVE_AUTOFILL", comment, scrMode });
    if (resp?.success) {
      toast("✓ Prescription approved & issued", "success");
      // Clear the comment box so it can't be reused on the next patient.
      if (commentEl) commentEl.value = "";
      setTimeout(() => doScan(), 800);
    } else {
      toast(resp?.error || "Could not complete approval", "error");
    }
  } catch {
    toast("Could not connect — open the order page first", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// ── Place on Hold — mirrors the Approve & Issue Rx pattern. Reads the
//    default hold reason from settings (chrome.storage.sync) and APPENDS
//    anything the user typed in #hold-comment on a new line.
const HOLD_BUILTIN_REASON = "Waiting for patient to upload documents.";
const APPROVE_PATIENT_MESSAGE_BUILTIN = `Dear Patient,

Your order has been approved and will now undergo a final clinical check by our pharmacist before being passed to our dispatch team.

Please read the following information before using your medication:

- Use your injection once weekly, preferably on the same day each week.
- Follow the instructions supplied with your pen, as administration may differ between devices.
- Inject into the abdomen, thigh or upper arm and rotate the injection site each week.
- Use a new needle for every injection where required.
- Store the medication as stated on the packaging and patient information leaflet. Do not freeze.
- Do not increase your dose unless it has been approved by your prescriber.

Common side effects include nausea, indigestion, reduced appetite, constipation, diarrhoea and vomiting. These may be more noticeable when starting treatment or increasing the dose.

To help reduce side effects:

- Eat smaller portions and stop eating when you feel full.
- Avoid rich, greasy or high-fat foods.
- Drink plenty of fluids.
- Avoid eating large meals late at night.

Please contact us before your next injection if your side effects are severe, persistent or affecting your ability to eat or drink.

Follow the missed-dose instructions in the patient information leaflet, as these differ between medications.

Stop using the medication and seek urgent medical advice if you experience:

- Severe or persistent abdominal pain, particularly if it spreads to your back
- Repeated vomiting or signs of dehydration
- Yellowing of the skin or eyes
- Swelling of the face, lips, tongue or throat
- Difficulty breathing or signs of a severe allergic reaction

Please read the patient information leaflet supplied with your medication before use.

If you have any questions or concerns, please reply to this message.

Kind regards,
EveryDayMeds Clinical Team`;
function getHoldDefault() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(["default_hold_reason"], (r) => {
        resolve((r && r.default_hold_reason) || HOLD_BUILTIN_REASON);
      });
    } catch (_) { resolve(HOLD_BUILTIN_REASON); }
  });
}
function getPatientCounsellingSettings() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(
        ["send_patient_counselling_on_approve", "patient_counselling_templates", "default_approve_patient_message"],
        (r) => {
          const enabled = r && r.send_patient_counselling_on_approve !== false;
          let templates = Array.isArray(r?.patient_counselling_templates)
            ? r.patient_counselling_templates.filter((t) => t && t.text)
            : [];
          if (!templates.length && r?.default_approve_patient_message) {
            templates = [{ name: "Default", text: r.default_approve_patient_message, active: true }];
          }
          if (!templates.length) {
            templates = [{ name: "Default", text: APPROVE_PATIENT_MESSAGE_BUILTIN, active: true }];
          }
          const active = templates.find((t) => t.active) || templates[0];
          resolve({
            enabled,
            message: active?.text || APPROVE_PATIENT_MESSAGE_BUILTIN,
            templateName: active?.name || "Default",
          });
        }
      );
    } catch (_) {
      resolve({
        enabled: true,
        message: APPROVE_PATIENT_MESSAGE_BUILTIN,
        templateName: "Default",
      });
    }
  });
}

function getApprovePatientMessage() {
  return getPatientCounsellingSettings().then((s) => s.message);
}
async function placeOnHold() {
  const btn = document.getElementById("btn-place-hold");
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> <span>Placing…</span>`;

  // Hard safety: if the content script never replies (e.g. it didn't get
  // reloaded after an extension update — common MV3 quirk), the button used
  // to spin forever. This timeout guarantees we always recover and show a
  // useful error so the user can take action.
  const HARD_TIMEOUT_MS = 15000;
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("No response from page — try reloading the order page (or the extension), then try again")), HARD_TIMEOUT_MS)
  );

  try {
    const holdEl = document.getElementById("hold-comment");
    const extra = (holdEl?.value || "").trim();
    const defaultReason = await getHoldDefault();
    const reason = extra ? `${defaultReason}\n${extra}` : defaultReason;
    const resp = await Promise.race([
      msgContent({ type: "RX_HOLD_ORDER", reason }),
      timeout,
    ]);
    if (resp?.success) {
      toast("✓ Order placed on hold", "success");
      if (holdEl) holdEl.value = "";
      setTimeout(() => doScan(), 800);
    } else {
      toast(resp?.error || "Could not place on hold", "error");
    }
  } catch (e) {
    const msg = e?.message || "";
    if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
      toast("Page not ready — reload the order page, then try again", "error");
    } else if (msg) {
      toast(msg, "error");
    } else {
      toast("Could not connect — open the order page first", "error");
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

function docVerifyAll() {
  const allBtn = document.querySelector("[data-verify-all]");
  if (allBtn) { allBtn.disabled = true; allBtn.textContent = "Verifying…"; }
  msgContent({ type: "DOC_VERIFY_ALL" })
    .then(resp => {
      if (resp?.success) {
        toast(`✓ Verified ${resp.count} document${resp.count === 1 ? "" : "s"}`, "success");
        setTimeout(() => doScan(), 800);
      } else {
        toast(resp?.error || "Nothing to verify", "error");
        if (allBtn) { allBtn.disabled = false; }
      }
    })
    .catch(() => {
      toast("Could not connect", "error");
      if (allBtn) { allBtn.disabled = false; }
    });
}

function bindStepEvents() {
  const list = document.getElementById("steps-list");
  if (!list) return;

  list.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); goToTab(b.dataset.goto); }));
  list.querySelectorAll("[data-mark]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); markDone(b.dataset.mark); }));
  list.querySelectorAll("[data-undo]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); undoTab(b.dataset.undo); }));
  list.querySelectorAll("[data-expand]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); toggleDropdown(b.dataset.expand); }));

  // Whole-card click = same as Go: navigate to the tab. No dropdown/hint expansion.
  list.querySelectorAll(".step-card .step-body").forEach(body => {
    body.addEventListener("click", (e) => {
      if (e.target.closest(".step-btns")) return;
      const card = body.closest(".step-card");
      if (!card) return;
      const tab = card.id.replace(/^step-/, "");
      goToTab(tab);
    });
  });
}

// ── Go ─────────────────────────────────────────
function goToTab(tab) {
  msgContent({ type: "NAVIGATE_TAB", tabName: tab })
    .then(() => {
      toast(`Navigated to ${TAB_LABELS[tab]}`, "success");
      if (currentOrderData) { currentOrderData.activeTab = tab; highlightActiveTab(tab); }
    })
    .catch(() => toast("Could not navigate — open an order page first", "error"));
}

// ── Reload extension (re-reads files from the unpacked folder) ──────────────
// Chrome re-reads whatever files are currently on disk — same as clicking
// "Reload" on chrome://extensions. Also re-injects the bundled content script
// into the active tab so the page picks up changes without a manual refresh.
async function reloadExtension() {
  toast("Reloading extension…", "default", 1500);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && /^https?:/.test(tab.url || "")) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      }).catch(err => console.warn("MediGuard: content.js re-injection failed:", err));
    }
  } catch (e) {
    console.warn("MediGuard: re-inject step failed:", e);
  }
  setTimeout(() => {
    try { chrome.runtime.reload(); }
    catch (e) { toast("Could not reload: " + (e.message || "unknown"), "error"); }
  }, 250);
}

// ── Bulk Approve all / Undo all ─────────────────
let isBulkRunning = false;

function updateBulkApproveButton(completion) {
  const btn = document.getElementById("btn-bulk-approve");
  if (!btn) return;
  // Don't fight the active batch — it manages its own label + disabled state.
  if (isBulkRunning) return;
  const pending = [...TABS_WITH_DONE].filter(t => !completion[t]);
  const CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  if (pending.length === 0) {
    btn.innerHTML = "Undo all";
    btn.classList.add("is-undo");
    btn.dataset.mode = "undo";
    btn.disabled = false;
  } else {
    btn.innerHTML = `${CHECK_SVG}<span>Approve all (${pending.length})</span>`;
    btn.classList.remove("is-undo");
    btn.dataset.mode = "approve";
    btn.disabled = false;
  }
}

async function bulkApproveOrUndo() {
  if (isBulkRunning) return;
  const btn = document.getElementById("btn-bulk-approve");
  if (!btn || btn.disabled) return;
  const mode = btn.dataset.mode === "undo" ? "undo" : "approve";
  const initialCompletion = (currentOrderData && currentOrderData.tabCompletion) || {};
  const targets = [...TABS_WITH_DONE].filter(t =>
    mode === "approve" ? !initialCompletion[t] : initialCompletion[t]
  );
  if (!targets.length) {
    toast(mode === "approve" ? "Nothing to approve" : "Nothing to undo", "info");
    return;
  }

  isBulkRunning = true;
  btn.disabled = true;
  const origLabel = btn.innerHTML;
  const SPIN_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
  btn.innerHTML = mode === "approve"
    ? `${SPIN_SVG}<span>Approving ${targets.length}…</span>`
    : `${SPIN_SVG}<span>Undoing ${targets.length}…</span>`;
  toast(
    mode === "approve"
      ? `Approving ${targets.length} step${targets.length>1?"s":""}…`
      : `Undoing ${targets.length} step${targets.length>1?"s":""}…`,
    mode === "approve" ? "success" : "undo",
    1800
  );

  // When approving, also fire the "Verify All" sweep on the documents tab —
  // this verifies every top-level document AND every inner photo/sub-document
  // that still has a Verify button. Already-verified items expose no button
  // and are skipped automatically. Best-effort: failure here doesn't abort.
  if (mode === "approve") {
    try {
      btn.innerHTML = `${SPIN_SVG}<span>Verifying photos…</span>`;
      const vResp = await msgContent({ type: "DOC_VERIFY_ALL" });
      if (vResp?.count) {
        toast(`✓ Verified ${vResp.count} item${vResp.count === 1 ? "" : "s"}`, "success", 1500);
      }
    } catch (_) { /* silent — continue with approvals */ }
    btn.innerHTML = `${SPIN_SVG}<span>Approving ${targets.length}…</span>`;
  }

  let ok = 0, fail = 0;
  // Sequential: await each before starting the next so the page never has two
  // in-flight tab navigations + completion writes overlapping.
  for (const tab of targets) {
    // Re-check latest completion right before acting — skip if already matching,
    // so the toggle-based MARK_TAB_DONE can't accidentally invert state.
    const liveCompletion = (currentOrderData && currentOrderData.tabCompletion) || {};
    const alreadyMatches = mode === "approve" ? !!liveCompletion[tab] : !liveCompletion[tab];
    if (alreadyMatches) continue;

    // Visual optimistic flip on the card
    setStepDone(tab, mode === "approve");
    if (mode === "undo") {
      const card = document.getElementById(`step-${tab}`);
      if (card) card.classList.add("is-flashing");
    }

    try {
      if (mode === "approve") {
        const resp = await msgContent({ type: "MARK_TAB_DONE", tabName: tab, autoAdvance: false });
        if (resp?.success) {
          ok++;
          if (currentOrderData) {
            if (!currentOrderData.tabCompletion) currentOrderData.tabCompletion = {};
            currentOrderData.tabCompletion[tab] = true;
          }
        } else {
          fail++;
          setStepDone(tab, false); // revert optimistic
        }
      } else {
        // Undo: navigate to the tab first, then toggle off
        await msgContent({ type: "NAVIGATE_TAB", tabName: tab });
        await new Promise(r => setTimeout(r, 250));
        const resp = await msgContent({ type: "MARK_TAB_DONE", tabName: tab, autoAdvance: false });
        if (resp?.success) {
          ok++;
          if (currentOrderData) {
            if (!currentOrderData.tabCompletion) currentOrderData.tabCompletion = {};
            currentOrderData.tabCompletion[tab] = false;
          }
        } else {
          fail++;
          setStepDone(tab, true);
        }
        const card = document.getElementById(`step-${tab}`);
        if (card) card.classList.remove("is-flashing");
      }
    } catch {
      fail++;
      setStepDone(tab, mode !== "approve");
    }
    // Small gap so the user visually perceives each card flip
    await new Promise(r => setTimeout(r, 180));
  }

  // After a successful Approve-all sweep, optionally send the active counselling
  // template through encrypted patient chat. Best-effort — failure is logged
  // via toast but does not change the approval result.
  if (mode === "approve" && ok > 0 && fail === 0) {
    try {
      const counselling = await getPatientCounsellingSettings();
      if (counselling.enabled) {
        btn.innerHTML = `${SPIN_SVG}<span>Sending patient message…</span>`;
        const message = substituteEmail(counselling.message).trim();
        if (message) {
          const cResp = await msgContent({ type: "SEND_PATIENT_MESSAGE", text: message });
          if (cResp?.success) {
            toast(`Counselling sent (${counselling.templateName})`, "success", 1800);
          } else if (cResp?.error) {
            toast(`Message not sent: ${cResp.error}`, "error", 2400);
          }
        }
      }
    } catch (_) { /* silent */ }
  }

  // Refresh progress/banner from the final state
  if (currentOrderData) {
    renderBanner(currentOrderData);
    updateProgress(currentOrderData.tabCompletion || {});
  }

  isBulkRunning = false;
  btn.disabled = false;
  btn.innerHTML = origLabel; // updateBulkApproveButton will refine on next scan
  updateBulkApproveButton((currentOrderData && currentOrderData.tabCompletion) || {});

  toast(
    fail === 0
      ? (mode === "approve" ? `✓ Approved ${ok} step${ok>1?"s":""}` : `↺ Undone ${ok} step${ok>1?"s":""}`)
      : `Done — ${ok} succeeded, ${fail} failed`,
    fail === 0 ? (mode === "approve" ? "success" : "undo") : "error"
  );

  // Trigger a fresh scan so anything the page changed re-syncs
  setTimeout(() => doScan(), 400);
}

// ── Mark done (Approve) ─────────────────────────
function markDone(tab) {
  setStepDone(tab, true); // optimistic
  msgContent({ type: "MARK_TAB_DONE", tabName: tab })
    .then(resp => {
      if (resp?.success) {
        toast(`✓ ${TAB_LABELS[tab]} approved`, "success");
        if (currentOrderData) {
          if (!currentOrderData.tabCompletion) currentOrderData.tabCompletion = {};
          currentOrderData.tabCompletion[tab] = true;
          renderBanner(currentOrderData);
          updateProgress(currentOrderData.tabCompletion);
        }
      } else {
        setStepDone(tab, false);
        toast(resp?.error || "Action failed — try the Go button first", "error");
      }
    })
    .catch(() => { setStepDone(tab, false); toast("Could not connect — are you on an order page?", "error"); });
}

// ── Undo ────────────────────────────────────────
function undoTab(tab) {
  const card = document.getElementById(`step-${tab}`);
  if (card) card.classList.add("is-flashing");
  toast(`↺ Undoing ${TAB_LABELS[tab]}…`, "undo", 2000);

  msgContent({ type: "NAVIGATE_TAB", tabName: tab })
    .then(() => new Promise(r => setTimeout(r, 300)))
    .then(() => msgContent({ type: "MARK_TAB_DONE", tabName: tab, autoAdvance: false }))
    .then(() => {
      setTimeout(() => {
        if (card) card.classList.remove("is-flashing");
        setStepDone(tab, false);
        if (currentOrderData) {
          if (!currentOrderData.tabCompletion) currentOrderData.tabCompletion = {};
          currentOrderData.tabCompletion[tab] = false;
          currentOrderData.activeTab = tab;
          renderBanner(currentOrderData);
          updateProgress(currentOrderData.tabCompletion);
          highlightActiveTab(tab);
        }
        toast(`↺ ${TAB_LABELS[tab]} un-marked`, "undo");
      }, 450);
    })
    .catch(() => {
      if (card) card.classList.remove("is-flashing");
      toast("Could not undo — try refreshing", "error");
    });
}

// ── Apply done state visually to one card ──────
function setStepDone(tab, done) {
  const card = document.getElementById(`step-${tab}`);
  if (!card) return;
  const idx = TAB_ORDER.indexOf(tab);
  // Rebuild card body content
  const newHtml = buildStepCardHtml(tab, idx, done, false);
  // Replace just the inner content (preserve the element id)
  const tmp = document.createElement("div");
  tmp.innerHTML = newHtml;
  const newCard = tmp.firstElementChild;
  card.className = newCard.className;
  card.innerHTML = newCard.innerHTML;
  // Re-bind events for this card
  card.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); goToTab(tab); }));
  card.querySelectorAll("[data-mark]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); markDone(tab); }));
  card.querySelectorAll("[data-undo]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); undoTab(tab); }));
  card.querySelector(".step-body")?.addEventListener("click", (e) => {
    if (e.target.closest(".step-btns")) return;
    goToTab(tab);
  });
  // Documents card has an always-open inline panel — repopulate after rebuild
  // so it doesn't flash empty between approve/undo and the next scan.
  if (tab === "documents" && currentOrderData) {
    renderDocsDropdown(currentOrderData.documents, currentOrderData.modalOpenDocId);
  }
}

function highlightActiveTab(tab) {
  document.querySelectorAll(".step-card").forEach(c => c.classList.remove("is-active"));
  const card = document.getElementById(`step-${tab}`);
  if (card && !card.classList.contains("is-done")) card.classList.add("is-active");
}

// ═══════════════════════════════════════════════
//  ELIGIBILITY VIEW
// ═══════════════════════════════════════════════

function renderEligibility(data) {
  const empty = document.getElementById("el-empty");
  const content = document.getElementById("el-content");
  if (!data) { empty.style.display = "flex"; content.style.display = "none"; return; }
  empty.style.display = "none";
  content.style.display = "flex";

  const e = evaluateEligibility(data);
  const vText = e.level === "red"
    ? "⚠ Review required — red flags detected"
    : e.level === "yellow" ? "⚡ Caution — borderline criteria present"
    : "✓ No eligibility flags detected";

  let html = `<div class="verdict-card verdict-${e.level}">${vText}</div>`;

  // Flags
  if (e.flags.length) {
    html += `<div class="section-heading">Flags</div>`;
    e.flags.forEach(f => {
      html += `<div class="flag-item flag-${f.level}"><div class="flag-dot dot-${f.level}"></div><span>${f.text}</span></div>`;
    });
  }

  // Metrics card
  if (data.bmi || data.age || data.medication) {
    html += `<div class="section-heading">Patient Metrics</div><div class="info-card">
      <div class="info-card-head">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Clinical Data
      </div>`;
    [
      ["Medication", data.medication ? data.medication.replace("® Injectable Pen","").replace("®","").trim() : null],
      ["Dose", data.dose], ["BMI", data.bmi], ["Height", data.height],
      ["Weight", data.weight], ["Age", data.age ? `${data.age} years` : null],
      ["Last Fulfilled", data.fulfilledDate ? `${data.fulfilledDate}${data.fulfilledOrderDate ? ` (order ${data.fulfilledOrderDate} + 3 days)` : ""}${data.fulfilledQty ? ` · ${data.fulfilledQty} pen(s)` : ""}` : null],
      ["Expected last dose window", data.expectedLastDoseRange || null],
      ["Step 3 last dose", data.declaredLastInjection || null],
      ["Another provider", data.anotherProviderAnswer || null]
    ].forEach(([label, val]) => {
      if (!val && val !== 0) return;
      html += `<div class="info-row"><div class="info-row-label">${label}</div><div class="info-row-val">${val}</div></div>`;
    });
    html += `</div>`;
  }

  // BMI History
  if (data.bmiHistory?.length) {
    html += `<div class="section-heading">BMI History</div><div class="info-card">
      <div class="info-card-head"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Recorded Values</div>`;
    data.bmiHistory.forEach(b => {
      const tag = b.isCurrent ? " (Current)" : b.isStart ? " (Start)" : "";
      html += `<div class="info-row"><div class="info-row-label">${b.date}${tag}</div><div class="info-row-val">BMI ${b.bmi || "—"}${b.weight && b.weight !== "—" ? ` · ${b.weight}` : ""}</div></div>`;
    });
    html += `</div>`;
  }

  // Consultation Answers with highlights
  if (data.consultationAnswers?.length) {
    html += `<div class="section-heading">Consultation Answers</div><div class="info-card">
      <div class="info-card-head"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${data.consultationAnswers.length} Questions Answered</div>`;
    data.consultationAnswers.forEach(qa => {
      const c = classifyConsultationAnswer(qa.question, qa.answer);
      const cls = c.level ? `qa-item q-${c.level}` : "qa-item";
      html += `<div class="${cls}">
        <div class="qa-q">${escapeHtml(qa.question)}</div>
        <div class="qa-a">${escapeHtml(qa.answer)}</div>
      </div>`;
    });
    html += `</div>`;
  }

  // Absolute & relative contraindication reference
  html += `<div class="section-heading">Absolute Contraindications</div><div class="info-card">
    <div class="info-card-head"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Any of these = REJECT</div>
    ${["Pancreatitis (acute or chronic)","Eating disorders (anorexia, bulimia, BED, ARFID)","Type 1 Diabetes (IDDM)","Liver cirrhosis or liver transplant","Gastroparesis","Medullary thyroid carcinoma / MEN2","Crohn's disease / Ulcerative colitis","Cushing's, Addison's, Acromegaly","Pregnancy or breastfeeding","Age <18 or ≥75"]
      .map(c => `<div class="contra-row"><span class="contra-dot" style="color:#ef4444">●</span>${c}</div>`).join("")}
  </div>`;

  html += `<div class="section-heading">Relative Cautions</div><div class="info-card">
    <div class="info-card-head"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Requires extra scrutiny</div>
    ${["BMI 27.5–30 without confirmed comorbidity","Bariatric surgery history","Renal impairment (eGFR <15)","Diabetic retinopathy (semaglutide)","Mental health crisis / suicide attempts","Active substance misuse","BMI ≥45 (extra monitoring required)","Heart failure NYHA Class IV"]
      .map(c => `<div class="contra-row"><span class="contra-dot" style="color:#f59e0b">●</span>${c}</div>`).join("")}
  </div>`;

  content.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ═══════════════════════════════════════════════
//  AI CHAT
// ═══════════════════════════════════════════════

function addMsg(text, role) {
  const wrap = document.getElementById("chat-messages");
  if (!wrap) return null;
  const el = document.createElement("div");
  el.className = `msg msg-${role}`;
  el.innerHTML = text.replace(/\n/g, "<br>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  wrap.appendChild(el);
  wrap.scrollTop = wrap.scrollHeight;
  return el;
}

async function sendChat(text) {
  if (!text.trim() || isChatRunning) return;
  isChatRunning = true;
  const sendBtn = document.getElementById("chat-send");
  const input = document.getElementById("chat-input");
  if (sendBtn) sendBtn.disabled = true;
  if (input) input.value = "";
  addMsg(text, "user");

  let sys = `You are MediGuard AI, a clinical decision support assistant for GLP-1 prescribing on rx.everydaymeds.co.uk.\n\nKey SOP rules:\n- BMI ≥30 (or ≥27.5 with comorbidity)\n- Age 18–74\n- Absolute contraindications: pancreatitis, eating disorders, T1DM, liver cirrhosis/transplant, gastroparesis, MTC/MEN2, Crohn's/UC, Cushing's/Addison's, pregnancy, breastfeeding\n- Be concise and clinical. Use bullet points for lists.`;

  if (currentOrderData) {
    const d = currentOrderData;
    sys += `\n\nCurrent order:\n- Medication: ${d.medication || "?"} ${d.dose || ""}\n- BMI: ${d.bmi ?? "?"} | Age: ${d.age ?? "?"}\n- Flags: ${(d.flags || []).map(f => f.text).join("; ") || "none"}`;
  }

  conversationHistory.push({ role: "user", content: text });
  const thinking = addMsg("Thinking…", "status");

  try {
    let reply = null;
    if (serverUrl) {
      try {
        const r = await fetch(`${serverUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "system", content: sys }, ...conversationHistory] })
        });
        if (r.ok) { const j = await r.json(); reply = j.response || j.message || j.content; }
      } catch {}
    }
    if (!reply && openaiKey) {
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "system", content: sys }, ...conversationHistory], max_tokens: 600 })
        });
        if (r.ok) { const j = await r.json(); reply = j.choices?.[0]?.message?.content; }
      } catch {}
    }
    if (thinking) thinking.remove();
    if (reply) {
      conversationHistory.push({ role: "assistant", content: reply });
      addMsg(reply, "ai");
    } else {
      addMsg("I couldn't get a response. Please configure your Server URL or OpenAI API key in Settings.", "ai");
    }
  } catch {
    if (thinking) thinking.remove();
    addMsg("Connection error. Check your settings.", "ai");
  }

  isChatRunning = false;
  if (sendBtn) sendBtn.disabled = false;
}

// ═══════════════════════════════════════════════
//  SCAN
// ═══════════════════════════════════════════════

function doScan() {
  // Route through msgContent so the PWA fallback (postMessage bridge into
  // the proxied page's chrome.* shim, which runs content.js) works without
  // any chrome.tabs API. In the real extension IS_EXT is true and this
  // still uses chrome.tabs.sendMessage internally.
  const handle = (resp) => {
    if (resp && resp.data) {
      currentOrderData = resp.data;
      renderBanner(currentOrderData);
      showWorkflow(currentOrderData);
      toast("Scan complete", "success");
    } else if (resp && resp.error) {
      toast(resp.error, "error");
    } else {
      toast("No order found — open an order on rx.everydaymeds.co.uk", "error");
    }
  };
  if (IS_EXT) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { toast("No active tab found", "error"); return; }
      chrome.tabs.sendMessage(tabs[0].id, { type: "GET_SCAN_DATA" })
        .then(handle)
        .catch(() => toast("Could not connect — navigate to an order page first", "error"));
    });
  } else {
    msgContent({ type: "GET_SCAN_DATA" }).then(handle);
  }
}

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {

  chrome.storage.sync.get(["server_url", "openai_key"], r => {
    if (r.server_url) serverUrl = r.server_url;
    if (r.openai_key) openaiKey = r.openai_key;
  });

  document.getElementById("open-settings")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage ? chrome.runtime.openOptionsPage() : window.open(chrome.runtime.getURL("options.html"));
  });
  const hlBtn = document.getElementById("toggle-highlight-btn");
  function applyHlBtnState(on) {
    if (!hlBtn) return;
    hlBtn.classList.toggle("is-off", !on);
    hlBtn.title = on ? "Page highlighting: ON — click to turn off" : "Page highlighting: OFF — click to turn on";
  }
  chrome.storage.sync.get({ highlights_on: true }, r => applyHlBtnState(r.highlights_on !== false));
  hlBtn?.addEventListener("click", () => {
    chrome.storage.sync.get({ highlights_on: true }, r => {
      const next = !(r.highlights_on !== false);
      chrome.storage.sync.set({ highlights_on: next }, () => {
        applyHlBtnState(next);
        if (IS_EXT) {
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (!tabs[0]?.id) return;
            chrome.tabs.sendMessage(tabs[0].id, { type: "HL_SET", enabled: next }).catch(() => {});
          });
        } else {
          msgContent({ type: "HL_SET", enabled: next });
        }
      });
    });
  });

  document.getElementById("refresh-btn")?.addEventListener("click", doScan);
  document.getElementById("scan-btn")?.addEventListener("click", doScan);
  document.getElementById("reload-ext-btn")?.addEventListener("click", reloadExtension);
  document.getElementById("btn-bulk-approve")?.addEventListener("click", bulkApproveOrUndo);
  document.getElementById("btn-issue-rx")?.addEventListener("click", issueRx);
  initScrModeToggles();
  initWorkflowStepsPanel();
  document.getElementById("btn-place-hold")?.addEventListener("click", placeOnHold);

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === "ORDER_DATA_SCANNED" && msg.data) {
      // Detect a real patient/order change and wipe the per-prescription
      // comment box so notes from a previous patient can't be carried over.
      const newKey = msg.data.orderNo || msg.data.patientName || null;
      if (newKey && newKey !== lastSeenOrderKey) {
        const cmt = document.getElementById("rx-comment");
        if (cmt) cmt.value = "";
        const hcmt = document.getElementById("hold-comment");
        if (hcmt) hcmt.value = "";
        lastSeenOrderKey = newKey;
      }
      currentOrderData = msg.data;
      renderBanner(currentOrderData);
      showWorkflow(currentOrderData);
    }
    if (msg.type === "TAB_COMPLETION_CHANGED" && msg.data) {
      if (currentOrderData) {
        currentOrderData.tabCompletion = msg.data;
        renderBanner(currentOrderData);
        Object.entries(msg.data).forEach(([tab, done]) => {
          const card = document.getElementById(`step-${tab}`);
          if (!card) return;
          const wasDone = card.classList.contains("is-done");
          if (done && !wasDone) setStepDone(tab, true);
          else if (!done && wasDone) setStepDone(tab, false);
        });
        updateProgress(msg.data);
        updateBulkApproveButton(msg.data);
      }
    }
    if (msg.type === "ACTIVE_TAB_CHANGED" && msg.data) {
      if (currentOrderData) {
        currentOrderData.activeTab = msg.data.activeTab;
        highlightActiveTab(msg.data.activeTab);
      }
    }
  });

  setTimeout(doScan, 600);
});

/* ─────────────────────────────────────────────────────────────
 * GLP-1 Switching Calculator + Gap-in-Treatment Calculator
 * ───────────────────────────────────────────────────────────── */
(function initCalculators() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  function run() {
    // Step equivalence table: step -> { drug: dose }
    const STEPS = [
      { step: "1A", mounjaro: null,    wegovy: null,    nevolat: "0.6mg", rybelsus: "3mg"  },
      { step: "1B", mounjaro: null,    wegovy: "0.25mg", nevolat: "1.2mg", rybelsus: "7mg"  },
      { step: "2",  mounjaro: "2.5mg", wegovy: "0.5mg",  nevolat: "1.8mg", rybelsus: "14mg" },
      { step: "3",  mounjaro: "5mg",   wegovy: "1mg",    nevolat: "2.4mg", rybelsus: null  },
      { step: "4",  mounjaro: "7.5mg", wegovy: "1.7mg",  nevolat: "3mg",   rybelsus: null  },
      { step: "5",  mounjaro: "10mg",  wegovy: "2.4mg",  nevolat: null,    rybelsus: null  },
      { step: "6",  mounjaro: "12.5mg",wegovy: null,     nevolat: null,    rybelsus: null  },
      { step: "7",  mounjaro: "15mg",  wegovy: null,     nevolat: null,    rybelsus: null  },
    ];
    const DRUG_NAMES = { mounjaro: "Mounjaro", wegovy: "Wegovy", nevolat: "Nevolat", rybelsus: "Rybelsus" };

    // Gap step adjustments (number of steps to drop)
    function gapAdjust(gap) {
      if (gap === "0-4")  return { drop: 0, label: "Maintained",  color: "#166534", bg: "#dcfce7" };
      if (gap === "4-8")  return { drop: 1, label: "Partial loss",color: "#92400e", bg: "#fef3c7" };
      if (gap === "8-12") return { drop: 2, label: "Major loss",  color: "#9a3412", bg: "#fed7aa" };
      return { drop: 99,  label: "Near restart — start at Step 1", color: "#991b1b", bg: "#fee2e2" };
    }

    function gapFromDate(iso) {
      if (!iso) return null;
      const last = new Date(iso); const now = new Date();
      const wks = Math.max(0, Math.floor((now - last) / (1000 * 60 * 60 * 24 * 7)));
      if (wks <= 4)  return { val: "0-4",  wks };
      if (wks <= 8)  return { val: "4-8",  wks };
      if (wks <= 12) return { val: "8-12", wks };
      return { val: "12+", wks };
    }

    function dosesFor(drug) {
      return STEPS.map(s => s[drug]).filter(Boolean);
    }
    function stepOf(drug, dose) {
      const i = STEPS.findIndex(s => s[drug] === dose);
      return i === -1 ? null : i;
    }
    function firstStepFor(drug) {
      return STEPS.findIndex(s => s[drug]);
    }

    /* ── Collapsible toggles ──────────────────────────────── */
    function bindCollapse(toggleId, contentId, chevronSel) {
      const t = document.getElementById(toggleId);
      const c = document.getElementById(contentId);
      if (!t || !c) return;
      t.addEventListener("click", () => {
        const open = c.style.maxHeight && c.style.maxHeight !== "0px";
        if (open) {
          c.style.maxHeight = "0px"; c.style.padding = "0 14px";
        } else {
          c.style.padding = "0 14px";
          c.style.maxHeight = c.scrollHeight + 40 + "px";
        }
        const chev = t.querySelector(chevronSel);
        if (chev) chev.style.transform = open ? "rotate(0deg)" : "rotate(180deg)";
      });
    }
    bindCollapse("dose-calc-toggle", "dose-calc-content", ".dose-calc-chevron");
    bindCollapse("gap-calc-toggle",  "gap-calc-content",  ".gap-calc-chevron");

    // Ref tables nested toggle
    (function() {
      const t = document.getElementById("ref-tables-toggle");
      const c = document.getElementById("ref-tables-content");
      if (!t || !c) return;
      t.addEventListener("click", () => {
        const open = c.style.maxHeight && c.style.maxHeight !== "0px";
        c.style.maxHeight = open ? "0px" : c.scrollHeight + 40 + "px";
        const chev = t.querySelector(".ref-tables-chevron");
        if (chev) chev.style.transform = open ? "rotate(0deg)" : "rotate(180deg)";
        // bubble height up
        const parent = document.getElementById("dose-calc-content");
        if (parent && parent.style.maxHeight !== "0px") {
          parent.style.maxHeight = parent.scrollHeight + 80 + "px";
        }
      });
    })();

    /* ── Switching Calculator ─────────────────────────────── */
    const fromDrug = document.getElementById("dose-from-drug");
    const fromDose = document.getElementById("dose-from-dose");
    const gapSel   = document.getElementById("dose-gap-length");
    const dateInp  = document.getElementById("dose-last-date");
    const toDrug   = document.getElementById("dose-to-drug");
    const calcBtn  = document.getElementById("calc-dose-btn");
    const result   = document.getElementById("dose-calc-result");

    function populateDoseDropdown(sel, drug) {
      if (!sel) return;
      sel.innerHTML = '<option value="">Select...</option>' +
        dosesFor(drug).map(d => `<option value="${d}">${d}</option>`).join("");
    }
    window.__mgPopulateGapDoses = populateDoseDropdown;
    fromDrug && fromDrug.addEventListener("change", () => populateDoseDropdown(fromDose, fromDrug.value));
    dateInp && dateInp.addEventListener("change", () => {
      const g = gapFromDate(dateInp.value);
      if (g && gapSel) gapSel.value = g.val;
    });

    calcBtn && calcBtn.addEventListener("click", () => {
      if (!result) return;
      const fd = fromDrug.value, dose = fromDose.value, td = toDrug.value;
      const gap = gapSel.value;
      if (!fd || !dose || !td) {
        result.style.display = "block";
        result.innerHTML = `<div style="padding:10px;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;font-size:11px;color:#991b1b;font-weight:600;">⚠️ Select current medication, current dose, and switch-to medication.</div>`;
        return;
      }
      if (fd === td) {
        result.style.display = "block";
        result.innerHTML = `<div style="padding:10px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;font-size:11px;color:#92400e;font-weight:600;">⚠️ Current and target medications are the same — use the Gap calculator instead.</div>`;
        return;
      }
      const adj = gapAdjust(gap);
      const curStep = stepOf(fd, dose);
      let targetIdx;
      if (curStep === null) {
        result.style.display = "block";
        result.innerHTML = `<div style="padding:10px;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;font-size:11px;color:#991b1b;">Could not match current dose to a step.</div>`;
        return;
      }
      if (adj.drop >= 99) {
        targetIdx = firstStepFor(td);
      } else {
        let want = curStep - adj.drop;
        // find nearest step that has the target drug at or below want
        targetIdx = -1;
        for (let i = Math.max(0, want); i >= 0; i--) {
          if (STEPS[i][td]) { targetIdx = i; break; }
        }
        if (targetIdx === -1) targetIdx = firstStepFor(td);
      }
      const targetDose = STEPS[targetIdx][td];
      const targetStep = STEPS[targetIdx].step;
      result.style.display = "block";
      result.innerHTML = `
        <div style="padding:12px; background:linear-gradient(180deg,#faf5ff,#f3e8ff); border:1.5px solid #c4b5fd; border-radius:10px;">
          <div style="font-size:11px; font-weight:800; color:#6b21a8; margin-bottom:6px;">💊 Recommended Switch Dose</div>
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px; background:white; border-radius:8px; border:1px solid #ddd6fe;">
            <div>
              <div style="font-size:10px; color:#6b21a8; font-weight:600;">${DRUG_NAMES[fd]} ${dose} → ${DRUG_NAMES[td]}</div>
              <div style="font-size:18px; font-weight:800; color:#7c3aed; margin-top:2px;">${targetDose}</div>
              <div style="font-size:10px; color:#6b21a8;">Step ${targetStep}</div>
            </div>
            <div style="text-align:right;">
              <div style="display:inline-block; padding:4px 8px; border-radius:999px; font-size:10px; font-weight:700; color:${adj.color}; background:${adj.bg};">${adj.label}</div>
              <div style="font-size:9px; color:#6b21a8; margin-top:4px;">Gap adjustment: −${adj.drop >= 99 ? "restart" : adj.drop + " step" + (adj.drop===1?"":"s")}</div>
            </div>
          </div>
          <div style="margin-top:8px; padding:8px; background:#fef3c7; border:1px solid #fcd34d; border-radius:6px; font-size:10px; color:#78350f;">
            ⚠️ Confirm tolerability and review Switching SOP before issuing. Counsel patient on injection technique if device class changes.
          </div>
        </div>`;
      // re-grow parent collapse
      const parent = document.getElementById("dose-calc-content");
      if (parent && parent.style.maxHeight !== "0px") parent.style.maxHeight = parent.scrollHeight + 80 + "px";
    });

    /* ── Gap-in-Treatment Calculator ──────────────────────── */
    const gMedSel  = document.getElementById("gap-medication");
    const gDoseSel = document.getElementById("gap-last-dose");
    const gDateInp = document.getElementById("gap-last-order-date");
    const gSupply  = document.getElementById("gap-supply-duration");
    const gBmi     = document.getElementById("gap-current-bmi");
    const gBtn     = document.getElementById("calc-gap-btn");
    const gResult  = document.getElementById("gap-calc-result");
    const gTypeN   = document.getElementById("gap-type-normal");
    const gTypeS   = document.getElementById("gap-type-switch");
    const gTypeHint= document.getElementById("gap-type-hint");
    const gDateLab = document.getElementById("gap-date-label");
    let gapType = "normal";
    const FULFILLED_GRACE_WEEKS = 2; // 1 wk late start + 1 wk tolerance after expected last dose

    function setGapType(t) {
      gapType = t;
      if (t === "normal") {
        gTypeN.style.background = "#f59e0b"; gTypeN.style.color = "white"; gTypeN.classList.add("active");
        gTypeS.style.background = "white";   gTypeS.style.color = "#d97706"; gTypeS.classList.remove("active");
        if (gDateLab) gDateLab.textContent = "Fulfilled Date";
        if (gTypeHint) gTypeHint.textContent = "Gap from fulfilled date + supply (+ 2 wk grace/tolerance)";
        if (gSupply) gSupply.disabled = false;
      } else {
        gTypeS.style.background = "#f59e0b"; gTypeS.style.color = "white"; gTypeS.classList.add("active");
        gTypeN.style.background = "white";   gTypeN.style.color = "#d97706"; gTypeN.classList.remove("active");
        if (gDateLab) gDateLab.textContent = "Last Injection Date";
        if (gTypeHint) gTypeHint.textContent = "Gap from last injection (different medication — refer to Switching SOP)";
        if (gSupply) gSupply.disabled = true;
      }
    }
    gTypeN && gTypeN.addEventListener("click", () => setGapType("normal"));
    gTypeS && gTypeS.addEventListener("click", () => setGapType("switch"));

    gMedSel && gMedSel.addEventListener("change", () => populateDoseDropdown(gDoseSel, gMedSel.value));

    function oneDoseLower(drug, dose) {
      const doses = dosesFor(drug);
      const i = doses.indexOf(dose);
      if (i <= 0) return doses[0] || dose;
      return doses[i - 1];
    }
    function lowestDose(drug) {
      return dosesFor(drug)[0] || "—";
    }
    function maxRestart(drug, bucket) {
      const m = { mounjaro: { "8-12": "10mg", "12-24": "5mg", "24+": "2.5mg" },
                  wegovy:   { "8-12": "1mg",  "12-24": "1mg",  "24+": "0.25mg" },
                  nevolat:  { "8-12": "1.8mg","12-24": "1.2mg","24+": "0.6mg" } };
      return (m[drug] && m[drug][bucket]) || "—";
    }

    gBtn && gBtn.addEventListener("click", () => {
      if (!gResult) return;
      const med = gMedSel.value, dose = gDoseSel.value, dateStr = gDateInp.value;
      const supply = parseInt(gSupply.value, 10) || 0;
      const bmi = parseFloat(gBmi.value);
      if (!med || !dose || !dateStr) {
        gResult.style.display = "block";
        gResult.innerHTML = `<div style="padding:10px;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;font-size:11px;color:#991b1b;font-weight:600;">⚠️ Medication, last tolerated dose, and date are required.</div>`;
        return;
      }
      const last = new Date(dateStr);
      const now = new Date();
      const totalWks = Math.max(0, Math.floor((now - last) / (1000 * 60 * 60 * 24 * 7)));
      // Normal: gap = weeks since fulfilled − supply − 2 wk (1 wk late start + 1 wk tolerance).
      // Switch: gap = weeks since last injection.
      const gapWks = gapType === "normal"
        ? Math.max(0, totalWks - supply - FULFILLED_GRACE_WEEKS)
        : totalWks;

      let bucket, action, recDose, badge, badgeBg, badgeFg, note;
      if (gapWks <= 8) {
        bucket = "≤8 weeks"; action = "Titrate up / normal restart"; recDose = dose;
        badge = "Within window"; badgeBg = "#dcfce7"; badgeFg = "#166534";
        note = "Within normal interval — continue titration plan.";
      } else if (gapWks <= 12) {
        bucket = ">8–12 weeks"; action = "Continue last tolerated dose"; recDose = dose;
        const cap = maxRestart(med, "8-12");
        badge = "Caution"; badgeBg = "#fef3c7"; badgeFg = "#92400e";
        note = `Restart at last tolerated dose. Max restart for ${DRUG_NAMES[med]}: <strong>${cap}</strong>.`;
      } else if (gapWks <= 24) {
        bucket = ">12–24 weeks"; action = "One dose lower"; recDose = oneDoseLower(med, dose);
        const cap = maxRestart(med, "12-24");
        badge = "High"; badgeBg = "#fed7aa"; badgeFg = "#9a3412";
        note = `Step down one dose. Max restart for ${DRUG_NAMES[med]}: <strong>${cap}</strong>.`;
      } else if (gapWks < 52) {
        bucket = ">24 weeks"; recDose = lowestDose(med);
        const cap = maxRestart(med, "24+");
        if (!isNaN(bmi) && bmi < 25) {
          action = "Do NOT restart — BMI < 25";
          badge = "Hold"; badgeBg = "#fee2e2"; badgeFg = "#991b1b";
          note = `Restart only if BMI ≥ 25. Current BMI: <strong>${bmi}</strong>. Place on hold and clarify.`;
        } else {
          action = "Restart at lowest dose";
          badge = "Restart"; badgeBg = "#fee2e2"; badgeFg = "#991b1b";
          note = `Restart at lowest dose only (BMI ≥ 25 required). Max restart: <strong>${cap}</strong>.`;
        }
      } else {
        bucket = "12+ months"; action = "Treat as new patient — starter only"; recDose = lowestDose(med);
        badge = "New patient"; badgeBg = "#fee2e2"; badgeFg = "#991b1b";
        note = "Greater than 12 months — full new-patient workup required. Starter dose only.";
      }

      gResult.style.display = "block";
      gResult.innerHTML = `
        <div style="padding:12px; background:linear-gradient(180deg,#fffdf3,#fff7e6); border:1.5px solid #fcd34d; border-radius:10px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
            <div>
              <div style="font-size:12px; font-weight:800; color:#92400e;">${gapType === "switch" ? "🔄 Switch gap" : "📦 Treatment gap"}: ${gapWks} weeks (${bucket})</div>
              <div style="font-size:10px; color:#78350f; margin-top:3px;">${gapType === "normal" ? `${totalWks} wks since fulfilled − ${supply} wks supply − ${FULFILLED_GRACE_WEEKS} wks grace` : `${totalWks} wks since last injection`}</div>
            </div>
            <span style="padding:4px 8px; border-radius:999px; font-size:10px; font-weight:800; background:${badgeBg}; color:${badgeFg}; white-space:nowrap;">${badge}</span>
          </div>
          <div style="margin-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div style="background:white; border:1px solid #fde68a; border-radius:8px; padding:8px;">
              <div style="font-size:10px; font-weight:700; color:#92400e; margin-bottom:3px;">Action</div>
              <div style="font-size:11px; font-weight:700; color:#111827;">${action}</div>
            </div>
            <div style="background:white; border:1px solid #fde68a; border-radius:8px; padding:8px;">
              <div style="font-size:10px; font-weight:700; color:#92400e; margin-bottom:3px;">Recommended Dose</div>
              <div style="font-size:14px; font-weight:800; color:#d97706;">${recDose}</div>
              <div style="font-size:9px; color:#92400e;">${DRUG_NAMES[med]}</div>
            </div>
          </div>
          <div style="margin-top:10px; padding:9px 10px; border-radius:8px; font-size:11px; line-height:1.5; border:1px solid #fde68a; background:#fffbeb; color:#78350f;">${note}</div>
        </div>`;
      const parent = document.getElementById("gap-calc-content");
      if (parent && parent.style.maxHeight !== "0px") parent.style.maxHeight = parent.scrollHeight + 80 + "px";
    });
  }
})();
