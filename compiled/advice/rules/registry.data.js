/**
 * Advice rule registry — defines match priority order.
 * Add new rule files under advice/rules/ and register them here.
 *
 * @module advice/rules/registry
 */
window.EDM_ADVICE_REGISTRY = {
  /** First matching rule type wins. */
  matchOrder: [
    'premature-ejaculation',
    'erectile-dysfunction',
    'hair-loss',
    'weight-loss',
    'medications-absolute',
    'time-sensitive',
    'clinical-details',
    'patient-assessment',
    'conditions',
  ],
};

/** Merge condition + medication time-sensitive rules (load order matters). */
window.EDM_ADVICE_RULES = window.EDM_ADVICE_RULES || {};
(function mergeTimeSensitiveRules() {
  const conditions = window.EDM_ADVICE_RULES.timeSensitiveConditions || [];
  const medications = window.EDM_ADVICE_RULES.timeSensitive || [];
  window.EDM_ADVICE_RULES.timeSensitive = [...conditions, ...medications];
})();
