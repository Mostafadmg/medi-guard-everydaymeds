# EDM-PE-01 — SCR Screening Keyword Library

**Protocol:** EDM-PE-01 Premature Ejaculation (dapoxetine)  
**Purpose:** keyword sets for automated screening of the patient's NHS Summary Care Record  
**Pattern:** extends the ED keyword schema

**JSON (scanner):** `src/conditions/premature-ejaculation/rules.json`  
**Keyword groups (UI):** `src/conditions/premature-ejaculation/keyword-groups.json`  
**Protocol advice (clickable):** `src/conditions/premature-ejaculation/protocol-advice.json`  
**Meta:** `src/conditions/premature-ejaculation/meta.json`  
**Demo:** `demo/premature-ejaculation.html`

---

## Schema changes from the ED file

The ED library uses a single flag, `fail_if_found: true`. EDM-PE-01 has **three** outcomes:

| `outcome` | Meaning | System behaviour |
|---|---|---|
| `reject` | Absolute contraindication or service exclusion | Block (`fail_if_found: true`) |
| `flag` | Prescriber must review and record reasoning | Route to prescriber with matched term and context |
| `counsel` | No block; counselling point | Display counselling text |
| `none` | Suppression / not an exclusion | Do not decline (e.g. finasteride 1 mg) |

Additional fields: `protocol_ref`, `basis` (`smpc` / `bnf` / `service_policy`), `context_sensitive`, `weight`.

`fail_if_found` is retained for the existing matcher and is `true` only where `outcome` is `reject`.

---

## Categories (full keyword lists live in rules.json)

1. Cardiovascular and orthostatic — `PE-CV-CARDIAC`, `PE-CV-HYPOTENSION`, `PE-CV-SYNCOPE-RECURRENT`, `PE-CV-SYNCOPE-SINGLE`, `PE-CV-HYPERTENSION-TREATED`
2. Numeric blood pressure — `PE-BP-NUMERIC`, `PE-BP-POSTURAL-TEXT`
3. Psychiatric — `PE-PSY-CONDITION`, `PE-PSY-SELFHARM`, `PE-PSY-HISTORICAL`
4. Neurological — `PE-NEURO-EPILEPSY`
5. Hepatic and renal — `PE-LIVER`, `PE-RENAL`, `PE-RENAL-NUMERIC`
6. Ophthalmic — `PE-EYE-GLAUCOMA`, `PE-EYE-DROPS`
7. Haematological — `PE-HAEM-BLEEDING`
8. Urological and genitourinary — `PE-URO-PROSTATE`, `PE-URO-GU`, `PE-URO-ED`
9. Metabolic and excipient — `PE-METAB-GALACTOSE`, `PE-METAB-THYROID`
10. Serotonergic medicines — `PE-MED-MAOI`, `PE-MED-ANTIDEPRESSANT`, `PE-MED-ANTIPSYCHOTIC`, `PE-MED-TRIPTAN`, `PE-MED-SEROTONERGIC-OTHER`
11. CYP3A4 inhibitors — `PE-MED-CYP3A4-POTENT`, `PE-MED-CYP3A4-MODERATE`
12. Cardiovascular medicines — `PE-MED-NITRATE`, `PE-MED-ALPHA`, `PE-MED-BP`
13. ED treatments and other interacting medicines — `PE-MED-PDE5`, `PE-MED-ANTICOAG`, `PE-MED-ASPIRIN-LOWDOSE`, `PE-MED-SEDATIVE`, `PE-MED-RECREATIONAL`, `PE-MED-FINASTERIDE-5MG`
14. Counsel and flag only — `PE-COUNSEL-ALCOHOL`, `PE-FLAG-FINASTERIDE-1MG`, `PE-FLAG-ACQUIRED-PE`, `PE-ALLERGY-DAPOXETINE`

Two-tier syncope: a hit on `PE-CV-SYNCOPE-SINGLE` that also matches `PE-CV-SYNCOPE-RECURRENT` is escalated to reject.

---

## Implementation notes

### 1. Negation

Check the ~90 characters before a match for `no`, `not`, `nil`, `denies`, `negative for`, `absence of`, `ruled out`, `excluded`, `never had`, `no history of`, `nil of note`. Negation **downgrades reject to flag** (does not suppress entirely).

### 2. Family history

Family-history context downgrades reject to flag for all rules **except** `PE-EYE-GLAUCOMA` (Section 5 includes being told you are at increased risk).

### 3. Stopped and historical medicines

Washout before dapoxetine: MAOI / thioridazine 14 days; SSRI / SNRI / TCA / other serotonergic 7 days. Where no stop date is available, treat as current. (Date extraction is not yet applied in the scanner.)

### 4. Dose-dependent rules

- Finasteride 1 mg (hair loss) is `outcome: none`; 5 mg / dutasteride is reject
- Aspirin 75 mg is tagged separately (`PE-MED-ASPIRIN-LOWDOSE`) so Clinical Lead can switch to counsel later
- Amitriptyline / tadalafil: same reject outcome; decline message must not assume indication

### 5. Cross-clinic reconciliation

`cross_clinic` is set on `PE-MED-TRIPTAN` (EDM-MIG-01), `PE-MED-PDE5` (EDM-ED-01), `PE-FLAG-FINASTERIDE-1MG` (EDM-HL-01). A decline on a medicine we supplied ourselves should go to the Clinical Lead.

### 6. What this does not replace

A clean SCR is not evidence of a clean history. A consultation disclosure stands even if the SCR does not corroborate it.

---

## Coverage check against Section 5

| Section 5 row | Rule |
|---|---|
| Not male / under 18 / 65+ | Consultation / demographics (`PE-FLAG-AGE` not SCR-keyword) |
| No distress | Consultation only |
| Pain on ejaculation / dysuria | `PE-URO-GU` |
| Diagnostic criteria not met | Consultation only |
| Low BP or postural light-headedness | `PE-CV-HYPOTENSION`, `PE-BP-NUMERIC` |
| Allergy to dapoxetine | `PE-ALLERGY-DAPOXETINE` |
| Severe depression / mania / bipolar / schizophrenia | `PE-PSY-CONDITION` |
| Significant cardiac disease | `PE-CV-CARDIAC` |
| Bleeding or clotting problems | `PE-HAEM-BLEEDING` |
| Glaucoma / raised IOP / at risk | `PE-EYE-GLAUCOMA`, `PE-EYE-DROPS` |
| Kidney problems | `PE-RENAL`, `PE-RENAL-NUMERIC` |
| Prostate problems | `PE-URO-PROSTATE`, `PE-MED-FINASTERIDE-5MG` |
| Epilepsy | `PE-NEURO-EPILEPSY` |
| Recurrent fainting | `PE-CV-SYNCOPE-RECURRENT` |
| Moderate/severe liver problems | `PE-LIVER` |
| Galactose intolerance | `PE-METAB-GALACTOSE` |
| Erectile dysfunction | `PE-URO-ED`, `PE-MED-PDE5` |

Prepared for EveryDayMeds / OVIO Ltd. Outcomes tagged `service_policy` are EveryDayMeds positions rather than SmPC or BNF requirements.
