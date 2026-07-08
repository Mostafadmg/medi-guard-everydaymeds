// MediGuard AI (EverydayMeds) — Options Script

const DEFAULT_SERVER_URL = "https://6953ffd7-1719-4bf3-8baf-cd9245046e01-00-2kzcudwa3v17m.picard.replit.dev";

const BUILTIN_SCR = "SCR not available, information provided by the patient.";
const BUILTIN_SCR_ACCESSED = "SCR accessed and checked no contraindication found or any concerns, happy to continue.";
const BUILTIN_COUNSELLING = "Patient has been contacted by email and provided counselling and information on their treatment. Patient can contact us at any time if they need further help or information.";
const BUILTIN_RATIONALE = "The patient meets the service eligibility criteria. The consultation responses, medical history, current medication, allergies and supporting documentation have been reviewed. No known contraindications, clinically significant interactions, red flags or other concerns have been identified.\n\nBased on the information available at the time of assessment, prescribing is considered clinically appropriate. Appropriate counselling, monitoring, follow-up and safety-netting advice have been provided. Prescription approved.";
const BUILTIN_HOLD = "Waiting for patient to upload documents.";
const BUILTIN_APPROVE_PATIENT_MESSAGE = `Dear Patient,

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
const BUILTIN_QUICK_HOLDS = [
  {
    name: "Previous Prescription",
    text: "Patient needs to upload a valid previous prescription that includes:\n- Name\n- Date of dispensing/order\n- Medication name and dose\n- Pharmacy / prescriber details",
  },
  {
    name: "Loose Clothing",
    text: "Loose Clothing, patient should upload a new video with appropriate clothes showing body shape.",
  },
  {
    name: "Invalid Full Body Video",
    text: "Invalid Full Body Video, cannot see the entire body to establish BMI eligibility",
  },
  {
    name: "Check Comorbidity",
    text: "check comorbidity as patient is not currently eligible, and may be eligible if has known comorbidity",
  },
  {
    name: "PP Date Missing",
    text: "Previous Prescription does not contain Date of Order/Dispense",
  },
  {
    name: "Last Injection",
    text: "need to confirm last injected dose, to establish dose appropriateness",
  },
  {
    name: "Weight and Height",
    text: "Patient Must Enter Both Weight and Height To establish BMI",
  },
  {
    name: "Invalid Scale Video",
    text: "Invalid Scale Video not meeting criteria, must show face and scale readings must be visible",
  },
  {
    name: "Documents",
    text: "Waiting for patient to upload the required documents to verify identity and proof of previous use.",
  },
];

document.addEventListener("DOMContentLoaded", () => {
  const serverUrlInput = document.getElementById("serverUrl");
  const apiKeyInput = document.getElementById("apiKey");
  const assistantIdInput = document.getElementById("assistantId");
  const scrAccessedInput = document.getElementById("scrAccessedText");
  const scrInput = document.getElementById("scrText");
  const counsellingInput = document.getElementById("counsellingText");
  const rationaleInput = document.getElementById("rationaleText");
  const holdInput = document.getElementById("holdReasonText");
  const approvePatientMsgInput = document.getElementById("approvePatientMessageText");
  const saveBtn = document.getElementById("save");
  const resetBtn = document.getElementById("resetDefaults");
  const statusDiv = document.getElementById("status");

  // ── Quick-chip lists (one for rx-comment, one for hold-comment) ──
  // Both share the same row UI; only the placeholder/empty-state copy and
  // the storage key differ, so we build them with a small factory.
  function makeQuickChipManager({ listId, addBtnId, resetBtnId, namePlaceholder, textPlaceholder, emptyMsg, builtin }) {
    const listEl = document.getElementById(listId);
    const addBtn = document.getElementById(addBtnId);
    const resetBtn = document.getElementById(resetBtnId);

    function renderRow(item) {
      const row = document.createElement("div");
      row.className = "qc-row";
      row.innerHTML = `
        <input type="text" class="qc-name" />
        <textarea class="qc-text" rows="3"></textarea>
        <button type="button" class="qc-del" title="Remove this button">Delete</button>
      `;
      row.querySelector(".qc-name").placeholder = namePlaceholder;
      row.querySelector(".qc-text").placeholder = textPlaceholder;
      row.querySelector(".qc-name").value = (item && item.name) || "";
      row.querySelector(".qc-text").value = (item && item.text) || "";
      row.querySelector(".qc-del").addEventListener("click", () => {
        row.remove();
        if (!listEl.querySelector(".qc-row")) renderEmpty();
      });
      return row;
    }
    function renderEmpty() {
      listEl.innerHTML = `<div class="qc-empty">${emptyMsg}</div>`;
    }
    function render(items) {
      listEl.innerHTML = "";
      if (!items || !items.length) { renderEmpty(); return; }
      items.forEach((it) => listEl.appendChild(renderRow(it)));
    }
    function read() {
      const out = [];
      listEl.querySelectorAll(".qc-row").forEach((r) => {
        const name = r.querySelector(".qc-name").value.trim();
        const text = r.querySelector(".qc-text").value.trim();
        if (name && text) out.push({ name, text });
      });
      return out;
    }
    addBtn.addEventListener("click", () => {
      if (listEl.querySelector(".qc-empty")) listEl.innerHTML = "";
      listEl.appendChild(renderRow({ name: "", text: "" }));
    });
    resetBtn.addEventListener("click", () => render(builtin));
    return { render, read };
  }

  const qcMgr = makeQuickChipManager({
    listId: "quickCommentsList", addBtnId: "addQuickComment", resetBtnId: "resetQuickComments",
    namePlaceholder: "Button name (e.g. Repeat)",
    textPlaceholder: "Text that gets dropped into the comment box when this button is clicked.",
    emptyMsg: 'No quick-comment buttons. Click "+ Add button" to create one.',
    builtin: BUILTIN_QUICK_COMMENTS,
  });
  const qhMgr = makeQuickChipManager({
    listId: "quickHoldsList", addBtnId: "addQuickHold", resetBtnId: "resetQuickHolds",
    namePlaceholder: "Button name (e.g. Documents)",
    textPlaceholder: "Text that gets appended to the hold reason when this button is clicked.",
    emptyMsg: 'No quick hold-reason buttons. Click "+ Add button" to create one.',
    builtin: BUILTIN_QUICK_HOLDS,
  });
  chrome.storage.sync.get(
    ["server_url", "openai_key", "assistant_id", "initialized",
     "default_scr_text", "default_scr_accessed_text", "default_counselling_text", "default_rationale_text", "default_hold_reason",
     "default_approve_patient_message",
     "quick_comment_buttons", "quick_hold_buttons", "ui_zoom", "show_workflow_steps", "show_email_section",
     "show_dose_calculator", "show_gap_calculator"],
    (result) => {
      if (DEFAULT_SERVER_URL && !result.initialized) {
        chrome.storage.sync.set({ server_url: DEFAULT_SERVER_URL, initialized: true });
        serverUrlInput.value = DEFAULT_SERVER_URL;
        statusDiv.innerHTML = "✅ <strong>Auto-configured!</strong> Server URL set automatically.";
        statusDiv.className = "status success";
      } else if (result.server_url) {
        serverUrlInput.value = result.server_url;
      }
      if (result.openai_key) apiKeyInput.value = result.openai_key;
      if (result.assistant_id) assistantIdInput.value = result.assistant_id;
      if (scrAccessedInput) scrAccessedInput.value = result.default_scr_accessed_text || BUILTIN_SCR_ACCESSED;
      scrInput.value = result.default_scr_text || BUILTIN_SCR;
      counsellingInput.value = result.default_counselling_text || BUILTIN_COUNSELLING;
      rationaleInput.value = result.default_rationale_text || BUILTIN_RATIONALE;
      if (holdInput) holdInput.value = result.default_hold_reason || BUILTIN_HOLD;
      if (approvePatientMsgInput) approvePatientMsgInput.value = result.default_approve_patient_message || BUILTIN_APPROVE_PATIENT_MESSAGE;
      const showStepsInput = document.getElementById("showWorkflowSteps");
      if (showStepsInput) showStepsInput.checked = result.show_workflow_steps !== false;
      const showEmailInput = document.getElementById("showEmailSection");
      if (showEmailInput) showEmailInput.checked = result.show_email_section === true;
      const showDoseInput = document.getElementById("showDoseCalculator");
      if (showDoseInput) showDoseInput.checked = result.show_dose_calculator === true;
      const showGapInput = document.getElementById("showGapCalculator");
      if (showGapInput) showGapInput.checked = result.show_gap_calculator === true;
      const qcSaved = Array.isArray(result.quick_comment_buttons) ? result.quick_comment_buttons : null;
      qcMgr.render(qcSaved && qcSaved.length ? qcSaved : BUILTIN_QUICK_COMMENTS);
      const qhSaved = Array.isArray(result.quick_hold_buttons) ? result.quick_hold_buttons : null;
      qhMgr.render(qhSaved && qhSaved.length ? qhSaved : BUILTIN_QUICK_HOLDS);

      // UI zoom slider (80–150%, default 100)
      const zoomInput = document.getElementById("uiZoom");
      const zoomValue = document.getElementById("uiZoomValue");
      if (zoomInput && zoomValue) {
        let z = parseInt(result.ui_zoom, 10);
        if (!Number.isFinite(z)) z = 100;
        z = Math.max(80, Math.min(200, z));
        zoomInput.value = String(z);
        zoomValue.textContent = z + "%";
        zoomInput.addEventListener("input", () => {
          zoomValue.textContent = zoomInput.value + "%";
        });
      }
    }
  );

  resetBtn.addEventListener("click", () => {
    if (scrAccessedInput) scrAccessedInput.value = BUILTIN_SCR_ACCESSED;
    scrInput.value = BUILTIN_SCR;
    counsellingInput.value = BUILTIN_COUNSELLING;
    rationaleInput.value = BUILTIN_RATIONALE;
    if (holdInput) holdInput.value = BUILTIN_HOLD;
    if (approvePatientMsgInput) approvePatientMsgInput.value = BUILTIN_APPROVE_PATIENT_MESSAGE;
    const showStepsInput = document.getElementById("showWorkflowSteps");
    if (showStepsInput) showStepsInput.checked = true;
    const showEmailInput = document.getElementById("showEmailSection");
    if (showEmailInput) showEmailInput.checked = false;
    const showDoseInput = document.getElementById("showDoseCalculator");
    if (showDoseInput) showDoseInput.checked = false;
    const showGapInput = document.getElementById("showGapCalculator");
    if (showGapInput) showGapInput.checked = false;
  });

  saveBtn.addEventListener("click", () => {
    const serverUrl = serverUrlInput.value.trim();
    const key = apiKeyInput.value.trim();
    const assistantId = assistantIdInput.value.trim();
    const scrAccessedText = (scrAccessedInput?.value || "").trim();
    const scrText = scrInput.value.trim();
    const counsellingText = counsellingInput.value.trim();
    const rationaleText = rationaleInput.value.trim();
    const holdText = (holdInput?.value || "").trim();
    const approvePatientMsgText = (approvePatientMsgInput?.value || "").trim();
    const showWorkflowSteps = document.getElementById("showWorkflowSteps")?.checked !== false;
    const showEmailSection = document.getElementById("showEmailSection")?.checked === true;
    const showDoseCalculator = document.getElementById("showDoseCalculator")?.checked === true;
    const showGapCalculator = document.getElementById("showGapCalculator")?.checked === true;

    if (!serverUrl && !key) {
      statusDiv.textContent = "⚠️ Please enter a Server URL or API key.";
      statusDiv.style.backgroundColor = "#fef3c7";
      statusDiv.style.color = "#92400e";
      statusDiv.className = "status";
      return;
    }

    const settings = {
      // Empty input → fall back to built-in on next read by storing empty string;
      // we save explicitly so a user can clear & save to revert to built-in.
      default_scr_text: scrText || BUILTIN_SCR,
      default_scr_accessed_text: scrAccessedText || BUILTIN_SCR_ACCESSED,
      default_counselling_text: counsellingText || BUILTIN_COUNSELLING,
      default_rationale_text: rationaleText || BUILTIN_RATIONALE,
      default_hold_reason: holdText || BUILTIN_HOLD,
      default_approve_patient_message: approvePatientMsgText || BUILTIN_APPROVE_PATIENT_MESSAGE,
      quick_comment_buttons: qcMgr.read(),
      quick_hold_buttons: qhMgr.read(),
      show_workflow_steps: showWorkflowSteps,
      show_email_section: showEmailSection,
      show_dose_calculator: showDoseCalculator,
      show_gap_calculator: showGapCalculator,
      ui_zoom: (() => {
        const el = document.getElementById("uiZoom");
        let z = parseInt(el && el.value, 10);
        if (!Number.isFinite(z)) z = 100;
        return Math.max(80, Math.min(200, z));
      })(),
    };
    if (serverUrl) settings.server_url = serverUrl.replace(/\/$/, "");
    if (key) settings.openai_key = key;
    if (assistantId) settings.assistant_id = assistantId;

    chrome.storage.sync.set(settings, () => {
      let msg = "✅ <strong>Saved!</strong><br>";
      if (serverUrl) msg += `Server: ${serverUrl}<br>`;
      else if (key) msg += "API Key: connected<br>";
      if (assistantId) msg += "Custom Assistant: connected<br>";
      msg += "Approval defaults updated.";
      statusDiv.innerHTML = msg;
      statusDiv.className = "status success";
      setTimeout(() => { statusDiv.textContent = ""; statusDiv.className = "status"; }, 5000);
    });
  });
});
