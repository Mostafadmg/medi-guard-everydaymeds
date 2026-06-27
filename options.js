// MediGuard AI (EverydayMeds) — Options Script

const DEFAULT_SERVER_URL = "https://6953ffd7-1719-4bf3-8baf-cd9245046e01-00-2kzcudwa3v17m.picard.replit.dev";

const BUILTIN_SCR = "SCR not available, information provided by the patient.";
const BUILTIN_SCR_ACCESSED = "SCR accessed and checked no contraindication found or any concerns, happy to continue.";
const BUILTIN_COUNSELLING = "Patient has been contacted by email and provided counselling and information on their treatment. Patient can contact us at any time if they need further help or information.";
const BUILTIN_RATIONALE = "The patient meets the service eligibility criteria. The consultation responses, medical history, current medication, allergies and supporting documentation have been reviewed. No known contraindications, clinically significant interactions, red flags or other concerns have been identified.\n\nBased on the information available at the time of assessment, prescribing is considered clinically appropriate. Appropriate counselling, monitoring, follow-up and safety-netting advice have been provided. Prescription approved.";
const BUILTIN_HOLD = "Waiting for patient to upload documents.";
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
const EMAIL_MACROS_VERSION = 4;
const BUILTIN_EMAIL_SIGNATURE = "Kind Regards,\nMostafa Damghani\nPharmacist Indpendant Prescriber";
const BUILTIN_EMAIL_MACROS = [
  {
    name: "Height/Weight Confirmation",
    text: "Dear Patient,\n\nIn order for us to review your order, we require your most recent height and weight measurements.\n\nPlease reply to this email with your current height and most recent weight so we can continue reviewing and processing your order.\n\nOnce we have received this information, we will be able to proceed with your order review.\n\n" + BUILTIN_EMAIL_SIGNATURE,
  },
  {
    name: "Invalid Documents",
    text: "Dear Patient,\n\nWe are contacting you to ask that you upload the required documents to your account so we can pass your order to the clinical team for review.\n\nIf you have not already done so, please upload the following documents ensuring they meet the criteria below:\n\n- A valid photo ID. The ID must be clear, readable, and in date. Please ensure all four corners of the document are visible and the details can be clearly read by the clinical team.\n\n- A full body video showing your full body in good lighting, wearing fitted clothing that clearly shows your body shape. This is required for us to verify your BMI.\n\n- A weight scale video showing both your face and the reading on the scale clearly visible and readable for the clinical team to proceed with your order.\n\nIf you are a transfer patient (previously recieved weightloss injection from a differenet provider), or have been asked to provide proof of previous use, please upload evidence such as:\n\n- Dispensing label\n- Prescription\n- Order confirmation letter\n- Previous provider correspondence\n\nThe document must clearly show:\n\n- Previous provider name\n- Full name of the patient\n- Date the prescription was issued or the order/dispensed date\n- Name and strength of the medication\n\nIf you are a starter patient and have not been asked to provide previous use proof, please ignore this section.\n\nTo help avoid delays in processing your order, please ensure the uploaded evidence meets all the above criteria. Your order may remain on hold until suitable evidence has been uploaded and reviewed by the clinical team.\n\nOnce uploaded, the clinical team will be able to continue reviewing your order.\n\n" + BUILTIN_EMAIL_SIGNATURE,
  },
  {
    name: "Invalid Weight Scale Video",
    text: "Dear Patient,\n\nWe are contacting you as the weight scale video has either not been uploaded, or the uploaded video does not currently meet the required criteria for clinical review.\n\nPlease upload a new weight scale video that meets the following requirements:\n\n- Your face must be clearly visible\n- The reading on the scale must be clearly visible and readable\n- The video should be clear and taken in good lighting\n- The weight reading should be shown while standing on the scale\n\nTo help avoid delays in processing your order, please ensure the uploaded video meets all the above criteria. Your order may remain on hold until a suitable video has been uploaded and reviewed by the clinical team.\n\nOnce uploaded, we will be able to continue processing your order.\n\n" + BUILTIN_EMAIL_SIGNATURE,
  },
  {
    name: "Invalid Full Body Video",
    text: "Dear Patient,\n\nWe are contacting you as the full body video has either not been uploaded, or the uploaded video does not currently meet the required criteria for clinical review.\n\nPlease upload a full body video that meets the following criteria so we can pass your order to the clinical team for review:\n\n- Full body visible from head to toe\n- Face clearly visible and facing the camera\n- Good lighting with the body clearly visible\n- Wear fitted clothing that shows body shape clearly\n- Avoid loose or baggy clothing such as jumpers, oversized tops, or hoodies\n- Avoid dark clothing where possible, as this can make body shape difficult to assess\n- Video should be clear and not blurred\n\nTo help avoid delays in processing your order, please ensure the uploaded video meets all the above criteria. Your order may remain on hold until a suitable video has been uploaded and reviewed by the clinical team.\n\nOnce uploaded, we will be able to continue processing your order.\n\n" + BUILTIN_EMAIL_SIGNATURE,
  },
  {
    name: "Invalid Previous Prescription",
    text: "Dear Patient,\n\nWe are contacting you as your previous use evidence of weight loss injection has either not been uploaded, or the uploaded evidence does not currently meet the required criteria for clinical review.\n\nIf you have been asked to provide proof of previous use, please upload suitable evidence such as:\n\n- Dispensing label\n- Prescription\n- Order confirmation\n- Previous provider letter or correspondence\n\nThe uploaded document must clearly show:\n\n- Previous provider name\n- Full name of the patient\n- Name and strength of the medication\n- Date the prescription was issued or the order/dispensing date\n\nPlease ensure the document is clear, readable, and not cropped or blurred.\n\nTo help avoid delays in processing your order, please ensure the uploaded evidence meets all the above criteria. Your order may remain on hold until suitable evidence has been uploaded and reviewed by the clinical team.\n\nOnce uploaded, we will be able to continue processing your order.\n\n" + BUILTIN_EMAIL_SIGNATURE,
  },
  {
    name: "Need More Info",
    text: "Dear Patient,\n\nAfter reviewing your request, we require some additional information from you in order to safely process your order.\n\nYour order will remain on hold until we receive the requested information and the clinical team has been able to review it.\n\nWe would appreciate it if you could provide more information regarding the following:\n\n{Please provide details here}\n\nOnce we receive the requested information, we will be able to continue reviewing your order.\n\n" + BUILTIN_EMAIL_SIGNATURE,
  },
  {
    name: "Last Injection Date",
    text: "Hello there,\n\nThank you for getting back in touch.\n\nBased on the information currently available to us, it appears that your last weight loss injection may have been more than 4 weeks ago.\n\nTo help us safely assess your order and determine the most appropriate treatment plan, could you please confirm:\n\n- The date of your last injection\n- The strength/dose of your last injection\n- Whether you have received any treatment from another provider during this period\n\nIf there has been a prolonged break in treatment, it may be necessary for safety reasons to restart from a lower dose and gradually re-titrate. This helps reduce the risk of significant gastrointestinal side effects and improves treatment tolerability.\n\nYour order will remain on hold until we receive the requested information and the clinical team has been able to review it.\n\nOnce we receive your response, we will be able to continue reviewing your order.\n\n" + BUILTIN_EMAIL_SIGNATURE,
  },
  {
    name: "Comorbidity",
    text: "Dear Patient,\n\nCurrently you do not meet the BMI eligibilty threshold for weightloss injection.\n\nTo help us complete the clinical review of your weight loss consultation, could you please confirm whether you have any medical conditions or weight-related comorbidities.\n\nExamples include, but are not limited to:\n\n- High blood pressure\n- High cholesterol\n- Prediabetes or diabetes\n- Heart disease\n- Sleep apnoea\n- PCOS\n- Osteoarthritis\n- Fatty liver disease\n- Acid reflux/GORD\n\nIf you do have any medical conditions, please upload supporting evidence in the Previous Prescription / Supporting Documents section of your account where possible. Examples may include:\n\n- GP letters\n- Clinic letters\n- Repeat prescription screenshots\n- Medication labels\n- NHS app screenshots\n- Recent medical correspondence\n\nThis helps the clinical team assess your eligibility safely and avoid delays in processing your order.\n\n" + BUILTIN_EMAIL_SIGNATURE,
  },
  {
    name: "Invalid WS/FB Videos",
    text: "Dear Patient,\n\nWe are contacting you as the Weight Scale Video and Full Body Video has either not been uploaded, or the uploaded video does not currently meet the required criteria for clinical review.\n\nPlease upload new videos that meet the following requirements:\n\nFull body video:\n\n- Full body visible from head to toe\n- Face clearly visible and facing the camera\n- Good lighting with the body clearly visible\n- Wear fitted clothing that shows body shape clearly\n- Avoid loose or baggy clothing such as jumpers, oversized tops, or hoodies\n- Avoid dark clothing where possible, as this can make body shape difficult to assess\n- Video should be clear and not blurred\n\nWeight scale video:\n\n- Your face must be clearly visible in the video\n- The reading on the scale must be clearly visible and readable\n- Video should be clear and taken in good lighting\n- The weight reading should be shown while standing on the scale\n\nTo help avoid delays in processing your order, please ensure the uploaded videos meet all the above criteria. Your order may remain on hold until suitable videos have been uploaded and reviewed by the clinical team.\n\nOnce uploaded, we will be able to continue processing your order.\n\n" + BUILTIN_EMAIL_SIGNATURE,
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
  const emMgr = makeQuickChipManager({
    listId: "emailMacrosList", addBtnId: "addEmailMacro", resetBtnId: "resetEmailMacros",
    namePlaceholder: "Template title (e.g. General)",
    textPlaceholder: 'Email body. Use {patient_name} where the patient name should appear. Whitespace, indentation and line breaks are preserved when copied.',
    emptyMsg: 'No email templates. Click "+ Add template" to create one.',
    builtin: BUILTIN_EMAIL_MACROS,
  });

  chrome.storage.sync.get(
    ["server_url", "openai_key", "assistant_id", "initialized",
     "default_scr_text", "default_scr_accessed_text", "default_counselling_text", "default_rationale_text", "default_hold_reason",
     "quick_comment_buttons", "quick_hold_buttons", "email_macros", "ui_zoom", "show_workflow_steps"],
    (syncResult) => { chrome.storage.local.get(["email_macros", "email_macros_version"], (localResult) => {
      const result = Object.assign({}, syncResult, {
        email_macros: localResult.email_macros,
        email_macros_version: localResult.email_macros_version,
      });
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
      const showStepsInput = document.getElementById("showWorkflowSteps");
      if (showStepsInput) showStepsInput.checked = result.show_workflow_steps !== false;
      const qcSaved = Array.isArray(result.quick_comment_buttons) ? result.quick_comment_buttons : null;
      qcMgr.render(qcSaved && qcSaved.length ? qcSaved : BUILTIN_QUICK_COMMENTS);
      const qhSaved = Array.isArray(result.quick_hold_buttons) ? result.quick_hold_buttons : null;
      qhMgr.render(qhSaved && qhSaved.length ? qhSaved : BUILTIN_QUICK_HOLDS);
      const emSaved = Array.isArray(result.email_macros) ? result.email_macros : null;
      // Version-based migration: when the builtin library is updated (e.g. new
      // Comorbidity template), bump EMAIL_MACROS_VERSION and stale saves are
      // replaced. Stored in chrome.storage.local because the full set is >8KB,
      // which exceeds chrome.storage.sync's per-item quota and would silently
      // fail to save (the bug behind manual adds not persisting).
      const versionMismatch = result.email_macros_version !== EMAIL_MACROS_VERSION;
      const emToRender = (!emSaved || !emSaved.length || versionMismatch)
        ? BUILTIN_EMAIL_MACROS
        : emSaved;
      emMgr.render(emToRender);
      if (!emSaved || !emSaved.length || versionMismatch) {
        try { chrome.storage.local.set({ email_macros: BUILTIN_EMAIL_MACROS, email_macros_version: EMAIL_MACROS_VERSION }); } catch {}
        // Clean up any stale email_macros stuck in sync storage.
        try { chrome.storage.sync.remove("email_macros"); } catch {}
      }

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
    }); }
  );

  resetBtn.addEventListener("click", () => {
    if (scrAccessedInput) scrAccessedInput.value = BUILTIN_SCR_ACCESSED;
    scrInput.value = BUILTIN_SCR;
    counsellingInput.value = BUILTIN_COUNSELLING;
    rationaleInput.value = BUILTIN_RATIONALE;
    if (holdInput) holdInput.value = BUILTIN_HOLD;
    const showStepsInput = document.getElementById("showWorkflowSteps");
    if (showStepsInput) showStepsInput.checked = true;
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
    const showWorkflowSteps = document.getElementById("showWorkflowSteps")?.checked !== false;

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
      quick_comment_buttons: qcMgr.read(),
      quick_hold_buttons: qhMgr.read(),
      show_workflow_steps: showWorkflowSteps,
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

    // Email macros live in chrome.storage.local (sync's 8KB per-item quota
    // is too small for the full builtin set + any user-added templates).
    try {
      chrome.storage.local.set({
        email_macros: emMgr.read(),
        email_macros_version: EMAIL_MACROS_VERSION,
      });
    } catch {}
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
