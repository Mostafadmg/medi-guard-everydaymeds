/**
 * Load prescription-condition rules/keywords from src/conditions/.
 * Engines must never import a specific condition's JSON — add a folder + registry entry instead.
 */

const STORAGE_KEY = 'edmSelectedCondition';
const REGISTRY_PATH = 'src/conditions/registry.json';
const DEFAULT_CONDITION = 'weight-loss';

function assetUrl(relativePath) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(relativePath);
  }
  return relativePath;
}

/**
 * @returns {Promise<object[]>}
 */
export async function loadConditionRegistry() {
  const res = await fetch(assetUrl(REGISTRY_PATH));
  if (!res.ok) throw new Error(`Failed to load condition registry: ${REGISTRY_PATH}`);
  return res.json();
}

/**
 * @param {object[]} registry
 * @param {string} [conditionId]
 */
export function pickConditionEntry(registry, conditionId) {
  return registry.find((c) => c.id === conditionId)
    || registry.find((c) => c.default)
    || registry[0]
    || null;
}

/**
 * @param {string} [conditionId]
 * @returns {Promise<{
 *   entry: object,
 *   rules: object[],
 *   keywordGroups: object[] | null,
 * }>}
 */
export async function loadConditionFiles(conditionId) {
  const registry = await loadConditionRegistry();
  const entry = pickConditionEntry(registry, conditionId);
  if (!entry?.rulesFile) {
    throw new Error(`No rules.json registered for condition: ${conditionId || DEFAULT_CONDITION}`);
  }

  const rulesRes = await fetch(assetUrl(entry.rulesFile));
  if (!rulesRes.ok) {
    throw new Error(`Failed to load ${entry.rulesFile}`);
  }

  let keywordGroups = null;
  const keywordsPath = entry.keywordGroupsFile || entry.keywordsFile;
  if (keywordsPath) {
    const groupsRes = await fetch(assetUrl(keywordsPath));
    if (groupsRes.ok) keywordGroups = await groupsRes.json();
  }

  return {
    entry,
    rules: await rulesRes.json(),
    keywordGroups,
  };
}

/**
 * Load the side-panel selected condition (chrome.storage.local).
 */
export async function loadActiveCondition() {
  let conditionId = DEFAULT_CONDITION;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    conditionId = stored[STORAGE_KEY] || DEFAULT_CONDITION;
  }
  return loadConditionFiles(conditionId);
}
