// MediGuard AI — EverydayMeds Content Script
// Scrapes order/patient data from od2-tab structure and handles tab workflow

console.log("MediGuard AI (EverydayMeds) content script active");

const TAB_ORDER = ["clinical", "consultation", "documents", "history", "counselling", "monitoring", "notes", "activity"];

const TAB_LABELS = {
  clinical: "Clinical Review",
  consultation: "Consultation",
  documents: "Documents",
  history: "Order History",
  counselling: "Patient Counselling",
  monitoring: "Monitoring",
  notes: "Notes",
  activity: "Activity"
};

let lastScannedData = null;
let tabCompletionState = {};
let activeTab = "clinical";
let scanInterval = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function getTextContent(selector) {
  const el = document.querySelector(selector);
  return el ? el.textContent.trim() : null;
}

// Wait for a SweetAlert2 confirm dialog ("Mark X as verified?") and auto-click its
// confirm button so the prescriber doesn't have to click twice. Resolves once the
// dialog is closed, or after a short timeout if no dialog appears.
function autoConfirmSwal(timeoutMs = 1200) {
  // Returns { appeared, closed }:
  //   appeared=false → no SweetAlert dialog was shown (caller can treat as success)
  //   appeared=true, closed=true → confirm clicked AND popup actually disappeared
  //   appeared=true, closed=false → modal stuck open (caller should treat as failure)
  return new Promise(resolve => {
    const start = Date.now();
    const tick = () => {
      const popup = document.querySelector(".swal2-popup.swal2-show");
      const confirmBtn = popup && popup.querySelector(".swal2-confirm");
      if (confirmBtn && !confirmBtn.disabled) {
        try { confirmBtn.click(); } catch {}
        const closeStart = Date.now();
        const waitClose = () => {
          if (!document.querySelector(".swal2-popup.swal2-show")) {
            return resolve({ appeared: true, closed: true });
          }
          if (Date.now() - closeStart > 800) {
            return resolve({ appeared: true, closed: false });
          }
          setTimeout(waitClose, 40);
        };
        return setTimeout(waitClose, 60);
      }
      if (Date.now() - start > timeoutMs) return resolve({ appeared: false, closed: false });
      setTimeout(tick, 40);
    };
    tick();
  });
}

// Wait for a selector to appear (visible) within timeout. Resolves the element or null.
function waitForEl(selector, timeoutMs = 3000, root = document) {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = () => {
      const el = root.querySelector(selector);
      if (el && (el.offsetParent !== null || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
        return resolve(el);
      }
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, 50);
    };
    tick();
  });
}

// Set a form value the React/vanilla way so any change listeners fire.
function setFieldValue(el, value) {
  if (!el) return;
  if (el.type === "radio" || el.type === "checkbox") {
    const label = el.closest("label");
    if (label) {
      try { label.click(); } catch {}
    }
    el.checked = true;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (!el.checked) {
      try { el.click(); } catch {}
    }
    return;
  }
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

const COMMS_TEXTAREA_MIN = 120;
const COMMS_TEXTAREA_MAX = 600; // ~1.67× previous 360px cap

function autoResizeTextarea(el, { min = COMMS_TEXTAREA_MIN, max = COMMS_TEXTAREA_MAX } = {}) {
  if (!el || el.tagName !== "TEXTAREA") return;
  el.style.setProperty("height", "auto", "important");
  const next = Math.min(max, Math.max(min, el.scrollHeight));
  el.style.setProperty("height", `${next}px`, "important");
  el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
}

function bindCommsInputAutoResize() {
  const input = document.getElementById("od2CommsInput");
  if (!input || input.dataset.mgAutoResize) return;
  input.dataset.mgAutoResize = "1";
  const resize = () => autoResizeTextarea(input);
  input.addEventListener("input", resize);
  resize();
}

function clickRxaRadio(input) {
  if (!input) return false;
  const label = input.closest("label.rxa-radio") || input.closest("label");
  if (label) {
    try { label.click(); } catch {}
  }
  input.checked = true;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  if (!input.checked) {
    try { input.click(); } catch {}
  }
  return input.checked;
}

function setRxaDateInput(el, isoDate) {
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(el, isoDate);
  else el.value = isoDate;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
  return el.value === isoDate;
}

function todayIsoDate() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

// Read user-customisable default texts from extension storage; fall back to
// the built-in wording if the user hasn't customised (or storage is unavailable).
const RX_BUILTIN = {
  scr: "SCR not available, information provided by the patient.",
  scrAccessed: "SCR accessed and checked no contraindication found or any concerns, happy to continue.",
  counselling: "Patient has been contacted by email and provided counselling and information on their treatment. Patient can contact us at any time if they need further help or information.",
  rationale: "The patient meets the service eligibility criteria. The consultation responses, medical history, current medication, allergies and supporting documentation have been reviewed. No known contraindications, clinically significant interactions, red flags or other concerns have been identified.\n\nBased on the information available at the time of assessment, prescribing is considered clinically appropriate. Appropriate counselling, monitoring, follow-up and safety-netting advice have been provided. Prescription approved."
};
function getRxDefaults() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(
        ["default_scr_text", "default_scr_accessed_text", "default_counselling_text", "default_rationale_text"],
        (r) => {
          resolve({
            scr: (r && r.default_scr_text) || RX_BUILTIN.scr,
            scrAccessed: (r && r.default_scr_accessed_text) || RX_BUILTIN.scrAccessed,
            counselling: (r && r.default_counselling_text) || RX_BUILTIN.counselling,
            rationale: (r && r.default_rationale_text) || RX_BUILTIN.rationale,
          });
        }
      );
    } catch (_) { resolve({ ...RX_BUILTIN }); }
  });
}

async function rxApproveAutofill(userComment, scrMode) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const defaults = await getRxDefaults();
  const useScrAccessed = scrMode === "accessed";
  try {
    // 1) Click the "Approve & prescribe" action to open the drawer
    const approveAction = document.querySelector('.od2-action[data-action="approve"]');
    if (!approveAction) return { success: false, error: "Approve action not found on this page" };
    approveAction.click();

    // 2) Wait for the drawer content to mount — the SCR radio appearing is the
    //    most reliable signal that the drawer is open AND its inner panel is rendered.
    //    (Don't gate on #rxaDrawer.is-open — the open-class may differ across builds.)
    const scrSelector = useScrAccessed
      ? 'input[name="rxa_scr_status"][value="accessed"]'
      : 'input[name="rxa_scr_status"][value="not_accessed"]';
    const scrRadio = await waitForEl(scrSelector, 8000);
    if (!scrRadio) return { success: false, error: "Approval drawer did not open (SCR option not found)" };
    await sleep(250); // let any slide-in animation settle

    // 3) Step 1 — select SCR status and fill the matching text field
    clickRxaRadio(scrRadio);
    await sleep(250);

    if (useScrAccessed) {
      const scrSummary = await waitForEl("#rxaScrSummary", 1500);
      if (scrSummary) setFieldValue(scrSummary, defaults.scrAccessed);
      // Tick the standard SCR review checkboxes so Continue isn't blocked.
      for (const id of ["rxaScrConsentRecorded", "rxaScrMedicationsReviewed", "rxaScrAllergiesChecked", "rxaScrDiagnosesAssessed"]) {
        const cb = document.getElementById(id);
        if (cb && !cb.checked) setFieldValue(cb, true);
      }
    } else {
      const scrReason = await waitForEl("#rxaScrNotAccessedReason", 1500);
      if (scrReason) setFieldValue(scrReason, defaults.scr);
    }

    // 4) Communication: Secure Message + today's date + summary (order matters for validation)
    const commRadio = await waitForEl('input[name="rxa_comm_method"][value="secure_message"]', 3000);
    if (!commRadio) return { success: false, error: "Communication method option not found" };
    clickRxaRadio(commRadio);
    await sleep(150);
    if (!commRadio.checked) {
      clickRxaRadio(commRadio);
      await sleep(150);
    }
    if (!commRadio.checked) return { success: false, error: "Could not select Secure Message" };

    const iso = todayIsoDate();
    const commDate = await waitForEl("#rxaCommDate", 1500);
    if (!commDate) return { success: false, error: "Communication date field not found" };
    setRxaDateInput(commDate, iso);
    await sleep(100);
    if (commDate.value !== iso) setRxaDateInput(commDate, iso);

    const commSummary = await waitForEl("#rxaCommSummary", 1500);
    if (commSummary) setFieldValue(commSummary, defaults.counselling);

    // 5) Click Continue to advance to step 2 — poll until enabled & visible
    const continueBtn = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        const b = document.querySelector("#rxaContinueBtn");
        if (b && b.offsetParent !== null && !b.disabled) return b;
        await sleep(80);
      }
      return null;
    })();
    if (!continueBtn) return { success: false, error: "Continue button not available — required fields may be missing" };
    continueBtn.click();

    // 6) Wait for step 2 panel to become visible
    const panel2Ok = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 4000) {
        const p = document.querySelector('.rxa-step-panel[data-panel="2"]');
        if (p && p.style.display !== "none" && p.offsetParent !== null) return true;
        await sleep(80);
      }
      return false;
    })();
    if (!panel2Ok) return { success: false, error: "Step 2 did not open" };
    await sleep(200);

    // 7) Fill final rationale — always include the default sign-off; append the
    //    user's comment (if any) on a new line after it.
    const rationale = await waitForEl("#rxaFinalRationale", 1500);
    if (rationale) {
      const defaultText = defaults.rationale;
      const userText = (userComment || "").trim();
      setFieldValue(rationale, userText ? `${defaultText}\n${userText}` : defaultText);
    }

    // 8) Click "Approve & issue Rx" — wait until enabled
    const finalBtn = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 4000) {
        const b = document.querySelector("#rxaApproveBtn");
        if (b && b.offsetParent !== null && !b.disabled) return b;
        await sleep(80);
      }
      return null;
    })();
    if (!finalBtn) return { success: false, error: "Approve & issue Rx button not enabled" };
    finalBtn.click();

    // 9) The page typically follows with a SweetAlert2 confirm — auto-accept it
    const swal = await autoConfirmSwal(2000);
    if (swal.appeared && !swal.closed) {
      return { success: false, error: "Final confirm dialog did not close" };
    }

    return { success: true, message: "Prescription approved & issued" };
  } catch (e) {
    return { success: false, error: e?.message || "Auto-approve failed" };
  }
}

// ── Place order on hold: clicks the on-page Hold action, waits for the
//    SweetAlert2 modal, fills its textarea with the reason (default is
//    already merged in by the side-panel), ticks any requested document
//    checkboxes, then clicks Confirm.
async function rxPlaceOnHold(reason, docs) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    const holdAction = document.querySelector('.od2-action[data-action="hold"]');
    if (!holdAction) return { success: false, error: "Hold action not found on this page" };
    holdAction.click();

    // Wait for the swal2 popup to mount with the hold-specific textarea.
    const ta = await waitForEl("#od2HoldReason", 6000);
    if (!ta) return { success: false, error: "Hold dialog did not open" };
    await sleep(180);

    setFieldValue(ta, reason || "");

    // Scope checkbox lookups to the active popup so we don't match stale
    // duplicates left in the DOM from a previous open/close cycle.
    const popup = ta.closest(".swal2-popup.swal2-show")
      || document.querySelector(".swal2-popup.swal2-show");

    // Tick any document checkboxes the user selected.
    if (Array.isArray(docs) && docs.length && popup) {
      docs.forEach(v => {
        const cb = popup.querySelector(`.od2-hold-doc-cb[value="${v}"]`);
        if (cb && !cb.checked) {
          cb.checked = true;
          cb.dispatchEvent(new Event("change", { bubbles: true }));
          cb.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    }
    await sleep(120);

    // Click the swal2 Confirm button inside the visible hold popup.
    const confirmBtn = popup && popup.querySelector(".swal2-confirm");
    if (!confirmBtn) return { success: false, error: "Confirm button not found in hold dialog" };
    confirmBtn.click();

    // Verify the dialog actually closed. If a follow-up swal appears,
    // auto-accept it — but only report success if the hold popup is gone.
    await sleep(300);
    const followUp = await autoConfirmSwal(2000);
    const stillOpen = !!document.querySelector("#od2HoldReason");
    if (stillOpen) {
      return { success: false, error: "Hold dialog did not close — please verify on the page" };
    }
    if (followUp.appeared && !followUp.closed) {
      return { success: false, error: "Confirmation dialog did not close cleanly" };
    }

    return { success: true, message: "Order placed on hold" };
  } catch (e) {
    return { success: false, error: e?.message || "Place on hold failed" };
  }
}

// Send a free-text message to the patient via the on-page encrypted chat composer.
async function sendPatientChatMessage(text) {
  try {
    const message = (text || "").trim();
    if (!message) return { success: false, error: "Message is empty" };

    if (typeof window.__mgOpenCommsModal === "function") {
      await window.__mgOpenCommsModal();
    } else {
      const fab = document.getElementById("od2ChatFab");
      if (fab) fab.click();
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let input = null;
    for (let i = 0; i < 24; i++) {
      await sleep(100);
      input = document.getElementById("od2CommsInput");
      if (input && input.offsetParent !== null) break;
    }
    if (!input) return { success: false, error: "Patient chat composer not found" };

    const closedNotice = document.getElementById("od2CommsClosedNotice");
    const chatClosed = closedNotice && closedNotice.offsetParent !== null;
    if (chatClosed) {
      const startBtn = document.getElementById("od2ChatToggleBtn");
      if (startBtn && /start chat/i.test(startBtn.textContent || "")) startBtn.click();
      await sleep(250);
    }

    setFieldValue(input, message);
    autoResizeTextarea(input);
    input.focus();

    let sendBtn = null;
    for (let i = 0; i < 20; i++) {
      await sleep(80);
      sendBtn = document.getElementById("od2CommsSendBtn");
      if (sendBtn && !sendBtn.disabled) break;
    }
    if (!sendBtn) return { success: false, error: "Send button not found" };
    if (sendBtn.disabled) return { success: false, error: "Send button is disabled — start the chat on the page first" };

    await sleep(120);
    try {
      sendBtn.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      sendBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      sendBtn.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      sendBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    } catch {}
    sendBtn.click();

    await sleep(400);
    const swalRes = await autoConfirmSwal(2000);
    if (swalRes.appeared && !swalRes.closed) {
      return { success: false, error: "Send confirmation did not complete" };
    }

    return { success: true, message: "Message sent to patient" };
  } catch (e) {
    return { success: false, error: e?.message || "Send failed" };
  }
}

function calculateAge(dobString) {
  if (!dobString) return null;
  let dob;
  const clean = dobString.trim();
  if (clean.match(/\d{4}-\d{2}-\d{2}/)) {
    dob = new Date(clean);
  } else if (clean.includes("/")) {
    const parts = clean.split("/");
    dob = new Date(parts[2], parts[1] - 1, parts[0]);
  } else {
    const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    const m = clean.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(\w{3})\w*\s*(\d{4})/i);
    if (m) {
      dob = new Date(parseInt(m[3]), months[m[2].toLowerCase().substring(0,3)], parseInt(m[1]));
    } else {
      dob = new Date(clean);
    }
  }
  if (!dob || isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) age--;
  return age;
}

const MG_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MG_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseMedDate(str) {
  if (!str) return null;
  const clean = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    const d = new Date(clean.slice(0, 10));
    return isNaN(d.getTime()) ? null : d;
  }
  if (clean.includes("/")) {
    const parts = clean.split("/");
    if (parts.length >= 3) {
      let y = parseInt(parts[2], 10);
      if (y < 100) y += 2000;
      const d = new Date(y, parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  const m = clean.match(/(\d{1,2})(?:st|nd|rd|th)?[\s/.-]+(\w{3,9})[\s/.-]*(\d{2,4})?/i);
  if (m) {
    const monKey = m[2].toLowerCase().substring(0, 3);
    const month = MG_MONTHS[monKey];
    if (month !== undefined) {
      let y = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
      if (y < 100) y += 2000;
      const d = new Date(y, month, parseInt(m[1], 10));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
}

function toIsoDate(d) {
  if (!d || isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function formatMedDate(d) {
  if (!d || isNaN(d.getTime())) return null;
  return `${d.getDate()} ${MG_MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function addDays(d, days) {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const FULFILLED_DAYS_AFTER_ORDER = 3;

function parsePenQty(text) {
  if (!text) return 1;
  const bundle = text.match(/(\d+)\s*[-–]?\s*pen\s*bundle/i);
  if (bundle) return parseInt(bundle[1], 10) || 1;
  const qtyM = text.match(/qty[:\s]*(\d+)/i);
  if (qtyM) return parseInt(qtyM[1], 10) || 1;
  const weeksM = text.match(/weeks?\s*(\d+)\s*[-–]\s*(\d+)/i);
  if (weeksM) {
    const wks = parseInt(weeksM[2], 10) - parseInt(weeksM[1], 10) + 1;
    return Math.max(1, Math.round(wks / 4));
  }
  return 1;
}

function orderDateToFulfilled(orderDate) {
  if (!orderDate) return null;
  const fulfilled = addDays(orderDate, FULFILLED_DAYS_AFTER_ORDER);
  return {
    date: fulfilled,
    dateIso: toIsoDate(fulfilled),
    dateFormatted: formatMedDate(fulfilled)
  };
}

function qtyToSupplyWeeks(qty) {
  return Math.max(4, (parseInt(qty, 10) || 1) * 4);
}

/** Expected last injection = fulfilled + supply weeks + 1 wk grace; OK window extends +1 wk. */
function computeTreatmentTimeline(fulfilledDate, qty) {
  const supplyWeeks = qtyToSupplyWeeks(qty);
  const earliestLast = addDays(fulfilledDate, supplyWeeks * 7);
  const expectedLast = addDays(fulfilledDate, supplyWeeks * 7 + 7);
  const okUntil = addDays(expectedLast, 7);
  return {
    supplyWeeks,
    pens: Math.max(1, parseInt(qty, 10) || 1),
    earliestLast,
    expectedLast,
    okUntil
  };
}

function formatDateRange(from, to) {
  if (!from || !to) return null;
  return `${formatMedDate(from)} – ${formatMedDate(to)}`;
}

function extractDeclaredLastInjection(answers) {
  if (!answers?.length) return null;
  for (const qa of answers) {
    const q = qa.question.toLowerCase();
    const mentionsLast = q.includes("last") && (
      q.includes("inject") || q.includes("injection") || q.includes("dose")
    );
    const step3 = q.includes("when was") && q.includes("date");
    if (!mentionsLast && !step3 && !q.includes("when did you last") && !q.includes("date of your last")) continue;
    const parsed = parseMedDate(qa.answer);
    if (parsed) return { raw: qa.answer.trim(), iso: toIsoDate(parsed), date: parsed };
  }
  return null;
}

function extractAnotherProviderAnswer(answers) {
  if (!answers?.length) return null;
  for (const qa of answers) {
    const q = qa.question.toLowerCase();
    if (!q.includes("another provider") && !(q.includes("obtain") && q.includes("from"))) continue;
    const a = qa.answer.trim();
    if (!a) continue;
    const low = a.toLowerCase();
    if (low === "yes" || low.startsWith("yes")) return { raw: a, value: "yes" };
    if (low === "no" || low.startsWith("no")) return { raw: a, value: "no" };
    return { raw: a, value: null };
  }
  return null;
}

function scrapeFulfilledDateFromTile() {
  for (const tile of document.querySelectorAll(".em-info-tile")) {
    const label = tile.querySelector(".em-info-label")?.textContent.trim().toLowerCase() || "";
    if (!label.includes("fulfil")) continue;
    const val = tile.querySelector(".em-info-value")?.textContent.trim();
    const date = parseMedDate(val);
    if (date) {
      return { date, dateIso: toIsoDate(date), dateFormatted: formatMedDate(date), raw: val };
    }
  }
  return null;
}

function parseOrderHistoryRow(tr) {
  const cells = [...tr.querySelectorAll("td")];
  if (cells.length < 3) return null;
  const rowText = tr.textContent.replace(/\s+/g, " ").trim();
  if (!/\bfulfilled\b/i.test(rowText) || /\bunfulfilled\b/i.test(rowText)) return null;

  let orderNo = null;
  let dateStr = null;
  let medication = null;
  let isFulfilled = false;

  cells.forEach(cell => {
    const t = cell.textContent.trim();
    const tl = t.toLowerCase();
    if (tl === "fulfilled") isFulfilled = true;
    const orderMatch = t.match(/#?\s*(\d{3,})/);
    if (orderMatch && !/mg|weeks|pen/i.test(t)) orderNo = orderMatch[1];
    if (parseMedDate(t)) dateStr = t;
    if (/injectable|mounjaro|wegovy|nevolat|pen|mg|weeks/i.test(t)) medication = t;
  });

  if (!isFulfilled) return null;
  const orderDate = parseMedDate(dateStr);
  if (!orderDate) return null;

  const medText = medication || rowText;
  const qty = parsePenQty(medText);
  const fulfilled = orderDateToFulfilled(orderDate);

  return {
    orderNo,
    orderDate,
    orderDateFormatted: formatMedDate(orderDate),
    date: fulfilled.date,
    dateIso: fulfilled.dateIso,
    dateFormatted: fulfilled.dateFormatted,
    qty,
    medication: medText
  };
}

function scrapeLastFulfilledOrder(currentOrderNo) {
  const selectors = [
    '[data-panel="history"] tr',
    '[data-tab-panel="history"] tr',
    ".od2-history tr",
    ".od2-panel-history tr",
    ".od2-wrap tr"
  ];
  let best = null;
  const seen = new Set();
  const visitRow = (tr) => {
    if (seen.has(tr)) return;
    seen.add(tr);
    const entry = parseOrderHistoryRow(tr);
    if (!entry) return;
    if (currentOrderNo && entry.orderNo === String(currentOrderNo).replace("#", "")) return;
    if (!best || entry.orderDate > best.orderDate) best = entry;
  };
  selectors.forEach(sel => document.querySelectorAll(sel).forEach(visitRow));
  return best;
}

function resolveLastFulfilledForGap(data) {
  const fromHistory = scrapeLastFulfilledOrder(data.orderNo);
  if (fromHistory?.date) return fromHistory;

  const fromTile = scrapeFulfilledDateFromTile();
  if (fromTile?.date) {
    return { ...fromTile, qty: data.qty || 1, source: "tile" };
  }

  // Fallback: derive from most recent fulfilled order card/list on page (order date + 3 days).
  const cardSelectors = [
    "[data-order-status='fulfilled']",
    "[data-status='fulfilled']",
    ".order-card",
    ".em-order-card"
  ];
  let best = null;
  cardSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      const text = el.textContent.replace(/\s+/g, " ").trim();
      if (!/\bfulfilled\b/i.test(text) || /\bunfulfilled\b/i.test(text)) return;
      const dateMatch = text.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}\s+\w{3,9}\s+\d{4})/i);
      if (!dateMatch) return;
      const orderDate = parseMedDate(dateMatch[1]);
      if (!orderDate) return;
      const orderNoMatch = text.match(/#\s*(\d+)/);
      const orderNo = orderNoMatch ? orderNoMatch[1] : null;
      if (data.orderNo && orderNo === String(data.orderNo).replace("#", "")) return;
      const fulfilled = orderDateToFulfilled(orderDate);
      const entry = {
        orderNo,
        orderDate,
        orderDateFormatted: formatMedDate(orderDate),
        date: fulfilled.date,
        dateIso: fulfilled.dateIso,
        dateFormatted: fulfilled.dateFormatted,
        qty: parsePenQty(text),
        medication: text,
        source: "card"
      };
      if (!best || entry.orderDate > best.orderDate) best = entry;
    });
  });
  return best;
}

function enrichTreatmentGapData(data) {
  const fulfilled = resolveLastFulfilledForGap(data);
  if (!fulfilled?.date) return;

  data.fulfilledDate = fulfilled.dateFormatted || formatMedDate(fulfilled.date);
  data.fulfilledDateIso = fulfilled.dateIso || toIsoDate(fulfilled.date);
  data.fulfilledOrderDate = fulfilled.orderDateFormatted || (fulfilled.orderDate ? formatMedDate(fulfilled.orderDate) : null);
  data.fulfilledQty = fulfilled.qty || data.qty || 1;
  data.fulfilledOrderNo = fulfilled.orderNo || null;
  data.fulfilledDerived = fulfilled.source !== "tile";

  const tl = computeTreatmentTimeline(fulfilled.date, data.fulfilledQty);
  data.supplyWeeks = tl.supplyWeeks;
  data.expectedLastDose = formatMedDate(tl.expectedLast);
  data.expectedLastDoseIso = toIsoDate(tl.expectedLast);
  data.expectedLastDoseOkUntil = formatMedDate(tl.okUntil);
  data.expectedLastDoseOkUntilIso = toIsoDate(tl.okUntil);
  data.expectedLastDoseRange = formatDateRange(tl.earliestLast, tl.okUntil);

  const declared = extractDeclaredLastInjection(data.consultationAnswers);
  const anotherProvider = extractAnotherProviderAnswer(data.consultationAnswers);
  if (anotherProvider) {
    data.anotherProviderAnswer = anotherProvider.raw;
    data.anotherProviderYes = anotherProvider.value === "yes";
    data.anotherProviderNo = anotherProvider.value === "no";
  }

  if (declared) {
    data.declaredLastInjection = declared.raw;
    data.declaredLastInjectionIso = declared.iso;
    const declaredDay = startOfDay(declared.date);
    const okUntilDay = startOfDay(tl.okUntil);
    if (declaredDay.getTime() <= okUntilDay.getTime()) {
      data.treatmentGapOk = true;
      data.treatmentGapWeeks = 0;
      data.supplyCheckRequired = false;
    } else {
      data.treatmentGapOk = false;
      data.treatmentGapWeeks = Math.ceil((declaredDay - okUntilDay) / (1000 * 60 * 60 * 24 * 7));
      data.supplyCheckRequired = true;
    }
  } else {
    data.treatmentGapOk = null;
    data.treatmentGapWeeks = null;
    data.supplyCheckRequired = null;
  }
}

function updateEmInfoTiles(data) {
  if (!data) return;
  document.querySelectorAll(".em-info-tile").forEach(tile => {
    const labelEl = tile.querySelector(".em-info-label");
    const valEl = tile.querySelector(".em-info-value");
    if (!labelEl || !valEl) return;
    const label = labelEl.textContent.trim().toLowerCase();
    if (label === "expected last dose" && data.expectedLastDoseRange) {
      valEl.textContent = data.expectedLastDoseRange;
      tile.dataset.mgComputed = "expected-last-dose-range";
    } else if (label === "expected last dose" && data.expectedLastDose) {
      valEl.textContent = data.expectedLastDose;
      tile.dataset.mgComputed = "expected-last-dose";
    } else if (label.includes("fulfil") && data.fulfilledDate) {
      valEl.textContent = data.fulfilledDate;
      tile.dataset.mgComputed = "fulfilled-date";
    }
  });
}

// ── Data Scraping ──────────────────────────────────────────────────────────

function scrapeOrderData() {
  const data = {
    // Patient info
    patientName: null,
    dob: null,
    age: null,
    gender: null,
    email: null,

    // Clinical metrics
    bmi: null,
    bmiHistory: [],
    height: null,
    weight: null,
    ethnicity: null,
    hasComorbidity: false,

    // Order info
    medication: null,
    dose: null,
    qty: null,
    orderDate: null,
    prescriptionType: null,

    // Consultation answers
    consultationAnswers: [],

    // Document status
    documentsVerified: 0,
    documentsPending: 0,
    documentsRejected: 0,
    documents: [],

    // Tab completion state
    tabCompletion: {},

    // Active tab
    activeTab: null,

    // NHS SCR
    scrStatus: null,

    // Notes
    notes: [],

    // Raw flags
    flags: [],

    // Patient status tags (New Patient, 1st Dose, etc.)
    patientTags: [],

    // Order number
    orderNo: null,

    // Previous fulfilled order + treatment gap (from order history / consultation)
    fulfilledDate: null,
    fulfilledDateIso: null,
    fulfilledOrderDate: null,
    fulfilledQty: null,
    fulfilledOrderNo: null,
    supplyWeeks: null,
    expectedLastDose: null,
    expectedLastDoseIso: null,
    expectedLastDoseOkUntil: null,
    expectedLastDoseOkUntilIso: null,
    declaredLastInjection: null,
    declaredLastInjectionIso: null,
    treatmentGapOk: null,
    treatmentGapWeeks: null,
    expectedLastDoseRange: null,
    supplyCheckRequired: null,
    anotherProviderAnswer: null,
    anotherProviderYes: false,
    anotherProviderNo: false
  };

  // ── Patient card (od2-patient-card) — name, DOB, tags, order no
  const nameEl = document.querySelector(".od2-patient-name .patient-name-text");
  if (nameEl) data.patientName = nameEl.textContent.trim();
  const dobEl = document.querySelector('.od2-patient-card [data-meta="dob"]');
  if (dobEl) {
    const dob = dobEl.textContent.trim();
    if (dob && dob !== "—") {
      data.dob = dob;
      data.age = calculateAge(data.dob);
    }
  }
  document.querySelectorAll(".od2-patient-tags .od2-tag").forEach(t => {
    const label = t.textContent.trim().replace(/\s+/g, " ");
    if (label) data.patientTags.push(label);
  });
  document.querySelectorAll(".od2-patient-card .od2-meta-row").forEach(row => {
    const lbl = row.querySelector(".lbl");
    const val = row.querySelector(".val");
    if (!lbl || !val) return;
    const l = lbl.textContent.trim().toLowerCase();
    const v = val.textContent.trim().replace(/\s+/g, " ");
    if (l === "order no") data.orderNo = v.replace(/^#/, "");
    if (l === "email" && !data.email) data.email = v;
  });

  // ── Vitals grid (od2-vitals-grid) — BMI, Age, Sex fallback
  document.querySelectorAll(".od2-vitals-grid .od2-vital").forEach(v => {
    const lbl = v.querySelector(".v-lbl");
    if (!lbl) return;
    const label = lbl.textContent.trim().toLowerCase();
    const num = v.querySelector(".v-num");
    const txt = v.querySelector(".v-text");
    if (label === "bmi" && num && data.bmi == null) {
      const n = parseFloat(num.textContent);
      if (!isNaN(n)) data.bmi = n;
    }
    if (label === "age" && num && data.age == null) {
      const n = parseInt(num.textContent, 10);
      if (!isNaN(n)) data.age = n;
    }
    if (label === "sex" && txt && !data.gender) data.gender = txt.textContent.trim();
    if (label === "ethnicity" && txt && !data.ethnicity) {
      const v = txt.textContent.trim();
      if (v && v !== "—") data.ethnicity = v;
    }
  });

  // ── Patient name (order summary avatar initial + title)
  const osTitle = document.querySelector(".os-title .os-strong");
  if (osTitle) data.medication = osTitle.textContent.trim();

  // Dose from subtitle
  const osSub = document.querySelector(".os-title span[style]");
  if (osSub) {
    const doseMatch = osSub.textContent.match(/([\d.]+\s*mg)/i);
    if (doseMatch) data.dose = doseMatch[1].trim();
  }

  // Qty
  const osSubText = getTextContent(".os-sub");
  if (osSubText) {
    data.qty = parsePenQty(osSubText);
    const typeMatch = osSubText.match(/Weight Loss|Diabetes|Obesity/i);
    if (typeMatch) data.prescriptionType = typeMatch[0];
  }

  // Order date
  const osMetaValue = getTextContent(".os-meta-value");
  if (osMetaValue) data.orderDate = osMetaValue;

  // ── BMI History table
  const bmiTable = document.querySelector(".od2-bmi-table");
  if (bmiTable) {
    const rows = bmiTable.querySelectorAll("tbody tr");
    rows.forEach((row, i) => {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 4) {
        const entry = {
          date: cells[0].textContent.replace(/Current|Start/g, "").trim(),
          bmi: parseFloat(cells[1].textContent) || null,
          height: cells[2].textContent.trim(),
          weight: cells[3].textContent.trim(),
          isCurrent: cells[0].textContent.includes("Current"),
          isStart: cells[0].textContent.includes("Start")
        };
        data.bmiHistory.push(entry);
        if (entry.isCurrent) {
          data.bmi = entry.bmi;
          data.height = entry.height;
          data.weight = entry.weight;
        }
      }
    });
  }

  // ── Consultation Q&A (od2-cons-q / od2-cons-a pairs)
  const qEls = document.querySelectorAll(".od2-cons-q");
  const aEls = document.querySelectorAll(".od2-cons-a");
  qEls.forEach((q, i) => {
    if (aEls[i]) {
      data.consultationAnswers.push({
        question: q.textContent.trim(),
        answer: aEls[i].textContent.trim()
      });
    }
  });

  // ── Extract key consultation fields
  data.consultationAnswers.forEach(qa => {
    const q = qa.question.toLowerCase();
    const a = qa.answer.toLowerCase();
    if (q.includes("date of birth") || q.includes("dob")) {
      data.dob = qa.answer;
      data.age = calculateAge(qa.answer);
    }
    if (q.includes("gender") || q.includes("sex")) data.gender = qa.answer;
    if (q.includes("ethnicity") || q.includes("ethnic background")) {
      const v = qa.answer.trim();
      if (v && v !== "—" && !data.ethnicity) data.ethnicity = v;
    }
    // Comorbidity flag: "Have you been diagnosed with any of these conditions?
    // Prediabetes, Type 2 Diabetes, High blood pressure, ... Obstructive sleep apnoea"
    if (q.includes("diagnosed with any of these conditions") &&
        (q.includes("type 2 diabetes") || q.includes("prediabetes") ||
         q.includes("sleep apnoea") || q.includes("high blood pressure"))) {
      data.hasComorbidity = a === "yes";
    }
    if (q.includes("email")) data.email = qa.answer;
    if (q.includes("name") && !q.includes("medication") && !q.includes("doctor")) {
      if (!data.patientName) data.patientName = qa.answer;
    }
  });

  // Try page text for name
  if (!data.patientName) {
    const pageText = document.body.innerText;
    // Look for name near "Patient" or consultation header
    const consTitle = document.querySelector(".od2-cons-title");
    if (!consTitle) {
      const nameMatch = pageText.match(/(?:Patient|Name):\s*([A-Z][a-z]+ [A-Z][a-z]+)/);
      if (nameMatch) data.patientName = nameMatch[1];
    }
    // Try avatar (first letter of name)
    const avatar = document.querySelector(".os-avatar");
    if (avatar) data.patientInitial = avatar.textContent.trim();
  }

  // ── Document counts
  const verifiedCount = document.querySelector(".od2-docs-count.is-verified");
  const pendingCount = document.querySelector(".od2-docs-count.is-pending");
  const rejectedCount = document.querySelector(".od2-docs-count.is-rejected");
  if (verifiedCount) data.documentsVerified = parseInt(verifiedCount.textContent.match(/\d+/)?.[0] || 0);
  if (pendingCount) data.documentsPending = parseInt(pendingCount.textContent.match(/\d+/)?.[0] || 0);
  if (rejectedCount) data.documentsRejected = parseInt(rejectedCount.textContent.match(/\d+/)?.[0] || 0);

  // ── Per-document scrape (id, title, status, available actions)
  document.querySelectorAll(".od2-doc-card").forEach(card => {
    const docId = card.dataset.docCard;
    if (!docId) return;
    const title = card.querySelector(".doc-title")?.textContent.trim() || docId;
    const subtitle = card.querySelector(".doc-sub")?.textContent.trim() || "";
    const statusEl = card.querySelector(".od2-doc-status");
    let status = "unknown";
    if (statusEl) {
      if (statusEl.classList.contains("is-verified")) status = "verified";
      else if (statusEl.classList.contains("is-pending")) status = "pending_review";
      else if (statusEl.classList.contains("is-rejected")) status = "rejected";
      else if (statusEl.classList.contains("is-missing")) status = "missing";
    }
    const actionsDiv = document.querySelector(`.od2-doc-actions[data-doc-id="${docId}"]`);
    let hasView = false, hasVerify = false, hasReject = false;
    if (actionsDiv) {
      const allBtns = [...actionsDiv.querySelectorAll(".od2-doc-btn")];
      allBtns.forEach(b => {
        const disabled = b.classList.contains("is-disabled") || b.tagName === "SPAN";
        if (disabled) return;
        const onclick = b.getAttribute("onclick") || "";
        if (b.classList.contains("is-primary") || onclick.includes("od2QuickVerify")) hasVerify = true;
        else if (b.classList.contains("is-danger-outline") || onclick.includes("od2QuickReject")) hasReject = true;
        else if (onclick.includes("od2OpenDocModal") || b.textContent.toLowerCase().includes("view")) hasView = true;
      });
    }
    const kind = card.querySelector(".od2-doc-preview img") ? "image"
      : card.querySelector(".od2-doc-preview video") ? "video"
      : (subtitle.toLowerCase().includes("video") || title.toLowerCase().includes("video")) ? "video" : "image";
    data.documents.push({ id: docId, title, subtitle, status, kind, hasView, hasVerify, hasReject });
  });

  // ── Doc preview modal state (so sidepanel can swap "View" → "Close photo")
  const docModal = document.getElementById("od2DocModal");
  const modalOpen = !!(docModal && docModal.classList.contains("is-open"));
  data.modalOpen = modalOpen;
  data.modalOpenDocId = modalOpen ? (window.__mgViewedDocId || null) : null;
  if (!modalOpen) window.__mgViewedDocId = null;

  // ── Tab completion state — "done" if the undo button is present (page swaps mark→undo)
  document.querySelectorAll("[data-tab-completion]").forEach(footer => {
    const tabName = footer.dataset.tabCompletion;
    data.tabCompletion[tabName] = isTabMarkedDone(footer);
  });

  // ── Active tab
  const activeTabEl = document.querySelector(".od2-tab.active");
  if (activeTabEl) data.activeTab = activeTabEl.dataset.tab || null;

  // ── SCR status (check scr card)
  const scrCard = document.querySelector(".od2-scr-card");
  if (scrCard) data.scrStatus = "available";

  // ── Notes (from notes panel if visible)
  const notesPanel = document.querySelector("[data-panel='notes']");
  if (notesPanel) {
    notesPanel.querySelectorAll("p, li").forEach(el => {
      const text = el.textContent.trim();
      if (text.length > 10) data.notes.push(text.substring(0, 300));
    });
  }

  // ── GLP-1 eligibility flags (BMI bands)
  if (data.bmi !== null) {
    if (data.bmi < 25) {
      data.flags.push({ level: "red", text: `BMI ${data.bmi} — Below 25: must be a continuation, not a new start` });
    } else if (data.bmi < 27.5) {
      data.flags.push({ level: "orange", text: `BMI ${data.bmi} — 25–27.5: needs previous-use evidence` });
    } else if (data.bmi <= 30) {
      data.flags.push({ level: "yellow", text: `BMI ${data.bmi} — 27.5–30: needs comorbidity` });
    } else if (data.bmi >= 45) {
      data.flags.push({ level: "yellow", text: `BMI ${data.bmi} — Very high BMI: extra monitoring needed` });
    } else {
      data.flags.push({ level: "green", text: `BMI ${data.bmi} — Within eligible range (>30)` });
    }
  }

  if (data.age !== null) {
    if (data.age < 18) {
      data.flags.push({ level: "red", text: `Age ${data.age} — Under 18: not eligible` });
    } else if (data.age >= 75) {
      data.flags.push({ level: "red", text: `Age ${data.age} — 75+: specialist review required` });
    } else {
      data.flags.push({ level: "green", text: `Age ${data.age} — Within eligible range (18–74)` });
    }
  }

  // Check consultation answers for contraindications
  const contraindications = [
    "pancreatitis", "eating disorder", "anorexia", "bulimia", "type 1 diabetes",
    "liver cirrhosis", "liver transplant", "gastroparesis", "thyroid cancer",
    "medullary thyroid", "crohn", "ulcerative colitis", "multiple endocrine neoplasia",
    "bariatric surgery", "addison"
  ];
  data.consultationAnswers.forEach(qa => {
    const text = (qa.question + " " + qa.answer).toLowerCase();
    contraindications.forEach(ci => {
      if (text.includes(ci) && !text.includes("no " + ci) && !text.includes("none")) {
        data.flags.push({ level: "red", text: `⚠ Possible contraindication: ${ci} mentioned in consultation` });
      }
    });
  });

  enrichTreatmentGapData(data);

  return data;
}

// ── Tab completion detection observer ────────────────────────────────────

// Page swaps a "Mark as done" button for an "Undo" button once done.
// Treat either an .od2-tcf-undo-btn or a marker like is-done class as completed.
function isTabMarkedDone(footer) {
  if (!footer) return false;
  if (footer.querySelector(".od2-tcf-undo-btn")) return true;
  const mark = footer.querySelector(".od2-tcf-mark-btn");
  if (!mark) return false;
  return (
    mark.classList.contains("is-done") ||
    mark.dataset.done === "true" ||
    mark.getAttribute("aria-pressed") === "true" ||
    mark.textContent.toLowerCase().includes("done") && !mark.textContent.toLowerCase().includes("mark") ||
    mark.style.background?.includes("22c55e") ||
    mark.style.backgroundColor?.includes("22c55e")
  );
}

function detectTabCompletionChanges() {
  const observer = new MutationObserver(() => {
    const newCompletionState = {};
    document.querySelectorAll("[data-tab-completion]").forEach(footer => {
      newCompletionState[footer.dataset.tabCompletion] = isTabMarkedDone(footer);
    });

    const changed = JSON.stringify(newCompletionState) !== JSON.stringify(tabCompletionState);
    if (changed) {
      tabCompletionState = newCompletionState;
      chrome.runtime.sendMessage({
        type: "TAB_COMPLETION_CHANGED",
        data: newCompletionState
      }).catch(() => {});
    }
  });

  observer.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ["class", "style", "data-done", "aria-pressed"] });
}

function detectActiveTabChanges() {
  const tabBar = document.querySelector(".od2-tabs");
  if (!tabBar) return;

  tabBar.addEventListener("click", (e) => {
    const tab = e.target.closest(".od2-tab");
    if (tab) {
      const tabName = tab.dataset.tab;
      if (tabName && tabName !== activeTab) {
        activeTab = tabName;
        chrome.runtime.sendMessage({
          type: "ACTIVE_TAB_CHANGED",
          data: { activeTab: tabName }
        }).catch(() => {});
      }
    }
  });
}

// ── Inline patient card (directly below od2-topbar) ───────────────────────

function mgFixInlinePatientCardLayoutAncestors(slot) {
  let el = slot.parentElement;
  while (el && el !== document.body) {
    const ps = getComputedStyle(el);
    if (ps.display.includes("flex") && ps.flexDirection !== "column" && ps.flexWrap === "nowrap") {
      el.style.flexWrap = "wrap";
    }
    if (ps.display.includes("grid")) {
      slot.style.gridColumn = "1 / -1";
    }
    el = el.parentElement;
  }
}

function mgSyncInlinePatientCardLayout() {
  const wrap = document.querySelector(".od2-wrap");
  const slot = document.getElementById("mg-inline-patient-card-slot");
  const shell = document.querySelector("#mg-inline-patient-card .mg-ipc-shell");
  if (!wrap || !slot || !shell) return;

  const card = document.getElementById("mg-inline-patient-card");
  if (card) {
    card.style.width = "";
    card.style.maxWidth = "";
    card.style.marginLeft = "";
    card.style.marginRight = "";
  }

  mgFixInlinePatientCardLayoutAncestors(slot);

  const wrapRect = wrap.getBoundingClientRect();
  const slotRect = slot.getBoundingClientRect();
  const width = Math.round(wrapRect.width);
  const leftOffset = Math.max(0, Math.round(wrapRect.left - slotRect.left));

  shell.style.width = `${width}px`;
  shell.style.maxWidth = `${width}px`;
  shell.style.marginLeft = `${leftOffset}px`;
  shell.style.marginRight = "auto";
  shell.style.boxSizing = "border-box";
}

function mgEnsureInlinePatientCardSlot(topbar, wrap) {
  let slot = document.getElementById("mg-inline-patient-card-slot");
  if (!slot) {
    slot = document.createElement("div");
    slot.id = "mg-inline-patient-card-slot";
    topbar.insertAdjacentElement("afterend", slot);
  } else if (topbar.nextElementSibling !== slot) {
    topbar.insertAdjacentElement("afterend", slot);
  }

  mgFixInlinePatientCardLayoutAncestors(slot);
  return slot;
}

function mgEnsureInlinePatientCardLayoutSync() {
  if (window.__mgInlinePatientCardLayoutSync) return;
  window.__mgInlinePatientCardLayoutSync = true;

  const sync = () => mgSyncInlinePatientCardLayout();
  window.addEventListener("resize", sync, { passive: true });

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(sync);
    const watch = () => {
      const wrap = document.querySelector(".od2-wrap");
      if (wrap) ro.observe(wrap);
    };
    watch();
    new MutationObserver(watch).observe(document.body, { childList: true, subtree: true });
  }
}

function mgEscapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function mgBmiTagClass(bmi) {
  if (bmi == null) return "slate";
  if (bmi >= 30) return "green";
  if (bmi >= 27.5) return "yellow";
  return "red";
}

function mgBuildInlinePatientTags(data) {
  const med = data.medication ? data.medication.replace("® Injectable Pen", "").replace("®", "").trim() : null;
  let primary = "";
  let vitals = "";
  (data.patientTags || []).forEach((tag) => {
    const lower = tag.toLowerCase();
    const cls = lower.includes("new") ? "yellow"
      : (lower.includes("1st") || lower.includes("first") || lower.includes("transfer")) ? "blue"
      : "slate";
    primary += `<span class="mg-ipc-tag mg-ipc-tag-${cls}">${mgEscapeHtml(tag)}</span>`;
  });
  if (data.gender && data.gender !== "—") {
    primary += `<span class="mg-ipc-tag mg-ipc-tag-slate">${mgEscapeHtml(data.gender)}</span>`;
  }
  if (med || data.dose) {
    primary += `<span class="mg-ipc-tag mg-ipc-tag-blue">💊 ${mgEscapeHtml([med, data.dose].filter(Boolean).join(" "))}</span>`;
  }
  if (data.bmi != null) {
    primary += `<span class="mg-ipc-tag mg-ipc-tag-${mgBmiTagClass(data.bmi)}">BMI ${data.bmi}</span>`;
  }
  if (data.ethnicity && data.ethnicity !== "—") {
    const ethLow = String(data.ethnicity).toLowerCase();
    const isBame = /asian|black|african|caribbean|mixed|arab|middle eastern|other ethnic/i.test(ethLow);
    const ethCls = isBame ? "blue" : "slate";
    const ethShort = String(data.ethnicity).replace(/\s*\([^)]*\)\s*/g, "").trim();
    primary += `<span class="mg-ipc-tag mg-ipc-tag-${ethCls}" title="Ethnicity: ${mgEscapeHtml(data.ethnicity)}">🌐 ${mgEscapeHtml(ethShort)}</span>`;
  }
  if (data.weight && data.weight !== "—") {
    const kg = parseFloat(String(data.weight).replace(/[^0-9.]/g, ""));
    let extra = "";
    if (Number.isFinite(kg) && kg > 0) {
      const totalLb = kg * 2.2046226218;
      const stones = Math.floor(totalLb / 14);
      const lbsRem = Math.round(totalLb - stones * 14);
      const s = lbsRem === 14 ? stones + 1 : stones;
      const l = lbsRem === 14 ? 0 : lbsRem;
      extra = ` <span class="mg-ipc-muted">·</span> ${s} st ${l} lb <span class="mg-ipc-muted">·</span> ${Math.round(totalLb)} lb`;
    }
    vitals += `<span class="mg-ipc-tag mg-ipc-tag-slate">⚖ ${mgEscapeHtml(data.weight)}${extra}</span>`;
  }
  if (data.height && data.height !== "—") {
    vitals += `<span class="mg-ipc-tag mg-ipc-tag-slate">↕ ${mgEscapeHtml(data.height)}</span>`;
  }
  return { primary, vitals };
}

function mgInjectInlinePatientCardStyles() {
  let style = document.getElementById("mg-inline-patient-card-styles");
  if (!style) {
    style = document.createElement("style");
    style.id = "mg-inline-patient-card-styles";
    document.documentElement.appendChild(style);
  }
  style.textContent = `
    #mg-inline-patient-card-slot {
      display: block !important;
      flex: 0 0 100% !important;
      flex-shrink: 0;
      width: 100% !important;
      max-width: 100% !important;
      grid-column: 1 / -1;
      clear: both;
      box-sizing: border-box;
      margin: 0 0 16px;
    }
    #mg-inline-patient-card {
      display: block;
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    #mg-inline-patient-card .mg-ipc-shell {
      background: #fff;
      border: 1px solid #e8e4df;
      border-radius: 16px;
      box-shadow: 0 2px 12px rgba(15, 23, 42, 0.06);
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-sizing: border-box;
    }
    #mg-inline-patient-card .mg-ipc-header,
    #mg-inline-patient-card .mg-ipc-body {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 32px;
    }
    #mg-inline-patient-card .mg-ipc-header-left,
    #mg-inline-patient-card .mg-ipc-body-left {
      flex: 1;
      min-width: 0;
    }
    #mg-inline-patient-card .mg-ipc-header-right,
    #mg-inline-patient-card .mg-ipc-body-right {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      text-align: right;
    }
    #mg-inline-patient-card .mg-ipc-name {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 28px;
      font-weight: 700;
      color: #1c1917;
      letter-spacing: -0.02em;
      line-height: 1.15;
      margin: 0 0 8px;
    }
    #mg-inline-patient-card .mg-ipc-dob {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #78716c;
      font-weight: 500;
    }
    #mg-inline-patient-card .mg-ipc-age {
      background: #f5f5f4;
      color: #57534e;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 700;
      border: 1px solid #e7e5e4;
    }
    #mg-inline-patient-card .mg-ipc-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    #mg-inline-patient-card .mg-ipc-tags-vitals {
      margin-top: 8px;
    }
    #mg-inline-patient-card .mg-ipc-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid;
      line-height: 1.2;
    }
    #mg-inline-patient-card .mg-ipc-tag-green { background: #ecfdf5; color: #065f46; border-color: #a7f3d0; }
    #mg-inline-patient-card .mg-ipc-tag-yellow { background: #fffbeb; color: #92400e; border-color: #fde68a; }
    #mg-inline-patient-card .mg-ipc-tag-red { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
    #mg-inline-patient-card .mg-ipc-tag-blue { background: #eff6ff; color: #1e40af; border-color: #bfdbfe; }
    #mg-inline-patient-card .mg-ipc-tag-slate { background: #fafaf9; color: #57534e; border-color: #e7e5e4; }
    #mg-inline-patient-card .mg-ipc-muted { opacity: 0.45; margin: 0 2px; }
    #mg-inline-patient-card .mg-ipc-submitted {
      display: inline-block;
      background: #fafaf9;
      border: 1px solid #e7e5e4;
      border-radius: 10px;
      padding: 8px 12px;
    }
    #mg-inline-patient-card .mg-ipc-submitted-lbl {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #a8a29e;
    }
    #mg-inline-patient-card .mg-ipc-submitted-val {
      font-size: 13px;
      font-weight: 600;
      color: #44403c;
      margin-top: 2px;
    }
    #mg-inline-patient-card .mg-ipc-order-num {
      font-size: 22px;
      font-weight: 800;
      color: #1c1917;
      letter-spacing: -0.02em;
      line-height: 1.2;
    }
    #mg-inline-patient-card .mg-ipc-med {
      font-size: 15px;
      font-weight: 600;
      color: #57534e;
      margin-top: 4px;
    }
    #mg-inline-patient-card .mg-ipc-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 10px;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      border: 1px solid;
    }
    #mg-inline-patient-card .mg-ipc-status .dot {
      width: 7px; height: 7px; border-radius: 50%; background: currentColor;
    }
    #mg-inline-patient-card .mg-ipc-status-hold { background: #fff7ed; color: #c2410c; border-color: #fed7aa; }
    #mg-inline-patient-card .mg-ipc-status-review { background: #fffbeb; color: #b45309; border-color: #fde68a; }
    #mg-inline-patient-card .mg-ipc-status-default { background: #f5f5f4; color: #57534e; border-color: #e7e5e4; }
    @media (max-width: 900px) {
      #mg-inline-patient-card .mg-ipc-header,
      #mg-inline-patient-card .mg-ipc-body {
        flex-direction: column;
        gap: 12px;
      }
      #mg-inline-patient-card .mg-ipc-header-right,
      #mg-inline-patient-card .mg-ipc-body-right {
        align-items: flex-start;
        text-align: left;
        width: 100%;
      }
    }
  `;
}

function renderInlinePatientCard(data) {
  const wrap = document.querySelector(".od2-wrap");
  const topbar = document.querySelector(".od2-topbar");
  if (!wrap || !topbar || !data?.patientName) return;

  mgInjectInlinePatientCardStyles();
  mgEnsureInlinePatientCardLayoutSync();

  const slot = mgEnsureInlinePatientCardSlot(topbar, wrap);

  let card = document.getElementById("mg-inline-patient-card");
  if (!card) {
    card = document.createElement("div");
    card.id = "mg-inline-patient-card";
    slot.appendChild(card);
  } else if (card.parentElement !== slot) {
    slot.appendChild(card);
  }

  const orderNumEl = document.querySelector(".od2-topbar .od2-order-num");
  const orderDateEl = document.querySelector(".od2-topbar .od2-topbar-date");
  const statusPill = document.querySelector(".od2-topbar .od2-pill");
  const orderNum = orderNumEl?.textContent.trim() || (data.orderNo ? `Order #${data.orderNo}` : "");
  const orderDate = orderDateEl?.textContent.trim() || data.orderDate || "";
  const statusText = statusPill?.textContent.replace(/\s+/g, " ").trim() || "";
  const statusCls = /hold/i.test(statusText) ? "hold"
    : /review|await/i.test(statusText) ? "review" : "default";

  const medLine = [data.medication?.replace("® Injectable Pen", "").replace("®", "").trim(), data.dose]
    .filter(Boolean).join(" · ");

  const dobParts = [];
  if (data.dob && data.dob !== "—") dobParts.push(`DOB ${mgEscapeHtml(data.dob)}`);
  if (data.age != null) dobParts.push(`<span class="mg-ipc-age">${data.age} yrs</span>`);

  const tags = mgBuildInlinePatientTags(data);

  card.innerHTML = `
    <div class="mg-ipc-shell">
      <div class="mg-ipc-header">
        <div class="mg-ipc-header-left">
          <h2 class="mg-ipc-name">${mgEscapeHtml(data.patientName)}</h2>
          ${dobParts.length ? `<div class="mg-ipc-dob">${dobParts.join(" ")}</div>` : ""}
        </div>
        <div class="mg-ipc-header-right">
          ${orderDate ? `<div class="mg-ipc-submitted"><div class="mg-ipc-submitted-lbl">Submitted</div><div class="mg-ipc-submitted-val">${mgEscapeHtml(orderDate)}</div></div>` : ""}
        </div>
      </div>
      <div class="mg-ipc-body">
        <div class="mg-ipc-body-left">
          ${tags.primary ? `<div class="mg-ipc-tags mg-ipc-tags-primary">${tags.primary}</div>` : ""}
          ${tags.vitals ? `<div class="mg-ipc-tags mg-ipc-tags-vitals">${tags.vitals}</div>` : ""}
        </div>
        <div class="mg-ipc-body-right">
          ${orderNum ? `<div class="mg-ipc-order-num">${mgEscapeHtml(orderNum)}</div>` : ""}
          ${medLine ? `<div class="mg-ipc-med">${mgEscapeHtml(medLine)}</div>` : ""}
          ${statusText ? `<div class="mg-ipc-status mg-ipc-status-${statusCls}"><span class="dot"></span>${mgEscapeHtml(statusText)}</div>` : ""}
        </div>
      </div>
    </div>
  `;

  requestAnimationFrame(() => mgSyncInlinePatientCardLayout());
}

function ensureInlinePatientCardObserver() {
  if (window.__mgInlinePatientCardObs) return;
  window.__mgInlinePatientCardObs = true;
  const obs = new MutationObserver(() => {
    const wrap = document.querySelector(".od2-wrap");
    const topbar = document.querySelector(".od2-topbar");
    if (!wrap || !topbar || document.getElementById("mg-inline-patient-card")) return;
    if (lastScannedData?.patientName) renderInlinePatientCard(lastScannedData);
  });
  const start = () => {
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}

// ── Initial scan ──────────────────────────────────────────────────────────

function performScan() {
  // Only scan on od2-tab pages
  if (!document.querySelector(".od2-tabs")) return;

  const data = scrapeOrderData();
  lastScannedData = data;

  renderInlinePatientCard(data);
  updateEmInfoTiles(data);
  ensureInlinePatientCardObserver();
  try { ensureDecisionScrLink(); } catch (_) {}

  chrome.runtime.sendMessage({
    type: "ORDER_DATA_SCANNED",
    data: data
  }).catch(() => {});
}

// ── Message listener ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "REFRESH_SCAN") {
    performScan();
    sendResponse({ success: true });
    return;
  }

  if (message.type === "HL_SET") {
    highlightsEnabled = !!message.enabled;
    highlightScheduled = false;
    if (highlightsEnabled) scheduleHighlight();
    else clearAllHighlights();
    sendResponse({ success: true, enabled: highlightsEnabled });
    return;
  }

  if (message.type === "GET_SCAN_DATA") {
    const data = scrapeOrderData();
    sendResponse({ success: true, data: data });
    return;
  }

  if (message.type === "NAVIGATE_TAB") {
    const tabName = message.tabName;
    const tabBtn = document.querySelector(`.od2-tab[data-tab="${tabName}"]`);
    if (tabBtn) {
      tabBtn.click();
      sendResponse({ success: true, message: `Navigated to ${TAB_LABELS[tabName] || tabName}` });
    } else {
      sendResponse({ success: false, error: `Tab "${tabName}" not found on page` });
    }
    return;
  }

  if (message.type === "MARK_TAB_DONE") {
    const tabName = message.tabName;

    // Always navigate to the target tab FIRST so the completion footer is visible
    // and od2ToggleTabCompletion() executes in the right context.
    const tabBtn = document.querySelector(`.od2-tab[data-tab="${tabName}"]`);
    if (tabBtn && !tabBtn.classList.contains("active")) tabBtn.click();

    // After navigation, look up the footer fresh and find whichever button currently exists
    setTimeout(() => {
      const footer = document.querySelector(`[data-tab-completion="${tabName}"]`);
      if (!footer) {
        sendResponse({ success: false, error: `Completion footer not found for "${tabName}"` });
        return;
      }
      // Once done, page swaps the Mark button for an Undo button. Click whichever one exists.
      const btn = footer.querySelector(".od2-tcf-undo-btn") || footer.querySelector(".od2-tcf-mark-btn");
      if (!btn) {
        sendResponse({ success: false, error: `Neither Mark nor Undo button found in "${tabName}" footer` });
        return;
      }
      const alreadyDone = btn.classList.contains("od2-tcf-undo-btn");
      btn.click();

      // After a short delay, navigate to the next tab
      const currentIdx = TAB_ORDER.indexOf(tabName);
      const nextTab = TAB_ORDER[currentIdx + 1];
      if (nextTab && message.autoAdvance !== false) {
        setTimeout(() => {
          const nextBtn = document.querySelector(`.od2-tab[data-tab="${nextTab}"]`);
          if (nextBtn) {
            nextBtn.click();
            chrome.runtime.sendMessage({
              type: "ACTIVE_TAB_CHANGED",
              data: { activeTab: nextTab }
            }).catch(() => {});
          }
        }, 400);
      }

      // Re-scan and report
      setTimeout(() => {
        const updatedData = scrapeOrderData();
        sendResponse({
          success: true,
          message: alreadyDone ? `${TAB_LABELS[tabName]} un-marked` : `${TAB_LABELS[tabName]} marked as done`,
          data: updatedData
        });
      }, 600);
    }, 300); // wait for navigation to complete before reading the footer

    return true; // async response
  }

  // ── Documents: View / Verify / Reject a single document ──
  if (message.type === "DOC_ACTION") {
    const { docId, action } = message;
    const actionsDiv = document.querySelector(`.od2-doc-actions[data-doc-id="${docId}"]`);
    if (!actionsDiv) {
      sendResponse({ success: false, error: `Document "${docId}" not found on page` });
      return;
    }
    // Ensure we're on the documents tab first (modals/quick actions may rely on it)
    const docsTabBtn = document.querySelector(`.od2-tab[data-tab="documents"]`);
    if (docsTabBtn && !docsTabBtn.classList.contains("active")) docsTabBtn.click();

    setTimeout(() => {
      let btn = null;
      const allBtns = [...actionsDiv.querySelectorAll(".od2-doc-btn")];
      if (action === "view") {
        // Toggle: if this doc's modal is already open, close it instead of re-opening.
        const docModal = document.getElementById("od2DocModal");
        const isOpenForThisDoc =
          docModal && docModal.classList.contains("is-open") &&
          window.__mgViewedDocId === docId;
        if (isOpenForThisDoc) {
          try {
            if (typeof window.od2CloseDocModal === "function") window.od2CloseDocModal();
            else docModal.querySelector(".od2-modal-close")?.click();
            window.__mgViewedDocId = null;
            sendResponse({ success: true, message: `Closed ${docId}`, viewState: "closed" });
          } catch (e) {
            sendResponse({ success: false, error: e.message || "close failed" });
          }
          return;
        }
        btn = allBtns.find(b => {
          const oc = b.getAttribute("onclick") || "";
          return oc.includes("od2OpenDocModal") && !b.classList.contains("is-disabled");
        });
        if (btn) {
          try {
            btn.click();
            window.__mgViewedDocId = docId;
            installDocModalBackdropCloser();
            setTimeout(() => sendResponse({ success: true, message: `Opened ${docId}`, viewState: "open" }), 200);
          } catch (e) {
            sendResponse({ success: false, error: e.message || "click failed" });
          }
          return;
        }
        sendResponse({ success: false, error: `view not available for ${docId}` });
        return;
      } else if (action === "verify") {
        btn = allBtns.find(b => b.classList.contains("is-primary") && !b.classList.contains("is-disabled"));
      } else if (action === "reject") {
        btn = allBtns.find(b => b.classList.contains("is-danger-outline") && !b.classList.contains("is-disabled"));
      }
      if (!btn) {
        sendResponse({ success: false, error: `${action} not available for ${docId}` });
        return;
      }
      try {
        btn.click();
        // Page shows a SweetAlert2 confirm modal ("Mark X as verified?") — auto-click Verify
        autoConfirmSwal(1500).then(r => {
          // Treat "no modal" as success (some doc actions skip confirm); treat "modal stuck" as failure
          const ok = !r.appeared || r.closed;
          setTimeout(() => sendResponse({
            success: ok,
            message: ok ? `${action} → ${docId}` : `${action} → ${docId} not confirmed`,
            confirmed: r.closed,
            error: ok ? undefined : "confirm dialog did not close"
          }), 150);
        });
      } catch (e) {
        sendResponse({ success: false, error: e.message || "click failed" });
      }
    }, 150);
    return true;
  }

  // ── Documents: Verify all documents that have a Verify button available ──
  //   Also opens each remaining unverified doc and verifies any inner
  //   photo/video/sub-document inside its modal that still has a Verify button.
  //   Items already verified expose no Verify button so they are skipped.
  if (message.type === "COUNSELLING_AUTO_SEND") {
    // After bulk approve: switch to Patient Counselling tab, click the first
    // VISIBLE template card (the system pre-filters relevant ones, so the
    // first non-`.is-hidden` card matches the current order's drug+dose —
    // e.g. Mounjaro 10 mg), then click "Send to patient" in the preview pane.
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    (async () => {
      try {
        const tabBtn = document.querySelector('.od2-tab[data-tab="counselling"]');
        if (!tabBtn) { sendResponse({ success: false, error: "Counselling tab not found" }); return; }
        if (!tabBtn.classList.contains("active")) tabBtn.click();
        // Wait for the template grid to render
        let grid = null;
        for (let i = 0; i < 20; i++) {
          await sleep(150);
          grid = document.getElementById("od2PcTemplateGrid");
          if (grid && grid.querySelector(".od2-pc-template-card:not(.is-hidden)")) break;
        }
        if (!grid) { sendResponse({ success: false, error: "Template grid not found" }); return; }
        const firstCard = grid.querySelector(".od2-pc-template-card:not(.is-hidden)");
        if (!firstCard) { sendResponse({ success: false, error: "No visible template cards" }); return; }
        const tplTitle = firstCard.getAttribute("data-tpl-title") || "template";
        firstCard.click();
        // Wait for the preview pane + send button to appear
        let sendBtn = null;
        for (let i = 0; i < 20; i++) {
          await sleep(150);
          sendBtn = document.getElementById("od2PcSendBtn");
          if (sendBtn && sendBtn.offsetParent !== null) break;
        }
        if (!sendBtn) { sendResponse({ success: false, error: "Send button not found" }); return; }
        await sleep(300);
        // Dispatch full pointer sequence so any framework listeners fire.
        try {
          sendBtn.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
          sendBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          sendBtn.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
          sendBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        } catch {}
        sendBtn.click();
        // The send usually fires a SweetAlert confirmation — auto-confirm it.
        const swalRes = await autoConfirmSwal(2500);
        // If a second "sent successfully" dialog appears, dismiss that too.
        if (swalRes.appeared && swalRes.closed) {
          await sleep(150);
          await autoConfirmSwal(1200);
        }
        sendResponse({ success: true, template: tplTitle, swalAppeared: swalRes.appeared });
      } catch (e) {
        sendResponse({ success: false, error: (e && e.message) || "unknown" });
      }
    })();
    return true; // async sendResponse
  }

  if (message.type === "DOC_VERIFY_ALL") {
    const docsTabBtn = document.querySelector(`.od2-tab[data-tab="documents"]`);
    if (docsTabBtn && !docsTabBtn.classList.contains("active")) docsTabBtn.click();

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Click one button + auto-confirm its swal popup. Returns true on success.
    async function clickAndConfirm(btn) {
      try {
        btn.click();
        const r = await autoConfirmSwal(1500);
        return r.closed || !r.appeared;
      } catch { return false; }
    }

    // Find verify buttons inside the open document modal (photos / inner docs).
    function findModalVerifyBtns() {
      const modal = document.getElementById("od2DocModal");
      if (!modal || !modal.classList.contains("is-open")) return [];
      const candidates = [...modal.querySelectorAll("button, a")];
      return candidates.filter(b => {
        if (b.classList.contains("is-disabled") || b.disabled) return false;
        const onclick = b.getAttribute("onclick") || "";
        const txt = (b.textContent || "").trim().toLowerCase();
        const isVerify = b.classList.contains("is-primary")
          || onclick.includes("od2QuickVerify")
          || onclick.includes("QuickVerify")
          || /^verify\b/.test(txt) || txt === "verify" || txt === "approve";
        const isReject = b.classList.contains("is-danger-outline")
          || onclick.includes("Reject") || txt.includes("reject");
        return isVerify && !isReject;
      });
    }

    function closeDocModal() {
      const modal = document.getElementById("od2DocModal");
      if (!modal || !modal.classList.contains("is-open")) return;
      const closeBtn = modal.querySelector(".od2-doc-modal-close, [data-action='close'], .close, [aria-label='Close']");
      if (closeBtn) { try { closeBtn.click(); } catch {} return; }
      // backdrop fallback
      modal.click();
    }

    setTimeout(async () => {
      let confirmed = 0, failed = 0, innerConfirmed = 0, innerFailed = 0;

      // Phase 1 — verify top-level doc cards
      const topBtns = [...document.querySelectorAll(".od2-doc-actions .od2-doc-btn.is-primary")]
        .filter(b => !b.classList.contains("is-disabled"));
      for (const b of topBtns) {
        const ok = await clickAndConfirm(b);
        ok ? confirmed++ : failed++;
        await sleep(150);
      }

      // Phase 2 — for each remaining unverified doc card, open its modal and
      // verify any inner photos/sub-documents that still have a Verify button.
      const remainingCards = [...document.querySelectorAll(".od2-doc-card")].filter(card => {
        const status = card.querySelector(".od2-doc-status");
        return !status || !status.classList.contains("is-verified");
      });
      for (const card of remainingCards) {
        const docId = card.dataset.docCard;
        const actionsDiv = docId ? document.querySelector(`.od2-doc-actions[data-doc-id="${docId}"]`) : null;
        const viewBtn = actionsDiv && [...actionsDiv.querySelectorAll(".od2-doc-btn")].find(b => {
          const onclick = b.getAttribute("onclick") || "";
          return onclick.includes("od2OpenDocModal") || (b.textContent || "").toLowerCase().includes("view");
        });
        if (!viewBtn || viewBtn.classList.contains("is-disabled")) continue;

        try { viewBtn.click(); } catch { continue; }
        window.__mgViewedDocId = docId;

        // wait up to 1.5s for the modal to open
        let opened = false;
        for (let i = 0; i < 15; i++) {
          await sleep(100);
          const m = document.getElementById("od2DocModal");
          if (m && m.classList.contains("is-open")) { opened = true; break; }
        }
        if (!opened) continue;

        // Click every inner verify button still present. Re-query after each
        // click in case the DOM mutates (button removed once verified).
        let safety = 20;
        while (safety-- > 0) {
          const innerBtns = findModalVerifyBtns();
          if (!innerBtns.length) break;
          const ok = await clickAndConfirm(innerBtns[0]);
          ok ? innerConfirmed++ : innerFailed++;
          await sleep(200);
        }

        closeDocModal();
        await sleep(250);
      }

      const totalOk = confirmed + innerConfirmed;
      const totalFail = failed + innerFailed;
      const nothingToDo = topBtns.length === 0 && remainingCards.length === 0;
      sendResponse({
        success: totalOk > 0 || nothingToDo,
        message: totalOk
          ? `Verified ${totalOk} item${totalOk === 1 ? "" : "s"}${totalFail ? ` (${totalFail} not confirmed)` : ""}`
          : (nothingToDo ? "Nothing left to verify" : "No items were verified"),
        count: totalOk,
        failed: totalFail
      });
    }, 150);
    return true;
  }

  // ── Approve & Issue Rx: opens the Prescription Approval drawer and
  //    fills in SCR + comms + rationale, then clicks the final Approve button.
  if (message.type === "RX_APPROVE_AUTOFILL") {
    rxApproveAutofill(message.comment, message.scrMode).then(sendResponse);
    return true;
  }

  // ── Place on Hold: clicks the on-page Hold action, waits for the swal2
  //    modal, fills the reason textarea, ticks any document checkboxes the
  //    user selected in our side-panel modal, then clicks Confirm.
  if (message.type === "RX_HOLD_ORDER") {
    rxPlaceOnHold(message.reason, message.docs).then(sendResponse);
    return true;
  }

  if (message.type === "SEND_PATIENT_MESSAGE") {
    sendPatientChatMessage(message.text).then(sendResponse);
    return true;
  }

  if (message.type === "NAVIGATE_AND_MARK") {
    // Navigate to tab first, then mark done
    const tabName = message.tabName;
    const tabBtn = document.querySelector(`.od2-tab[data-tab="${tabName}"]`);
    if (tabBtn) tabBtn.click();

    setTimeout(() => {
      const footer = document.querySelector(`[data-tab-completion="${tabName}"]`);
      const btn = footer?.querySelector(".od2-tcf-mark-btn");
      if (btn) {
        btn.click();
        setTimeout(() => {
          const nextIdx = TAB_ORDER.indexOf(tabName) + 1;
          const nextTab = TAB_ORDER[nextIdx];
          if (nextTab) {
            const nextBtn = document.querySelector(`.od2-tab[data-tab="${nextTab}"]`);
            if (nextBtn) nextBtn.click();
          }
          sendResponse({ success: true });
        }, 400);
      } else {
        sendResponse({ success: false, error: "Mark done button not found" });
      }
    }, 300);

    return true;
  }

  return true;
});

// ── Boot ──────────────────────────────────────────────────────────────────

function boot() {
  if (!document.querySelector(".od2-tabs")) {
    // Keep checking if we land on an order page later
    setTimeout(boot, 2000);
    return;
  }

  performScan();
  detectTabCompletionChanges();
  detectActiveTabChanges();
  try { installDocModalEnhancements(); } catch {}

  // Periodically rescan in case data changes
  if (scanInterval) clearInterval(scanInterval);
  scanInterval = setInterval(performScan, 10000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

// ═══════════════════════════════════════════════════════════════════
//  PAGE HIGHLIGHTING — colours consultation Q/A and patient flags
//  directly on the live page so the prescriber sees them in context.
// ═══════════════════════════════════════════════════════════════════

function classifyConsultationAnswer(qRaw, aRaw) {
  if (!qRaw || !aRaw) return { level: null };
  const q = qRaw.toLowerCase();
  // The page renders YES/NO pills with an inline badge ("OK", "REVIEW", "CAUTION", "EVIDENCE")
  // baked into the same text node — so .textContent gives us things like "NoOK" or "YesREVIEW".
  // Strip those badge words wherever they appear so isYes/isNo can match cleanly.
  const a = aRaw
    .toLowerCase()
    .replace(/\b(ok|review|caution|evidence)\b/g, " ")
    .replace(/(yes|no|none)(ok|review|caution|evidence)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const isYes = a === "yes" || a.startsWith("yes ") || a.startsWith("yes,");
  const isNo = a === "no" || a.startsWith("no ") || a.startsWith("no,") || a === "none" || a === "n/a";

  // Hard contraindications — Yes = RED
  if (q.includes("pregnant") || q.includes("breastfeed"))     return { level: isNo ? "green" : "red" };
  if (q.includes("allergic reaction"))                        return { level: isNo ? "green" : "red" };
  if (q.includes("medullary thyroid") || q.includes("men2"))  return { level: isNo ? "green" : "red" };
  if (q.includes("eating disorder"))                          return { level: isNo ? "green" : "red" };

  // Age 18–75 — Yes = GREEN
  if (q.includes("aged 18") || q.includes("aged between 18") || q.includes("between 18 and 75")) {
    return { level: isYes ? "green" : "red" };
  }

  // Free-text follow-ups — always YELLOW
  if (q.includes("please indicate which condition") || q.includes("indicate which condition") ||
      (q.includes("which condition") && q.includes("diagnos")) ||
      q.includes("which treatment") || q.includes("which health condition") ||
      q.includes("which medication") || q.includes("brief details") ||
      q.includes("which injectable") || q.includes("when did you last")) {
    return { level: "yellow" };
  }

  // Cautions — Yes = YELLOW
  if (q.includes("diagnosed with or had surgery"))            return { level: isYes ? "yellow" : "green" };
  if (q.includes("previous or current health conditions"))    return { level: isYes ? "yellow" : "green" };
  if (q.includes("prescribed") && q.includes("drugs"))        return { level: isYes ? "yellow" : "green" };
  if (q.includes("type 2 diabetes"))                          return { level: isYes ? "yellow" : "green" };
  if (q.includes("oral contraceptive"))                       return { level: isYes ? "yellow" : "green" };
  if (q.includes("amiodarone") || q.includes("ciclosporin") || q.includes("warfarin") ||
      q.includes("lithium") || q.includes("anti-epileptic") || q.includes("digoxin")) {
    return { level: isYes ? "yellow" : "green" };
  }
  if (q.includes("new to using injectable") || q.includes("new to injectable")) {
    return { level: isYes ? "green" : "yellow" };
  }
  if (q.includes("purchase") && q.includes("previous")) {
    return { level: isNo ? "yellow" : "green" };
  }

  // Consent — Yes = GREEN
  if (q.includes("consent") || q.includes("agree") || q.includes("by proceeding") || q.includes("i confirm")) {
    return { level: isYes ? "green" : "red" };
  }
  return { level: null };
}

// One-time install: clicking the dark backdrop area of the doc preview modal closes it,
// AND watch the modal's open/close state so the sidepanel updates instantly (no scan delay).
function installDocModalBackdropCloser() {
  if (window.__mgBackdropCloserInstalled) return;
  const modal = document.getElementById("od2DocModal");
  if (!modal) return;
  modal.addEventListener("click", e => {
    if (e.target === modal) {
      if (typeof window.od2CloseDocModal === "function") window.od2CloseDocModal();
      else modal.querySelector(".od2-modal-close")?.click();
      window.__mgViewedDocId = null;
    }
  });
  // Push a scan whenever the modal toggles is-open so the sidepanel button
  // immediately flips View ↔ Close photo (even when closed via the page's X or backdrop).
  try {
    const obs = new MutationObserver(() => { try { performScan(); } catch {} });
    obs.observe(modal, { attributes: true, attributeFilter: ["class"] });
  } catch {}
  window.__mgBackdropCloserInstalled = true;
}

// ── Doc-preview modal: widen panel + scroll-to-zoom / drag-to-pan on the image ──
function injectDocModalStyles() {
  if (document.getElementById("mediguard-modal-styles")) return;
  const css = `
    #od2DocModal .od2-modal-box {
      width: min(1100px, 92vw) !important;
      max-width: none !important;
      height: min(900px, 88vh) !important;
      max-height: none !important;
      display: flex !important;
      flex-direction: column !important;
    }
    #od2DocModal .od2-modal-body, #od2DocModal #od2ModalBody {
      position: relative !important;
      flex: 1 1 auto !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      overflow: hidden !important;
      min-height: 0 !important;
      padding: 0 !important;
    }
    #od2DocModal #od2ModalBody > img {
      display: block !important;
      max-width: 100% !important;
      max-height: 100% !important;
      width: auto !important;
      height: auto !important;
      object-fit: contain !important;
      transform-origin: 0 0 !important;
      cursor: zoom-in !important;
      user-select: none !important;
      -webkit-user-drag: none !important;
    }
    #od2DocModal #od2ModalBody > video {
      display: block !important;
      max-width: 100% !important;
      max-height: 100% !important;
      width: auto !important;
      height: auto !important;
      object-fit: contain !important;
      background: #000 !important;
      transform-origin: 0 0 !important;
      cursor: zoom-in !important;
      user-select: none !important;
      -webkit-user-drag: none !important;
      /* Mild perceptual quality boost on low-res patient-uploaded videos
         (weight-scale clips etc.). Pure CSS — no source change, no perf
         cost. Slight contrast + saturation + sharpening via SVG filter
         gives a noticeable readability win on dark phone uploads
         without looking processed. */
      filter: contrast(1.06) saturate(1.10) brightness(1.03)
              url(#mediguard-video-sharpen) !important;
      image-rendering: -webkit-optimize-contrast !important;
    }
    #od2DocModal #od2ModalPrev,
    #od2DocModal #od2ModalNext {
      position: absolute !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      z-index: 10 !important;
    }
    #od2DocModal #od2ModalPrev { left: 12px !important; }
    #od2DocModal #od2ModalNext { right: 12px !important; }
    #od2DocModal #od2ModalCounter {
      position: absolute !important;
      bottom: 12px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      z-index: 10 !important;
    }
  `;
  const s = document.createElement("style");
  s.id = "mediguard-modal-styles";
  s.textContent = css;
  document.head.appendChild(s);

  // Inject an inline SVG holding a subtle unsharp-mask convolution kernel.
  // Referenced by the video CSS filter above via url(#mediguard-video-sharpen).
  // Kernel is centre-weighted (5 / -1 around) so edges read crisper without
  // ringing. Hidden, zero layout cost.
  if (!document.getElementById("mediguard-video-filter-svg")) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "mediguard-video-filter-svg";
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
    svg.innerHTML =
      '<defs><filter id="mediguard-video-sharpen">' +
      '<feConvolveMatrix order="3" preserveAlpha="true" ' +
      'kernelMatrix="0 -0.4 0  -0.4 2.6 -0.4  0 -0.4 0"/>' +
      '</filter></defs>';
    document.body.appendChild(svg);
  }
}

// Bind wheel-zoom + drag-pan + dblclick-zoom on a modal media element.
// Works for both <img> and <video> — same maths, same transform. For
// videos the native play/pause/scrub controls live in the browser's
// shadow DOM, so we only intercept clicks when the user is actually
// panning (scale > 1). At 1× the video behaves normally.
function _mgBindModalImageZoom(el) {
  const isVideo = el.tagName === "VIDEO";
  const srcKey = isVideo ? (el.currentSrc || el.src || "") : (el.currentSrc || el.src || "");
  if (el.dataset.mgZoomBound === "1") {
    if (el.dataset.mgZoomSrc !== srcKey) {
      el.dataset.mgZoomSrc = srcKey;
      if (typeof el._mgZoomReset === "function") el._mgZoomReset();
    }
    return;
  }
  el.dataset.mgZoomBound = "1";
  el.dataset.mgZoomSrc = srcKey;

  const state = { scale: 1, tx: 0, ty: 0, dragging: false, sx: 0, sy: 0 };
  const apply = () => {
    el.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
  };
  const reset = () => {
    state.scale = 1; state.tx = 0; state.ty = 0;
    state.dragging = false;
    el.style.transform = "";
    el.style.cursor = "zoom-in";
  };
  el._mgZoomReset = reset;

  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const ix = cx / state.scale;
    const iy = cy / state.scale;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    let newScale = state.scale * factor;
    if (newScale < 1) newScale = 1;
    if (newScale > 6) newScale = 6;
    state.tx = e.clientX - (rect.left - state.tx) - ix * newScale;
    state.ty = e.clientY - (rect.top  - state.ty) - iy * newScale;
    state.scale = newScale;
    if (state.scale <= 1.0001) { state.scale = 1; state.tx = 0; state.ty = 0; }
    el.style.cursor = state.scale > 1 ? "grab" : "zoom-in";
    apply();
  }, { passive: false });

  el.addEventListener("mousedown", (e) => {
    if (state.scale <= 1) return;        // at 1×, let native controls handle the click
    if (e.button !== 0) return;          // only left-button initiates a pan
    e.preventDefault();
    state.dragging = true;
    state.sx = e.clientX - state.tx;
    state.sy = e.clientY - state.ty;
    el.style.cursor = "grabbing";
  });
  const onMove = (e) => {
    if (!state.dragging) return;
    state.tx = e.clientX - state.sx;
    state.ty = e.clientY - state.sy;
    apply();
  };
  const onUp = () => {
    if (!state.dragging) return;
    state.dragging = false;
    el.style.cursor = state.scale > 1 ? "grab" : "zoom-in";
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  el.addEventListener("dblclick", (e) => {
    // Default video dblclick = fullscreen. We override to zoom because
    // fullscreen on the proxied iframe is unreliable and the user
    // explicitly asked for image-style zoom on videos.
    e.preventDefault();
    if (state.scale > 1) { reset(); return; }
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    state.scale = 2;
    state.tx = -cx;
    state.ty = -cy;
    el.style.cursor = "grab";
    apply();
  });

  el.addEventListener("dragstart", (e) => e.preventDefault());

  // Per-element quality nudges for videos.
  if (isVideo) {
    try {
      el.playsInline = true;
      el.preload = "auto";
      // Pick the highest-resolution <source> if multiple are offered.
      const sources = el.querySelectorAll("source");
      if (sources.length > 1) {
        let best = null, bestScore = -1;
        sources.forEach(s => {
          const lbl = (s.getAttribute("label") || s.getAttribute("data-res") || "").toLowerCase();
          const m = lbl.match(/(\d{3,4})p?/);
          const score = m ? parseInt(m[1], 10) : 0;
          if (score > bestScore) { bestScore = score; best = s; }
        });
        if (best && best !== sources[0]) {
          const cur = el.currentTime;
          el.src = best.src;
          try { el.load(); el.currentTime = cur; } catch {}
        }
      }
    } catch {}
  }
}

function installDocModalEnhancements() {
  injectDocModalStyles();
  if (window.__mgModalZoomInstalled) return;
  window.__mgModalZoomInstalled = true;

  const tryBind = () => {
    const modal = document.getElementById("od2DocModal");
    if (!modal) return;
    const body = document.getElementById("od2ModalBody");
    if (!body) return;
    const isOpen = modal.classList.contains("is-open");
    // Bind both images AND videos — same zoom/pan behaviour, same maths.
    const media = body.querySelectorAll(":scope > img, :scope > video");
    media.forEach(el => {
      if (isOpen) _mgBindModalImageZoom(el);
      else if (typeof el._mgZoomReset === "function") el._mgZoomReset();
    });
  };

  const obs = new MutationObserver(tryBind);
  obs.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ["class", "src"],
  });

  // Reset zoom when user clicks prev/next or close
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (!t.closest("#od2ModalPrev, #od2ModalNext, .od2-modal-close")) return;
    setTimeout(() => {
      const body = document.getElementById("od2ModalBody");
      if (!body) return;
      body.querySelectorAll("img, video").forEach(el => {
        if (typeof el._mgZoomReset === "function") el._mgZoomReset();
      });
    }, 30);
  }, true);

  tryBind();
}

function injectHighlightStyles() {
  if (document.getElementById("mediguard-hl-styles")) return;
  const css = `
    .mg-hl-red    { background: rgba(239,68,68,0.10) !important; border-left: 3px solid #dc2626 !important; padding-left: 8px !important; border-radius: 4px !important; }
    .mg-hl-orange { background: rgba(249,115,22,0.10) !important; border-left: 3px solid #ea580c !important; padding-left: 8px !important; border-radius: 4px !important; }
    .mg-hl-yellow { background: rgba(245,158,11,0.10) !important; border-left: 3px solid #d97706 !important; padding-left: 8px !important; border-radius: 4px !important; }
    .mg-hl-green  { background: rgba(16,185,129,0.08) !important; border-left: 3px solid #059669 !important; padding-left: 8px !important; border-radius: 4px !important; }
    /* When highlighting a single table row, paint the cells instead of leaving a stray left bar */
    tr.mg-hl-red    > td { background: rgba(239,68,68,0.10) !important; }
    tr.mg-hl-orange > td { background: rgba(249,115,22,0.10) !important; }
    tr.mg-hl-yellow > td { background: rgba(245,158,11,0.10) !important; }
    tr.mg-hl-green  > td { background: rgba(16,185,129,0.08) !important; }
    tr.mg-hl-red, tr.mg-hl-orange, tr.mg-hl-yellow, tr.mg-hl-green {
      border-left: none !important; padding-left: 0 !important; background: transparent !important;
      box-shadow: inset 4px 0 0 var(--mg-tr-color, currentColor) !important;
    }
    tr.mg-hl-red    { --mg-tr-color: #dc2626; }
    tr.mg-hl-orange { --mg-tr-color: #ea580c; }
    tr.mg-hl-yellow { --mg-tr-color: #d97706; }
    tr.mg-hl-green  { --mg-tr-color: #059669; }

    .mg-hl-badge {
      display: inline-block; margin-left: 6px; padding: 1px 7px;
      border-radius: 9px; font-size: 10px; font-weight: 700;
      vertical-align: middle; letter-spacing: 0.02em;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .mg-hl-badge.red    { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    .mg-hl-badge.orange { background: #ffedd5; color: #9a3412; border: 1px solid #fdba74; }
    .mg-hl-badge.yellow { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
    .mg-hl-badge.green  { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
  `;
  const style = document.createElement("style");
  style.id = "mediguard-hl-styles";
  style.textContent = css;
  document.head.appendChild(style);
}

const BADGE_LABEL = { red: "REVIEW", orange: "EVIDENCE", yellow: "CAUTION", green: "OK" };
const MG_HL_CLASSES = ["mg-hl-red", "mg-hl-orange", "mg-hl-yellow", "mg-hl-green"];

// Eligibility threshold for green-status BMI per SOP.
//   White (default) + no comorbidity → 30
//   White + comorbidity              → 27.5
//   Non-white ethnicity              → 27
function bmiThreshold(ethnicity, hasComorbidity) {
  const eth = (ethnicity || "").toLowerCase().trim();
  // Unknown → treat as white (default SOP).
  if (eth === "" || eth === "—") {
    return hasComorbidity ? 27.5 : 30;
  }
  // "White and Black African", "White and Asian", "Mixed: White and X" etc. are
  // mixed categories — the non-white side dominates clinically, so apply 27.
  const isMixed = eth.includes(" and ") || eth.startsWith("mixed");
  const isPureWhite = !isMixed && (
    eth === "white" ||
    eth.startsWith("white british") ||
    eth.startsWith("white irish") ||
    eth.startsWith("white european") ||
    eth.startsWith("white other") ||
    eth.startsWith("any other white") ||
    eth.startsWith("white -")
  );
  if (!isPureWhite) return 27;
  return hasComorbidity ? 27.5 : 30;
}

function detectEthnicityFromPage() {
  const vital = [...document.querySelectorAll(".od2-vitals-grid .od2-vital")]
    .find(v => (v.querySelector(".v-lbl")?.textContent || "").trim().toLowerCase() === "ethnicity");
  const v = vital?.querySelector(".v-text")?.textContent.trim() || "";
  return v && v !== "—" ? v : "";
}

function detectComorbidityFromPage() {
  const qs = document.querySelectorAll(".od2-cons-q");
  const as = document.querySelectorAll(".od2-cons-a");
  for (let i = 0; i < qs.length; i++) {
    const q = (qs[i].textContent || "").toLowerCase();
    if (q.includes("diagnosed with any of these conditions") &&
        (q.includes("type 2 diabetes") || q.includes("prediabetes") ||
         q.includes("sleep apnoea") || q.includes("high blood pressure"))) {
      return (as[i]?.textContent || "").trim().toLowerCase() === "yes";
    }
  }
  return false;
}

// BMI bands per current SOP
function classifyBmi(bmi) {
  if (bmi == null || isNaN(bmi)) return { level: null, msg: "" };
  if (bmi < 25)   return { level: "red",    msg: `BMI ${bmi} — Below 25: must be continuation, not a new start` };
  if (bmi < 27.5) return { level: "orange", msg: `BMI ${bmi} — 25–27.5: needs previous-use evidence` };
  if (bmi <= 30)  return { level: "yellow", msg: `BMI ${bmi} — 27.5–30: needs comorbidity` };
  if (bmi >= 45)  return { level: "yellow", msg: `BMI ${bmi} — Very high BMI: extra monitoring` };
  return            { level: "green",  msg: `BMI ${bmi} — Within eligible range (>30)` };
}

let highlightsEnabled = true;
try {
  chrome.storage.sync.get({ highlights_on: true }, r => {
    highlightsEnabled = r.highlights_on !== false;
    if (!highlightsEnabled) clearAllHighlights();
    else scheduleHighlight();
  });
} catch (_) {}

function clearAllHighlights() {
  document.querySelectorAll("." + MG_HL_CLASSES.join(", .")).forEach(el => {
    el.classList.remove(...MG_HL_CLASSES);
  });
  document.querySelectorAll("[data-mg-flag]").forEach(el => el.removeAttribute("data-mg-flag"));
  document.querySelectorAll(".mg-hl-badge").forEach(b => b.remove());
}

let highlightScheduled = false;
function scheduleHighlight() {
  if (!highlightsEnabled) return;
  if (highlightScheduled) return;
  highlightScheduled = true;
  requestAnimationFrame(() => {
    highlightScheduled = false;
    if (!highlightsEnabled) return;
    try { applyPageHighlights(); } catch (e) { /* ignore */ }
  });
}

function applyPageHighlights() {
  injectHighlightStyles();

  // ── Consultation Q/A pairs
  const qs = document.querySelectorAll(".od2-cons-q");
  const as = document.querySelectorAll(".od2-cons-a");
  qs.forEach((qEl, i) => {
    const aEl = as[i];
    if (!aEl) return;
    const c = classifyConsultationAnswer(qEl.textContent || "", aEl.textContent || "");
    // Clear any previous classes/badges on both elements
    [qEl, aEl].forEach(el => {
      el.classList.remove(...MG_HL_CLASSES);
      el.querySelectorAll(".mg-hl-badge").forEach(b => b.remove());
    });
    if (!c.level) return;
    const cls = `mg-hl-${c.level}`;
    qEl.classList.add(cls);
    aEl.classList.add(cls);
  });

  // ── Patient flag highlights (BMI / age) ──
  // Clean ONLY previous BMI/age artifacts (data-mg-flag); the Q/A highlights above are
  // self-cleaning per-pair and must not be wiped by this block.
  document.querySelectorAll("[data-mg-flag]").forEach(el => {
    el.classList.remove(...MG_HL_CLASSES);
    el.removeAttribute("data-mg-flag");
  });

  // BMI history table — highlight EVERY row against the eligibility threshold.
  //   Threshold:
  //     • Non-white ethnicity (African / Asian / Middle Eastern / Mixed / Other) → 27
  //     • White (or unknown) + comorbidity declared            → 27.5
  //     • White (or unknown), no comorbidity                   → 30
  //   Special rule for the Current row: if the Start row's BMI was within range,
  //   the Current row stays green all the way down to 21 (treatment is working —
  //   no need to flag the weight loss as out of range).
  //   Anything else below threshold is red (previous-use evidence required).
  const bmiTable = document.querySelector("table.od2-bmi-table");
  if (bmiTable) {
    const ethnicity = detectEthnicityFromPage();
    const hasCo = detectComorbidityFromPage();
    const threshold = bmiThreshold(ethnicity, hasCo);

    const rows = [...bmiTable.querySelectorAll("tbody tr")];
    const startRow = rows.find(r => r.querySelector(".row-tag--start"));
    const startBmi = startRow
      ? parseFloat((startRow.querySelectorAll("td")[1]?.textContent || "").trim())
      : NaN;
    const startInRange = !isNaN(startBmi) && startBmi >= threshold;

    rows.forEach(row => {
      const cells = row.querySelectorAll("td");
      const bmi = parseFloat((cells[1]?.textContent || "").trim());
      if (isNaN(bmi)) return;
      const isCurrent = !!row.querySelector(".row-tag--current");

      let level;
      if (bmi >= threshold) level = "green";
      else if (isCurrent && startInRange && bmi >= 21) level = "green";
      else level = "red";

      row.classList.add(`mg-hl-${level}`);
      row.setAttribute("data-mg-flag", "bmi");
    });
  }

  // Standalone BMI "tile" (e.g. the sidebar card showing just "28.4 BMI") — only tiles that
  // are SMALL and clearly a BMI value tile, never huge containers.
  document.querySelectorAll(".od2-bmi-card, .os-meta-row").forEach(el => {
    const txt = (el.textContent || "").trim();
    // Must look like a tiny BMI tile: contains "BMI" label AND a 2-digit number AND short text
    if (!/\bBMI\b/i.test(txt) || txt.length > 60) return;
    const bmiNum = parseFloat((txt.match(/\b(\d{2}(?:\.\d+)?)\b/) || [])[1]);
    const { level } = classifyBmi(bmiNum);
    if (level) {
      el.classList.add(`mg-hl-${level}`);
      el.setAttribute("data-mg-flag", "bmi");
    }
  });

  // Age tile — same size guardrail
  document.querySelectorAll(".os-meta-row, [class*='age-card']").forEach(el => {
    const txt = (el.textContent || "").trim();
    if (!/\bAge\b/i.test(txt) || txt.length > 40) return;
    const ageNum = parseInt((txt.match(/(\d{1,3})\s*(?:yrs?|years?|y)?/i) || [])[1]);
    if (isNaN(ageNum)) return;
    const lvl = (ageNum < 18 || ageNum >= 75) ? "red" : "green";
    el.classList.add(`mg-hl-${lvl}`);
    el.setAttribute("data-mg-flag", "age");
  });
}

// Observe the document for changes so highlights re-apply when tabs are switched
function watchForHighlightOpportunities() {
  const obs = new MutationObserver(scheduleHighlight);
  obs.observe(document.body, { childList: true, subtree: true });
}

// Hook into existing scan + boot
const _origPerformScan = performScan;
performScan = function() {
  _origPerformScan();
  scheduleHighlight();
};

// First highlight pass once content is ready
setTimeout(() => {
  if (document.querySelector(".od2-tabs")) {
    if (highlightsEnabled) scheduleHighlight();
    watchForHighlightOpportunities();
  }
}, 800);

// ═══════════════════════════════════════════════
//  Contraindications floating tab + slide-up modal
//  (mirrored from previous MedExpress extension —
//   anchored to BOTTOM-LEFT here, not bottom-right)
// ═══════════════════════════════════════════════
// Dataset derived from SOP Appendix 24 (GLP-1 contraindications) —
// grouped into Absolute, Relative, Info, and Nevolat-specific.
// ─────────────────────────────────────────────────────────────────────────────
// Contraindications Reference — tabbed dataset (SOP Appendix 24 + extensions)
// Structure: top categories → sub-categories → conditions/sections/rationale.
// ─────────────────────────────────────────────────────────────────────────────
const MG_CONTRA_DATA = {
  topTabs: [
    {
      id: "absolute",
      label: "Absolute Contraindications",
      icon: "⛔",
      color: "#ef4444", colorDark: "#dc2626", colorBorder: "#b91c1c",
      colorShadow: "rgba(220,38,38,0.35)",
      subTabs: [
        {
          id: "pancreatitis", label: "Pancreatitis", icon: "🔴",
          action: "REJECT IMMEDIATELY",
          conditionsLabel: "Includes:",
          conditions: ["Pancreatitis", "Acute pancreatic insufficiency", "Chronic pancreatic insufficiency"],
          rationale: "GLP-1s have black box warning for increased risk of pancreatitis."
        },
        {
          id: "eating", label: "Eating Disorders", icon: "🟣",
          action: "REJECT IMMEDIATELY",
          conditions: ["Anorexia nervosa", "Bulimia nervosa", "Binge Eating Disorder (BED)", "Avoidant/Restrictive Food Intake Disorder (ARFID)"],
          rationale: "GLP-1s suppress appetite and can worsen eating disorder pathology."
        },
        {
          id: "t1d", label: "Type 1 Diabetes", icon: "💉",
          action: "REJECT IMMEDIATELY",
          alsoKnownAs: "Insulin-dependent diabetes mellitus (IDDM)",
          rationale: "GLP-1s are not licensed for Type 1 diabetes treatment. Risk of diabetic ketoacidosis."
        },
        {
          id: "liver", label: "Liver Conditions", icon: "🫀",
          action: "REJECT IMMEDIATELY",
          conditions: ["Liver cirrhosis", "Liver transplant", "Severe hepatic impairment"],
          rationale: "Severe liver impairment affects drug metabolism and safety.",
          note: "For Nevolat prescriptions: any liver disease (any severity) is also an absolute contraindication."
        },
        {
          id: "endocrine", label: "Endocrine Disorders", icon: "⚡",
          action: "REJECT IMMEDIATELY",
          conditions: [
            "Acromegaly (Growth hormone disorder)",
            "Cushing's syndrome",
            "Addison's disease (Adrenal insufficiency)",
            "Congenital Adrenal Hyperplasia",
            "Overactive thyroid awaiting radioactive iodine or surgery"
          ],
          rationale: "These hormonal disorders can cause secondary obesity requiring specialist management."
        },
        {
          id: "gi", label: "GI Conditions", icon: "🔵",
          action: "REJECT IMMEDIATELY",
          conditions: ["Ulcerative Colitis", "Crohn's disease", "Gastroparesis (delayed gastric emptying)", "Chronic malabsorption syndrome"],
          rationale: "GLP-1s delay gastric emptying which can worsen these conditions."
        },
        {
          id: "thyroid", label: "Thyroid & Cancer", icon: "🎗️",
          action: "REJECT IMMEDIATELY",
          conditions: [
            "Multiple Endocrine Neoplasia type 2 (MEN2)",
            "Medullary Thyroid cancer (personal or family history)",
            "Thyroid disease — for Nevolat prescriptions ONLY",
            "Any form of cancer currently being treated by specialist"
          ],
          rationale: "GLP-1s have black box warning against use with medullary thyroid cancer or MEN2.",
          note: "Calcitonin >100 ng/L is an absolute contraindication for Nevolat."
        },
        {
          id: "medications", label: "Medications", icon: "💊",
          action: "REJECT IF ON REPEAT MEDICATION LIST",
          sections: [
            { title: "INSULIN", items: ["Any insulin on repeat medication list"] },
            { title: "ORAL DIABETIC — Sulfonylureas", items: ["Diamicron (gliclazide)", "Daonil (glibenclamide)", "Rastin (tolbutamide)"] },
            { title: "ORAL DIABETIC — DPP-4 inhibitors", items: ["Januvia (sitagliptin)", "Galvus (vildagliptin)", "Trajenta (linagliptin)"] },
            { title: "ORAL DIABETIC — SGLT2 inhibitors", items: ["Jardiance (empagliflozin)", "Forxiga (dapagliflozin)", "Invokana (canagliflozin)"] },
            { title: "ORAL DIABETIC — Thiazolidinediones", items: ["Actos (pioglitazone)"] },
            { title: "NARROW THERAPEUTIC INDEX", items: ["Amiodarone", "Carbamazepine", "Ciclosporin", "Clozapine", "Digoxin", "Fenfluramine", "Lithium", "Mycophenolate mofetil", "Oral methotrexate", "Phenobarbital", "Phenytoin", "Somatrogon", "Tacrolimus", "Theophylline", "Warfarin"] }
          ],
          rationale: "These medications have significant interactions or indicate conditions incompatible with GLP-1 treatment."
        },
        {
          id: "kidney", label: "Kidney Disease", icon: "🫘",
          action: "REJECT IMMEDIATELY",
          conditions: ["Chronic kidney disease with eGFR less than 30 ml/min (severe / Stage 4–5)"],
          rationale: "Severe renal impairment affects drug clearance and increases risk of adverse effects.",
          ifNeeded: "Request a recent eGFR result before approving."
        },
        {
          id: "cardiac", label: "Cardiac Conditions", icon: "❤️",
          action: "REJECT IMMEDIATELY",
          conditions: ["Heart failure with shortness of breath at rest (Stage IV)", "Active retinopathy"],
          rationale: "Severe heart failure increases risk of adverse cardiovascular events.",
          ifNeeded: "Request a recent cardiology clinic letter before approving."
        }
      ]
    },
    {
      id: "timesensitive",
      label: "Time-Sensitive Conditions",
      icon: "⏱️",
      color: "#fbbf24", colorDark: "#f59e0b", colorBorder: "#b45309",
      colorShadow: "rgba(245,158,11,0.35)",
      subTabs: [
        {
          id: "bariatric", label: "Bariatric Surgery", icon: "🩻",
          action: "REJECT", actionNote: "if <12 months post-surgery",
          safeIf: "If surgery was ≥12 months ago (1 year or more)",
          conditionsLabel: "Surgery Types:", conditionsLabelStyle: "info",
          conditions: [
            "Roux-en-Y Gastric Bypass (RYGB)",
            "Sleeve Gastrectomy",
            "Adjustable Gastric Band (Lap-Band)",
            "Biliopancreatic Diversion with Duodenal Switch (BPD/DS)",
            "Mini Gastric Bypass (OAGB)",
            "Endoscopic Bariatric Procedures (gastric balloon)"
          ],
          ifNeeded: "If timing is unknown, email the patient to confirm the date before approving."
        },
        {
          id: "gallbladder", label: "Gallbladder Removal", icon: "🟪",
          action: "REJECT", actionNote: "if cholecystectomy <3 months",
          safeIf: "If ≥3 months post-cholecystectomy with no ongoing symptoms",
          conditionsLabel: "Includes:", conditionsLabelStyle: "info",
          conditions: [
            "Cholecystectomy within last 3 months",
            "Active gallstones (symptomatic)",
            "Acute biliary colic in last 6 months"
          ],
          rationale: "GLP-1s can increase risk of gallbladder events. Allow recovery time before initiating.",
          ifNeeded: "If timing is unknown, email the patient to confirm the date before approving."
        },
        {
          id: "diabetic_meds", label: "Diabetic Medications", icon: "💊",
          action: "REJECT", actionNote: "if EITHER condition applies",
          conditions: [
            "Prescribed within last 3 months as acute",
            "OR present on repeat medication list"
          ],
          sections: [
            {
              title: "ORAL DIABETIC MEDICATIONS:",
              subSections: [
                { title: "Sulfonylureas:", items: ["Diamicron (gliclazide)", "Daonil (glibenclamide)", "Rastin (tolbutamide)"] },
                { title: "DPP-4 inhibitors:", items: ["Januvia (sitagliptin)", "Galvus (vildagliptin)", "Trajenta (linagliptin)"] },
                { title: "SGLT2 inhibitors:", items: ["Jardiance (empagliflozin)", "Forxiga (dapagliflozin)", "Invokana (canagliflozin)"] },
                { title: "Thiazolidinediones:", items: ["Actos (pioglitazone)"] }
              ]
            },
            { title: "INSULIN:", items: ["Any insulin on repeat medication list"] }
          ],
          rationale: "Concurrent diabetic medications cause unsafe hypoglycaemia risk with GLP-1s."
        },
        {
          id: "nti_meds", label: "NTI Medications", icon: "⚠️",
          action: "REJECT", actionNote: "if EITHER condition applies",
          conditions: [
            "Prescribed within last 3 months as acute",
            "OR present on repeat medication list"
          ],
          sections: [
            {
              title: "NTI MEDICATIONS LIST:",
              items: [
                "Amiodarone", "Oral methotrexate",
                "Carbamazepine", "Phenobarbital",
                "Ciclosporin", "Phenytoin",
                "Clozapine", "Somatrogon",
                "Digoxin", "Tacrolimus",
                "Fenfluramine", "Theophylline",
                "Lithium", "Warfarin",
                "Mycophenolate mofetil"
              ]
            }
          ],
          rationale: "GLP-1s delay gastric emptying, which can affect absorption and blood levels of these medications."
        },
        {
          id: "orlistat", label: "Orlistat", icon: "🟠",
          action: "REJECT", actionNote: "if EITHER condition applies",
          conditions: [
            "Prescribed within last 3 months as acute",
            "OR present on repeat medication list"
          ],
          rationale: "Orlistat affects fat absorption and may interfere with GLP-1 efficacy. Must be stopped before starting treatment."
        }
      ]
    },
    {
      id: "clinical",
      label: "Clinical Details Required",
      icon: "📋",
      color: "#60a5fa", colorDark: "#3b82f6", colorBorder: "#1d4ed8",
      colorShadow: "rgba(59,130,246,0.35)",
      subTabs: [
        {
          id: "gallstones", label: "Gallstones", icon: "🟪",
          action: "HOLD ORDER", actionStyle: "hold",
          actionNote: "if no evidence of cholecystectomy → Hold order",
          title: "Cholelithiasis (Gallstones) or Cholecystitis",
          questionToAsk: "Have you had your gallbladder removed? If yes, when?",
          rejectIf: "Patient confirms NO cholecystectomy (gallbladder still present)",
          prescribeIf: "Cholecystectomy confirmed by patient (even if not visible on SCR)"
        },
        {
          id: "heart_failure", label: "Heart Failure", icon: "❤️",
          action: "IF NO INFORMATION ON STAGE → EMAIL PATIENT", actionStyle: "info",
          title: "Heart Failure (HF)",
          rejectIf: "Patient confirms Stage IV heart failure (shortness of breath at rest)",
          prescribeIf: "Stage I, II, or III confirmed"
        },
        {
          id: "ckd", label: "Chronic Kidney Disease", icon: "🫘",
          action: "IF NO EGFR INFORMATION → EMAIL PATIENT", actionStyle: "info",
          title: "Chronic Kidney Disease (CKD)",
          rejectIf: "eGFR <30 ml/min (Stage 4-5 / Severe CKD)",
          prescribeIf: "eGFR ≥30 ml/min (Stage 1-3)"
        },
        {
          id: "retinopathy", label: "Retinopathy", icon: "👁️",
          action: "DETERMINE TYPE OF RETINOPATHY BEFORE DECISION", actionStyle: "info",
          title: "Retinopathy - Type Matters!",
          rejectIf: "Active diabetic retinopathy under regular eye clinic care",
          prescribeIf: "Non-diabetic causes (hypertensive, toxoplasma chorioretinitis, etc.)"
        }
      ]
    },
    {
      id: "assessment",
      label: "Patient Assessment Required",
      icon: "🧑‍⚕️",
      color: "#a78bfa", colorDark: "#8b5cf6", colorBorder: "#6d28d9",
      colorShadow: "rgba(139,92,246,0.35)",
      subTabs: [
        {
          id: "cancer", label: "Cancer", icon: "🎗️",
          title: "Cancer Diagnosis",
          exclusion: "Medullary thyroid cancer and MEN2 are absolute contraindications",
          conditionsLabel: "Information needed:", conditionsLabelStyle: "info",
          conditions: [
            "Treatment status (active, in remission, cured)",
            "Remission status and duration",
            "Oncology team discharge status",
            "For breast cancer: Whether on hormone therapy only (e.g., tamoxifen, Zoladex)"
          ],
          specialConsideration: {
            label: "🌷 Breast Cancer - Special Consideration",
            body: "Breast cancer history requires clarification, not automatic rejection. Email patient to confirm current cancer status before making decision."
          },
          rejectIf: [
            "Currently under oncology care",
            "Receiving active cancer treatment (chemotherapy, radiotherapy, targeted therapy)",
            "Recent recurrence or spread of cancer"
          ],
          prescribeIf: [
            "Cancer in remission and discharged from oncology team",
            "On long-term hormone therapy only (tamoxifen/Zoladex) with no active treatment",
            "No recent recurrence or current oncology involvement"
          ]
        },
        {
          id: "pregnancy_a", label: "Pregnancy", icon: "🤰",
          title: "Pregnancy, Breastfeeding & Conception",
          action: "EMAIL PATIENT", actionStyle: "info",
          rejectIf: [
            "Currently pregnant",
            "Breastfeeding",
            "Planning pregnancy within 3 months"
          ],
          prescribeIf: "Patient confirms none of the above apply"
        },
        {
          id: "dementia", label: "Dementia", icon: "🧠",
          title: "Dementia / Cognitive Impairment",
          action: "EMAIL PATIENT", actionStyle: "info",
          rejectIf: "Patient unable to safely self-administer medication or lacks adequate support",
          prescribeIf: "Patient has adequate support and can safely use medication"
        },
        {
          id: "malabsorption", label: "Malabsorption", icon: "🍽️",
          title: "Chronic Malabsorption",
          action: "EMAIL PATIENT", actionStyle: "info",
          rejectIf: "Patient provides evidence of formal chronic malabsorption syndrome diagnosis",
          prescribeIf: "No formal diagnosis confirmed (may be historical/resolved)"
        },
        {
          id: "mental_health", label: "Mental Health", icon: "💭",
          title: "Depression or Anxiety",
          action: "EMAIL PATIENT", actionStyle: "info",
          rejectIf: [
            "Acutely unwell <3 months",
            "Started new antidepressant recently",
            "Active thoughts of self-harm or suicide"
          ]
        },
        {
          id: "suicidal", label: "Suicidal Ideation", icon: "⚠️",
          title: "Active Suicidal Ideation",
          action: "REJECT IMMEDIATELY",
          actionNote: "if mentioned in last 12 months", actionNoteStyle: "warn"
        },
        {
          id: "alcohol", label: "Alcohol", icon: "🍺",
          title: "Alcohol Abuse or Dependence",
          action: "EMAIL PATIENT", actionStyle: "info",
          rejectIf: [
            "Current alcohol abuse or dependence",
            "Alcohol abuse mentioned in last 12 months",
            "In treatment/rehabilitation"
          ],
          prescribeIf: "Historical alcohol issues (>12 months ago) and currently stable"
        }
      ]
    },
    {
      id: "knowledge",
      label: "Knowledge Base",
      icon: "📚",
      color: "#10b981", colorDark: "#059669", colorBorder: "#047857",
      colorShadow: "rgba(16,185,129,0.35)",
      // List-view tab: instead of icon sub-tabs, show category filter pills
      // and a long searchable list of all conditions.
      view: "list",
      subTabs: [],
      categories: ["GIT", "Cardiology", "Endocrine", "Mental Health", "Neurology", "Renal", "Bariatric", "Cancer", "Other"],
      conditions: [
        // ── GIT (22) ──
        { cat: "GIT", name: "Pancreatitis (acute or chronic)", status: "reject", desc: "Any diagnosis of this at any time is an exclusion. Request hospital discharge letter for suspected/confirmed acute pancreatitis." },
        { cat: "GIT", name: "Liver Cirrhosis", status: "reject", desc: "Any diagnosis of this at any time is an exclusion." },
        { cat: "GIT", name: "Primary Biliary Cholangitis", status: "reject", desc: "Any diagnosis of this at any time is an exclusion." },
        { cat: "GIT", name: "Ulcerative Colitis", status: "reject", desc: "Any diagnosis of this at any time is an exclusion." },
        { cat: "GIT", name: "Crohn's Disease", status: "reject", desc: "Any diagnosis of this at any time is an exclusion." },
        { cat: "GIT", name: "Ileostomy or Colostomy stoma", status: "reject", desc: "This is an exclusion." },
        { cat: "GIT", name: "End Stage Liver Failure", status: "reject", desc: "Do not prescribe, regardless if asymptomatic or not." },
        { cat: "GIT", name: "Gallstones (no GB removal)", status: "reject", desc: "Do not prescribe, regardless if asymptomatic or not." },
        { cat: "GIT", name: "Cholecystitis (no GB removal)", status: "reject", desc: "Reject." },
        { cat: "GIT", name: "Cholecystectomy", status: "follow_sop", desc: "Reject if <12 months, prescribe if surgery was more than a year ago. Refer to SCR Screening SOP." },
        { cat: "GIT", name: "Viral Hepatitis", status: "escalate", desc: "Acute/Active disease is an exclusion. Chronic/carrier status may be okay if no end-stage liver disease or cirrhosis. Clinic letter from specialist may be beneficial." },
        { cat: "GIT", name: "Autoimmune Hepatitis", status: "escalate", desc: "Will need further information including if under a specialist and on treatment. Recent clinic letter and/or letter of support from specialist needed." },
        { cat: "GIT", name: "Bile Acid Malabsorption", status: "escalate", desc: "Gather more information about cause and symptoms. REJECT if symptomatic and under consultant. OK if symptom free and not under secondary care." },
        { cat: "GIT", name: "Infective or Ischaemic Colitis", status: "escalate", desc: "Gather more info: blood tests, stools tests, colonoscopy results, symptoms. May be safe if all symptoms resolved; letter from specialist beneficial." },
        { cat: "GIT", name: "Deranged LFTs", status: "escalate", desc: "Confirm pt does not suffer from viral hepatitis. Recent bloods and liver scan may be helpful. Otherwise, usually safe to prescribe." },
        { cat: "GIT", name: "IBS", status: "escalate", desc: "Safe to prescribe if tolerating other SE. If SE intolerable, review dose & consider reducing. If IBS flared up, pause GLP1 until reduced." },
        { cat: "GIT", name: "Splenectomy", status: "escalate", desc: "Check why they had splenectomy. Most cases after trauma = OK. Other causes discuss case by case." },
        { cat: "GIT", name: "Gallbladder Polyp", status: "escalate", desc: "If benign polyp and no gallstones, no prev cholecystitis then OK to use." },
        { cat: "GIT", name: "Coeliac Disease", status: "prescribe", desc: "If well controlled OK to prescribe." },
        { cat: "GIT", name: "Gilbert Syndrome", status: "prescribe", desc: "Safe to prescribe." },
        { cat: "GIT", name: "Hiatus Hernia", status: "prescribe", desc: "Ok to prescribe, but 20% chance of reflux as side effect of GLP1." },
        { cat: "GIT", name: "Diverticular Disease", status: "prescribe", desc: "As long as not had any bowel removed - safe to prescribe." },

        // ── Cardiology (10) ──
        { cat: "Cardiology", name: "Heart Failure Stage 4", status: "reject", desc: "Any diagnosis of this (SOBAR — shortness of breath at rest) at any time is an exclusion." },
        { cat: "Cardiology", name: "Long QT Syndrome", status: "reject", desc: "Effects of GLP1 Rx not known on this condition and we cannot monitor — this is an exclusion." },
        { cat: "Cardiology", name: "POTS", status: "escalate", desc: "If symptomatic (dizziness, fainting, palpitations, SOB, chest pain triggered by standing) REJECT. If asymptomatic, may be eligible." },
        { cat: "Cardiology", name: "Cardiomyopathy", status: "escalate", desc: "Get more info: diagnosis/symptoms. Specialist letter and recent echo may be beneficial." },
        { cat: "Cardiology", name: "Heart Block / Pacemaker", status: "escalate", desc: "Need further info — if controlled/stable, asymptomatic, no comorbidity (e.g. Heart Failure), should be okay. Letter from specialist beneficial." },
        { cat: "Cardiology", name: "Ischaemic Heart Disease", status: "escalate", desc: "Specialist clinic letter beneficial. If stable, asymptomatic, no recent (<8 weeks) cardiac event, should be okay." },
        { cat: "Cardiology", name: "Congenital Heart Disease", status: "escalate", desc: "If surgically corrected, no longer under specialist care and no symptoms may be able to prescribe." },
        { cat: "Cardiology", name: "Atrial Fibrillation", status: "escalate", desc: "If well controlled with medication (non-NTI drugs) and no comorbidity (e.g. Stage 4 HF or cardiomyopathy) OK to use." },
        { cat: "Cardiology", name: "SVT", status: "escalate", desc: "If asymptomatic/controlled on meds and not under specialist, safe to prescribe. If under specialist, may need letter of support." },
        { cat: "Cardiology", name: "Heart Failure Stages 1-3", status: "prescribe", desc: "Safe to prescribe as long as pt is not NYHA stage 4 (symptomatic at rest)." },

        // ── Endocrine (16) ──
        { cat: "Endocrine", name: "Type 1 Diabetes", status: "reject", desc: "Reject (as per SCR Screening SOP)." },
        { cat: "Endocrine", name: "LADA", status: "reject", desc: "These patients are essentially 'type 1' diabetic phenotype — excluded from GLP1 treatment." },
        { cat: "Endocrine", name: "Hypoglycaemia", status: "reject", desc: "We do not have capacity to monitor these patients — this is an exclusion." },
        { cat: "Endocrine", name: "Acromegaly", status: "reject", desc: "Reject (as per SCR Screening SOP)." },
        { cat: "Endocrine", name: "Cushing's Syndrome", status: "reject", desc: "Reject (as per SCR Screening SOP)." },
        { cat: "Endocrine", name: "Addison's Disease", status: "reject", desc: "Reject (as per SCR Screening SOP)." },
        { cat: "Endocrine", name: "Congenital Adrenal Hyperplasia", status: "reject", desc: "Reject (as per SCR Screening SOP)." },
        { cat: "Endocrine", name: "Gastroparesis", status: "reject", desc: "Reject (as per SCR Screening SOP)." },
        { cat: "Endocrine", name: "MEN2", status: "reject", desc: "Reject now." },
        { cat: "Endocrine", name: "Raised Triglycerides", status: "escalate", desc: "If fasting TG >4.5 do not prescribe (pancreatitis risk). Check if test was fasted; if not ask to repeat fasted." },
        { cat: "Endocrine", name: "Hypopituitarism / Prolactinoma", status: "escalate", desc: "Need more info — check with endocrinologist before starting. May be safe if benefits outweigh risks." },
        { cat: "Endocrine", name: "Thyroid Nodules (U3+)", status: "escalate", desc: "Obtain more info; if U3 or above — ask about biopsy and if under investigation. Exception: Nevolat where no Thyroid disease patients should have Rx." },
        { cat: "Endocrine", name: "Thyroid Nodules (U2)", status: "prescribe", desc: "These are benign and OK to use GLP1. Exception: Nevolat where no Thyroid disease patients should have Rx." },
        { cat: "Endocrine", name: "Hypothyroidism / Hashimoto's", status: "prescribe", desc: "Okay to prescribe (unless secondary to thyroid cancer treatment). Exception: Nevolat — no Thyroid disease patients." },
        { cat: "Endocrine", name: "Hyperthyroidism / Graves", status: "prescribe", desc: "Should be safe — check patient feels well and no treatment changes in last 6m. Exception: Nevolat — no Thyroid disease patients." },
        { cat: "Endocrine", name: "Thyroidectomy / Thyroid Removal", status: "prescribe", desc: "Thyroidectomy is NOT a contraindication to GLP-1 therapy. Patient will be on levothyroxine replacement which does not interact with GLP-1s. Safe to prescribe provided thyroid levels are stable. Exception: If thyroidectomy was for Medullary Thyroid Cancer — REJECT (MTC is absolute contraindication)." },

        // ── Mental Health (8) ──
        { cat: "Mental Health", name: "Anorexia", status: "reject", desc: "Any diagnosis of this at any time is an exclusion." },
        { cat: "Mental Health", name: "Bulimia", status: "reject", desc: "Any diagnosis of this at any time is an exclusion." },
        { cat: "Mental Health", name: "ARFID", status: "reject", desc: "Reject (as per SCR Screening SOP)." },
        { cat: "Mental Health", name: "Current Suicidal Thoughts", status: "reject", desc: "This is an exclusion but must contact pt to check they're getting help." },
        { cat: "Mental Health", name: "Binge Eating Disorder", status: "escalate", desc: "Formal diagnosis is exclusion. However, if reports binge eating but never diagnosed or seen specialist, may be eligible (70% of obese people binge eat but most don't have disorder)." },
        { cat: "Mental Health", name: "Binge Eating (no diagnosis)", status: "prescribe", desc: "OK to prescribe in absence of 'Binge Eating Disorder' diagnosis." },
        { cat: "Mental Health", name: "Depression / Bipolar", status: "escalate", desc: "Do not prescribe if acutely mentally unwell. Enquire if any medication changes in last 3 months." },
        { cat: "Mental Health", name: "Previous Suicidal Thoughts", status: "escalate", desc: "Needs more info to check no current concerns." },

        // ── Neurology (6) ──
        { cat: "Neurology", name: "Ischaemic Stroke", status: "prescribe", desc: "Ischaemic stroke is considered safe to have GLP-1 treatment." },
        { cat: "Neurology", name: "Haemorrhagic Stroke", status: "escalate", desc: "Need to gather more information: when diagnosed, how treated, current condition." },
        { cat: "Neurology", name: "CVA", status: "escalate", desc: "If ischaemic (not haemorrhagic) CVA can prescribe." },
        { cat: "Neurology", name: "TIA", status: "escalate", desc: "If ischaemic (not haemorrhagic) TIA can prescribe." },
        { cat: "Neurology", name: "Epilepsy", status: "escalate", desc: "If under a neurologist, they need to be aware." },
        { cat: "Neurology", name: "Idiopathic Intracranial Hypertension", status: "prescribe", desc: "Safe to prescribe." },

        // ── Renal (4) ──
        { cat: "Renal", name: "CKD", status: "escalate", desc: "Can treat if eGFR >30." },
        { cat: "Renal", name: "Kidney Stones", status: "prescribe", desc: "Safe to prescribe if eGFR >30. Extra advice about hydration beneficial." },
        { cat: "Renal", name: "One Kidney", status: "escalate", desc: "If evidence of eGFR >30 in last 6 months OK to use." },
        { cat: "Renal", name: "Kidney Cysts", status: "escalate", desc: "If not due to Polycystic Kidney disease, and eGFR >30, safe to prescribe." },

        // ── Bariatric (6) ──
        { cat: "Bariatric", name: "Gastric Bypass (RYGB)", status: "follow_sop", desc: "Reject if <12 months, prescribe if surgery was more than a year ago. Refer to SCR Screening SOP." },
        { cat: "Bariatric", name: "Sleeve Gastrectomy", status: "follow_sop", desc: "Reject if <12 months, prescribe if surgery was more than a year ago. Refer to SCR Screening SOP." },
        { cat: "Bariatric", name: "Gastric Band (Lap-Band)", status: "follow_sop", desc: "Reject if <12 months, prescribe if surgery was more than a year ago. Refer to SCR Screening SOP." },
        { cat: "Bariatric", name: "Mini Gastric Bypass (OAGB)", status: "follow_sop", desc: "Reject if <12 months, prescribe if surgery was more than a year ago. Refer to SCR Screening SOP." },
        { cat: "Bariatric", name: "BPD/DS", status: "follow_sop", desc: "Reject if <12 months, prescribe if surgery was more than a year ago. Refer to SCR Screening SOP." },
        { cat: "Bariatric", name: "Gastric Balloon", status: "follow_sop", desc: "Reject if <12 months, prescribe if surgery was more than a year ago. Refer to SCR Screening SOP." },

        // ── Cancer (5) ──
        { cat: "Cancer", name: "Medullary Thyroid Cancer", status: "reject", desc: "Reject now." },
        { cat: "Cancer", name: "Active Cancer (on treatment)", status: "reject", desc: "If having treatment for active cancer from oncology team, that is an exclusion." },
        { cat: "Cancer", name: "Cancer (in remission)", status: "escalate", desc: "If discharged from oncology team or in remission/maintenance Rx/surveillance only, then eligible. Request discharge or recent oncology letter." },
        { cat: "Cancer", name: "Papillary/Follicular Thyroid Cancer", status: "follow_sop", desc: "As long as 'Cancer' conditions are met (see above), safe to prescribe." },
        { cat: "Cancer", name: "Basal Cell Carcinoma", status: "prescribe", desc: "Accept — local wart-like cancer only, does not metastasise/cause mortality." },

        // ── Other (17) ──
        { cat: "Other", name: "NAION", status: "reject", desc: "Any diagnosis of this at any time is an exclusion." },
        { cat: "Other", name: "Maculopathy", status: "reject", desc: "Reject now." },
        { cat: "Other", name: "Diabetic Retinopathy (Active / Under Eye Clinic)", status: "reject", desc: "If under regular care of eye clinic for ACTIVE diabetic retinopathy — this is an exclusion due to 'early worsening phenomenon' where rapid HbA1c reduction can worsen retinopathy.", note: "SUSTAIN-6 showed semaglutide associated with more diabetic retinopathy complications in patients with pre-existing disease and high baseline HbA1c." },
        { cat: "Other", name: "Diabetic Retinopathy (Background / Stable)", status: "escalate", desc: "If having regular screening but NOT under active eye clinic care, may be suitable. Request confirmation of last retinal screening result and whether stable. Advise patient to report any vision changes immediately.", note: "Early worsening risk is highest in patients with pre-existing retinopathy + rapid glycaemic improvement. Lower risk if stable background changes only." },
        { cat: "Other", name: "Non-Diabetic Retinopathy", status: "prescribe", desc: "Retinopathy NOT related to diabetes (e.g., hypertensive, toxoplasma chorioretinitis, retinal vein occlusion) is NOT a contraindication. The 'early worsening phenomenon' is specific to diabetic retinopathy and rapid HbA1c changes.", note: "GLP-1s have no direct retinal toxicity. Risk is metabolic (rapid glucose normalisation), not pharmacological." },
        { cat: "Other", name: "Hypertensive Retinopathy", status: "prescribe", desc: "Ok to prescribe. Not related to the diabetic retinopathy early worsening mechanism." },
        { cat: "Other", name: "Toxoplasma Chorioretinitis", status: "prescribe", desc: "Safe to prescribe. This is an ocular infection, not related to diabetes or GLP-1 mechanisms. GLP-1s are not immunosuppressive and do not increase reactivation risk.", note: "If active infection currently being treated, consider waiting until resolved as clinical prudence." },
        { cat: "Other", name: "HIV", status: "escalate", desc: "If patient stable, no acute complications or advanced disease, okay to prescribe. Patient to inform specialist; clinic letter helpful." },
        { cat: "Other", name: "New Mothers (not breastfeeding)", status: "prescribe", desc: "Remind pt of nausea SE & advise use of contraception. Otherwise, safe to prescribe." },
        { cat: "Other", name: "Planning to Conceive", status: "follow_sop", desc: "See SOP." },
        { cat: "Other", name: "Autoimmune Disorder (Lupus, RA)", status: "escalate", desc: "Gather more info incl recent bloods. If under specialist, letter of support beneficial. Likely safe if stable for 6m and not on steroids/NTI meds." },
        { cat: "Other", name: "Anaemia", status: "escalate", desc: "Depends on cause — if not malignant, being treated, and not symptomatic, safe to prescribe." },
        { cat: "Other", name: "G6PD Deficiency", status: "prescribe", desc: "Ok to prescribe." },
        { cat: "Other", name: "DMARDs for Rheumatology", status: "escalate", desc: "If condition stable and rheumatology team aware, should be OK. Recent clinic letter from specialist recommended." },
        { cat: "Other", name: "Antiemetics", status: "escalate", desc: "More info needed. If taking for GLP1 side effects — check if dose needs adjusting or change in GLP1 medication." },
        { cat: "Other", name: "Medicines (diuretics, ACEi, NSAIDs)", status: "prescribe", desc: "Safe to prescribe, remind pt of importance of remaining hydrated." },
        { cat: "Other", name: "Oral Steroids", status: "prescribe", desc: "Oral steroids are not a contraindication to GLPs. Do not hold order." }
      ]
    }
  ]
};

function injectContraModal() {
  // If a previous injection survived, leave it alone.
  if (document.getElementById("mg-contra-tab") && document.getElementById("mg-contra-panel")) return;
  // Otherwise tear down any stale fragments so we re-inject atomically and
  // don't accumulate duplicate <style> nodes or stranded launchers/panels.
  ["mg-contra-styles", "mg-contra-tab", "mg-contra-panel"].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  if (window.__mgContraKeydown) {
    try { window.removeEventListener("keydown", window.__mgContraKeydown); } catch (_) {}
    window.__mgContraKeydown = null;
  }
  if (window.__mgContraOutsideClick) {
    try { document.removeEventListener("mousedown", window.__mgContraOutsideClick, true); } catch (_) {}
    window.__mgContraOutsideClick = null;
  }

  const style = document.createElement("style");
  style.id = "mg-contra-styles";
  style.textContent = `
    #mg-contra-tab {
      position: fixed !important; left: 20px !important; bottom: 74px !important;
      background: #dc2626 !important; color: #fff !important;
      padding: 12px 18px 12px 16px !important;
      border-radius: 999px !important;
      cursor: pointer !important; z-index: 2147483000 !important;
      font: 700 14px/1 Inter, "Segoe UI", Arial, Helvetica, sans-serif !important;
      box-shadow: 0 8px 20px rgba(220,38,38,0.35), 0 2px 6px rgba(0,0,0,0.15) !important;
      letter-spacing: 0.01em !important; user-select: none !important;
      border: none !important; outline: none !important;
      display: inline-flex !important; align-items: center !important; gap: 8px !important;
      transition: transform .15s ease, background .15s ease, box-shadow .15s ease !important;
      margin: 0 !important;
    }
    #mg-contra-tab:hover { background: #b91c1c !important; transform: translateY(-1px); }
    #mg-contra-tab svg { width: 18px; height: 18px; }

    #mg-contra-panel {
      position: fixed !important; left: 20px !important; bottom: 132px !important;
      width: 1100px !important; max-width: calc(100vw - 40px) !important;
      height: 760px !important; max-height: calc(100vh - 160px) !important;
      background: #0f172a !important; color: #e2e8f0 !important;
      border-radius: 14px !important; border: 1px solid #1e293b !important;
      box-shadow: 0 24px 60px rgba(0,0,0,0.55) !important;
      overflow: hidden !important; display: flex !important; flex-direction: column !important;
      transform: translateY(20px) scale(.98); opacity: 0;
      pointer-events: none; transition: all .22s ease;
      z-index: 2147483000 !important;
      font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif !important;
    }
    #mg-contra-panel.open { transform: translateY(0) scale(1); opacity: 1; pointer-events: auto; }
    body.swal2-shown #mg-contra-panel,
    body.swal2-shown #mg-contra-tab { display: none !important; }

    /* ── Header (colour driven by --mg-accent / --mg-accent-dark) ── */
    #mg-contra-panel {
      --mg-accent: #ef4444;
      --mg-accent-dark: #dc2626;
      --mg-accent-border: #b91c1c;
      --mg-accent-shadow: rgba(220,38,38,0.35);
    }
    #mg-contra-panel .mg-header {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 18px;
      background: linear-gradient(90deg, var(--mg-accent), var(--mg-accent-dark));
      color: #fff; border-bottom: 1px solid var(--mg-accent-border);
    }
    #mg-contra-panel .mg-header .mg-logo {
      width: 38px; height: 38px; border-radius: 9px;
      background: rgba(255,255,255,0.18); display: grid; place-items: center;
      font-size: 18px;
    }
    #mg-contra-panel .mg-header .mg-titles { flex: 1; min-width: 0; }
    #mg-contra-panel .mg-header .mg-title { font-weight: 800; font-size: 16px; line-height: 1.2; }
    #mg-contra-panel .mg-header .mg-subtitle { font-size: 11.5px; opacity: 0.9; margin-top: 2px; }
    #mg-contra-close {
      background: rgba(255,255,255,0.18); border: none; color: #fff;
      width: 28px; height: 28px; border-radius: 50%;
      cursor: pointer; font-size: 14px; line-height: 1;
      display: grid; place-items: center;
    }
    #mg-contra-close:hover { background: rgba(255,255,255,0.32); }

    /* ── Top tabs ── */
    #mg-top-tabs {
      display: flex; flex-wrap: wrap; gap: 8px;
      padding: 12px 14px 4px;
      background: #0f172a;
    }
    #mg-top-tabs .mg-top-tab {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: 10px;
      background: #1e293b; color: #cbd5e1; border: 1px solid #334155;
      font-size: 12.5px; font-weight: 600; cursor: pointer;
      transition: all .15s ease;
    }
    #mg-top-tabs .mg-top-tab:hover { background: #283548; color: #fff; }
    #mg-top-tabs .mg-top-tab.active {
      background: linear-gradient(180deg, var(--mg-accent), var(--mg-accent-dark));
      color: #fff; border-color: var(--mg-accent-border);
      box-shadow: 0 4px 12px var(--mg-accent-shadow);
    }

    /* ── Search ── */
    #mg-contra-search-wrap {
      padding: 10px 14px 8px; background: #0f172a;
    }
    #mg-contra-search {
      width: 100%; box-sizing: border-box;
      padding: 10px 12px 10px 36px; border-radius: 10px;
      background: #1e293b url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='8'/><path d='m21 21-4.3-4.3'/></svg>") no-repeat 12px center;
      border: 1px solid #334155; color: #f1f5f9;
      font-size: 13px; font-family: inherit; outline: none;
    }
    #mg-contra-search::placeholder { color: #64748b; }
    #mg-contra-search:focus { border-color: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,0.15); }

    /* ── Sub tabs ── */
    #mg-sub-tabs {
      display: flex; flex-wrap: wrap; gap: 8px;
      padding: 0 14px 12px;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
    }
    #mg-sub-tabs .mg-sub-tab {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 12px; border-radius: 9px;
      background: #1e293b; color: #cbd5e1; border: 1px solid #334155;
      font-size: 12px; font-weight: 600; cursor: pointer;
      transition: all .15s ease;
    }
    #mg-sub-tabs .mg-sub-tab:hover { background: #283548; color: #fff; }
    #mg-sub-tabs .mg-sub-tab.active {
      background: linear-gradient(180deg, var(--mg-accent), var(--mg-accent-dark));
      color: #fff; border-color: var(--mg-accent-border);
      box-shadow: 0 4px 10px var(--mg-accent-shadow);
    }
    #mg-sub-tabs .mg-sub-tab.hidden { display: none; }

    /* ── Content panel ── */
    #mg-contra-content {
      flex: 1; overflow-y: auto; padding: 18px 18px 22px;
      background: #0b1220;
    }
    #mg-contra-content::-webkit-scrollbar { width: 8px; }
    #mg-contra-content::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 4px; }

    .mg-detail-head {
      display: flex; align-items: center; gap: 12px; margin-bottom: 14px;
    }
    .mg-detail-icon {
      width: 44px; height: 44px; border-radius: 10px;
      background: #1e1b29; border: 1px solid #312e44;
      display: grid; place-items: center; font-size: 20px;
      flex-shrink: 0;
    }
    .mg-detail-titlewrap { flex: 1; min-width: 0; }
    .mg-detail-title {
      font-size: 16px; font-weight: 700; color: #f1f5f9;
      padding-bottom: 4px;
      border-bottom: 2px solid #3b82f6;
      display: inline-block;
    }

    .mg-action-row {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      margin: 4px 0 16px;
    }
    .mg-reject-btn {
      display: inline-block;
      padding: 10px 22px; border-radius: 8px;
      background: linear-gradient(180deg, #ef4444, #dc2626);
      color: #fff; font-weight: 800; font-size: 13px;
      letter-spacing: 0.04em; text-transform: uppercase;
      border: none; box-shadow: 0 4px 12px rgba(220,38,38,0.4);
      cursor: default;
    }
    .mg-action-note {
      display: inline-block;
      padding: 7px 12px; border-radius: 6px;
      background: rgba(239,68,68,0.16); color: #fca5a5;
      border: 1px solid rgba(239,68,68,0.35);
      font-size: 11.5px; font-weight: 700;
    }
    /* Action button variants */
    .mg-reject-btn.hold {
      background: linear-gradient(180deg, #fbbf24, #f59e0b);
      box-shadow: 0 4px 12px rgba(245,158,11,0.4);
    }
    .mg-reject-btn.info {
      background: linear-gradient(180deg, #8b5cf6, #7c3aed);
      box-shadow: 0 4px 12px rgba(124,58,237,0.4);
      text-transform: none; letter-spacing: 0.01em;
      font-size: 12.5px; padding: 12px 22px;
    }
    .mg-action-row .mg-action-note.neutral {
      background: rgba(148,163,184,0.16); color: #cbd5e1;
      border: 1px solid rgba(148,163,184,0.35);
    }
    .mg-action-row .mg-action-note.warn {
      background: rgba(245,158,11,0.16); color: #fcd34d;
      border: 1px solid rgba(245,158,11,0.45);
    }

    /* Exclusion warning callout (red border, used on Cancer tab) */
    .mg-exclusion {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 12px 14px; margin: 10px 0 14px;
      border: 1px solid rgba(220,38,38,0.5);
      background: rgba(127,29,29,0.22);
      border-radius: 8px; color: #fecaca;
      font-size: 13px;
    }
    .mg-exclusion .mg-exclusion-label {
      font-weight: 800; color: #fca5a5; flex-shrink: 0;
    }
    .mg-exclusion .mg-exclusion-body { color: #fee2e2; }

    /* Special Consideration callout (amber, with custom label) */
    .mg-callout.special {
      border-left-color: #f59e0b;
      background: rgba(120,53,15,0.22);
    }
    .mg-callout.special .mg-callout-label { color: #fcd34d; }

    /* Bulleted lists inside REJECT if / PRESCRIBE if decision boxes */
    .mg-decision-body ul { list-style: none; padding: 0; margin: 0; }
    .mg-decision-body li {
      position: relative; padding: 3px 0 3px 14px;
      line-height: 1.5;
    }
    .mg-decision-body li::before {
      content: ""; position: absolute; left: 0; top: 11px;
      width: 4px; height: 4px; border-radius: 50%;
    }
    .mg-decision.reject .mg-decision-body li::before    { background: #f87171; }
    .mg-decision.prescribe .mg-decision-body li::before { background: #4ade80; }

    /* ── Knowledge Base list view ── */
    .mg-cond-count {
      color: #94a3b8; font-size: 12px; padding: 6px 2px 10px;
    }
    .mg-cond-count strong { color: #e2e8f0; }
    .mg-cat-header {
      display: inline-block; padding: 5px 12px; border-radius: 6px;
      background: rgba(16,185,129,0.18); color: #34d399;
      font-weight: 800; font-size: 11px; letter-spacing: 0.08em;
      text-transform: uppercase; margin: 16px 0 8px;
      border-left: 3px solid #10b981;
    }
    .mg-cat-header.first { margin-top: 4px; }
    .mg-cond-row {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px; margin: 6px 0;
      background: rgba(15,23,42,0.55);
      border: 1px solid rgba(148,163,184,0.18);
      border-radius: 10px;
    }
    .mg-cond-body { flex: 1; min-width: 0; }
    .mg-cond-name {
      font-weight: 700; color: #f1f5f9; font-size: 13.5px;
      margin-bottom: 4px;
    }
    .mg-cond-desc {
      color: #cbd5e1; font-size: 12.5px; line-height: 1.5;
    }
    .mg-cond-note {
      color: #94a3b8; font-size: 11.5px; line-height: 1.5;
      margin-top: 6px; padding: 6px 10px;
      background: rgba(30,41,59,0.7); border-radius: 6px;
      border-left: 2px solid rgba(148,163,184,0.4);
    }
    .mg-cond-status {
      flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px;
      padding: 9px 14px; border-radius: 8px;
      font-weight: 800; font-size: 11.5px;
      letter-spacing: 0.06em; text-transform: uppercase;
      white-space: nowrap; color: #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    }
    .mg-cond-status.reject    { background: linear-gradient(180deg, #ef4444, #dc2626); }
    .mg-cond-status.sop       { background: linear-gradient(180deg, #8b5cf6, #7c3aed); }
    .mg-cond-status.escalate  { background: linear-gradient(180deg, #f97316, #ea580c); }
    .mg-cond-status.prescribe { background: linear-gradient(180deg, #22c55e, #16a34a); }
    .mg-cond-hl {
      background: rgba(250,204,21,0.35); color: #fef9c3;
      padding: 0 2px; border-radius: 2px; font-weight: 700;
    }

    /* Global search results — when a query is typed we search across ALL
       5 top tabs and show every match grouped by tab. Rows are clickable
       and navigate to the source tab/sub. */
    .mg-gs-section { margin: 0 0 16px; }
    .mg-gs-section-header {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; margin: 0 0 8px;
      border-radius: 8px;
      background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0));
      border-left: 3px solid var(--mg-gs-accent, #64748b);
      color: #e2e8f0; font-size: 12px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .mg-gs-section-icon { font-size: 16px; }
    .mg-gs-section-label { flex: 1; }
    .mg-gs-section-count {
      background: var(--mg-gs-accent, #64748b);
      color: #fff; padding: 2px 9px; border-radius: 999px;
      font-size: 11px; font-weight: 800;
    }
    .mg-gs-row {
      display: flex; align-items: flex-start; gap: 10px;
      width: 100%; text-align: left;
      padding: 10px 12px; margin: 0 0 6px;
      background: #0f172a; border: 1px solid #1e293b; border-radius: 8px;
      color: #e2e8f0; cursor: pointer; font: inherit;
      transition: background 0.15s, border-color 0.15s, transform 0.05s;
    }
    .mg-gs-row:hover {
      background: #162033; border-color: var(--mg-gs-accent, #334155);
    }
    .mg-gs-row:active { transform: scale(0.995); }
    .mg-gs-row-icon { font-size: 18px; line-height: 1.2; flex-shrink: 0; }
    .mg-gs-row-body { flex: 1; min-width: 0; }
    .mg-gs-row-name {
      font-weight: 700; font-size: 13.5px; color: #f8fafc;
      margin-bottom: 3px;
    }
    .mg-gs-row-snip {
      font-size: 12px; color: #94a3b8; line-height: 1.45;
      overflow: hidden; text-overflow: ellipsis;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }

    /* Decision callouts (REJECT if / PRESCRIBE if) */
    .mg-decision {
      padding: 12px 14px; margin: 10px 0; border-radius: 8px;
      border: 1px solid; font-size: 13px;
    }
    .mg-decision .mg-decision-label {
      font-weight: 800; font-size: 12px; text-transform: uppercase;
      letter-spacing: 0.04em; margin-bottom: 6px; display: block;
    }
    .mg-decision .mg-decision-body { color: #e2e8f0; }
    .mg-decision.reject {
      background: rgba(127,29,29,0.28); border-color: rgba(220,38,38,0.5);
    }
    .mg-decision.reject .mg-decision-label { color: #fca5a5; }
    .mg-decision.prescribe {
      background: rgba(6,78,59,0.28); border-color: rgba(34,197,94,0.5);
    }
    .mg-decision.prescribe .mg-decision-label { color: #4ade80; }

    /* Question to ask callout (purple) */
    .mg-callout.question {
      border-left-color: #a855f7;
    }
    .mg-callout.question .mg-callout-label { color: #c084fc; }
    .mg-callout.question .mg-callout-body { font-style: italic; color: #e2e8f0; }

    .mg-section-divider {
      border-top: 1px solid #1e293b; margin: 4px 0 14px;
    }
    .mg-section-label {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 800; color: #ef4444;
      letter-spacing: 0.06em; text-transform: uppercase;
      margin: 4px 0 10px;
    }
    .mg-section-label.neutral { color: #94a3b8; }
    .mg-section-label.info { color: #60a5fa; }

    .mg-subgroup-label {
      color: #f87171; font-weight: 700; font-size: 12px;
      margin: 12px 0 6px; letter-spacing: 0.02em;
    }
    .mg-macro-pill {
      display: inline-block;
      padding: 4px 11px; border-radius: 999px;
      background: rgba(59,130,246,0.18); color: #93c5fd;
      border: 1px solid rgba(59,130,246,0.45);
      font-size: 11.5px; font-weight: 700; font-family: inherit;
      cursor: default; margin-left: 4px;
    }

    .mg-condition-row {
      display: flex; align-items: center; gap: 10px;
      padding: 11px 14px; margin-bottom: 6px;
      background: #111c30; border: 1px solid #1e293b;
      border-radius: 8px; font-size: 13px; color: #e2e8f0;
    }
    .mg-condition-row::before {
      content: ""; width: 6px; height: 6px; border-radius: 50%;
      background: #ef4444; flex-shrink: 0;
    }

    .mg-callout {
      display: flex; gap: 10px; align-items: flex-start;
      padding: 10px 14px; margin-top: 12px;
      background: #131c33; border-radius: 8px;
      border-left: 3px solid #f59e0b;
      font-size: 13px; color: #e2e8f0;
    }
    .mg-callout.info  { border-left-color: #3b82f6; }
    .mg-callout.safe  { border-left-color: #22c55e; background: #0f2a1d; }
    .mg-callout .mg-callout-label { font-weight: 700; color: #f59e0b; flex-shrink: 0; }
    .mg-callout.info  .mg-callout-label { color: #60a5fa; }
    .mg-callout.safe  .mg-callout-label { color: #4ade80; }
    .mg-callout .mg-callout-body { flex: 1; color: #cbd5e1; }

    .mg-section-group {
      background: linear-gradient(90deg, #2a1018, #1a0f1a);
      color: #fca5a5; font-weight: 700; font-size: 11.5px;
      letter-spacing: 0.06em; text-transform: uppercase;
      padding: 8px 12px; margin: 14px 0 6px;
      border-radius: 6px; border: 1px solid #3f1d1d;
    }
    .mg-section-group:first-child { margin-top: 0; }
    .mg-section-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
    }
    @media (max-width: 600px) {
      .mg-section-grid { grid-template-columns: 1fr; }
    }
    .mg-empty {
      padding: 24px; text-align: center; color: #64748b; font-size: 13px;
    }
  `;
  document.head.appendChild(style);

  // Floating launcher pill (red, bottom-left)
  const tab = document.createElement("button");
  tab.id = "mg-contra-tab";
  tab.type = "button";
  tab.setAttribute("aria-label", "Open contraindications reference");
  tab.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>
    </svg>
    Contraindications`;
  document.body.appendChild(tab);

  // Modal shell
  const panel = document.createElement("div");
  panel.id = "mg-contra-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = `
    <div class="mg-header">
      <div class="mg-logo">⛔</div>
      <div class="mg-titles">
        <div class="mg-title">Contraindications Reference</div>
        <div class="mg-subtitle">SCR Checks • Clinical Decision Support</div>
      </div>
      <button id="mg-contra-close" aria-label="Close">✕</button>
    </div>
    <div id="mg-top-tabs"></div>
    <div id="mg-contra-search-wrap">
      <input id="mg-contra-search" type="text" placeholder="🔍  Search conditions, medications, keywords…" />
    </div>
    <div id="mg-sub-tabs"></div>
    <div id="mg-contra-content"></div>
  `;
  document.body.appendChild(panel);

  const topTabsEl = panel.querySelector("#mg-top-tabs");
  const subTabsEl = panel.querySelector("#mg-sub-tabs");
  const contentEl = panel.querySelector("#mg-contra-content");
  const searchEl  = panel.querySelector("#mg-contra-search");
  const closeBtn  = panel.querySelector("#mg-contra-close");

  let activeTopId = MG_CONTRA_DATA.topTabs[0].id;
  let activeSubId = MG_CONTRA_DATA.topTabs[0].subTabs?.[0]?.id || null;
  // List-view tabs (Knowledge Base) have a separate "active category"
  // pill state instead of a sub-tab id.
  let activeCategory = "All";
  // searchScope controls how a non-empty query is rendered:
  //   • "global" (default whenever the user types) → renderGlobalSearch
  //     scans all 5 top tabs and lists every match.
  //   • "local"  → renderContent uses the active tab's normal renderer
  //     (list view or detail view) while the query is still applied so
  //     matches stay highlighted. Set when the user clicks a global
  //     result for a list-view (Knowledge) tab; reset to "global" the
  //     moment the user touches the search box again.
  let searchScope = "global";

  // Status badges for the Knowledge Base list view.
  const STATUS_META = {
    reject:     { label: "REJECT",     icon: "⛔", cls: "reject" },
    follow_sop: { label: "FOLLOW SOP", icon: "📋", cls: "sop" },
    escalate:   { label: "ESCALATE",   icon: "⚠️", cls: "escalate" },
    prescribe:  { label: "PRESCRIBE",  icon: "✅", cls: "prescribe" }
  };

  // ── Renderers ──
  function getTop(id) { return MG_CONTRA_DATA.topTabs.find(t => t.id === id); }
  function getSub(top, id) { return top.subTabs.find(s => s.id === id); }

  function applyAccent(top) {
    // Each top category has its own theme colour that drives the header,
    // the active tab pills and the active sub-tab pills via CSS variables.
    if (top.color)        panel.style.setProperty("--mg-accent",        top.color);
    if (top.colorDark)    panel.style.setProperty("--mg-accent-dark",   top.colorDark);
    if (top.colorBorder)  panel.style.setProperty("--mg-accent-border", top.colorBorder);
    if (top.colorShadow)  panel.style.setProperty("--mg-accent-shadow", top.colorShadow);
  }

  function renderTopTabs() {
    topTabsEl.innerHTML = "";
    MG_CONTRA_DATA.topTabs.forEach(t => {
      const b = document.createElement("button");
      b.className = "mg-top-tab" + (t.id === activeTopId ? " active" : "");
      b.type = "button";
      b.innerHTML = `<span>${t.icon}</span><span>${t.label}</span>`;
      b.addEventListener("click", () => {
        activeTopId = t.id;
        // List-view tabs (no subTabs) keep activeSubId null.
        activeSubId = t.subTabs?.[0]?.id || null;
        // Reset the list-view category filter when switching tabs so users
        // always land on the full list of conditions.
        activeCategory = "All";
        applyAccent(t);
        renderTopTabs();
        renderSubTabs();
        renderContent();
      });
      topTabsEl.appendChild(b);
    });
    applyAccent(getTop(activeTopId));
  }

  // Build the full searchable text for a sub-tab. Returns the original
  // (un-lowercased) string so callers can both substring-match AND extract
  // a readable snippet around the match for the global-search results.
  function buildSubHaystack(sub) {
    let ifNeededText = "";
    if (typeof sub.ifNeeded === "string") {
      ifNeededText = sub.ifNeeded;
    } else if (sub.ifNeeded && typeof sub.ifNeeded === "object") {
      ifNeededText = [sub.ifNeeded.label, sub.ifNeeded.macro].filter(Boolean).join(" ");
    }
    const sectionsText = (sub.sections || []).map(s => {
      const parts = [s.title];
      if (Array.isArray(s.items)) parts.push(s.items.join(" • "));
      if (Array.isArray(s.subSections)) {
        s.subSections.forEach(ss => {
          parts.push(ss.title || "");
          if (Array.isArray(ss.items)) parts.push(ss.items.join(" • "));
        });
      }
      return parts.filter(Boolean).join(" • ");
    }).filter(Boolean).join(" • ");
    const flat = (v) => Array.isArray(v) ? v.join(" • ") : (v || "");
    const sc = sub.specialConsideration;
    return [
      sub.label,
      sub.title || "",
      sub.action || "",
      sub.actionNote || "",
      sub.safeIf || "",
      sub.alsoKnownAs || "",
      sub.rationale || "",
      sub.note || "",
      sub.exclusion || "",
      sc ? `${sc.label || ""}: ${sc.body || ""}` : "",
      ifNeededText,
      sub.questionToAsk || "",
      flat(sub.rejectIf),
      flat(sub.prescribeIf),
      (sub.conditions || []).join(" • "),
      sub.conditionsLabel || "",
      sectionsText
    ].filter(Boolean).join(" • ");
  }

  function subMatchesSearch(sub, q) {
    if (!q) return true;
    return buildSubHaystack(sub).toLowerCase().includes(q);
  }

  // Module-level highlight helper — escapes HTML on the haystack, escapes
  // the query for safe regex insertion, then wraps each case-insensitive
  // match in a .mg-cond-hl span. Used by both the Knowledge Base list and
  // the cross-tab global search results.
  function mgHighlight(text, q, qRaw) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    const safeQ = escapeHtml(qRaw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!safeQ) return safe;
    const re = new RegExp(safeQ, "gi");
    return safe.replace(re, m => `<span class="mg-cond-hl">${m}</span>`);
  }

  // Pull a short snippet around the first match in a longer haystack so
  // global-search rows can show *why* they matched. Returns highlighted
  // HTML, already HTML-safe.
  function makeSnippet(text, q, qRaw, radius) {
    if (!text) return "";
    const r = radius || 60;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) {
      const slice = text.length > r * 2 ? text.slice(0, r * 2) + "…" : text;
      return escapeHtml(slice);
    }
    const start = Math.max(0, idx - r);
    const end = Math.min(text.length, idx + q.length + r * 1.5);
    const slice = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
    return mgHighlight(slice, q, qRaw);
  }

  function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  function isGlobalSearchActive() {
    return searchScope === "global" && (searchEl.value || "").trim().length > 0;
  }

  function renderSubTabs() {
    subTabsEl.innerHTML = "";
    // Global search mode: hide sub-tab pills entirely — the results panel
    // below shows every match across all 5 top tabs, each as a clickable
    // row, so a sub-tab strip would be redundant and misleading.
    if (isGlobalSearchActive()) return;

    const top = getTop(activeTopId);

    // List-view tabs (Knowledge Base): render category filter pills
    // instead of icon sub-tabs. The pills filter the list but do NOT
    // hide themselves on search — users still need to pick a scope.
    if (top.view === "list") {
      const pills = ["All", ...(top.categories || [])];
      pills.forEach(cat => {
        const b = document.createElement("button");
        b.className = "mg-sub-tab" + (cat === activeCategory ? " active" : "");
        b.type = "button";
        b.innerHTML = `<span>${escapeHtml(cat)}</span>`;
        b.addEventListener("click", () => {
          activeCategory = cat;
          renderSubTabs();
          renderContent();
        });
        subTabsEl.appendChild(b);
      });
      return;
    }

    const q = (searchEl.value || "").trim().toLowerCase();
    let firstVisible = null;
    top.subTabs.forEach(s => {
      const matches = subMatchesSearch(s, q);
      const b = document.createElement("button");
      b.className = "mg-sub-tab" + (s.id === activeSubId ? " active" : "") + (matches ? "" : " hidden");
      b.type = "button";
      b.innerHTML = `<span>${s.icon}</span><span>${s.label}</span>`;
      b.addEventListener("click", () => {
        activeSubId = s.id;
        renderSubTabs();
        renderContent();
      });
      subTabsEl.appendChild(b);
      if (matches && firstVisible === null) firstVisible = s.id;
    });
    // Reconcile activeSubId with the filtered view:
    //   • If a query is active and the current sub is hidden, jump to the first
    //     visible match (if any) or clear selection so the content panel shows
    //     an empty-state message rather than stale content.
    //   • Guard against infinite recursion: only re-render when the selection
    //     actually changes. Without this guard, a query that matches nothing
    //     would loop forever (firstVisible=null → activeSubId=null → next
    //     pass still has no match → recurse).
    if (q) {
      const currentSub = getSub(top, activeSubId);
      if ((!currentSub || !subMatchesSearch(currentSub, q)) && activeSubId !== firstVisible) {
        activeSubId = firstVisible;
        renderSubTabs();
        renderContent();
      }
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  function renderContent() {
    // Global cross-tab search takes precedence — when the user types,
    // they want ALL matches everywhere, not just inside the active tab.
    if (isGlobalSearchActive()) {
      renderGlobalSearch();
      return;
    }

    const top = getTop(activeTopId);

    // ── List-view path (Knowledge Base) ──
    if (top.view === "list") {
      renderListContent(top);
      return;
    }

    const sub = activeSubId ? getSub(top, activeSubId) : null;
    if (!sub) {
      const q = (searchEl.value || "").trim();
      const msg = q
        ? `No matches for "${escapeHtml(q)}" in <strong>${escapeHtml(top.label)}</strong>. Try a different search term or another category.`
        : "No content available.";
      contentEl.innerHTML = `<div class="mg-empty">${msg}</div>`;
      return;
    }

    // Action row: big REJECT (or other action) button + optional small
    // qualifier badge such as "if <12 months post-surgery".
    // actionStyle controls button colour: "reject" red (default) | "hold" orange | "info" purple.
    // Whitelist the value before injecting into a class string.
    const ALLOWED_ACTION_STYLES = ["reject", "hold", "info"];
    const actionStyle = ALLOWED_ACTION_STYLES.includes(sub.actionStyle) ? sub.actionStyle : "reject";
    const actionStyleCls = actionStyle === "reject" ? "" : ` ${actionStyle}`;
    // actionNoteStyle: "" (red default) | "warn" amber | "neutral" grey
    const ALLOWED_NOTE_STYLES = ["warn", "neutral"];
    const actionNoteCls = ALLOWED_NOTE_STYLES.includes(sub.actionNoteStyle) ? ` ${sub.actionNoteStyle}` : "";
    const actionNoteHtmlStyled = sub.actionNote
      ? ` <span class="mg-action-note${actionNoteCls}">${escapeHtml(sub.actionNote)}</span>`
      : "";
    // Title can override the sub.label for the detail heading (e.g. full
    // clinical name "Cholelithiasis (Gallstones) or Cholecystitis").
    const headTitle = sub.title || sub.label;

    // Tabs that are purely informational (e.g. Cancer) may omit the action
    // button entirely — only render the action row when there is something
    // to show.
    const actionRowHtml = (sub.action || sub.actionNote)
      ? `
        <div class="mg-action-row">
          ${sub.action ? `<button class="mg-reject-btn${actionStyleCls}" type="button" disabled>${escapeHtml(sub.action)}</button>` : ""}${actionNoteHtmlStyled}
        </div>
        <div class="mg-section-divider"></div>
      `
      : "";

    let body = `
      <div class="mg-detail-head">
        <div class="mg-detail-icon">${sub.icon || "•"}</div>
        <div class="mg-detail-titlewrap">
          <div class="mg-detail-title">${escapeHtml(headTitle)}</div>
        </div>
      </div>
      ${actionRowHtml}
    `;

    // Exclusion warning (red box) — e.g. "Medullary thyroid cancer and MEN2
    // are absolute contraindications" on the Cancer tab.
    if (sub.exclusion) {
      body += `
        <div class="mg-exclusion">
          <div class="mg-exclusion-label">⚠ Exclusion:</div>
          <div class="mg-exclusion-body">${escapeHtml(sub.exclusion)}</div>
        </div>
      `;
    }

    // Question to ask the patient (purple, italic body)
    if (sub.questionToAsk) {
      body += `
        <div class="mg-callout question">
          <div class="mg-callout-label">❓ Question to ask:</div>
          <div class="mg-callout-body">"${escapeHtml(sub.questionToAsk)}"</div>
        </div>
      `;
    }
    // Special Consideration callout (amber) — used for nuanced cases like
    // breast cancer that need clarification rather than auto-rejection.
    if (sub.specialConsideration) {
      const sc = sub.specialConsideration;
      body += `
        <div class="mg-callout special">
          <div class="mg-callout-label">${escapeHtml(sc.label || "Special Consideration")}</div>
          <div class="mg-callout-body">${escapeHtml(sc.body || "")}</div>
        </div>
      `;
    }
    // REJECT if / PRESCRIBE if decision callouts. Body may be a plain
    // string OR an array of strings (rendered as a bulleted list).
    const renderDecisionBody = (v) => {
      if (Array.isArray(v)) {
        return `<ul>${v.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`;
      }
      return escapeHtml(v);
    };
    if (sub.rejectIf) {
      body += `
        <div class="mg-decision reject">
          <span class="mg-decision-label">REJECT if:</span>
          <div class="mg-decision-body">${renderDecisionBody(sub.rejectIf)}</div>
        </div>
      `;
    }
    if (sub.prescribeIf) {
      body += `
        <div class="mg-decision prescribe">
          <span class="mg-decision-label">PRESCRIBE if:</span>
          <div class="mg-decision-body">${renderDecisionBody(sub.prescribeIf)}</div>
        </div>
      `;
    }

    if (sub.alsoKnownAs) {
      body += `
        <div class="mg-callout info">
          <div class="mg-callout-label">📘 Also known as:</div>
          <div class="mg-callout-body">${escapeHtml(sub.alsoKnownAs)}</div>
        </div>
      `;
    }

    // Green "Safe to Prescribe" callout (shown before conditions so it reads
    // like an early reassurance, matching the reference screenshots).
    if (sub.safeIf) {
      body += `
        <div class="mg-callout safe">
          <div class="mg-callout-label">✓ Safe to Prescribe:</div>
          <div class="mg-callout-body">${escapeHtml(sub.safeIf)}</div>
        </div>
      `;
    }

    if (Array.isArray(sub.conditions) && sub.conditions.length) {
      const label = sub.conditionsLabel || "Conditions:";
      const labelStyle = sub.conditionsLabelStyle || "warn"; // "warn" | "info" | "neutral"
      const labelCls = labelStyle === "warn" ? "" : ` ${labelStyle}`;
      const icon = labelStyle === "warn" ? "⚠ " : "";
      body += `<div class="mg-section-label${labelCls}">${icon}${escapeHtml(label)}</div>`;
      sub.conditions.forEach(c => {
        body += `<div class="mg-condition-row">${escapeHtml(c)}</div>`;
      });
    }

    if (Array.isArray(sub.sections) && sub.sections.length) {
      sub.sections.forEach(sec => {
        body += `<div class="mg-section-group">${escapeHtml(sec.title)}</div>`;
        if (Array.isArray(sec.subSections) && sec.subSections.length) {
          // Nested groups — e.g. Sulfonylureas / DPP-4 inhibitors under
          // "ORAL DIABETIC MEDICATIONS:".
          sec.subSections.forEach(sub2 => {
            body += `<div class="mg-subgroup-label">${escapeHtml(sub2.title)}</div>`;
            body += `<div class="mg-section-grid">`;
            (sub2.items || []).forEach(it => {
              body += `<div class="mg-condition-row">${escapeHtml(it)}</div>`;
            });
            body += `</div>`;
          });
        } else if (Array.isArray(sec.items)) {
          body += `<div class="mg-section-grid">`;
          sec.items.forEach(it => {
            body += `<div class="mg-condition-row">${escapeHtml(it)}</div>`;
          });
          body += `</div>`;
        }
      });
    }

    if (sub.rationale) {
      body += `
        <div class="mg-callout">
          <div class="mg-callout-label">Rationale:</div>
          <div class="mg-callout-body">${escapeHtml(sub.rationale)}</div>
        </div>
      `;
    }
    if (sub.ifNeeded) {
      // ifNeeded may be a plain string OR { label, macro } where macro is
      // shown as a pill button next to the label.
      const isObj = typeof sub.ifNeeded === "object" && sub.ifNeeded !== null;
      const ifLabel = isObj ? (sub.ifNeeded.label || "If needed:") : "If needed:";
      const ifBody  = isObj
        ? (sub.ifNeeded.macro ? `<button type="button" class="mg-macro-pill" disabled>${escapeHtml(sub.ifNeeded.macro)}</button>` : "")
        : escapeHtml(sub.ifNeeded);
      body += `
        <div class="mg-callout info">
          <div class="mg-callout-label">${escapeHtml(ifLabel)}</div>
          <div class="mg-callout-body">${ifBody}</div>
        </div>
      `;
    }
    if (sub.note) {
      body += `
        <div class="mg-callout info">
          <div class="mg-callout-label">Note:</div>
          <div class="mg-callout-body">${escapeHtml(sub.note)}</div>
        </div>
      `;
    }

    contentEl.innerHTML = body;
    contentEl.scrollTop = 0;
  }

  // ── Knowledge Base list view renderer ──
  // Renders a grouped, searchable list of all conditions. Search is the
  // primary discovery tool: when a query is present we IGNORE the active
  // category pill so users see every possible match across all categories
  // — that's what the "very accurate, all possible matches" requirement
  // needs. Without a query, the active category pill scopes the list.
  function renderListContent(top) {
    const qRaw = (searchEl.value || "").trim();
    const q = qRaw.toLowerCase();
    const all = top.conditions || [];

    // Filter
    let conds;
    if (q) {
      // Search across every visible string for the condition so any
      // keyword — name, description, note, status label, category —
      // surfaces a hit.
      conds = all.filter(c => {
        const statusLabel = (STATUS_META[c.status] || {}).label || "";
        const hay = `${c.name} ${c.desc} ${c.note || ""} ${c.cat} ${statusLabel}`.toLowerCase();
        return hay.includes(q);
      });
    } else if (activeCategory !== "All") {
      conds = all.filter(c => c.cat === activeCategory);
    } else {
      conds = all.slice();
    }

    // Group by category in the order declared on the top tab so the
    // output is stable and readable.
    const groups = {};
    (top.categories || []).forEach(cat => { groups[cat] = []; });
    conds.forEach(c => {
      if (!groups[c.cat]) groups[c.cat] = [];
      groups[c.cat].push(c);
    });

    // Use the shared module-level highlight helper.
    const highlight = (text) => mgHighlight(text, q, qRaw);

    // Count line
    const total = all.length;
    const shown = conds.length;
    let html = "";
    if (q) {
      html += `<div class="mg-cond-count"><strong>${shown}</strong> of ${total} match "${escapeHtml(qRaw)}"</div>`;
    } else if (activeCategory !== "All") {
      html += `<div class="mg-cond-count"><strong>${shown}</strong> condition${shown === 1 ? "" : "s"} in ${escapeHtml(activeCategory)}</div>`;
    } else {
      html += `<div class="mg-cond-count">Showing <strong>${shown}</strong> conditions</div>`;
    }

    if (shown === 0) {
      // When a query is active we ignore the category filter on purpose,
      // so the "try a different category" hint would be misleading.
      const hint = q
        ? `No matches for "${escapeHtml(qRaw)}" across any category. Try a different keyword.`
        : `No conditions in ${escapeHtml(activeCategory)}.`;
      html += `<div class="mg-empty">${hint}</div>`;
      contentEl.innerHTML = html;
      contentEl.scrollTop = 0;
      return;
    }

    let first = true;
    (top.categories || []).forEach(cat => {
      const items = groups[cat] || [];
      if (!items.length) return;
      html += `<div class="mg-cat-header${first ? " first" : ""}">${escapeHtml(cat)}</div>`;
      first = false;
      items.forEach(c => {
        const meta = STATUS_META[c.status] || STATUS_META.escalate;
        html += `
          <div class="mg-cond-row">
            <div class="mg-cond-body">
              <div class="mg-cond-name">${highlight(c.name)}</div>
              <div class="mg-cond-desc">${highlight(c.desc)}</div>
              ${c.note ? `<div class="mg-cond-note">📝 ${highlight(c.note)}</div>` : ""}
            </div>
            <span class="mg-cond-status ${meta.cls}">${meta.icon} ${meta.label}</span>
          </div>
        `;
      });
    });

    contentEl.innerHTML = html;
    contentEl.scrollTop = 0;
  }

  // ── Cross-tab global search ──
  // When the user types anything in the search box, search EVERY top tab
  // (not just the active one) and show every match. This is what makes
  // "digoxin" findable even when you're sitting on the Absolute tab —
  // Digoxin lives inside the NTI Medications sub-tab of Time-Sensitive.
  // Results are grouped by source tab, each row is clickable and jumps
  // to the underlying sub-tab (or to Knowledge with the query still
  // applied so the matching condition stays highlighted).
  function renderGlobalSearch() {
    const qRaw = (searchEl.value || "").trim();
    const q = qRaw.toLowerCase();

    let totalMatches = 0;
    let html = "";

    MG_CONTRA_DATA.topTabs.forEach(top => {
      const accent = top.color || "#64748b";
      const matches = [];

      if (top.view === "list") {
        // Knowledge Base: each individual condition is a hit candidate.
        (top.conditions || []).forEach(c => {
          const statusLabel = (STATUS_META[c.status] || {}).label || "";
          const hay = `${c.name} • ${c.desc} • ${c.note || ""} • ${c.cat} • ${statusLabel}`;
          if (hay.toLowerCase().includes(q)) {
            matches.push({ kind: "cond", cond: c, hay });
          }
        });
      } else {
        // Detail tabs: each sub-tab is a hit candidate, snippet pulled
        // from its full searchable haystack so the user sees the field
        // that actually matched.
        (top.subTabs || []).forEach(s => {
          const hay = buildSubHaystack(s);
          if (hay.toLowerCase().includes(q)) {
            matches.push({ kind: "sub", sub: s, hay });
          }
        });
      }

      if (!matches.length) return;
      totalMatches += matches.length;

      html += `<div class="mg-gs-section" style="--mg-gs-accent: ${accent};">
        <div class="mg-gs-section-header">
          <span class="mg-gs-section-icon">${top.icon || ""}</span>
          <span class="mg-gs-section-label">${escapeHtml(top.label)}</span>
          <span class="mg-gs-section-count">${matches.length}</span>
        </div>`;

      matches.forEach(m => {
        if (m.kind === "cond") {
          const c = m.cond;
          const meta = STATUS_META[c.status] || STATUS_META.escalate;
          html += `<button class="mg-gs-row" type="button"
              data-top="${escapeAttr(top.id)}"
              data-cond="1">
            <div class="mg-gs-row-body">
              <div class="mg-gs-row-name">${mgHighlight(c.name, q, qRaw)}
                <span style="color:#64748b;font-weight:500;font-size:11.5px;margin-left:6px;">${escapeHtml(c.cat)}</span>
              </div>
              <div class="mg-gs-row-snip">${mgHighlight(c.desc, q, qRaw)}</div>
            </div>
            <span class="mg-cond-status ${meta.cls}" style="flex-shrink:0;">${meta.icon} ${meta.label}</span>
          </button>`;
        } else {
          const s = m.sub;
          const snippet = makeSnippet(m.hay, q, qRaw, 60);
          html += `<button class="mg-gs-row" type="button"
              data-top="${escapeAttr(top.id)}"
              data-sub="${escapeAttr(s.id)}">
            <div class="mg-gs-row-icon">${s.icon || "•"}</div>
            <div class="mg-gs-row-body">
              <div class="mg-gs-row-name">${mgHighlight(s.label || s.title || s.id, q, qRaw)}</div>
              ${snippet ? `<div class="mg-gs-row-snip">${snippet}</div>` : ""}
            </div>
          </button>`;
        }
      });

      html += `</div>`;
    });

    const header = totalMatches === 0
      ? `<div class="mg-cond-count"><strong>0</strong> matches for "${escapeHtml(qRaw)}" across all tabs</div>`
      : `<div class="mg-cond-count"><strong>${totalMatches}</strong> match${totalMatches === 1 ? "" : "es"} for "${escapeHtml(qRaw)}" across all tabs</div>`;

    if (totalMatches === 0) {
      contentEl.innerHTML = header + `<div class="mg-empty">Nothing matched "${escapeHtml(qRaw)}" anywhere. Try a different keyword — search covers every condition, medication, rationale and note across all 5 tabs.</div>`;
      contentEl.scrollTop = 0;
      return;
    }

    contentEl.innerHTML = header + html;
    contentEl.scrollTop = 0;

    // Wire up navigation. Clicking a row jumps to its source tab so the
    // user can read the full context. For detail tabs we clear the query
    // (otherwise we'd just re-enter global search mode and never show the
    // sub-tab content). For Knowledge Base we keep the query so the
    // matching condition stays highlighted in the list.
    contentEl.querySelectorAll(".mg-gs-row").forEach(btn => {
      btn.addEventListener("click", () => {
        const topId = btn.getAttribute("data-top");
        const subId = btn.getAttribute("data-sub");
        const isCond = btn.getAttribute("data-cond") === "1";
        const top = getTop(topId);
        if (!top) return;
        activeTopId = topId;
        applyAccent(top);
        if (top.view === "list") {
          activeCategory = "All";
          // Keep the query so renderListContent still highlights the
          // matched condition, but flip out of global mode so the list
          // view actually renders (otherwise renderContent would route
          // back to renderGlobalSearch and we'd never leave the results
          // panel). Typing in the search box again resets to global.
          searchScope = "local";
        } else if (subId) {
          activeSubId = subId;
          // Clear search so the chosen sub-tab actually shows content
          // instead of bouncing back into global-search mode.
          searchEl.value = "";
        }
        renderTopTabs();
        renderSubTabs();
        renderContent();
      });
    });
  }

  function openPanel() {
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    setTimeout(() => searchEl.focus(), 100);
  }
  function closePanel() {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    tab.focus();
  }

  tab.addEventListener("click", () => {
    panel.classList.contains("open") ? closePanel() : openPanel();
  });
  closeBtn.addEventListener("click", closePanel);

  // Click-outside-to-close. Use mousedown (not click) so it fires before
  // any inner click handlers, and check `composedPath()` so clicks inside
  // the panel — or on the floating tab itself — are ignored.
  const _outsideClickHandler = (e) => {
    if (!panel.classList.contains("open")) return;
    const path = (typeof e.composedPath === "function") ? e.composedPath() : [];
    if (path.includes(panel) || path.includes(tab)) return;
    // Fallback for older browsers without composedPath().
    if (!path.length && (panel.contains(e.target) || tab.contains(e.target))) return;
    closePanel();
  };
  document.addEventListener("mousedown", _outsideClickHandler, true);
  window.__mgContraOutsideClick = _outsideClickHandler;
  searchEl.addEventListener("input", () => {
    // Any new keystroke means the user is searching again — return to
    // cross-tab global mode so they see every match.
    searchScope = "global";
    renderSubTabs();
    renderContent();
  });

  const _keydownHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      panel.classList.contains("open") ? closePanel() : openPanel();
    }
    if (e.key === "Escape" && panel.classList.contains("open")) closePanel();
  };
  window.addEventListener("keydown", _keydownHandler);
  window.__mgContraKeydown = _keydownHandler;

  renderTopTabs();
  renderSubTabs();
  renderContent();
}

// Inject the contra modal as soon as the page body is ready, and keep it
// alive across SPA route changes that wipe the DOM. We retry a few times
// at start (in case the page's framework hydrates after us) and observe
// body for removals so we can re-attach instantly.
function _mgEnsureContra() {
  try {
    if (!document.body) return;
    // Require BOTH the launcher pill and the panel — if either is gone (e.g.
    // an SPA route swap nuked one but not the other), tear down and reinject
    // atomically so the two never get out of sync.
    if (document.getElementById("mg-contra-tab") && document.getElementById("mg-contra-panel")) return;
    injectContraModal();
    console.log("[MediGuard] Contra popout injected");
  } catch (e) {
    console.warn("[MediGuard] Contra inject failed:", e);
  }
}
// First-pass: as soon as we can.
if (document.body) _mgEnsureContra();
else document.addEventListener("DOMContentLoaded", _mgEnsureContra, { once: true });
window.addEventListener("load", _mgEnsureContra);
// Belt-and-braces retries in case the host SPA hydrates after document_idle
// and wipes anything we appended to body.
[300, 800, 1500, 3000, 6000].forEach(ms => setTimeout(_mgEnsureContra, ms));
// Re-inject if the tab ever disappears (SPA route change replaces body kids).
try {
  const _mgObs = new MutationObserver(() => {
    if (!document.getElementById("mg-contra-tab") || !document.getElementById("mg-contra-panel")) {
      _mgEnsureContra();
    }
  });
  const _mgStartObs = () => {
    if (document.body) _mgObs.observe(document.body, { childList: true });
  };
  if (document.body) _mgStartObs();
  else document.addEventListener("DOMContentLoaded", _mgStartObs, { once: true });
} catch (_) {}

// ═══════════════════════════════════════════════════════════════════════════
// MACROS POPOUT — floating button stacked underneath the Contraindications
// pill. Mirrors the contra modal's CSS/lifecycle pattern but with a simpler
// flat structure (category tabs + search + clickable copy-list).
// ═══════════════════════════════════════════════════════════════════════════
function getBuiltinMacroCategories() {
  if (typeof EDMS_MACRO_CATEGORIES !== 'undefined' && Array.isArray(EDMS_MACRO_CATEGORIES)) {
    return EDMS_MACRO_CATEGORIES.slice();
  }
  return [];
}

function getSavedEmailMacrosForPopout() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(["email_macros"], (r) => {
        const v = r && r.email_macros;
        if (!Array.isArray(v) || !v.length) { resolve([]); return; }
        const cleaned = v
          .map((m) => ({
            name: (m && m.name ? String(m.name) : "").trim(),
            body: (m && m.text ? String(m.text) : "").trim(),
          }))
          .filter((m) => m.name && m.body)
          .map((m) => ({ ...m, tag: "Settings", desc: "Synced from Settings → Email templates" }));
        resolve(cleaned);
      });
    } catch (_) {
      resolve([]);
    }
  });
}

async function getMacroCategoriesForPopout() {
  const saved = await getSavedEmailMacrosForPopout();
  const base = getBuiltinMacroCategories();
  if (!saved.length) return base;
  return [
    {
      id: "settings_email",
      label: "Settings Email Templates",
      icon: "⚙️",
      macros: saved,
    },
    ...base,
  ];
}

function injectMacroModal() {
  if (document.getElementById("mg-macro-backdrop") && document.getElementById("mg-macro-panel")) return;
  ["mg-macro-styles", "mg-macro-tab", "mg-macro-backdrop", "mg-macro-panel"].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  if (window.__mgMacroKeydown) {
    try { window.removeEventListener("keydown", window.__mgMacroKeydown); } catch (_) {}
    window.__mgMacroKeydown = null;
  }

  const style = document.createElement("style");
  style.id = "mg-macro-styles";
  style.textContent = `
    #mg-macro-tab {
      display: inline-flex !important; align-items: center !important; gap: 6px !important;
      background: #7c3aed !important; color: #fff !important;
      padding: 8px 14px !important; border-radius: 8px !important;
      cursor: pointer !important; z-index: 2147483000 !important;
      font: 700 12.5px/1 Inter, "Segoe UI", Arial, Helvetica, sans-serif !important;
      box-shadow: 0 4px 14px rgba(124,58,237,0.28) !important;
      letter-spacing: 0.01em !important; user-select: none !important;
      border: none !important; outline: none !important;
      transition: transform .15s ease, background .15s ease !important;
      margin: 0 !important;
    }
    #mg-macro-tab {
      position: fixed !important; left: 20px !important; bottom: 20px !important;
      padding: 12px 18px 12px 16px !important; border-radius: 999px !important;
      font-size: 14px !important;
      box-shadow: 0 8px 20px rgba(124,58,237,0.35), 0 2px 6px rgba(0,0,0,0.15) !important;
    }
    #mg-macro-tab:hover { background: #6d28d9 !important; transform: translateY(-1px); }
    #mg-macro-tab svg { width: 18px; height: 18px; }

    #mg-macro-backdrop {
      position: fixed !important; inset: 0 !important;
      background: rgba(2, 6, 23, 0.62) !important;
      backdrop-filter: blur(4px) !important;
      z-index: 2147482999 !important;
      opacity: 0; pointer-events: none;
      transition: opacity .22s ease !important;
    }
    #mg-macro-backdrop.open { opacity: 1; pointer-events: auto; }

    #mg-macro-panel {
      position: fixed !important; left: 50% !important; top: 50% !important;
      transform: translate(-50%, -48%) scale(.96) !important;
      width: min(1280px, calc(100vw - 24px)) !important;
      height: min(900px, calc(100vh - 32px)) !important;
      background: #0f172a !important; color: #e2e8f0 !important;
      border-radius: 16px !important; border: 1px solid #334155 !important;
      box-shadow: 0 32px 80px rgba(0,0,0,0.55) !important;
      overflow: hidden !important; display: flex !important; flex-direction: column !important;
      opacity: 0; pointer-events: none;
      transition: opacity .22s ease, transform .22s ease !important;
      z-index: 2147483000 !important;
      font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif !important;
    }
    #mg-macro-panel.open {
      opacity: 1 !important; pointer-events: auto !important;
      transform: translate(-50%, -50%) scale(1) !important;
    }
    body.swal2-shown #mg-macro-panel,
    body.swal2-shown #mg-macro-backdrop,
    body.swal2-shown #mg-macro-tab { display: none !important; }

    #mg-macro-panel .mg-mac-header {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 18px; flex-shrink: 0;
      background: linear-gradient(90deg, #8b5cf6, #7c3aed);
      color: #fff; border-bottom: 1px solid #6d28d9;
    }
    #mg-macro-panel .mg-mac-header .mg-mac-logo {
      width: 38px; height: 38px; border-radius: 9px;
      background: rgba(255,255,255,0.18); display: grid; place-items: center; font-size: 18px;
    }
    #mg-macro-panel .mg-mac-titles { flex: 1; min-width: 0; }
    #mg-macro-panel .mg-mac-title { font-weight: 800; font-size: 16px; line-height: 1.2; }
    #mg-macro-panel .mg-mac-subtitle { font-size: 11.5px; opacity: 0.9; margin-top: 2px; }
    #mg-macro-close {
      background: rgba(255,255,255,0.18); border: none; color: #fff;
      width: 32px; height: 32px; border-radius: 50%;
      cursor: pointer; font-size: 16px; line-height: 1;
      display: grid; place-items: center;
    }
    #mg-macro-close:hover { background: rgba(255,255,255,0.32); }

    .mg-mac-body { display: flex; flex: 1; min-height: 0; }

    #mg-macro-sidebar {
      width: 340px; flex-shrink: 0;
      display: flex; flex-direction: column;
      border-right: 1px solid #1e293b;
      background: #0b1220;
    }
    #mg-macro-search-wrap { padding: 12px; border-bottom: 1px solid #1e293b; }
    #mg-macro-search {
      width: 100%; box-sizing: border-box;
      padding: 10px 12px 10px 36px; border-radius: 10px;
      background: #1e293b url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='8'/><path d='m21 21-4.3-4.3'/></svg>") no-repeat 12px center;
      border: 1px solid #334155; color: #f1f5f9;
      font-size: 13px; font-family: inherit; outline: none;
    }
    #mg-macro-search::placeholder { color: #64748b; }
    #mg-macro-search:focus { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,0.18); }

    #mg-macro-cat-nav {
      padding: 8px; border-bottom: 1px solid #1e293b;
      max-height: 200px; overflow-y: auto;
    }
    #mg-macro-cat-nav .mg-mac-cat-item {
      display: flex; align-items: center; gap: 8px;
      width: 100%; text-align: left;
      padding: 8px 10px; margin-bottom: 4px;
      border-radius: 8px; border: 1px solid transparent;
      background: transparent; color: #94a3b8;
      font: 600 12px/1.3 inherit; cursor: pointer;
      transition: all .12s ease;
    }
    #mg-macro-cat-nav .mg-mac-cat-item:hover { background: #1e293b; color: #e2e8f0; }
    #mg-macro-cat-nav .mg-mac-cat-item.active {
      background: rgba(139,92,246,0.15); color: #e9d5ff;
      border-color: rgba(139,92,246,0.35);
    }
    #mg-macro-cat-nav .mg-mac-cat-count {
      margin-left: auto; font-size: 10px; font-weight: 700;
      padding: 2px 7px; border-radius: 999px;
      background: #1e293b; color: #64748b;
    }
    #mg-macro-cat-nav .mg-mac-cat-item.active .mg-mac-cat-count {
      background: rgba(139,92,246,0.25); color: #c4b5fd;
    }

    #mg-macro-list {
      flex: 1; overflow-y: auto; padding: 6px 8px 12px;
    }
    #mg-macro-list::-webkit-scrollbar, #mg-macro-detail-preview::-webkit-scrollbar,
    #mg-macro-cat-nav::-webkit-scrollbar { width: 7px; }
    #mg-macro-list::-webkit-scrollbar-thumb, #mg-macro-detail-preview::-webkit-scrollbar-thumb,
    #mg-macro-cat-nav::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }

    .mg-mac-list-item {
      display: block; width: 100%; text-align: left;
      padding: 10px 12px; margin-bottom: 4px;
      border-radius: 8px; border: 1px solid transparent;
      background: transparent; color: #cbd5e1; cursor: pointer;
      font-family: inherit; transition: all .12s ease;
    }
    .mg-mac-list-item:hover { background: #1e293b; border-color: #334155; }
    .mg-mac-list-item.active {
      background: linear-gradient(90deg, rgba(139,92,246,0.2), rgba(124,58,237,0.12));
      border-color: rgba(139,92,246,0.45); color: #f8fafc;
    }
    .mg-mac-list-item-name { font-weight: 700; font-size: 12.5px; line-height: 1.35; }
    .mg-mac-list-item-meta { font-size: 10.5px; color: #64748b; margin-top: 3px; }
    .mg-mac-list-item.active .mg-mac-list-item-meta { color: #a78bfa; }
    .mg-mac-list-item.custom-item {
      border: 1px dashed rgba(139,92,246,0.35);
      margin-bottom: 10px;
    }
    .mg-mac-list-item.custom-item.active {
      border-style: solid;
    }
    .mg-mac-list-group {
      padding: 8px 8px 4px; font-size: 10px; font-weight: 800;
      letter-spacing: 0.06em; text-transform: uppercase; color: #64748b;
    }

    #mg-macro-detail {
      flex: 1; min-width: 0; display: flex; flex-direction: column;
      background: #0f172a;
    }
    #mg-macro-detail-empty {
      flex: 1; display: grid; place-items: center;
      color: #64748b; font-size: 14px; padding: 40px; text-align: center;
    }
    #mg-macro-detail-content { flex: 1; display: none; flex-direction: column; min-height: 0; }
    #mg-macro-detail-content.visible { display: flex; }
    #mg-macro-detail-head { padding: 12px 20px 10px; border-bottom: 1px solid #1e293b; }
    #mg-macro-detail-head.compact { padding: 8px 20px 6px; }
    #mg-macro-detail-title-row {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    }
    #mg-macro-detail-name { font-weight: 800; font-size: 17px; color: #f8fafc; line-height: 1.2; }
    #mg-macro-detail-head.compact #mg-macro-detail-name { font-size: 15px; }
    #mg-macro-detail-desc { color: #94a3b8; font-size: 13px; margin-top: 4px; line-height: 1.35; }
    #mg-macro-detail-head.compact #mg-macro-detail-desc { font-size: 12px; margin-top: 2px; }
    #mg-macro-detail-tag {
      display: inline-block; margin-top: 0;
      padding: 2px 8px; border-radius: 999px;
      background: rgba(139,92,246,0.18); color: #c4b5fd;
      border: 1px solid rgba(139,92,246,0.4);
      font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    }
    #mg-macro-detail-preview {
      flex: 1; width: 100%; box-sizing: border-box;
      margin: 0; padding: 16px 20px;
      overflow-y: auto; resize: none;
      white-space: pre-wrap; word-break: break-word;
      color: #e2e8f0; font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: #0b1220; border: none; outline: none;
      min-height: 320px;
    }
    #mg-macro-detail-preview:focus {
      box-shadow: inset 0 0 0 2px rgba(139,92,246,0.4);
      background: #0d1526;
    }
    #mg-macro-custom-tabs {
      display: flex; gap: 8px; padding: 12px 20px 0; flex-shrink: 0;
      border-bottom: 1px solid #1e293b;
    }
    #mg-macro-custom-tabs[hidden] { display: none !important; }
    .mg-custom-tab {
      flex: 1; padding: 10px 12px; border: 1px solid transparent;
      border-radius: 10px 10px 0 0; background: transparent;
      color: #94a3b8; font-size: 12px; font-weight: 700; cursor: pointer;
      font-family: inherit; transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .mg-custom-tab:hover { color: #cbd5e1; background: rgba(15,23,42,0.5); }
    .mg-custom-tab.active {
      background: #0b1220; color: #e9d5ff;
      border-color: #334155; border-bottom-color: #0b1220;
    }
    #mg-macro-write-pane, #mg-macro-ai-pane {
      flex: 1; display: flex; flex-direction: column; min-height: 0;
    }
    #mg-macro-write-pane[hidden], #mg-macro-ai-pane[hidden] { display: none !important; }
    #mg-macro-ai-intro {
      padding: 14px 20px 0; font-size: 12px; color: #94a3b8; line-height: 1.45; flex-shrink: 0;
    }
    #mg-macro-ai-pane label {
      display: block; padding: 10px 20px 6px; font-size: 10px; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase; color: #a78bfa;
    }
    #mg-macro-ai-pane label[hidden] { display: none !important; }
    #mg-macro-ai-prompt, #mg-macro-ai-result {
      margin: 0 20px; width: calc(100% - 40px); box-sizing: border-box;
      min-height: 88px; max-height: 160px; padding: 12px 14px;
      border-radius: 10px; border: 1px solid #334155; background: #0b1220;
      color: #e2e8f0; font-size: 13px; line-height: 1.5; resize: vertical;
      font-family: inherit; outline: none;
    }
    #mg-macro-ai-result {
      flex: 1; min-height: 140px; max-height: none;
      font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    #mg-macro-ai-prompt:focus, #mg-macro-ai-result:focus {
      border-color: #7c3aed; box-shadow: 0 0 0 2px rgba(124,58,237,0.25);
    }
    #mg-macro-ai-prompt::placeholder { color: #64748b; }
    .mg-macro-ai-actions {
      display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
      padding: 12px 20px; flex-shrink: 0;
    }
    #mg-macro-ai-result-actions {
      display: flex; flex-wrap: wrap; gap: 10px; padding: 0 20px 16px; flex-shrink: 0;
    }
    #mg-macro-ai-result-actions[hidden] { display: none !important; }
    #mg-macro-ai-status {
      font-size: 11.5px; color: #94a3b8; flex: 1; min-width: 120px;
    }
    #mg-macro-ai-status.error { color: #f87171; }
    #mg-macro-ai-status.success { color: #4ade80; }
    .mg-mac-btn.ai-btn {
      background: linear-gradient(180deg, #a855f7, #9333ea);
      box-shadow: 0 3px 8px rgba(147,51,234,0.35);
    }
    .mg-mac-btn.ai-btn:disabled { opacity: 0.6; cursor: wait; transform: none; }
    #mg-macro-detail-actions {
      display: flex; gap: 10px; padding: 14px 20px;
      border-top: 1px solid #1e293b; background: #0f172a; flex-shrink: 0;
    }
    .mg-mac-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 16px; border-radius: 8px; border: none; cursor: pointer;
      font: 700 12.5px/1 inherit; letter-spacing: 0.02em;
      background: linear-gradient(180deg, #8b5cf6, #7c3aed);
      color: #fff; box-shadow: 0 3px 8px rgba(124,58,237,0.3);
      transition: transform .08s ease, box-shadow .15s ease;
    }
    .mg-mac-btn:hover { transform: translateY(-1px); box-shadow: 0 5px 12px rgba(124,58,237,0.4); }
    .mg-mac-btn.copied { background: linear-gradient(180deg, #22c55e, #16a34a); box-shadow: 0 3px 8px rgba(34,197,94,0.35); }
    .mg-mac-btn.secondary {
      background: #1e293b; color: #cbd5e1; border: 1px solid #334155; box-shadow: none;
    }
    .mg-mac-btn.secondary:hover { background: #283548; color: #fff; }
    .mg-mac-btn.chat-btn {
      background: linear-gradient(180deg, #3b82f6, #2563eb);
      box-shadow: 0 3px 8px rgba(37,99,235,0.3);
    }
    .mg-mac-empty {
      padding: 20px 12px; text-align: center; color: #64748b; font-size: 12.5px;
    }
    .mg-mac-hl { background: rgba(250,204,21,0.35); color: #fef9c3; padding: 0 2px; border-radius: 2px; font-weight: 700; }

    .od2-comms-composer { position: relative; }

    /* Hide native floating chat — only visible inside our modal */
    .od2-chat-panel:not(.mg-comms-embedded) {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
      position: fixed !important;
      left: -10000px !important;
      top: auto !important;
      bottom: 0 !important;
      width: 1px !important;
      height: 1px !important;
      overflow: hidden !important;
      z-index: -1 !important;
    }
    #mg-comms-chat-slot {
      display: none;
      flex: 1.2;
      min-width: 480px;
      min-height: 0;
      background: #f8fafc;
      border-left: 1px solid #1e293b;
      overflow: hidden;
    }
    #mg-macro-panel.mg-comms-mode {
      width: min(1820px, calc(100vw - 1rem)) !important;
      height: calc(100vh - 2rem) !important;
      max-height: calc(100vh - 2rem) !important;
    }
    #mg-macro-panel.mg-comms-mode.open {
      transform: translate(-50%, calc(-50% + 0.35rem)) scale(1) !important;
    }
    #mg-macro-panel.mg-comms-mode .mg-mac-header { display: none !important; }
    #mg-macro-panel.mg-comms-mode #mg-comms-chat-slot { display: flex; flex-direction: column; }
    #mg-macro-panel.mg-comms-mode #mg-macro-detail {
      flex: 1;
      min-width: 360px;
      max-width: 580px;
      border-right: 1px solid #1e293b;
    }
    #mg-macro-panel.mg-comms-mode #mg-macro-sidebar { width: 320px; }

    .od2-chat-panel.mg-comms-embedded {
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      position: relative !important;
      inset: auto !important;
      left: auto !important;
      top: auto !important;
      right: auto !important;
      bottom: auto !important;
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      transform: none !important;
      display: flex !important;
      flex-direction: column !important;
      z-index: auto !important;
    }
    .od2-chat-panel.mg-comms-embedded .od2-comms-thread { flex: 1; min-height: 0; overflow-y: auto; }
    .od2-chat-panel.mg-comms-embedded .od2-comms-composer {
      flex-shrink: 0;
      display: flex !important;
      align-items: flex-end;
      gap: 12px;
      padding: 14px 16px 18px !important;
      box-sizing: border-box;
      border-top: 1px solid #e2e8f0;
      background: #fff;
    }
    .od2-chat-panel.mg-comms-embedded .od2-comms-closed-notice {
      flex-shrink: 0;
      padding: 12px 16px 18px !important;
      box-sizing: border-box;
    }
    .od2-chat-panel.mg-comms-embedded #od2CommsInput {
      flex: 1;
      min-height: 120px !important;
      max-height: 600px !important;
      resize: none !important;
      line-height: 1.5 !important;
      margin: 0 !important;
      box-sizing: border-box !important;
      overflow-y: hidden;
    }
    .od2-chat-panel.mg-comms-embedded #od2CommsSendBtn {
      flex-shrink: 0;
      margin-bottom: 2px;
    }
  `;
  document.head.appendChild(style);

  const tab = document.createElement("button");
  tab.id = "mg-macro-tab";
  tab.type = "button";
  tab.setAttribute("aria-label", "Open patient email macros");
  tab.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2"></rect>
      <path d="M3 7l9 6 9-6"></path>
    </svg>
    Macros
  `;
  document.body.appendChild(tab);

  const backdrop = document.createElement("div");
  backdrop.id = "mg-macro-backdrop";
  backdrop.setAttribute("aria-hidden", "true");

  const panel = document.createElement("div");
  panel.id = "mg-macro-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = `
    <div class="mg-mac-header">
      <div class="mg-mac-logo">✉️</div>
      <div class="mg-mac-titles">
        <div class="mg-mac-title">Patient Email Macros</div>
        <div class="mg-mac-subtitle">Search by category • Edit • Copy or insert into chat</div>
      </div>
      <button id="mg-macro-close" type="button" aria-label="Close">✕</button>
    </div>
    <div class="mg-mac-body">
      <aside id="mg-macro-sidebar">
        <div id="mg-macro-search-wrap">
          <input id="mg-macro-search" type="search" placeholder="Search macros…" autocomplete="off" />
        </div>
        <nav id="mg-macro-cat-nav" aria-label="Macro categories"></nav>
        <div id="mg-macro-list" role="listbox" aria-label="Macros"></div>
      </aside>
      <section id="mg-macro-detail">
        <div id="mg-macro-detail-empty">Select a macro or choose Custom message to write your own email.</div>
        <div id="mg-macro-detail-content">
          <div id="mg-macro-custom-tabs" hidden>
            <button type="button" class="mg-custom-tab active" data-mode="write">✏️ Write</button>
            <button type="button" class="mg-custom-tab" data-mode="ai">✨ AI Assist</button>
          </div>
          <div id="mg-macro-write-pane">
            <div id="mg-macro-detail-head">
              <div id="mg-macro-detail-title-row">
                <div id="mg-macro-detail-name"></div>
                <span id="mg-macro-detail-tag"></span>
              </div>
              <div id="mg-macro-detail-desc"></div>
            </div>
            <textarea id="mg-macro-detail-preview" spellcheck="true" aria-label="Macro body — editable"></textarea>
            <div id="mg-macro-detail-actions">
              <button type="button" class="mg-mac-btn" id="mg-macro-copy-btn">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>
                <span id="mg-macro-copy-label">Copy</span>
              </button>
              <button type="button" class="mg-mac-btn chat-btn" id="mg-macro-insert-btn">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                Insert into chat
              </button>
            </div>
          </div>
          <div id="mg-macro-ai-pane" hidden>
            <div id="mg-macro-ai-intro">Describe the scenario — AI will draft a patient message for you to review.</div>
            <label for="mg-macro-ai-prompt">Your scenario</label>
            <textarea id="mg-macro-ai-prompt" rows="4" placeholder="e.g. Patient has gallstones on SCR — ask if they had cholecystectomy and when…"></textarea>
            <div class="mg-macro-ai-actions">
              <button type="button" class="mg-mac-btn ai-btn" id="mg-macro-ai-generate">✨ Generate with AI</button>
              <button type="button" class="mg-mac-btn secondary" id="mg-macro-ai-settings" title="Open extension Settings">Settings</button>
              <span id="mg-macro-ai-status">Paste your OpenAI key in Settings → Save</span>
            </div>
            <label for="mg-macro-ai-result" id="mg-macro-ai-result-label" hidden>Generated message</label>
            <textarea id="mg-macro-ai-result" rows="10" readonly spellcheck="true" aria-label="AI generated message" hidden></textarea>
            <div id="mg-macro-ai-result-actions" hidden>
              <button type="button" class="mg-mac-btn" id="mg-macro-ai-use-editor">Use in editor</button>
              <button type="button" class="mg-mac-btn chat-btn" id="mg-macro-ai-insert-chat">Insert into chat</button>
              <button type="button" class="mg-mac-btn secondary" id="mg-macro-ai-copy-result">Copy</button>
            </div>
          </div>
        </div>
      </section>
      <section id="mg-comms-chat-slot" aria-label="Patient chat"></section>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  const catNavEl = panel.querySelector("#mg-macro-cat-nav");
  const listEl = panel.querySelector("#mg-macro-list");
  const searchEl = panel.querySelector("#mg-macro-search");
  const closeBtn = panel.querySelector("#mg-macro-close");
  const detailEmpty = panel.querySelector("#mg-macro-detail-empty");
  const detailContent = panel.querySelector("#mg-macro-detail-content");
  const detailHead = panel.querySelector("#mg-macro-detail-head");
  const detailName = panel.querySelector("#mg-macro-detail-name");
  const detailDesc = panel.querySelector("#mg-macro-detail-desc");
  const detailTag = panel.querySelector("#mg-macro-detail-tag");
  const detailPreview = panel.querySelector("#mg-macro-detail-preview");
  const copyBtn = panel.querySelector("#mg-macro-copy-btn");
  const copyLabel = panel.querySelector("#mg-macro-copy-label");
  const insertBtn = panel.querySelector("#mg-macro-insert-btn");
  const customTabs = panel.querySelector("#mg-macro-custom-tabs");
  const writePane = panel.querySelector("#mg-macro-write-pane");
  const aiPane = panel.querySelector("#mg-macro-ai-pane");
  const aiPrompt = panel.querySelector("#mg-macro-ai-prompt");
  const aiResult = panel.querySelector("#mg-macro-ai-result");
  const aiResultLabel = panel.querySelector("#mg-macro-ai-result-label");
  const aiResultActions = panel.querySelector("#mg-macro-ai-result-actions");
  const aiGenerateBtn = panel.querySelector("#mg-macro-ai-generate");
  const aiSettingsBtn = panel.querySelector("#mg-macro-ai-settings");
  const aiUseEditorBtn = panel.querySelector("#mg-macro-ai-use-editor");
  const aiInsertChatBtn = panel.querySelector("#mg-macro-ai-insert-chat");
  const aiCopyResultBtn = panel.querySelector("#mg-macro-ai-copy-result");
  const aiStatus = panel.querySelector("#mg-macro-ai-status");
  let aiGenerating = false;
  let customDetailMode = "write";

  async function refreshAiStatusHint() {
    if (!aiStatus || selectedKey !== CUSTOM_MACRO_KEY || customDetailMode !== "ai") return;
    const { openaiKey } = await getAiSettings();
    if (openaiKey) {
      setAiStatus("OpenAI key configured — press Enter or click Generate.");
    } else {
      setAiStatus("Add your OpenAI API key in Settings → Save.", "error");
    }
  }

  let activeCatId = "all";
  let selectedKey = null;
  let categories = [];
  let commsMode = false;
  let chatOriginalParent = null;
  const CUSTOM_MACRO_KEY = "__custom__";
  const chatSlot = panel.querySelector("#mg-comms-chat-slot");
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getCustomTemplateBody() {
    return "Dear {patient_name},\n\n\n\nKind regards,\nEveryDayMeds Clinical Team";
  }

  function getCustomEntry() {
    return {
      cat: { id: "custom", label: "Custom", icon: "✏️" },
      macro: {
        name: "Custom message",
        desc: "Write your own email from scratch",
        tag: "Custom",
        body: getCustomTemplateBody(),
      },
      key: CUSTOM_MACRO_KEY,
    };
  }

  function customMatchesSearch(q) {
    if (!q) return true;
    const hay = "custom message write your own email from scratch blank";
    return hay.includes(q);
  }

  function appendCustomListItem(q) {
    if (!customMatchesSearch(q)) return false;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mg-mac-list-item custom-item" + (selectedKey === CUSTOM_MACRO_KEY ? " active" : "");
    btn.setAttribute("role", "option");
    btn.innerHTML = `
      <div class="mg-mac-list-item-name">✏️ Custom message</div>
      <div class="mg-mac-list-item-meta">Write your own email from scratch</div>
    `;
    btn.addEventListener("click", () => {
      selectedKey = CUSTOM_MACRO_KEY;
      renderList();
      renderDetail();
      detailPreview.focus();
    });
    listEl.appendChild(btn);
    return true;
  }

  function macroKey(catId, m) {
    return `${catId}::${m.name}`;
  }

  function getPatientFullName() {
    try {
      const sub = document.querySelector(".chat-panel-sub");
      if (sub && sub.textContent) return String(sub.textContent).trim();
    } catch (_) {}
    try {
      const d = lastScannedData || {};
      if (d.patientName) return String(d.patientName).trim();
    } catch (_) {}
    return "";
  }

  function getRecentChatSnippet(maxMsgs = 4) {
    try {
      const thread = document.getElementById("od2CommsThread");
      if (!thread) return "";
      return [...thread.querySelectorAll(".od2-comms-bubble.from-patient")]
        .slice(-maxMsgs)
        .map(b => String(b.textContent || "").trim())
        .filter(Boolean)
        .join("\n---\n");
    } catch (_) {
      return "";
    }
  }

  function buildEmailAiContext() {
    const d = lastScannedData || {};
    const lines = [];
    const fullName = getPatientFullName();
    const firstName = getPatientName();
    if (fullName) lines.push(`Patient full name: ${fullName}`);
    else if (firstName && firstName !== "there") lines.push(`Patient first name: ${firstName}`);
    if (d.orderNo) lines.push(`Current order #: ${d.orderNo}`);
    if (d.orderDate) lines.push(`Current order date: ${d.orderDate}`);
    if (d.medication) lines.push(`Medication ordered: ${d.medication}${d.dose ? ` ${d.dose}` : ""}`);
    if (d.qty) lines.push(`Current order quantity (pens): ${d.qty}`);
    if (d.bmi != null) lines.push(`BMI: ${d.bmi}`);
    if (d.age != null) lines.push(`Age: ${d.age}`);
    if (d.fulfilledOrderNo) lines.push(`Last fulfilled order with us #: ${d.fulfilledOrderNo}`);
    if (d.fulfilledOrderDate) lines.push(`Last order date with us: ${d.fulfilledOrderDate}`);
    if (d.fulfilledDate) lines.push(`Last order fulfilled/dispatched: ${d.fulfilledDate}`);
    if (d.fulfilledQty) {
      const supplyW = (d.fulfilledQty || 1) * 4;
      lines.push(`Last order supply: ${d.fulfilledQty} pen(s) ≈ ${supplyW} weeks`);
    }
    if (d.expectedLastDoseRange) {
      lines.push(`Expected last injection window from last order: ${d.expectedLastDoseRange}`);
    }
    if (d.declaredLastInjection) {
      lines.push(`Patient declared last injection (consultation): ${d.declaredLastInjection}`);
    }
    if (d.anotherProviderAnswer) {
      lines.push(`Another provider during gap (consultation): ${d.anotherProviderAnswer}`);
    }
    if (d.supplyCheckRequired && d.treatmentGapWeeks != null) {
      lines.push(`Supply check: declared injection is ~${d.treatmentGapWeeks} week(s) beyond expected supply from last order`);
    }
    const lastOrderDate = d.fulfilledOrderDate ? parseMedDate(d.fulfilledOrderDate) : null;
    if (lastOrderDate) {
      const daysSince = Math.round((startOfDay(new Date()) - startOfDay(lastOrderDate)) / (1000 * 60 * 60 * 24));
      const weeksSince = Math.floor(daysSince / 7);
      lines.push(`Time since last order with us: ~${weeksSince} weeks (${daysSince} days)`);
      if (weeksSince >= 8) {
        lines.push(`Note: significant gap since last EverydayMeds order — if patient claims a recent injection, one pen order would not cover that period; consider asking about another provider/source.`);
      }
    }
    if (Array.isArray(d.flags) && d.flags.length) {
      lines.push(`Clinical flags on order: ${d.flags.map(f => f.text).join("; ")}`);
    }
    if (Array.isArray(d.patientTags) && d.patientTags.length) {
      lines.push(`Patient tags: ${d.patientTags.join(", ")}`);
    }
    const chatSnippet = getRecentChatSnippet();
    if (chatSnippet) lines.push(`Recent patient chat:\n${chatSnippet}`);
    return lines.join("\n");
  }

  function getAiSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(["server_url", "openai_key"], (r) => {
          resolve({
            serverUrl: (r && r.server_url) ? String(r.server_url).replace(/\/$/, "") : "",
            openaiKey: (r && r.openai_key) ? String(r.openai_key) : "",
          });
        });
      } catch (_) {
        resolve({ serverUrl: "", openaiKey: "" });
      }
    });
  }

  async function generateEmailWithAI(scenario) {
    const prompt = (scenario || "").trim();
    if (!prompt) throw new Error("Describe the scenario first.");

    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({
          type: "GENERATE_PATIENT_EMAIL",
          scenario: prompt,
          context: buildEmailAiContext(),
        }, (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || "Extension error"));
            return;
          }
          if (resp?.success && resp.text) {
            resolve(stripEmailSubject(resp.text));
            return;
          }
          reject(new Error(resp?.error || "Generation failed."));
        });
      } catch (e) {
        reject(new Error(e?.message || "Could not reach extension background."));
      }
    });
  }

  function setCustomDetailMode(mode) {
    customDetailMode = mode === "ai" ? "ai" : "write";
    if (customTabs) {
      customTabs.querySelectorAll(".mg-custom-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mode === customDetailMode);
      });
    }
    if (writePane) writePane.hidden = customDetailMode !== "write";
    if (aiPane) aiPane.hidden = customDetailMode !== "ai";
    if (customDetailMode === "ai") {
      refreshAiStatusHint();
      if (aiPrompt) aiPrompt.focus();
    } else if (detailPreview) {
      detailPreview.focus();
    }
  }

  function showAiResult(text) {
    if (aiResult) {
      aiResult.value = text;
      aiResult.hidden = false;
    }
    if (aiResultLabel) aiResultLabel.hidden = false;
    if (aiResultActions) aiResultActions.hidden = false;
  }

  function hideAiResult() {
    if (aiResult) {
      aiResult.value = "";
      aiResult.hidden = true;
    }
    if (aiResultLabel) aiResultLabel.hidden = true;
    if (aiResultActions) aiResultActions.hidden = true;
  }

  function setAiStatus(text, kind) {
    if (!aiStatus) return;
    aiStatus.textContent = text;
    aiStatus.classList.remove("error", "success");
    if (kind) aiStatus.classList.add(kind);
  }

  async function runAiGenerate() {
    if (aiGenerating || !aiPrompt) return;
    const scenario = aiPrompt.value.trim();
    if (!scenario) {
      setAiStatus("Describe the scenario first.", "error");
      aiPrompt.focus();
      return;
    }
    aiGenerating = true;
    if (aiGenerateBtn) aiGenerateBtn.disabled = true;
    hideAiResult();
    setAiStatus("Generating draft…");
    try {
      const draft = await generateEmailWithAI(scenario);
      showAiResult(draft);
      setAiStatus("Draft ready — copy, insert into chat, or use in editor.", "success");
    } catch (e) {
      setAiStatus(e?.message || "Generation failed.", "error");
    } finally {
      aiGenerating = false;
      if (aiGenerateBtn) aiGenerateBtn.disabled = false;
    }
  }

  function useAiDraftInEditor() {
    if (!aiResult || !detailPreview) return;
    const draft = String(aiResult.value || "").trim();
    if (!draft) return;
    detailPreview.value = draft;
    detailPreview.dataset.macroKey = CUSTOM_MACRO_KEY;
    setCustomDetailMode("write");
    detailPreview.focus();
    try { detailPreview.setSelectionRange(detailPreview.value.length, detailPreview.value.length); } catch (_) {}
  }

  async function insertAiDraftIntoChat() {
    if (!aiResult) return;
    const text = String(aiResult.value || "").trim();
    if (!text) return;
    if (!commsMode) {
      await openCommsModal();
    }
    let input = null;
    for (let i = 0; i < 24; i++) {
      await sleep(80);
      input = document.getElementById("od2CommsInput");
      if (input && input.offsetParent !== null) break;
    }
    if (!input) return;
    const closedNotice = document.getElementById("od2CommsClosedNotice");
    if (closedNotice && closedNotice.offsetParent !== null) {
      const startBtn = document.getElementById("od2ChatToggleBtn");
      if (startBtn && /start chat/i.test(startBtn.textContent || "")) startBtn.click();
      await sleep(200);
    }
    setFieldValue(input, text);
    autoResizeTextarea(input);
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
  }

  function getPatientName() {
    try {
      const sub = document.querySelector(".chat-panel-sub");
      if (sub && sub.textContent) return String(sub.textContent).trim().split(/\s+/)[0];
    } catch (_) {}
    try {
      const pd = window.patientData || (typeof patientData !== "undefined" ? patientData : null);
      if (pd && typeof pd === "object" && pd.name) return String(pd.name).split(/\s+/)[0];
    } catch (_) {}
    return "there";
  }

  function stripEmailSubject(text) {
    return String(text)
      .replace(/^(\[[^\]]+\]\s*\n+)?Subject:\s*[^\n]+\n+/i, "")
      .trim();
  }

  function fillPlaceholders(text) {
    const name = getPatientName();
    return stripEmailSubject(String(text))
      .replace(/\{patient_name\}/gi, name)
      .replace(/\[Patient Name\]/gi, name)
      .replace(/<<\s*Patient Name\s*>>/gi, name);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  function highlight(text, q) {
    const safe = esc(text);
    if (!q) return safe;
    const safeQ = esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!safeQ) return safe;
    return safe.replace(new RegExp(safeQ, "gi"), m => `<span class="mg-mac-hl">${m}</span>`);
  }

  function macroMatches(m, q) {
    if (!q) return true;
    const hay = `${m.name} ${m.desc || ""} ${m.tag || ""} ${m.body}`.toLowerCase();
    return hay.includes(q);
  }

  function getFilteredMacros() {
    const q = (searchEl.value || "").trim().toLowerCase();
    const out = [];
    categories.forEach(c => {
      if (activeCatId !== "all" && c.id !== activeCatId) return;
      (c.macros || []).forEach(m => {
        if (macroMatches(m, q)) out.push({ cat: c, macro: m, key: macroKey(c.id, m) });
      });
    });
    return out;
  }

  function getSelectedEntry() {
    if (!selectedKey) return null;
    if (selectedKey === CUSTOM_MACRO_KEY) return getCustomEntry();
    return getFilteredMacros().find(e => e.key === selectedKey)
      || categories.flatMap(c => (c.macros || []).map(m => ({ cat: c, macro: m, key: macroKey(c.id, m) }))).find(e => e.key === selectedKey)
      || null;
  }

  function getDetailText() {
    return detailPreview ? String(detailPreview.value || "") : "";
  }

  function renderDetail() {
    const entry = getSelectedEntry();
    if (!entry) {
      detailEmpty.style.display = "grid";
      detailContent.classList.remove("visible");
      if (detailPreview) detailPreview.dataset.macroKey = "";
      return;
    }
    const { macro: m } = entry;
    const q = (searchEl.value || "").trim();
    detailEmpty.style.display = "none";
    detailContent.classList.add("visible");
    detailName.innerHTML = highlight(m.name, q);
    detailDesc.innerHTML = m.desc ? highlight(m.desc, q) : "";
    detailDesc.style.display = m.desc ? "block" : "none";
    if (m.tag) {
      detailTag.textContent = m.tag;
      detailTag.style.display = "inline-block";
    } else {
      detailTag.style.display = "none";
    }
    if (detailPreview.dataset.macroKey !== selectedKey) {
      detailPreview.value = fillPlaceholders(m.body);
      detailPreview.dataset.macroKey = selectedKey;
      if (selectedKey === CUSTOM_MACRO_KEY) {
        customDetailMode = "write";
        hideAiResult();
      }
    }
    const isCustom = selectedKey === CUSTOM_MACRO_KEY;
    if (detailHead) detailHead.classList.toggle("compact", isCustom);
    if (customTabs) customTabs.hidden = !isCustom;
    if (isCustom) {
      if (customDetailMode !== "write" && customDetailMode !== "ai") customDetailMode = "write";
      setCustomDetailMode(customDetailMode);
      refreshAiStatusHint();
    } else {
      customDetailMode = "write";
      if (writePane) writePane.hidden = false;
      if (aiPane) aiPane.hidden = true;
    }
    copyBtn.classList.remove("copied");
    copyLabel.textContent = "Copy";
  }

  function renderCatNav() {
    const q = (searchEl.value || "").trim().toLowerCase();
    catNavEl.innerHTML = "";
    const counts = new Map();
    let allCount = 0;
    categories.forEach(c => {
      const n = (c.macros || []).filter(m => macroMatches(m, q)).length;
      counts.set(c.id, n);
      allCount += n;
    });

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "mg-mac-cat-item" + (activeCatId === "all" ? " active" : "");
    allBtn.innerHTML = `<span>📚</span><span>All categories</span><span class="mg-mac-cat-count">${allCount}</span>`;
    allBtn.addEventListener("click", () => { activeCatId = "all"; renderCatNav(); renderList(); });
    catNavEl.appendChild(allBtn);

    categories.forEach(c => {
      const n = counts.get(c.id) || 0;
      if (q && n === 0) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mg-mac-cat-item" + (c.id === activeCatId ? " active" : "");
      b.innerHTML = `<span>${esc(c.icon || "•")}</span><span>${esc(c.label)}</span><span class="mg-mac-cat-count">${n}</span>`;
      b.addEventListener("click", () => { activeCatId = c.id; renderCatNav(); renderList(); });
      catNavEl.appendChild(b);
    });
  }

  function renderList() {
    const qRaw = (searchEl.value || "").trim();
    const q = qRaw.toLowerCase();
    const entries = getFilteredMacros();
    listEl.innerHTML = "";

    const customShown = appendCustomListItem(q);

    if (!entries.length && !customShown) {
      const empty = document.createElement("div");
      empty.className = "mg-mac-empty";
      empty.textContent = q ? `No macros match "${qRaw}".` : "No macros in this category.";
      listEl.appendChild(empty);
      selectedKey = null;
      renderDetail();
      return;
    }

    const customValid = customShown && customMatchesSearch(q);
    const entryKeys = entries.map(e => e.key);
    if (!selectedKey || (selectedKey !== CUSTOM_MACRO_KEY && !entryKeys.includes(selectedKey))) {
      selectedKey = customValid ? CUSTOM_MACRO_KEY : entryKeys[0];
    }

    let lastCat = null;
    entries.forEach(({ cat, macro: m, key }) => {
      if (activeCatId === "all" && lastCat !== cat.id) {
        lastCat = cat.id;
        const g = document.createElement("div");
        g.className = "mg-mac-list-group";
        g.textContent = `${cat.icon || ""} ${cat.label}`.trim();
        listEl.appendChild(g);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mg-mac-list-item" + (key === selectedKey ? " active" : "");
      btn.setAttribute("role", "option");
      btn.innerHTML = `
        <div class="mg-mac-list-item-name">${highlight(m.name, q)}</div>
        ${m.desc ? `<div class="mg-mac-list-item-meta">${highlight(m.desc, q)}</div>` : ""}
      `;
      btn.addEventListener("click", () => {
        selectedKey = key;
        renderList();
        renderDetail();
      });
      listEl.appendChild(btn);
    });
    renderDetail();
  }

  async function copySelected() {
    const entry = getSelectedEntry();
    if (!entry) return;
    const text = getDetailText() || fillPlaceholders(entry.macro.body || "");
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (_) {}
      document.body.removeChild(ta);
    }
    copyBtn.classList.add("copied");
    copyLabel.textContent = "Copied ✓";
    setTimeout(() => {
      copyBtn.classList.remove("copied");
      copyLabel.textContent = "Copy";
    }, 1600);
  }

  async function insertIntoChat() {
    const entry = getSelectedEntry();
    if (!entry) return;
    const text = getDetailText() || fillPlaceholders(entry.macro.body || "");
    if (!commsMode) {
      await openCommsModal();
    }
    let input = null;
    for (let i = 0; i < 24; i++) {
      await sleep(80);
      input = document.getElementById("od2CommsInput");
      if (input && input.offsetParent !== null) break;
    }
    if (!input) return;
    const closedNotice = document.getElementById("od2CommsClosedNotice");
    if (closedNotice && closedNotice.offsetParent !== null) {
      const startBtn = document.getElementById("od2ChatToggleBtn");
      if (startBtn && /start chat/i.test(startBtn.textContent || "")) startBtn.click();
      await sleep(200);
    }
    setFieldValue(input, text);
    autoResizeTextarea(input);
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
  }

  async function ensureNativeChatOpen() {
    const chatPanel = document.getElementById("od2ChatPanel");
    const fab = document.getElementById("od2ChatFab");
    if (!chatPanel || !fab) return false;
    if (chatPanel.classList.contains("is-open")) return true;
    window.__mgOpeningCommsInternal = true;
    try { fab.click(); } finally { window.__mgOpeningCommsInternal = false; }
    for (let i = 0; i < 40; i++) {
      await sleep(50);
      if (chatPanel.classList.contains("is-open")) return true;
    }
    return false;
  }

  function bindEmbeddedChatClose() {
    const nativeClose = document.getElementById("od2ChatPanelClose");
    if (!nativeClose || nativeClose.dataset.mgBound) return;
    nativeClose.dataset.mgBound = "1";
    nativeClose.addEventListener("click", (e) => {
      if (!commsMode) return;
      e.preventDefault();
      e.stopPropagation();
      closePanel();
    }, true);
  }

  function embedNativeChat() {
    const chatPanel = document.getElementById("od2ChatPanel");
    if (!chatPanel || !chatSlot) return false;
    if (!chatOriginalParent) chatOriginalParent = chatPanel.parentElement;
    chatPanel.classList.add("mg-comms-embedded");
    chatSlot.appendChild(chatPanel);
    panel.classList.add("mg-comms-mode");
    commsMode = true;
    bindEmbeddedChatClose();
    bindCommsInputAutoResize();
    return true;
  }

  function unembedNativeChat() {
    const chatPanel = document.getElementById("od2ChatPanel");
    if (!chatPanel) return;
    chatPanel.classList.remove("mg-comms-embedded");
    if (chatOriginalParent && chatOriginalParent.isConnected) {
      chatOriginalParent.appendChild(chatPanel);
    } else {
      document.body.appendChild(chatPanel);
    }
    panel.classList.remove("mg-comms-mode");
    commsMode = false;
  }

  async function openCommsModal() {
    if (panel.classList.contains("open") && commsMode) {
      document.getElementById("od2CommsInput")?.focus();
      return;
    }
    const ok = await ensureNativeChatOpen();
    if (!ok) return;
    selectedKey = CUSTOM_MACRO_KEY;
    customDetailMode = "write";
    hideAiResult();
    embedNativeChat();
    openPanel();
    renderList();
    renderDetail();
    setTimeout(() => detailPreview.focus(), 120);
  }

  async function openMacrosOnlyModal() {
    if (panel.classList.contains("open") && commsMode) {
      closePanel();
      await sleep(220);
    }
    openPanel();
  }

  async function refreshMacroData() {
    categories = await getMacroCategoriesForPopout();
    if (activeCatId !== "all" && !categories.some(c => c.id === activeCatId)) {
      activeCatId = "all";
    }
    renderCatNav();
    renderList();
  }

  function openPanel() {
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setTimeout(() => searchEl.focus(), 80);
  }

  function closePanel() {
    if (commsMode) {
      unembedNativeChat();
      const nativeClose = document.getElementById("od2ChatPanelClose");
      if (nativeClose) nativeClose.click();
    }
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  window.__mgOpenMacroModal = openMacrosOnlyModal;
  window.__mgOpenCommsModal = openCommsModal;
  window.__mgCloseMacroModal = closePanel;

  tab.addEventListener("click", () => {
    panel.classList.contains("open") ? closePanel() : openMacrosOnlyModal();
  });
  backdrop.addEventListener("click", closePanel);
  closeBtn.addEventListener("click", closePanel);
  copyBtn.addEventListener("click", copySelected);
  insertBtn.addEventListener("click", insertIntoChat);
  if (aiGenerateBtn) aiGenerateBtn.addEventListener("click", runAiGenerate);
  if (aiSettingsBtn) {
    aiSettingsBtn.addEventListener("click", () => {
      try {
        if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
        else window.open(chrome.runtime.getURL("options.html"));
      } catch (_) {}
    });
  }
  if (customTabs) {
    customTabs.querySelectorAll(".mg-custom-tab").forEach((btn) => {
      btn.addEventListener("click", () => setCustomDetailMode(btn.dataset.mode));
    });
  }
  if (aiUseEditorBtn) aiUseEditorBtn.addEventListener("click", useAiDraftInEditor);
  if (aiInsertChatBtn) aiInsertChatBtn.addEventListener("click", insertAiDraftIntoChat);
  if (aiCopyResultBtn) {
    aiCopyResultBtn.addEventListener("click", async () => {
      const text = String(aiResult?.value || "").trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (_) {}
        document.body.removeChild(ta);
      }
      aiCopyResultBtn.classList.add("copied");
      const prev = aiCopyResultBtn.textContent;
      aiCopyResultBtn.textContent = "Copied ✓";
      setTimeout(() => {
        aiCopyResultBtn.classList.remove("copied");
        aiCopyResultBtn.textContent = prev;
      }, 1600);
    });
  }
  if (aiPrompt) {
    aiPrompt.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      runAiGenerate();
    });
  }
  searchEl.addEventListener("input", () => { renderCatNav(); renderList(); });

  const _keydownHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
      e.preventDefault();
      panel.classList.contains("open") ? closePanel() : openMacrosOnlyModal();
    }
    if (e.key === "Escape" && panel.classList.contains("open")) closePanel();
  };
  window.addEventListener("keydown", _keydownHandler);
  window.__mgMacroKeydown = _keydownHandler;

  refreshMacroData();

  if (!window.__mgMacroStorageListenerInstalled) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.email_macros && document.getElementById("mg-macro-panel")) {
          try { refreshMacroData(); } catch (_) {}
        }
        if (area === "sync" && (changes.openai_key || changes.server_url)) {
          try { refreshAiStatusHint(); } catch (_) {}
        }
      });
      window.__mgMacroStorageListenerInstalled = true;
    } catch (_) {}
  }
}

function injectChatFabHijack() {
  const fab = document.getElementById("od2ChatFab");
  if (!fab || fab.dataset.mgHijacked) return;
  fab.dataset.mgHijacked = "1";

  const onFabActivate = (e) => {
    if (window.__mgOpeningCommsInternal) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (typeof window.__mgOpenCommsModal === "function") window.__mgOpenCommsModal();
    else injectMacroModal();
  };

  fab.addEventListener("click", onFabActivate, true);
  fab.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") onFabActivate(e);
  }, true);
}

function _mgEnsureMacro() {
  try {
    if (!document.body) return;
    if (!document.getElementById("mg-macro-backdrop") || !document.getElementById("mg-macro-panel")) {
      injectMacroModal();
      console.log("[MediGuard] Macros modal injected");
    }
    injectChatFabHijack();
  } catch (e) {
    console.warn("[MediGuard] Macros inject failed:", e);
  }
}
if (document.body) _mgEnsureMacro();
else document.addEventListener("DOMContentLoaded", _mgEnsureMacro, { once: true });
window.addEventListener("load", _mgEnsureMacro);
[300, 800, 1500, 3000, 6000].forEach(ms => setTimeout(_mgEnsureMacro, ms));
try {
  const _mgMacObs = new MutationObserver(() => {
    if (!document.getElementById("mg-macro-backdrop") || !document.getElementById("mg-macro-panel")) {
      _mgEnsureMacro();
    } else {
      injectChatFabHijack();
    }
  });
  const _mgMacStartObs = () => {
    if (document.body) _mgMacObs.observe(document.body, { childList: true });
  };
  if (document.body) _mgMacStartObs();
  else document.addEventListener("DOMContentLoaded", _mgMacStartObs, { once: true });
} catch (_) {}

// ── NHS SCR link — track tabs opened after "Go to NHS SCR" ─────────────────

const MG_SCR_FIND_PATIENT_URL = "https://portal.spineservices.nhs.uk/nationalcarerecordsservice/app/find_patient";

function mgDecisionScrLinkMarkup() {
  return `
    <span class="ico"><i class="bx bx-right-arrow-alt"></i></span>
    <span class="lbl">
      <span class="t1">Go to NHS SCR</span>
    </span>
  `;
}

function mgDecisionScrLinkIsReady(link, urgentBtn, decisionCard) {
  if (!link || !urgentBtn || !decisionCard) return false;
  return link.getAttribute("href") === MG_SCR_FIND_PATIENT_URL
    && link.classList.contains("od2-action")
    && link.classList.contains("action-scr")
    && link.parentElement === decisionCard
    && link.previousElementSibling === urgentBtn
    && link.querySelector(".t1")?.textContent?.trim() === "Go to NHS SCR"
    && !link.querySelector(".t2");
}

function mgApplyDecisionScrLink(link) {
  link.href = MG_SCR_FIND_PATIENT_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "od2-action action-scr scr-cta";
  if (link.innerHTML.trim() !== mgDecisionScrLinkMarkup().trim()) {
    link.innerHTML = mgDecisionScrLinkMarkup();
  }
}

function injectDecisionScrLinkStyles() {
  let style = document.getElementById("mg-decision-scr-styles");
  if (!style) {
    style = document.createElement("style");
    style.id = "mg-decision-scr-styles";
    document.documentElement.appendChild(style);
  }
  style.textContent = `
    a#mg-decision-scr-link.od2-action.action-scr {
      border: 1px solid #ddd6fe;
      background: linear-gradient(180deg, #faf5ff 0%, #f5f3ff 100%);
      text-decoration: none;
      color: inherit;
    }
    a#mg-decision-scr-link.od2-action.action-scr:hover {
      background: linear-gradient(180deg, #f5f3ff 0%, #ede9fe 100%);
      border-color: #c4b5fd;
    }
    a#mg-decision-scr-link.od2-action.action-scr:active {
      transform: translateY(1px);
    }
    a#mg-decision-scr-link.od2-action.action-scr .ico {
      width: 28px;
      height: 28px;
      min-width: 28px;
      min-height: 28px;
      max-width: 28px;
      max-height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      align-self: center;
      flex-shrink: 0;
      border-radius: 6px;
      font-size: 14px;
      background: #ddd6fe;
      color: #7c3aed;
    }
    a#mg-decision-scr-link.od2-action.action-scr .t1 {
      color: #5b21b6;
    }
  `;
}

function mgSyncDecisionScrLinkSize() {
  const ref = document.getElementById("od2UrgentBtn") || document.querySelector(".od2-card .od2-action");
  const link = document.getElementById("mg-decision-scr-link");
  if (!ref || !link) return;

  const refStyle = getComputedStyle(ref);
  const refRect = ref.getBoundingClientRect();
  const btnH = Math.round(refRect.height);

  ["display", "alignItems", "flexDirection", "borderRadius", "marginTop", "marginBottom", "padding", "gap"].forEach((prop) => {
    link.style[prop] = refStyle[prop];
  });
  if (btnH > 0) link.style.minHeight = `${btnH}px`;

  const refIco = ref.querySelector(".ico");
  const linkIco = link.querySelector(".ico");
  if (refIco && linkIco) {
    const icoStyle = getComputedStyle(refIco);
    ["display", "alignItems", "justifyContent", "alignSelf", "borderRadius", "fontSize", "padding"].forEach((prop) => {
      linkIco.style[prop] = icoStyle[prop];
    });
    linkIco.style.width = "28px";
    linkIco.style.height = "28px";
    linkIco.style.minWidth = "28px";
    linkIco.style.minHeight = "28px";
    linkIco.style.maxWidth = "28px";
    linkIco.style.maxHeight = "28px";
  }

  const refLbl = ref.querySelector(".lbl");
  const linkLbl = link.querySelector(".lbl");
  if (refLbl && linkLbl) {
    const lblStyle = getComputedStyle(refLbl);
    ["display", "flexDirection", "justifyContent", "alignItems", "padding", "gap", "flex"].forEach((prop) => {
      linkLbl.style[prop] = lblStyle[prop];
    });
  }

  const refT1 = ref.querySelector(".t1");
  const t1 = link.querySelector(".t1");
  if (refT1 && t1) {
    const s = getComputedStyle(refT1);
    t1.style.fontSize = s.fontSize;
    t1.style.fontWeight = s.fontWeight;
    t1.style.lineHeight = s.lineHeight;
  }
}

function ensureDecisionScrLink() {
  const urgentBtn = document.getElementById("od2UrgentBtn");
  const decisionCard = urgentBtn?.closest(".od2-card");
  if (!urgentBtn || !decisionCard) return false;

  injectDecisionScrLinkStyles();

  let link = document.getElementById("mg-decision-scr-link");
  if (!link) {
    link = document.createElement("a");
    link.id = "mg-decision-scr-link";
  }

  if (mgDecisionScrLinkIsReady(link, urgentBtn, decisionCard)) {
    mgSyncDecisionScrLinkSize();
    return true;
  }

  mgApplyDecisionScrLink(link);

  if (link.parentElement !== decisionCard || link.previousElementSibling !== urgentBtn) {
    urgentBtn.insertAdjacentElement("afterend", link);
  }

  mgSyncDecisionScrLinkSize();
  requestAnimationFrame(() => mgSyncDecisionScrLinkSize());
  return true;
}

function initDecisionScrLinkEarly() {
  injectDecisionScrLinkStyles();

  let debounceTimer = null;
  let pollId = null;
  let polls = 0;

  const tryInject = () => {
    try {
      if (ensureDecisionScrLink()) {
        if (pollId) {
          clearInterval(pollId);
          pollId = null;
        }
      }
    } catch (_) {}
  };

  const scheduleTry = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      tryInject();
    }, 150);
  };

  tryInject();

  if (window.__mgDecisionScrLinkObs) return;
  window.__mgDecisionScrLinkObs = true;

  const obs = new MutationObserver(scheduleTry);
  const attachObs = () => {
    const root = document.querySelector(".od2-col-right");
    if (root) obs.observe(root, { childList: true, subtree: true });
  };
  if (document.body) attachObs();
  else document.addEventListener("DOMContentLoaded", attachObs, { once: true });

  pollId = setInterval(() => {
    tryInject();
    if (mgDecisionScrLinkIsReady(
      document.getElementById("mg-decision-scr-link"),
      document.getElementById("od2UrgentBtn"),
      document.getElementById("od2UrgentBtn")?.closest(".od2-card")
    ) || ++polls >= 40) {
      clearInterval(pollId);
      pollId = null;
    }
  }, 250);
}

function ensureDecisionScrLinkObserver() {
  initDecisionScrLinkEarly();
}

function initScrLinkTracking() {
  if (window.__mgScrLinkTracking) return;
  window.__mgScrLinkTracking = true;
  document.addEventListener("click", (e) => {
    const link = e.target.closest('a.scr-cta, a[href*="portal.spineservices.nhs.uk"]');
    if (!link) return;
    try {
      chrome.runtime.sendMessage({
        type: "SCR_LINK_CLICKED",
        returnUrl: window.location.href,
      }, () => { void chrome.runtime.lastError; });
    } catch (_) {}
  }, true);
}
if (document.body) initScrLinkTracking();
else document.addEventListener("DOMContentLoaded", initScrLinkTracking, { once: true });

initDecisionScrLinkEarly();
