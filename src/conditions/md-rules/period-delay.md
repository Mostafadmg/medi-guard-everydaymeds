# EDM-PD-01 v2.4 — Norethisterone for Period Delay

**Condition:** Period Delay  
**JSON rules:** `src/conditions/period-delay/rules.json`  
**Keyword groups:** `src/conditions/period-delay/keyword-groups.json`

**Products:** Norethisterone 5mg, Utovlan, Primolut N, Wockhardt Norethisterone



## Rules

| ID | Name | Category | Summary |
|---|---|---|---|
| PD-PREG | Pregnancy, breastfeeding & recent birth | condition | SmPC absolute — pregnancy, breastfeeding, or <6 weeks postpartum. |
| PD-ALLERGY | Norethisterone allergy | condition | SmPC absolute — anaphylaxis, angioedema or serious reaction to norethisterone. |
| PD-VTE | Blood clots / thrombophilia | condition | SmPC absolute — DVT, PE, retinal thrombosis, thrombophilia, antiphospholipid syndrome. |
| PD-CV | Arterial disease | condition | SmPC absolute — MI, angina, stroke, TIA or other arterial thrombosis. |
| PD-LIVER | Liver disease & pregnancy liver reactions | condition | SmPC absolute — severe liver disease, tumours, jaundice; obstetric cholestasis / pemphigoid gestationis history. |
| PD-CANCER | Hormone-sensitive cancer | condition | SmPC absolute — breast/genital tract cancer, breast lump, nipple discharge, active anticancer treatment. |
| PD-BLEED | Abnormal bleeding | condition | SmPC absolute — undiagnosed irregular bleeding or untreated endometrial hyperplasia. |
| PD-MIGRAINE | Migraine with aura | condition | Absolute — migraine with aura (flashing lights, one-sided numbness). |
| PD-OTHER | Other contraindications | condition | Service exclusions — IBD, SLE, sickle cell, RA, porphyria, gallstones, HF, renal impairment, hypertension, dyslipidaemia, diabetes, epilepsy, surgery/immobilisation. |
| PD-MED-NORETH | Norethisterone products | medication | Existing norethisterone / period delay treatment. |
| PD-MED-ANTICOAG | Anticoagulants | medication | Service exclusion — warfarin, DOACs, heparins (Section 8). |
| PD-MED-EPILEPSY | Antiepileptic medicines | medication | Service exclusion — enzyme-inducing and interacting AEDs (Section 8 & Step 2E). |
| PD-MED-INDUCER | Enzyme inducers | medication | Service exclusion — rifampicin, efavirenz, St John's Wort, etc. |
| PD-MED-ONCOLOGY | Cancer treatments | medication | Service exclusion — chemotherapy, immunotherapy, hormone therapy (tamoxifen, GnRH agonists). |
| PD-MED-HORMONE | Hormonal contraception | medication | Service exclusion — COC, POP, implant, injection, patch, ring, hormonal IUS, ellaOne. |
| PD-MED-HIV-HCV | HIV & HCV treatments | medication | Service exclusion — antiretrovirals and hepatitis C combinations. |
| PD-MED-IMMUNO | Immunosuppressants | medication | Service exclusion — ciclosporin (interaction). |
| PD-MED-CHRONIC | Diabetes, BP & cholesterol meds | medication | Consultation screen (Step 2E) — diabetes, statin and antihypertensive medicines on SCR. |

Edit keywords in the JSON files above. This markdown is the human-readable protocol index.
