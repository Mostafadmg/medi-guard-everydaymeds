/**
 * Clinical Details Required rules (GLP-1).
 * Blue-themed advice — hold/email patient when SCR lacks key information.
 *
 * @module advice/rules/clinical-details
 */
window.EDM_ADVICE_RULES = window.EDM_ADVICE_RULES || {};

window.EDM_ADVICE_RULES.clinicalDetails = [
  {
    id: 'CLIN-GALLSTONES',
    type: 'clinical-details',
    tab: 'clinical-details',
    tabLabel: 'Clinical details required',
    title: 'Cholelithiasis (Gallstones) or Cholecystitis',
    icon: '💎',
    layout: 'hold-question',
    holdAction: 'HOLD ORDER',
    holdSubLabel: 'if no evidence of cholecystectomy → Hold order',
    question: 'Have you had your gallbladder removed? If yes, when?',
    rejectIf: ['Patient confirms NO cholecystectomy (gallbladder still present)'],
    prescribeIf: ['Cholecystectomy confirmed by patient (even if not visible on SCR)'],
    referenceFolderRuleIds: ['R001', 'R005'],
    searchTags: [
      'gallstone',
      'cholelithiasis',
      'cholecystitis',
      'calculus',
      'calculi',
      'cholecyst',
    ],
    excludeTags: [
      'cholecystectomy',
      'gallbladder removal',
      'post-cholecystectomy',
      'post cholecystectomy',
    ],
    priorityTags: ['gallstone', 'cholelithiasis', 'cholecystitis'],
  },
  {
    id: 'CLIN-HF',
    type: 'clinical-details',
    tab: 'clinical-details',
    tabLabel: 'Clinical details required',
    title: 'Heart Failure (HF)',
    icon: '❤️',
    layout: 'action-request',
    actionText: 'If no information on stage → email patient',
    request: 'Last letter from cardiologist stating stage OR fitness for GLP-1',
    rejectIf: ['Patient confirms Stage IV heart failure (shortness of breath at rest)'],
    prescribeIf: ['Stage I, II, or III confirmed'],
    referenceFolderRuleIds: ['R005'],
    searchTags: [
      'heart failure',
      'cardiac failure',
      'nyha',
      'cardiomyopathy',
      'hfref',
      'hfpef',
    ],
    priorityTags: ['heart failure'],
  },
  {
    id: 'CLIN-CKD',
    type: 'clinical-details',
    tab: 'clinical-details',
    tabLabel: 'Clinical details required',
    title: 'Chronic Kidney Disease (CKD)',
    icon: '🫘',
    layout: 'action-request',
    actionText: 'If no eGFR information → email patient',
    request: 'Most recent eGFR result',
    rejectIf: ['eGFR < 30 ml/min (Stage 4-5 / Severe CKD)'],
    prescribeIf: ['eGFR ≥ 30 ml/min (Stage 1-3)'],
    referenceFolderRuleIds: ['R005'],
    searchTags: [
      'chronic kidney',
      'ckd',
      'kidney disease',
      'renal failure',
      'renal impairment',
      'nephropathy',
      'egfr',
      'glomerular filtration',
    ],
    priorityTags: ['chronic kidney', 'ckd', 'egfr'],
  },
];
