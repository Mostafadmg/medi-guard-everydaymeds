/**
 * Generates email-macros-data.js from sanitized macro definitions.
 * Run: node scripts/build-email-macros.js
 */
const fs = require("fs");
const path = require("path");

const SIG = "Kind regards,\\nEveryDayMeds Clinical Team";

function body(text) {
  let t = text.trim();
  t = t.replace(/^(\[[^\]]+\]\s*\n+)?Subject:\s*[^\n]+\n+/i, "");
  t = t.replace(/<<Patient Name>>|\[Patient Name\]/g, "{patient_name}");
  t = t.replace(/Dear Customer,/g, "Dear {patient_name},");
  t = t.replace(/Dear Patient,/g, "Dear {patient_name},");
  t = t.replace(/Hello there,/g, "Hello {patient_name},");
  t = t.replace(/Hi <<Patient Name>>,/g, "Hi {patient_name},");
  t = t.replace(/MedExpress/g, "EveryDayMeds");
  t = t.replace(/\n\nIf you require any assistance[^\n]*0208[^\n]*\.\n/gi, "\n");
  t = t.replace(/\nIf you need further assistance[^\n]*0208[^\n]*\.\n/gi, "\n");
  t = t.replace(/\nIf you require any assistance[^\n]*Customer Support[^\n]*\.\n/gi, "\n");
  t = t.replace(/\nKind [Rr]egards,\s*\n(?:MedExpress|EveryDayMeds) Clinical Team\s*$/g, "");
  t = t.replace(/\nKind regards,\s*\n(?:MedExpress|EveryDayMeds) Clinical Team\s*$/g, "");
  if (!t.endsWith(SIG.replace(/\\n/g, "\n"))) {
    t += "\n\n" + SIG.replace(/\\n/g, "\n");
  }
  return t;
}

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

const categories = [
  {
    id: "scr", label: "SCR / Clinical", icon: "📋",
    macros: [
      { name: "SCR Macro 1 - Time Sensitive Conditions", tag: "SCR", desc: "Confirm timing of conditions from Table 2", raw: `Subject: EverydayMeds Order (Action required) - Request for Further Information About Your Medical History

Dear [Patient Name],

Thank you for your recent order with EverydayMeds.

I can see from your records that you have had [X condition listed on Table 2].

Could you please provide us with a bit more information about when this occurred and any relevant details you feel may be important?

Your response will help us ensure that we have an accurate and up-to-date understanding of your medical history when reviewing your request.

Your order will be placed on hold whilst we await your response.` },
      { name: "SCR Macro 2 - Cholecystectomy/Gallbladder", tag: "SCR", desc: "Check if patient has had gallbladder removed", raw: `Subject: EverydayMeds Order (Action required) - Follow-Up on Your Medical History

Dear [Patient Name],

Thank you for your recent order with EverydayMeds.

From your records, I can see you have had a gallbladder problem noted.

Could you please confirm if you have had a cholecystectomy (gallbladder removal surgery) following this, and if so, when the surgery took place?

Your order will be placed on hold whilst we await your response.` },
      { name: "SCR Macro 3 - Cancer", tag: "SCR", desc: "SCR shows cancer - request status details", raw: `Subject: EverydayMeds Order (Action required) - Follow-Up on Your Medical History

Dear <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

We would be grateful if you could provide us with some further details about your medical history:

• Have you ever had a cancer diagnosis (excluding MEN2 or medullary thyroid cancer)?
• Are you currently on, or awaiting, any treatment such as surgery, chemotherapy, or radiotherapy?
• Is the cancer in remission?
• Have you been discharged from the oncology team? If so, please send a copy of your discharge letter or your most recent letter from the Oncology team.

Thank you for choosing EverydayMeds to support you on your weight loss journey.

Your response will help us make sure we have an accurate and up-to-date understanding of your medical history.

Your order will be placed on hold whilst we await your response.` },
      { name: "SCR Macro 4 - Heart Failure", tag: "SCR", desc: "SCR shows heart failure - request stage info", raw: `Subject: EverydayMeds Order (Action required) - Request for Information on Heart Failure Diagnosis

Dear <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

We can see a coded diagnosis of heart failure in your records. To ensure we have the most accurate and up-to-date information about your condition, could you please provide us with either:

• A copy of your most recent cardiology letter
• Any additional details regarding your diagnosis that you feel are relevant.

Your order will be placed on hold whilst we await your response.

Thank you for choosing EverydayMeds to support you on your weight loss journey. Your response will help us provide the best possible care.` },
      { name: "SCR Macro 5 - CKD Diagnosis", tag: "SCR", desc: "SCR shows CKD - request eGFR/stage", raw: `Subject: EverydayMeds Order (Action required) - Request for Information on CKD Diagnosis

Dear <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

We can see a diagnosis of chronic kidney disease (CKD) noted in your records. To ensure we have the most accurate and up-to-date information about your condition, could you please provide us with at least one of the following:

• Your most recent eGFR result
• A copy of the latest letter from your specialist with further details about your CKD.

Your order will be placed on hold whilst we await your response.

Thank you for choosing EverydayMeds to support you on your weight loss journey. Your response will help us provide the best possible care.` },
      { name: "SCR Macro 6 - Current Pregnancy", tag: "SCR", desc: "Confirm pregnancy/breastfeeding/TTC status", raw: `Subject: EverydayMeds Order (Action required) - Follow-Up on Your Current Status

Dear <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

To help us provide the most appropriate care, could you please confirm your current status regarding the following:

• Are you currently pregnant?
• Are you breastfeeding?
• Are you trying to conceive?

Your order will be placed on hold whilst we await your response.

Your response will ensure we have accurate and up-to-date information for your care.

Thank you for choosing EverydayMeds to support you on your weight loss journey.` },
      { name: "SCR Macro 7 - Dementia", tag: "SCR", desc: "SCR shows dementia - assess home support", raw: `Subject: Follow-Up on Your Care and Support

Dear [Patient Name],

We can see that dementia is noted in your records. To help us understand your needs and provide the best support, could you please let us know:

• How do you manage at home on a day-to-day basis?
• Do you have any help or support at home?

Thank you for choosing EverydayMeds to support you on your weight loss journey. Your response will help us ensure we have the most accurate and up-to-date information.

Your order will be placed on hold whilst we await your response.` },
      { name: "SCR Macro 8 - Chronic Malabsorption", tag: "SCR", desc: "SCR shows malabsorption - request diagnosis", raw: `Subject: Request for Information on Chronic Malabsorption

Dear [Patient Name],

We can see a note of chronic malabsorption in your records. To ensure we have accurate and up-to-date information about your condition, could you please provide us with:

• Evidence of a formal diagnosis, or
• A letter from your specialist with further details regarding your condition.

Thank you for choosing EverydayMeds to support you on your weight loss journey. Your response will help us provide the best possible care.

Your order will be placed on hold whilst we await your response.` },
      { name: "SCR Macro 9 - Mental Health", tag: "SCR", desc: "SCR shows recent mental health - assess current state", raw: `Subject: Follow-Up on Your Mental Health

Dear [Patient Name],

We hope you're doing okay. We've noticed from your records that you may have experienced symptoms of depression or anxiety before, and we want to make sure you're receiving the best possible care.

To help us look after you safely, could you please let us know a little about how you've been feeling recently?

• How has your mood been lately?
• Have you noticed any changes in your mood over the past few weeks or months?
• Have you had any thoughts of self-harm?
• Have you had any thoughts about ending your life?

Your safety and wellbeing are our top priorities. If you are currently experiencing any thoughts of self-harm or of ending your life, please reach out for help straight away. You can contact your GP or local crisis service for urgent support.

If you're in the UK, you can also contact Samaritans at 116 123, any time, day or night.

Thank you for taking the time to share how you've been feeling. This information helps us ensure your care is safe, in your best interests and tailored to your needs.

Your order will be placed on hold whilst we await your response.` },
      { name: "SCR Macro 10 - Alcohol Use", tag: "SCR", desc: "SCR shows alcohol issues - CAGE screening", raw: `Subject: Checking in on Your Alcohol Use

Dear [Patient Name],

We hope you're doing well. As part of your care with us, we've noticed that there may be a history of alcohol use or concerns noted in your records. To make sure we're supporting you in the best and safest way possible, we'd be grateful if you could share a little more about your current situation. When you're ready, please let us know:

• How much alcohol you're currently drinking.
• Whether you've ever felt you should cut down on your drinking.
• Whether you've ever felt annoyed by criticism of your drinking.
• Whether you've ever felt guilty about your drinking.
• Whether you ever have a drink first thing in the morning to get the day started or ease a hangover.

There's no judgment here - our goal is simply to ensure you feel supported and that your care is safe, respectful, and tailored to your needs.

Thank you for choosing EverydayMeds to support you on your weight loss journey.

Your order will be placed on hold whilst we await your response.` },
      { name: "SCR Macro 11 - Retinopathy", tag: "SCR", desc: "SCR shows retinopathy - request clinic information", raw: `Subject: Request for Information on Retinopathy

Dear [Patient Name],

We can see retinopathy noted in your records. To ensure we have the most accurate and up-to-date information, could you please let us know:

• Whether you are under the regular care of an eye clinic, and
• Provide a copy of your most recent clinic letter if available.

Thank you for choosing EverydayMeds to support you on your weight loss journey. Your response will help us provide the best possible care.

Your order will be placed on hold whilst we await your response.` },
      { name: "SCR Macro 13 - SCR Access Declined", tag: "SCR", desc: "Patient declined SCR access", raw: `Subject: Update Regarding Access to Summary Care Records (SCR)

Dear [Patient Name],

We wanted to let you know about an important change to our prescribing process.

We are now unable to prescribe medication if access to the Summary Care Record (SCR) is declined. Access to the SCR is essential to ensure that we can prescribe safely and in line with clinical guidance.

It appears that you have not granted us access to your SCR. If you would like to review this decision or have any questions about what the SCR is, we would be happy to provide more information.

If you wish to change your mind and allow us access to your SCR, we would be happy to move forward with your prescription. However, if you choose not to grant access, we will need to reject your prescription request, and you will receive a full refund.

Your order will be placed on hold whilst we await your response.` },
      { name: "Side Effects Query", tag: "Clinical", desc: "Patient reports side effects - provide guidance", raw: `Subject: Response to Your Side Effects Query

Dear <<Patient Name>>,

Thank you for letting us know about the side effects you're experiencing.

The side effects you've described ([INSERT SIDE EFFECTS]) are [common/less common] with this medication.

These usually improve within the first few weeks. We recommend:
• Eating smaller, more frequent meals
• Staying hydrated
• Avoiding fatty or spicy foods
• Taking your medication in the evening if nausea is an issue

Given the symptoms you've described, we may recommend speaking with your GP or contacting NHS 111.

Please let us know if your symptoms persist or worsen.` },
      { name: "Minor SES - Injection Site Reaction", tag: "Clinical", desc: "Injection site redness/swelling/pain", raw: `Subject: Advice for Injection Site Reactions

Dear <<Patient Name>>,

Thank you for getting in touch about your injection site reaction.

Mild reactions at the injection site such as redness, swelling, or discomfort are common and usually resolve on their own within a few days.

To help reduce injection site reactions:
• Rotate your injection sites (thigh, abdomen, upper arm)
• Allow the medication to reach room temperature before injecting
• Ensure the injection site is clean and dry
• Apply a cold compress after injecting if needed

If the reaction persists for more than a week, spreads beyond the injection site, or you develop signs of infection (increasing redness, warmth, pus, or fever), please contact your GP.` },
      { name: "Breast Cancer History Clarification", tag: "SCR", desc: "Clarify cancer status before prescribing", raw: `Subject: Follow-Up on Your Breast Cancer Medical History

Dear <<Patient Name>>,

Thank you for your recent order with EverydayMeds. We have reviewed your medical history and would like to clarify some information regarding your breast cancer diagnosis before we can proceed with your prescription.

Could you please confirm the following:

1. Are you currently under the care of an oncology team for your breast cancer?
2. Are you receiving any active cancer treatments now or planned soon?
3. Are you on long-term hormone therapy only (e.g., tamoxifen, Zoladex)? If so, has there been any recent recurrence or spread of the cancer?

Please note that being on long-term hormone therapy alone does not prevent us from prescribing GLP-1 medication, as long as you are not receiving active cancer treatment and are not currently under oncology care.` },
      { name: "History of Cancer (General Template)", tag: "SCR", desc: "General template for any cancer history clarification", raw: `Subject: Follow-Up on Your Cancer Medical History

Dear <<Patient Name>>,

During our routine clinical review, we noted a history of cancer recorded in your medical records.

To ensure we can assess your suitability for treatment safely and in line with our prescribing guidelines, we need to gather some additional information.

We would be grateful if you could please confirm the following:

• What type of cancer were you diagnosed with?
• When were you diagnosed with this condition?
• Are you currently under the care of a specialist (e.g. oncology team)?
• Are you currently receiving, or awaiting, any cancer-related treatment?
• Is the cancer considered to be in remission?
• Have you been formally discharged from the oncology team?
• Are you currently taking any medication related to cancer treatment or remission maintenance?

Once we receive this information, we will be able to continue reviewing your request.

Thank you for choosing EverydayMeds to support you on your weight loss journey.` },
      { name: "Suspicious BMI - Photo Verification Required", tag: "Clinical", desc: "Request side-profile full-length photo when BMI cannot be verified", raw: `Subject: Additional Photo Required for BMI Verification

Dear <<Patient Name>>,

Thank you for providing your recent photo.

Unfortunately, we're unable to verify your BMI based on the image provided, as it does not clearly align with the height and weight information submitted.

To allow us to proceed safely and in line with our prescribing requirements, could you please provide the following:

• A side-profile, full-length photo, taken in fitted clothing
• A clear, well-lit image showing your full body
• Confirmation of your most recent weight and height (measured as accurately as possible)

Once we receive this information, we'll reassess your order and update you accordingly.

Thank you for your cooperation and understanding.` },
      { name: "Gallstone No Cholecystectomy", tag: "SCR", desc: "Gallstones without cholecystectomy - GLP-1 contraindicated", raw: `Subject: Important Information Regarding Gallstones and Your Prescription

Dear <<Patient Name>>,

Thank you for your response and for providing further information.

After carefully reviewing your medical history, we can see that you have a history of gallstones and have not had your gallbladder removed.

Unfortunately, this means we are unable to safely prescribe injectable weight loss treatment online at this time.

This is because these medications can increase the risk of gallbladder-related complications in people who have gallstones, and this requires closer medical supervision than we can provide through an online service.

For your safety, we recommend discussing weight management options with your GP or specialist.

Your order will be cancelled and a full refund will be processed automatically.

Thank you for your understanding and for choosing EverydayMeds.` },
      { name: "Cholecystectomy <12 Months", tag: "SCR", desc: "GLP-1 contraindicated within 12 months post-cholecystectomy", raw: `Subject: Prescription Update Following Recent Gallbladder Surgery

Dear <<Patient Name>>,

Thank you for providing your discharge letter confirming your gallbladder removal (cholecystectomy) surgery.

After reviewing this information, we're unfortunately unable to prescribe GLP-1 weight-loss treatment at this time. In line with our prescribing guidance, these medications cannot be prescribed within 12 months of gallbladder removal.

For safety reasons, we therefore need to decline your request on this occasion. You would be welcome to reapply once 12 months have passed since your surgery, provided there are no other contraindications at that time.

If you have any questions or wish to discuss alternative weight-management options in the meantime, we recommend speaking with your GP.

Thank you for your understanding.` },
      { name: "Retinopathy SCR (Extended)", tag: "SCR", desc: "Retinopathy/maculopathy - extended eye clinic questions", raw: `Dear <<Patient Name>>,

As part of our routine clinical safety checks, we are reviewing your medical records in relation to your prescription request.

We can see a note referring to retinopathy. To ensure this treatment is safe and appropriate for you, we just need a little more information before we can proceed.

Could you please let us know:

• Whether this condition is currently active or stable
• Whether you are under ongoing follow-up with an optician or eye specialist
• Whether you have ever required treatment, such as eye injections or laser therapy
• Whether you have been discharged from ophthalmology care, and if so, when
• Whether you have noticed any recent changes in your vision

This information helps us assess suitability for treatment and ensure your safety before issuing a prescription.

Thank you very much for your time and cooperation.` },
      { name: "SCR Rejection - Repeat Patients", tag: "SCR", desc: "Rejecting repeat patient based on SCR findings", raw: `Subject: An important update on your treatment plan

Hi <<Patient Name>>,

We're getting in touch to let you know that, following an updated review of your medical records, we're no longer able to prescribe weight loss treatments such as Wegovy, Mounjaro or Nevolat.

This means your current order will be automatically cancelled and refunded.

This decision is based on new information from your Summary Care Record (SCR). During these checks, we noted [add information about contraindication(s) found].

For your safety, please stop using your injectable treatment and take any remaining pens to your local pharmacy for safe disposal.` },
    ]
  },
  {
    id: "transfer", label: "Transfer / PUE", icon: "🔁",
    macros: [
      { name: "Combined PUE & Previous Weight Photo", tag: "PUE", desc: "Need both PUE and previous weight photo", raw: `Subject: Additional Verification Required for Your Order

Dear <<Patient Name>>,

Thank you for your order with EverydayMeds. As you are transferring from another provider and your current BMI is below the standard licensing threshold, we need to verify both your previous treatment and that you met the BMI criteria when you first started GLP-1 therapy.

Please provide the following TWO items:

1. PROOF OF PREVIOUS USE (PUE) — evidence must clearly show: patient name or email, medication and dose, date, and regulated provider name.

2. PREVIOUS WEIGHT VERIFICATION PHOTO — taken within 30 days of starting GLP-1, full-length in fitted clothing, well lit and clear.

Once we receive both items, we will review your order.` },
      { name: "PUE + Previous BMI Photo Request", tag: "PUE", desc: "Transfer patient needs both PUE and previous BMI photo", raw: `Subject: Additional Verification Required for Your Order

Dear <<Patient Name>>,

Thank you for providing evidence of your previous GLP-1 treatment.

We've reviewed the information submitted. While some details are present, it does not currently meet our verification requirements.

1. Evidence of previous GLP-1 use (PUE) must clearly show: patient name or email, medication and dose, date, and regulated provider.

2. Weight/BMI verification at treatment start — a previous BMI photo taken within 30 days of starting GLP-1, full-length in fitted clothing, well lit and clear.

Once we have both items, we'll reassess your order.` },
      { name: "Previous Use Evidence", tag: "PUE", desc: "PUE missing required information", raw: `Subject: Additional Evidence Required

Dear <<Patient Name>>,

Thank you for providing evidence of your previous GLP-1 treatment.

Unfortunately, the evidence submitted does not currently meet our verification requirements. For the evidence to be acceptable it must include all of the following:

• Patient name or email
• Medication and dose
• Date
• Regulated provider

Please provide updated evidence that includes all of the above information.` },
      { name: "Previous BMI Photo (Starting BMI)", tag: "PUE", desc: "Below licence BMI - need starting BMI photo", raw: `Subject: Previous Weight Photo Required

Dear <<Patient Name>>,

Thank you for your order.

Your current BMI is below the standard licensing threshold for this medication. To continue treatment, we need to verify that you met the licence criteria when you first started GLP-1 therapy.

Please provide a previous BMI weight-verification photo that:
• Was taken within 30 days of starting GLP-1 treatment
• Shows you full-length in fitted clothing
• Is well lit and clear
• Allows us to confirm you met the licensed BMI at that time

If possible, please also provide the approximate date the photo was taken.` },
      { name: "Clinical PUE 2 Weeks Old", tag: "PUE", desc: "Gap >2 weeks since last dose", raw: `Subject: Clarification on Treatment Gap

Dear <<Patient Name>>,

Thank you for your order.

We can see from your previous use evidence that there has been a gap of more than 2 weeks since your last GLP-1 injection.

For safety reasons, if you have missed more than 2 consecutive weeks of treatment, we may need to restart you at a lower dose rather than your previous maintenance dose.

Please confirm:
1. When did you take your last injection?
2. How long have you been without medication?

Once we have this information, we can determine the appropriate dose for you to restart on.` },
      { name: "Repeat Customer Weight/Height Verification", tag: "PUE", desc: "Photo inconsistent with declared weight", raw: `Subject: Weight Verification Required

Dear <<Patient Name>>,

Thank you for your recent order.

To continue processing your prescription, we need to verify your current weight. Please provide:

• A clear, full-length photo taken within the last 30 days
• The photo should show you in fitted clothing
• Good lighting so we can clearly see your body shape

Alternatively, you can provide a photo showing your weight on scales.` },
      { name: "Transfer Dose Adjustment Offer", tag: "Transfer", desc: "Offer adjusted dose or refund after clinical review", raw: `Dear <<Patient Name>>,

Thank you for providing the requested information.

Following our clinical review, we have determined that the most appropriate dose to start treatment with us would be [MEDICATION_NAME] [DOSE].

We understand that this may differ from the dose you originally ordered. To support you, we would like to offer the following two options:

1. If you are happy to proceed with [MEDICATION_NAME] [DOSE], please reply to confirm. Any difference in price will be refunded.

2. If you would prefer not to proceed at this dose, we can cancel your order and provide a full refund.

Please let us know how you would like to proceed.` },
      { name: "Last Injection Date", tag: "PUE", desc: "Ask patient to confirm date & strength of last injection", raw: `Hello there,

Thank you for getting back in touch.

Based on the information currently available to us, it appears that your last weight loss injection may have been more than 4 weeks ago.

To help us safely assess your order and determine the most appropriate treatment plan, could you please confirm:

- The date of your last injection
- The strength/dose of your last injection
- Whether you have received any treatment from another provider during this period

If there has been a prolonged break in treatment, it may be necessary for safety reasons to restart from a lower dose and gradually re-titrate.

Your order will remain on hold until we receive the requested information and the clinical team has been able to review it.

Once we receive your response, we will be able to continue reviewing your order.` },
    ]
  },
  {
    id: "titration", label: "Titration", icon: "📈",
    macros: [
      { name: "Dose Increase Too Soon", tag: "Titration", desc: "Patient requested next dose before 4-week minimum interval", raw: `Hello {patient_name},

Thank you for your recent order.

For your safety, GLP-1 doses should only be increased after a minimum of 4 weeks on your current strength. Our records show your last dose has not yet reached this interval, so we are unable to authorise the increase at this time.

Please reorder once you have completed 4 full weeks on your current dose. If you are experiencing side effects or have any concerns, reply to this message and we will be happy to review.` },
      { name: "Hold Current Dose — Side Effects", tag: "Titration", desc: "Recommend staying on current dose due to ongoing side effects", raw: `Hello {patient_name},

Thank you for your message and for letting us know about the side effects you have been experiencing.

Given what you have described, we recommend remaining on your current dose for a further 4 weeks before considering a step up. This gives your body more time to adjust and usually improves tolerability.

If symptoms persist, worsen, or you have any new concerns, please reply and we will review again.` },
      { name: "7.2mg Prescription Approved", tag: "Wegovy", desc: "Wegovy 7.2mg approved - 3x2.4mg pen guidance", raw: `Subject: Your Wegovy 7.2mg Prescription Has Been Approved

Dear <<Patient Name>>,

Your prescription for Wegovy 7.2 mg has now been approved and sent for dispensing.

Please read the following guidance carefully before starting your next dose:

• Your total weekly dose is given as three 2.4 mg injections
• Inject one dose from each pen on the same day each week
• Use a new needle for every injection
• Rotate injection sites to reduce irritation

At this dose, side effects such as nausea or altered skin sensations are common, particularly during the early weeks. These usually improve as your body adjusts.

Please seek medical advice if you experience severe or persistent vomiting, signs of dehydration, severe or worsening pain, or signs of infection at injection sites.

If you have any questions or concerns while taking this medication, please contact us before making any changes.

Thank you for choosing EverydayMeds to support you on your weight loss journey.` },
      { name: "7.2mg Dysesthesia - Hold Dose Increase", tag: "Wegovy", desc: "Patient has skin sensations - do not increase dose", raw: `Subject: Important Safety Information About Your Dose

Dear <<Patient Name>>,

We can see that you have reported altered skin sensations while using Wegovy 2.4 mg.

As a safety measure, we do not recommend increasing your dose at this time, as higher doses are associated with a greater likelihood of these symptoms.

To proceed safely, we advise remaining on your current dose and allowing symptoms to settle before any dose increase.

Please let us know once symptoms have improved so we can review your treatment plan.

Thank you for choosing EverydayMeds to support you on your weight loss journey.` },
      { name: "7.2mg Dysesthesia Warning", tag: "Wegovy", desc: "Inform patient about dysesthesia side effect at 7.2mg", raw: `Subject: Important Information About Wegovy 7.2mg Side Effects

Dear <<Patient Name>>,

We would like to make you aware of a possible side effect associated with higher doses of Wegovy, including the 7.2 mg dose.

Some patients experience changes in skin sensation (dysesthesia) such as tingling, burning, pins and needles, or altered skin sensitivity. At the 7.2 mg dose, this side effect is considered common. Importantly, this is not nerve damage and symptoms are usually temporary.

Please confirm that you understand this information and are happy to proceed.

If you are currently experiencing similar symptoms at a lower dose, please inform us before increasing your dose.

Thank you for choosing EverydayMeds to support you on your weight loss journey.` },
      { name: "7.2mg GI Side Effects Awareness", tag: "Wegovy", desc: "Confirm understanding of GI side effects at 7.2mg", raw: `Subject: Wegovy 7.2mg Treatment Information

Dear <<Patient Name>>,

As part of your treatment review, we would like to ensure you are aware of the expected side effects associated with Wegovy 7.2 mg.

At this dose, gastrointestinal side effects are common, particularly during the early weeks. These may include nausea, vomiting, abdominal discomfort, and reduced appetite. Most symptoms are mild to moderate and usually improve as your body adjusts.

Please confirm that you understand these potential effects and that you are happy to proceed with treatment at this dose.

If you experience severe or persistent symptoms, you should contact us promptly.

Thank you for choosing EverydayMeds to support you on your weight loss journey.` },
      { name: "7.2mg Triple Pen Confirmation", tag: "Wegovy", desc: "Confirm patient understands 3x2.4mg injection protocol", raw: `Subject: Confirmation Required for Wegovy 7.2mg Treatment

Dear <<Patient Name>>,

We are reviewing your request for Wegovy at a total weekly dose of 7.2 mg.

At present, this dose is administered using three separate 2.4 mg pens. To safely receive the full dose, you will need to inject one dose from each pen on the same day each week.

Please confirm that you understand the following:

• You will be giving three injections per week
• You must use a new needle for each injection
• Injection sites must be rotated each time
• Needles should never be reused

If you have any concerns about administering multiple injections, please let us know before proceeding.

Thank you for choosing EverydayMeds to support you on your weight loss journey.` },
    ]
  },
  {
    id: "id", label: "ID / Photos", icon: "🪪",
    macros: [
      { name: "Failed ID Email (Automated)", tag: "Identity", desc: "System email when ID verification fails", raw: `[Automated system email when ID verification fails]

Subject: ID Verification Required

Dear {patient_name},

Unfortunately, we were unable to verify your identity from the documents you provided. This may be because the image was unclear, the document was expired, or the details didn't match our records.

Please log in to your account and upload a new photo of a valid ID document (passport, driving licence, or national ID card).` },
      { name: "ID Missing - No ID Uploaded", tag: "Identity", desc: "Patient has not uploaded any ID", raw: `Subject: ID Document Required

Dear <<Patient Name>>,

Thank you for your order with EverydayMeds.

Before we can process your prescription, we require a copy of a valid photo ID for verification purposes.

Please log in to your account and upload a clear photo of one of the following documents:
• Passport
• Driving licence
• National ID card

Please ensure the document is valid, not expired, and all details are legible.

Once we receive your ID document, we will continue processing your order.` },
      { name: "Weight Verification Failed (Automated)", tag: "Identity", desc: "System email when weight photo fails", raw: `[Automated system email when weight photo fails verification]

Subject: Weight Verification Photo Required

Dear {patient_name},

Unfortunately, we were unable to verify your weight from the photo you provided. For us to proceed with your order, we need a clear photo that shows your full body.

Please upload a new photo that:
• Shows your full body (head to toe)
• Is taken in fitted clothing
• Has good lighting
• Is clear and not blurry` },
      { name: "Account Name not Matching ID", tag: "Identity", desc: "Account name does not match ID document", raw: `Subject: Account Name Verification Required

Dear <<Patient Name>>,

During our routine identity verification checks, we noticed that the name on your account does not exactly match the name shown on the identification document you provided.

To proceed safely, could you please confirm your full legal name as it appears on official documents.

If your name has changed, please upload an updated photo ID or marriage certificate/deed poll confirming the name change.

Once we receive confirmation or the relevant documentation, we'll be able to continue reviewing your order.

Thank you for your cooperation.` },
      { name: "Photo Requirements Not Met", tag: "Identity", desc: "Photo doesn't meet prescribing requirements", raw: `Subject: New Photo Required for Your Order

Hello <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

Unfortunately the photo uploaded did not meet our requirements to prescribe. Please respond with a new photo which meets the following requirements:

• Shows your current body shape in fitted clothing
• Shows you standing, facing the camera, head to toes
• Shows your face clearly in good lighting and without sunglasses
• Is not edited or retouched

You may also wish to include a photo showing your side profile as well as one facing forward.

Please reply directly to this email with the attached photo(s), and we will promptly upload it to your patient account.

Your order will be placed on hold whilst we await your response.` },
    ]
  },
  {
    id: "weight", label: "Weight Changes", icon: "⚖️",
    macros: [
      { name: "Weight Has Increased", tag: "Weight", desc: "Repeat patient weight increased", raw: `Dear <<Patient Name>>,

Thank you for your recent order.

We noticed that your weight has increased since your last order. Before we proceed with your prescription, we wanted to check in with you:

• Have you experienced any changes in your lifestyle or diet recently?
• Have you been taking your medication as prescribed?
• Have you experienced any issues with the medication?

Please let us know so we can ensure your treatment plan is still appropriate for you.` },
      { name: "Rapid Weight Loss Query", tag: "Weight", desc: "Patient losing weight too rapidly", raw: `Dear <<Patient Name>>,

Thank you for your order.

We noticed that you appear to be losing weight quite rapidly. While this medication can be very effective, we want to make sure your weight loss is healthy and sustainable.

Could you please let us know:

• Are you eating regular meals?
• Are you experiencing any side effects such as nausea, vomiting, or loss of appetite?
• How are you feeling generally?

Healthy weight loss is typically around 1-2 lbs per week. If you're losing more than this, we may need to review your treatment plan.` },
      { name: "Height/Weight Confirmation", tag: "Weight", desc: "Request current height and weight measurements", raw: `Dear Patient,

In order for us to review your order, we require your most recent height and weight measurements.

Please reply to this email with your current height and most recent weight so we can continue reviewing and processing your order.

Once we have received this information, we will be able to proceed with your order review.` },
      { name: "Comorbidity", tag: "Weight", desc: "BMI 27.5-30 - confirm comorbidity", raw: `Dear Patient,

Currently you do not meet the BMI eligibility threshold for weight loss injection without a confirmed comorbidity.

To help us complete the clinical review of your weight loss consultation, could you please confirm whether you have any medical conditions or weight-related comorbidities.

Examples include, but are not limited to:

- High blood pressure
- High cholesterol
- Prediabetes or diabetes
- Heart disease
- Sleep apnoea
- PCOS
- Osteoarthritis
- Fatty liver disease
- Acid reflux/GORD

If you do have any medical conditions, please upload supporting evidence where possible (GP letters, clinic letters, prescription screenshots, NHS app screenshots, etc.).

This helps the clinical team assess your eligibility safely and avoid delays in processing your order.` },
    ]
  },
  {
    id: "gap", label: "Gap in Treatment", icon: "⏸️",
    macros: [
      { name: "Gap in Treatment (Generic)", tag: "Gap", desc: "Universal template with placeholders", raw: `Subject: Follow-Up on Your Treatment Gap

Hello <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

We've noticed a gap in your <<Medication Name>> treatment. If you have obtained a prescription with another provider during this period, please provide photo evidence showing medication name, dosage, date, and your name.

Additionally, please let us know if you experienced any side effects requiring medical attention during this period.

If you have not received treatment from another provider during this period, we may need to adjust your prescription request based on the length of the treatment gap.

Based on the length of the gap identified (<<Gap Duration>>), you can safely continue treatment at your last tolerated dose, up to a maximum of <<Maximum Dose>>.

If you are happy to proceed on this basis, please let us know and we will amend your current order and credit your account with any price difference.

Your order will be placed on hold while we await your response.` },
      { name: "Gap 8-12 Weeks - Mounjaro (Max 10mg)", tag: "Gap", desc: "Gap 8-12 weeks Mounjaro - max 10mg", raw: `Hello <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

We've noticed a gap in your GLP-1 treatment since your last order with us. If you obtained treatment elsewhere, please provide photo evidence showing dosage, date and your name.

If you haven't received treatment from another provider, we may need to adjust your prescription based on the length of your treatment gap.

As your previous order was placed 8-12 weeks ago, you can continue treatment at your last tolerated dose, up to a maximum of 10mg Mounjaro.

If you are happy to proceed, please let us know and we will amend your current order and credit any price difference.

Your order will be placed on hold whilst we await your response.` },
      { name: "Gap 12-24 Weeks - Mounjaro (Max 5mg)", tag: "Gap", desc: "Gap 12-24 weeks Mounjaro - max 5mg", raw: `Hello <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

We've noticed a gap in your GLP-1 treatment since your last order with us.

As your previous order was placed 12-24 weeks ago, the maximum dose we can prescribe is 5mg Mounjaro to ensure safe titration and minimise side effects.

If you are happy to proceed, please let us know and we will amend your current order and credit any price difference.

Your order will be placed on hold whilst we await your response.` },
      { name: "Gap >24 Weeks - Mounjaro (Restart 2.5mg)", tag: "Gap", desc: "Gap >24 weeks Mounjaro - restart 2.5mg", raw: `Hello <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

As your last order was placed more than 24 weeks ago, you will need to restart treatment at the lowest dose, 2.5mg Mounjaro, to ensure safe titration and reduce the risk of side effects.

If you are happy to proceed, please let us know and we will amend your current order and credit any price difference.

Your order will be placed on hold whilst we await your response.` },
      { name: "Gap 8-12 Weeks - Wegovy (Max 1mg)", tag: "Gap", desc: "Gap 8-12 weeks Wegovy - max 1mg", raw: `Hello <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

As your previous order was placed 8-12 weeks ago, you can continue treatment at your last tolerated dose, up to a maximum of 1mg Wegovy.

If you are happy to proceed, please let us know and we will amend your current order and credit any price difference.

Your order will be placed on hold whilst we await your response.` },
      { name: "Gap 12-24 Weeks - Wegovy (Max 1mg)", tag: "Gap", desc: "Gap 12-24 weeks Wegovy - max 1mg", raw: `Hello <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

As your previous order was placed 12-24 weeks ago, the maximum dose we can prescribe is 1mg Wegovy.

If you are happy to proceed, please let us know and we will amend your current order and credit any price difference.

Your order will be placed on hold whilst we await your response.` },
      { name: "Gap >24 Weeks - Wegovy (Restart 0.25mg)", tag: "Gap", desc: "Gap >24 weeks Wegovy - restart 0.25mg", raw: `Hello <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

As your last order was placed more than 24 weeks ago, you will need to restart treatment at the lowest dose, 0.25mg Wegovy.

If you are happy to proceed, please let us know and we will amend your current order and credit any price difference.

Your order will be placed on hold whilst we await your response.` },
      { name: "Gap 8-12 Weeks - Nevolat (Max 1.8mg)", tag: "Gap", desc: "Gap 8-12 weeks Nevolat - max 1.8mg", raw: `Hello <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

As your previous order was placed 8-12 weeks ago, you can continue treatment at your last tolerated dose, up to a maximum of 1.8mg Nevolat.

If you are happy to proceed, please let us know and we will amend your current order and credit any price difference.

Your order will be placed on hold whilst we await your response.` },
      { name: "Gap 12-24 Weeks - Nevolat (Max 1.2mg)", tag: "Gap", desc: "Gap 12-24 weeks Nevolat - max 1.2mg", raw: `Hello <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

As your previous order was placed 12-24 weeks ago, the maximum dose we can prescribe is 1.2mg Nevolat.

If you are happy to proceed, please let us know and we will amend your current order and credit any price difference.

Your order will be placed on hold whilst we await your response.` },
      { name: "Gap >24 Weeks - Nevolat (Restart 0.6mg)", tag: "Gap", desc: "Gap >24 weeks Nevolat - restart 0.6mg", raw: `Hello <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

As your last order was placed more than 24 weeks ago, you will need to restart treatment at the lowest dose, 0.6mg Nevolat.

If you are happy to proceed, please let us know and we will amend your current order and credit any price difference.

Your order will be placed on hold whilst we await your response.` },
      { name: "Gap >12 Months (All Medications)", tag: "Gap", desc: "Gap >12 months - treat as new patient", raw: `Hello <<Patient Name>>,

Thank you for your recent order with EverydayMeds.

As your last order was placed more than 12 months ago, you will be treated as a new patient and will need to restart treatment at the lowest dose:
• Mounjaro: 2.5mg
• Wegovy: 0.25mg
• Nevolat: 0.6mg

If you are happy to proceed, please let us know and we will amend your current order and credit any price difference.

Your order will be placed on hold whilst we await your response.` },
      { name: "Restart After Short Gap (<4 weeks)", tag: "Gap", desc: "Patient missed <4 weeks - safe to resume current dose", raw: `Hello {patient_name},

Thank you for getting back in touch.

As your break from treatment has been under 4 weeks, you can safely resume on your previous dose. We have approved your order on this basis. If you experience any unusual side effects on restarting, please reply and we will review.` },
      { name: "Restart After Long Gap (>4 weeks) — Re-titrate", tag: "Gap", desc: "Gap >4 weeks - restart from lowest dose", raw: `Hello {patient_name},

Thank you for getting back in touch.

As your break from treatment has been longer than 4 weeks, for your safety we will need to restart you from the lowest starting dose and titrate up gradually. This reduces the risk of significant side effects.

We have updated your order accordingly. If you have any questions about the re-titration plan, just reply and we will be happy to help.` },
    ]
  },
  {
    id: "docs", label: "Documents / Videos", icon: "📎",
    macros: [
      { name: "Invalid Documents — Full Upload Request", tag: "Docs", desc: "Omnibus chase: ID + body video + weight scale video + PUE", raw: `Dear Patient,

We are contacting you to ask that you upload the required documents to your account so we can pass your order to the clinical team for review.

If you have not already done so, please upload the following documents ensuring they meet the criteria below:

- A valid photo ID. The ID must be clear, readable, and in date. Please ensure all four corners of the document are visible.

- A full body video showing your full body in good lighting, wearing fitted clothing that clearly shows your body shape. This is required for us to verify your BMI.

- A weight scale video showing both your face and the reading on the scale clearly visible and readable.

If you are a transfer patient, or have been asked to provide proof of previous use, please upload evidence such as dispensing label, prescription, order confirmation, or previous provider correspondence showing provider name, patient name, medication, dose and date.

To help avoid delays, please ensure uploaded evidence meets all criteria. Your order may remain on hold until suitable evidence has been uploaded and reviewed.

Once uploaded, the clinical team will be able to continue reviewing your order.` },
      { name: "Invalid Weight Scale Video", tag: "Video", desc: "Re-request a valid weight scale video", raw: `Dear Patient,

We are contacting you as the weight scale video has either not been uploaded, or the uploaded video does not currently meet the required criteria for clinical review.

Please upload a new weight scale video that meets the following requirements:

- Your face must be clearly visible
- The reading on the scale must be clearly visible and readable
- The video should be clear and taken in good lighting
- The weight reading should be shown while standing on the scale

To help avoid delays, please ensure the uploaded video meets all the above criteria. Your order may remain on hold until a suitable video has been uploaded and reviewed.

Once uploaded, we will be able to continue processing your order.` },
      { name: "Invalid Full Body Video", tag: "Video", desc: "Re-request a valid full body video", raw: `Dear Patient,

We are contacting you as the full body video has either not been uploaded, or the uploaded video does not currently meet the required criteria for clinical review.

Please upload a full body video that meets the following criteria:

- Full body visible from head to toe
- Face clearly visible and facing the camera
- Good lighting with the body clearly visible
- Wear fitted clothing that shows body shape clearly
- Avoid loose or baggy clothing
- Video should be clear and not blurred

To help avoid delays, please ensure the uploaded video meets all the above criteria. Your order may remain on hold until a suitable video has been uploaded and reviewed.

Once uploaded, we will be able to continue processing your order.` },
      { name: "Invalid WS / FB Videos (Both)", tag: "Video", desc: "Re-request both weight scale AND full body videos", raw: `Dear Patient,

We are contacting you as the Weight Scale Video and Full Body Video has either not been uploaded, or the uploaded video does not currently meet the required criteria for clinical review.

Please upload new videos that meet the requirements for both full body video and weight scale video as outlined in our document upload guidelines.

To help avoid delays, please ensure the uploaded videos meet all criteria. Your order may remain on hold until suitable videos have been uploaded and reviewed.

Once uploaded, we will be able to continue processing your order.` },
      { name: "Invalid Previous Prescription Evidence", tag: "PUE", desc: "Previous-use evidence missing or doesn't meet criteria", raw: `Dear Patient,

We are contacting you as your previous use evidence of weight loss injection has either not been uploaded, or the uploaded evidence does not currently meet the required criteria for clinical review.

If you have been asked to provide proof of previous use, please upload suitable evidence such as dispensing label, prescription, order confirmation, or previous provider letter.

The uploaded document must clearly show: previous provider name, full name of the patient, name and strength of the medication, and date issued or dispensed.

Please ensure the document is clear, readable, and not cropped or blurred.

Once uploaded, we will be able to continue processing your order.` },
    ]
  },
  {
    id: "general", label: "General", icon: "💬",
    macros: [
      { name: "Need More Info", tag: "General", desc: "Generic chase template — fill in details bracket", raw: `Dear Patient,

After reviewing your request, we require some additional information from you in order to safely process your order.

Your order will remain on hold until we receive the requested information and the clinical team has been able to review it.

We would appreciate it if you could provide more information regarding the following:

{Please provide details here}

Once we receive the requested information, we will be able to continue reviewing your order.` },
    ]
  },
];

// Process all macros
for (const cat of categories) {
  for (const m of cat.macros) {
    m.body = body(m.raw);
    delete m.raw;
  }
}

const flat = categories.flatMap((c) =>
  c.macros.map((m) => ({ name: m.name, text: m.body }))
);

const out = `/* AUTO-GENERATED by scripts/build-email-macros.js — do not edit by hand */
const EDMS_MACRO_SIGNATURE = "Kind regards,\\nEveryDayMeds Clinical Team";
const EMAIL_MACROS_VERSION = 6;

const EDMS_MACRO_CATEGORIES = ${JSON.stringify(categories, null, 2)};

const EDMS_FLAT_MACROS = ${JSON.stringify(flat, null, 2)};

if (typeof window !== "undefined") {
  window.EDMS_MACRO_SIGNATURE = EDMS_MACRO_SIGNATURE;
  window.EMAIL_MACROS_VERSION = EMAIL_MACROS_VERSION;
  window.EDMS_MACRO_CATEGORIES = EDMS_MACRO_CATEGORIES;
  window.EDMS_FLAT_MACROS = EDMS_FLAT_MACROS;
}
`;

const outPath = path.join(__dirname, "..", "email-macros-data.js");
fs.writeFileSync(outPath, out, "utf8");
console.log("Wrote", outPath, "-", flat.length, "macros in", categories.length, "categories");
