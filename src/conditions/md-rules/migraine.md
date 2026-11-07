# EDM-MIG-01 v2.3 — Triptans (Part A) & rimegepant / Vydura (Part B, acute only)

**Condition:** Migraine  
**JSON rules:** `src/conditions/migraine/rules.json`  
**Keyword groups:** `src/conditions/migraine/keyword-groups.json`

**Products:** Sumatriptan 50 mg tablets, Sumatriptan 20 mg nasal spray (Imigran), Zolmitriptan 2.5 mg orodispersible (Zomig), Rizatriptan 10 mg orodispersible (Maxalt), Imigran 50 mg tablets, Zomig 5 mg tablets, Vydura (rimegepant) 75 mg oral lyophilisate

- Acute on-demand treatment only — not prevention (atogepant / Aquipta excluded).
- Continuation-of-treatment service — established doctor-diagnosed migraine required.
- Part A (triptans): cardiovascular contraindications apply. Part B (rimegepant): non-vasoconstrictive; different interaction profile.
- Service excludes ≥10 migraine days/month (MOH / high-frequency episodic threshold).

## Rules

| ID | Name | Category | Summary |
|---|---|---|---|
| MIG-RED | Red flags & secondary headache | condition | Thunderclap headache, new headache >50, focal neurology, atypical aura, meningism, raised ICP pattern, recent head trauma, immunocompromise, progressive/changed headache. |
| MIG-SUBTYPE | Excluded migraine subtypes | condition | Hemiplegic, basilar/brainstem, ophthalmoplegic migraine — triptans not indicated. |
| MIG-PREG | Pregnancy, breastfeeding & trying to conceive | condition | Absolute service exclusion for triptans and rimegepant. |
| MIG-CV | Ischaemic heart disease & coronary vasospasm | condition | MI, angina, IHD, Prinzmetal angina — triptan SmPC absolute contraindication. |
| MIG-STROKE | Stroke & TIA | condition | Previous stroke or TIA — triptan class contraindication. |
| MIG-PVD | Peripheral vascular disease | condition | Poor peripheral circulation — triptan service exclusion. |
| MIG-HTN | Uncontrolled hypertension | condition | Moderate/severe or untreated/uncontrolled BP — triptans declined. |
| MIG-CARDIAC | Heart failure, arrhythmia & WPW | condition | HF, significant arrhythmia, Wolff-Parkinson-White — triptan exclusion. |
| MIG-CV-PROC | Recent cardiac revascularisation | condition | CABG, stent, angioplasty within 12 months — service exclusion. |
| MIG-LIVER | Hepatic impairment | condition | Moderate/severe liver disease; Child-Pugh C for rimegepant. |
| MIG-RENAL | Renal impairment | condition | Any disclosed kidney disease (triptans); severe/ESRD/dialysis (rimegepant). |
| MIG-EPILEPSY | Epilepsy & seizures | condition | Epilepsy or seizure history — triptan service exclusion. |
| MIG-ALLERGY | Triptan / rimegepant allergy | condition | Hypersensitivity to sumatriptan, zolmitriptan, rizatriptan, rimegepant or excipients. |
| MIG-CANCER-IMMUNO | Cancer & immunosuppression | condition | Active/recent malignancy, chemotherapy, immunosuppressants, HIV — red-flag pathway. |
| MIG-CLUSTER | Cluster headache features | condition | Unilateral periorbital autonomic cluster pattern — not migraine; decline. |
| MIG-GCA | Giant cell arteritis & occipital headache | condition | Temporal arteritis, jaw claudication, scalp tenderness, occipital predominant headache. |
| MIG-CHC-AURA | Combined hormonal contraception with aura | condition | COC/patch/ring with migraine with aura — UKMEC 4; GP review required. |
| MIG-MED-ERGOT | Ergotamine & ergot derivatives | medication | Contraindicated with triptans; 24h separation required. |
| MIG-MED-TRIPTAN-ALT | Non-supplied triptans (concomitant use risk) | medication | Almotriptan, eletriptan, frovatriptan, naratriptan — not supplied; concomitant triptan use contraindicated. |
| MIG-MED-MAOI | MAOIs | medication | MAOI or within 2 weeks of stopping — triptan contraindication. |
| MIG-MED-SEROTONERGIC | Serotonergic antidepressants & lithium | medication | SSRIs, SNRIs, other antidepressants, lithium, St John's Wort — service-level decline for triptans. |
| MIG-MED-CYP3A4-INH | Strong CYP3A4 inhibitors | medication | Ketoconazole, itraconazole, clarithromycin, ritonavir, cobicistat — rimegepant contraindicated; triptan precaution. |
| MIG-MED-CYP3A4-IND | CYP3A4 inducers | medication | Rifampicin, carbamazepine, phenytoin — rimegepant efficacy reduced. |
| MIG-MED-CGRP | CGRP pathway medicines | medication | Other gepants (atogepant), erenumab, fremanezumab, galcanezumab, eptinezumab — outside combined use scope. |
| MIG-MED-PGP | P-gp & moderate CYP3A4 inhibitors (rimegepant) | medication | Verapamil, erythromycin, ciclosporin, fluconazole taken regularly — rimegepant decline. |
| MIG-MED-PROPRANOLOL | Propranolol | medication | Rizatriptan declined if on propranolol; sumatriptan/zolmitriptan preferred. |
| MIG-MED-CYP1A2 | CYP1A2 inhibitors | medication | Cimetidine, fluvoxamine — zolmitriptan declined; dose interaction. |
| MIG-MED-OPIOID | Frequent opioid use | medication | Opioids for headache — MOH risk; not for acute migraine. |
| MIG-CONTEXT-TRIPTAN | Supplied triptans on SCR (review only) | medication | Sumatriptan, zolmitriptan, rizatriptan, Imigran, Zomig, Maxalt — expected on continuation; does not fail scan. |
| MIG-CONTEXT-RIME | Rimegepant / Vydura on SCR (review only) | medication | Part B product or existing therapy — flagged for context; does not fail scan. |
| MIG-DX | Migraine diagnosis (review only) | condition | Positive migraine diagnosis terms — supports continuation context; does not fail scan. |

Edit keywords in the JSON files above. This markdown is the human-readable protocol index.
