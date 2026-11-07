/**
 * Condition-aware keyword rules loader for SCR checker.
 */
(function () {
  const STORAGE_KEY = 'edmSelectedCondition';
  const DEFAULT_CONDITION = 'weight-loss';

  const REGISTRY_PATH = 'src/conditions/registry.json';

  let conditions = [];
  let activeCondition = DEFAULT_CONDITION;

  function assetUrl(relativePath) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(relativePath);
    }
    return relativePath;
  }

  async function loadConditions() {
    const res = await fetch(assetUrl(REGISTRY_PATH));
    conditions = await res.json();
    return conditions;
  }

  async function loadRulesForCondition(conditionId) {
    await loadConditions();
    const entry = conditions.find((c) => c.id === conditionId)
      || conditions.find((c) => c.default)
      || conditions[0];
    if (!entry) throw new Error('No conditions configured');
    const res = await fetch(assetUrl(entry.rulesFile));
    if (!res.ok) throw new Error(`Failed to load rules: ${entry.rulesFile}`);
    return { entry, rules: await res.json() };
  }

  async function applyCondition(conditionId, options = {}) {
    const id = conditionId || DEFAULT_CONDITION;
    const { entry, rules } = await loadRulesForCondition(id);
    window.EDM_KEYWORD_RULES = rules;
    activeCondition = entry.id;
    await chrome.storage.local.set({ [STORAGE_KEY]: entry.id });
    document.documentElement.dataset.edmCondition = entry.id;
    if (options.rescan && window.__EDM_SCR_CONTENT__) {
      chrome.runtime.sendMessage({ action: 'rescanSCR' }, () => void chrome.runtime.lastError);
    }
    document.dispatchEvent(new CustomEvent('edm-condition-applied', { detail: entry }));
    return entry;
  }

  async function init() {
    if (!chrome?.storage?.local) return;
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    await applyCondition(stored[STORAGE_KEY] || DEFAULT_CONDITION, { rescan: false });
  }

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const next = changes[STORAGE_KEY].newValue || DEFAULT_CONDITION;
    if (next === activeCondition) return;
    applyCondition(next, { rescan: true });
  });

  window.edmApplyCondition = applyCondition;
  window.edmGetActiveCondition = () => activeCondition;
  window.edmGetConditions = () => conditions;

  init();
})();
