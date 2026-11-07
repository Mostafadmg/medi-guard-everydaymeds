/**
 * Time-sensitive condition rules (GLP-1) — surgery / procedure windows.
 * Separate from medication time-sensitive rules in time-sensitive.data.js
 *
 * @module advice/rules/time-sensitive-conditions
 */
window.EDM_ADVICE_RULES = window.EDM_ADVICE_RULES || {};

window.EDM_ADVICE_RULES.timeSensitiveConditions = [
  {
    id: 'TS-CHOLECYST',
    type: 'time-sensitive-condition',
    tab: 'time-sensitive',
    tabLabel: 'Time-sensitive conditions',
    title: 'Cholecystectomy (Gallbladder Removal)',
    icon: '🫀',
    action: 'REJECT',
    actionSubLabel: 'if < 12 months post-surgery',
    monthsThreshold: 12,
    eventLabel: 'cholecystectomy / gallbladder surgery',
    safeIfLabel: 'Safe to Prescribe: If surgery was ≥ 12 months ago (1 year or more)',
    rationale:
      'Increased risk of gallstones with GLP-1s. 12-month recovery period needed.',
    ifNeeded: 'If timing is unknown → email patient to confirm surgery date',
    referenceFolderRuleIds: ['R001'],
    searchTags: [
      'cholecystectomy',
      'gallbladder removal',
      'post-cholecystectomy',
      'post cholecystectomy',
      'post chole',
      'cholecyst',
    ],
    excludeTags: ['cholecystitis'],
    priorityTags: ['cholecystectomy', 'gallbladder removal'],
  },
];
