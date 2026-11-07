/** In-page clinical check (Send to dispensary). Mirrors content.js + comms/decision fallbacks. */
export const CLINICAL_CHECK_SOURCE = `async (scrMode = "not_accessed") => {
  const DEFAULTS = {
    scr: "SCR not available, information provided by the patient.",
    counselling:
      "Patient has been contacted by email and provided counselling and information on their treatment. Patient can contact us at any time if they need further help or information.",
    rationale:
      "The patient meets the service eligibility criteria. The consultation responses, medical history, current medication, allergies and supporting documentation have been reviewed. No known contraindications, clinically significant interactions, red flags or other concerns have been identified.\\n\\nBased on the information available at the time of assessment, prescribing is considered clinically appropriate. Appropriate counselling, monitoring, follow-up and safety-netting advice have been provided. Prescription approved.",
  };
  const useScrAccessed = scrMode === "accessed";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const todayIso = () => {
    const t = new Date();
    return \`\${t.getFullYear()}-\${String(t.getMonth() + 1).padStart(2, "0")}-\${String(t.getDate()).padStart(2, "0")}\`;
  };
  const waitForEl = async (sel, ms = 8000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const el = document.querySelector(sel);
      if (el && (el.offsetParent !== null || ["INPUT", "TEXTAREA", "BUTTON"].includes(el.tagName)))
        return el;
      await sleep(80);
    }
    return null;
  };
  const waitBtn = async (sel, ms = 8000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const b = document.querySelector(sel);
      if (b && !b.disabled) return b;
      await sleep(80);
    }
    return null;
  };
  const clickRadio = (input) => {
    if (!input) return false;
    input.closest("label")?.click();
    input.checked = true;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (!input.checked) input.click();
    return input.checked;
  };
  const setVal = (el, v) => {
    if (!el) return;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  const disp = await waitForEl('.od2-action[data-action="dispensary"]', 20000);
  if (!disp) return { ok: false, err: "no dispensary action" };
  disp.click();
  await sleep(500);

  const visibleP2u = () =>
    [...document.querySelectorAll("#rxaP2uQuestions .rxa-p2u-q")].find(
      (el) => el.offsetParent !== null
    );
  let p2u = visibleP2u();
  if (!p2u) {
    const scrSel = useScrAccessed
      ? 'input[name="rxa_scr_status"][value="accessed"]'
      : 'input[name="rxa_scr_status"][value="not_accessed"]';
    const scr = await waitForEl(scrSel, 8000);
    if (scr) {
      await sleep(250);
      clickRadio(scr);
      await sleep(250);
      if (useScrAccessed) {
        setVal(document.querySelector("#rxaScrSummary"), DEFAULTS.scr);
        for (const id of [
          "rxaScrConsentRecorded",
          "rxaScrMedicationsReviewed",
          "rxaScrAllergiesChecked",
          "rxaScrDiagnosesAssessed",
        ]) {
          const cb = document.getElementById(id);
          if (cb && !cb.checked) clickRadio(cb);
        }
      } else {
        setVal(document.querySelector("#rxaScrNotAccessedReason"), DEFAULTS.scr);
      }
    }
    const comm = await waitForEl('input[name="rxa_comm_method"][value="secure_message"]', 3000);
    if (comm) {
      clickRadio(comm);
      await sleep(150);
      setVal(document.querySelector("#rxaCommDate"), todayIso());
      setVal(document.querySelector("#rxaCommSummary"), DEFAULTS.counselling);
    }
    const cont = await waitBtn("#rxaContinueBtn", 8000);
    if (cont && !visibleP2u()) {
      cont.click();
      await sleep(700);
    }
  }

  p2u = visibleP2u();
  if (p2u) {
    let filled = 0;
    document.querySelectorAll("#rxaP2uQuestions .rxa-p2u-q, .rxa-p2u-q").forEach((qEl) => {
      const expected = String(qEl.getAttribute("data-p2u-expected") || "")
        .trim()
        .toLowerCase();
      if (!expected) return;
      const field = qEl.getAttribute("data-p2u-field");
      let radio = qEl.querySelector(\`input[type="radio"][value="\${expected}"]\`);
      if (!radio && field) {
        radio = document.querySelector(\`input[type="radio"][name="\${field}"][value="\${expected}"]\`);
      }
      if (radio) {
        clickRadio(radio);
        filled += 1;
        return;
      }
      for (const el of qEl.querySelectorAll("button, label, .rxa-pill, .rxa-choice, span")) {
        const t = el.textContent.trim().toLowerCase();
        if (t === expected || t.startsWith(\`\${expected} \`)) {
          el.click();
          filled += 1;
          return;
        }
      }
    });
    if (!filled) return { ok: false, err: "p2u not filled" };
  } else {
    for (const sel of [
      'input[name="rxa_escalated"][value="no"]',
      'input[name="rxa_escalation_required"][value="no"]',
      'input[name="rxa_escalation"][value="no"]',
    ]) {
      const esc = document.querySelector(sel);
      if (esc) clickRadio(esc);
    }
    for (const sel of [
      'input[name="rxa_final_decision"][value="approved_for_supply"]',
      'input[name="rxa_final_decision"][value="approved"]',
    ]) {
      const appr = document.querySelector(sel);
      if (appr) clickRadio(appr);
    }
    const rat = document.querySelector("#rxaFinalRationale, textarea[name='rxa_final_rationale']");
    if (rat) setVal(rat, DEFAULTS.rationale);
  }

  for (let step = 0; step < 4; step++) {
    const appr = document.querySelector("#rxaApproveBtn:not([disabled])");
    if (appr && (appr.offsetParent !== null || appr.textContent.includes("dispensary"))) break;
    const cont = document.querySelector("#rxaContinueBtn:not([disabled])");
    if (cont) {
      cont.click();
      await sleep(700);
    } else break;
  }

  await sleep(300);
  const approve = await waitBtn("#rxaApproveBtn", 10000);
  if (!approve) {
    return {
      prep: "failed",
      err: "approve disabled",
      panel: document.querySelector("#rxaDrawer")?.innerText?.slice(0, 400),
    };
  }
  return { prep: "ready", path: location.pathname };
}`;

async function nativeApproveAndVerify(page) {
  const btn = page.locator("#rxaApproveBtn:not([disabled])");
  await btn.waitFor({ state: "visible", timeout: 15000 });
  await btn.click({ timeout: 15000 });
  for (let i = 0; i < 40; i++) {
    const swal = page.locator(".swal2-popup.swal2-show .swal2-confirm");
    if (await swal.count()) {
      await swal.first().click({ timeout: 3000 }).catch(() => {});
    }
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2800);
  const stillDispensary = await page.locator('.od2-action[data-action="dispensary"]').count();
  if (stillDispensary) {
    return { ok: false, err: "Submit did not complete — dispensary action still present" };
  }
  const path = await page.evaluate(() => location.pathname);
  return { ok: true, path };
}

export const QUEUE_URL = "https://rx.everydaymeds.co.uk/pending-orders-new?tab=rx_approved";

export async function runClinicalCheckOnPage(page, scrMode = "not_accessed") {
  const prep = await page.evaluate(
    async (source, mode) => {
      const fn = (0, eval)(`(${source})`);
      return fn(mode);
    },
    CLINICAL_CHECK_SOURCE,
    scrMode
  );
  if (prep?.ok === false && prep?.err) return prep;
  if (prep?.prep === "failed") return { ok: false, err: prep.err, panel: prep.panel };
  if (prep?.prep !== "ready") return { ok: false, err: prep?.err || "clinical prep failed" };
  const done = await nativeApproveAndVerify(page);
  return { ...done, path: done.path || prep.path };
}

export async function ensureClinicalTab(page) {
  const tab = page.locator('button.pq-status-tab[data-status="rx_approved"]');
  if (await tab.count()) {
    await tab.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
}

export async function firstOrderUrl(page) {
  return page.evaluate(() => {
    const tr = document.querySelector("#pqTableWrap tr.pq-row[data-detail-url]");
    const p = tr?.getAttribute("data-detail-url");
    if (!p) return null;
    return p.startsWith("http") ? p : `${location.origin}${p}`;
  });
}
