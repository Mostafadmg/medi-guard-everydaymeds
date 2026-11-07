/**
 * Header "Keywords" reference modal — all SCR screening keywords by rule.
 */
(function () {
  const ICON_TAGS =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>';

  const REGISTRY_PATH = 'src/conditions/registry.json';
  const STORAGE_KEY = 'edmSelectedCondition';

  let rulesCache = null;
  let activeOverlay = null;

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function assetUrl(path) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(path);
    }
    return path;
  }

  async function getActiveConditionEntry() {
    const registryRes = await fetch(assetUrl(REGISTRY_PATH));
    const registry = await registryRes.json();
    let activeId = document.documentElement.dataset.edmCondition;
    if (!activeId && chrome?.storage?.local) {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      activeId = stored[STORAGE_KEY];
    }
    return registry.find((c) => c.id === activeId)
      || registry.find((c) => c.default)
      || registry[0];
  }

  function groupedRuleId(ruleId) {
    return ruleId === 'R005' || /-OTHER$/i.test(ruleId);
  }

  async function loadKeywordGroupsForCondition(entry) {
    if (!entry?.keywordGroupsFile) return null;
    const res = await fetch(assetUrl(entry.keywordGroupsFile));
    if (!res.ok) return null;
    return res.json();
  }

  async function loadRules() {
    if (rulesCache) return rulesCache;
    const entry = await getActiveConditionEntry();
    if (!entry) throw new Error('No active condition configured');
    const res = await fetch(assetUrl(entry.rulesFile));
    if (!res.ok) throw new Error('Could not load keyword rules');
    const data = await res.json();
    const rules = data
      .filter((r) => r.outcome !== 'none')
      .sort((a, b) => {
        const aNum = parseInt(String(a.id).replace(/\D/g, ''), 10) || 0;
        const bNum = parseInt(String(b.id).replace(/\D/g, ''), 10) || 0;
        return aNum - bNum || String(a.id).localeCompare(String(b.id));
      });

    const groups = await loadKeywordGroupsForCondition(entry);
    if (groups?.length) {
      const groupedRule = rules.find((rule) => groupedRuleId(rule.id))
        || rules.find((rule) => /-OTHER$/i.test(rule.id))
        || rules.find((rule) => rule.name === 'Other' || rule.name?.includes('Other'));
      if (groupedRule) {
        groupedRule.keywordGroups = groups;
      } else {
        rules.push({
          id: 'KEYWORD-GROUPS',
          name: 'Keyword groups',
          category: 'condition',
          keywords: [],
          keywordGroups: groups,
        });
      }
    }

    rulesCache = rules;
    return rulesCache;
  }

  document.addEventListener('edm-condition-applied', () => {
    rulesCache = null;
  });

  function countRuleKeywords(rule) {
    if (rule.keywordGroups?.length) {
      return rule.keywordGroups.reduce((sum, group) => sum + group.keywords.length, 0);
    }
    return rule.keywords?.length || 0;
  }

  function totalKeywords(rules) {
    return rules.reduce((sum, r) => sum + countRuleKeywords(r), 0);
  }

  function filterKeywordGroups(rule, query) {
    if (!rule.keywordGroups?.length) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rule.keywordGroups;

    return rule.keywordGroups
      .map((group) => ({
        ...group,
        keywords: group.keywords.filter((kw) => kw.toLowerCase().includes(q)),
      }))
      .filter((group) => group.keywords.length);
  }

  function filterRules(rules, query) {
    const q = query.trim().toLowerCase();
    if (!q) return rules;

    return rules
      .map((rule) => {
        const nameMatch = `${rule.id} ${rule.name} ${rule.category}`.toLowerCase().includes(q);

        if (rule.keywordGroups?.length) {
          const matchedGroups = filterKeywordGroups(rule, query);
          const groupLabelMatch = rule.keywordGroups.some((group) =>
            group.label.toLowerCase().includes(q),
          );

          if (nameMatch || groupLabelMatch) {
            return { ...rule, keywordGroups: rule.keywordGroups };
          }
          if (matchedGroups?.length) {
            return { ...rule, keywordGroups: matchedGroups };
          }
          return null;
        }

        const matchedKeywords = (rule.keywords || []).filter((kw) => kw.toLowerCase().includes(q));
        if (nameMatch) return { ...rule, keywords: rule.keywords };
        if (matchedKeywords.length) return { ...rule, keywords: matchedKeywords };
        return null;
      })
      .filter(Boolean);
  }

  function renderChips(keywords) {
    return keywords
      .map((kw) => `<span class="edm-kw-chip">${escapeHtml(kw.trim())}</span>`)
      .join('');
  }

  function renderKeywordGroups(groups) {
    return `
      <div class="edm-kw-groups">
        ${groups.map((group) => `
          <section class="edm-kw-group edm-kw-group--${escapeHtml(group.id)}">
            <header class="edm-kw-group__head">
              <h4 class="edm-kw-group__title">${escapeHtml(group.label)}</h4>
              <span class="edm-kw-group__count">${group.keywords.length}</span>
            </header>
            <div class="edm-kw-group__chips">${renderChips(group.keywords)}</div>
          </section>`).join('')}
      </div>`;
  }

  function renderRuleCard(rule) {
    const keywordCount = countRuleKeywords(rule);
    const body = rule.keywordGroups?.length
      ? renderKeywordGroups(rule.keywordGroups)
      : `<div class="edm-kw-rule__chips">${renderChips(rule.keywords || [])}</div>`;

    return `
      <article class="edm-kw-rule" data-rule-id="${escapeHtml(rule.id)}">
        <header class="edm-kw-rule__head">
          <div class="edm-kw-rule__title-wrap">
            <span class="edm-kw-rule__id">${escapeHtml(rule.id)}</span>
            <h3 class="edm-kw-rule__name">${escapeHtml(rule.name)}</h3>
          </div>
          <span class="edm-kw-rule__category edm-kw-rule__category--${escapeHtml(rule.category || 'other')}">${escapeHtml(rule.category || 'rule')}</span>
        </header>
        ${body}
        <p class="edm-kw-rule__count">${keywordCount} keyword${keywordCount === 1 ? '' : 's'}${rule.keywordGroups?.length ? ` · ${rule.keywordGroups.length} categories` : ''}</p>
      </article>`;
  }

  function renderModalBody(rules, query) {
    const filtered = filterRules(rules, query);
    const visibleKeywords = totalKeywords(filtered);

    if (!filtered.length) {
      return `
        <div class="edm-kw-empty">
          <p>No keywords match <strong>${escapeHtml(query)}</strong></p>
        </div>`;
    }

    return `
      <div class="edm-kw-summary">
        Showing <strong>${visibleKeywords}</strong> keywords across <strong>${filtered.length}</strong> rule${filtered.length === 1 ? '' : 's'}
      </div>
      <div class="edm-kw-rules">${filtered.map(renderRuleCard).join('')}</div>`;
  }

  function closeModal() {
    if (!activeOverlay) return;
    activeOverlay.remove();
    activeOverlay = null;
    document.body.classList.remove('edm-kw-modal-open');
  }

  async function openModal() {
    closeModal();

    let rules;
    try {
      rules = await loadRules();
    } catch {
      rules = [];
    }

    const overlay = document.createElement('div');
    overlay.className = 'edm-kw-overlay';
    overlay.setAttribute('role', 'presentation');

    const total = totalKeywords(rules);

    overlay.innerHTML = `
      <div class="edm-kw-modal" role="dialog" aria-modal="true" aria-labelledby="edm-kw-modal-title">
        <header class="edm-kw-modal__header">
          <div class="edm-kw-modal__header-text">
            <h2 id="edm-kw-modal-title">Screening keywords</h2>
            <p>${rules.length} rules · ${total} keywords searched in the SCR</p>
          </div>
          <button type="button" class="edm-kw-modal__close" aria-label="Close keywords reference">&times;</button>
        </header>
        <div class="edm-kw-modal__search-wrap">
          <span class="edm-kw-modal__search-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </span>
          <input type="search" class="edm-kw-modal__search" placeholder="Filter rules, categories, or keywords…" aria-label="Filter keywords" />
        </div>
        <div class="edm-kw-modal__body">${renderModalBody(rules, '')}</div>
        <footer class="edm-kw-modal__footer">
          Case-insensitive substring match · <code>*</code> wildcard supported in engine
        </footer>
      </div>`;

    document.body.appendChild(overlay);
    document.body.classList.add('edm-kw-modal-open');
    activeOverlay = overlay;

    const body = overlay.querySelector('.edm-kw-modal__body');
    const search = overlay.querySelector('.edm-kw-modal__search');

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    overlay.querySelector('.edm-kw-modal__close')?.addEventListener('click', closeModal);

    search?.addEventListener('input', () => {
      body.innerHTML = renderModalBody(rules, search.value);
    });

    const onKey = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);

    requestAnimationFrame(() => search?.focus());
  }

  function ensureKeywordsButton() {
    const actions = document.querySelector('#root .edm-app-header__actions');
    if (!actions || actions.querySelector('.edm-keywords-trigger')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'edm-keywords-trigger';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.innerHTML = `${ICON_TAGS}<span>Keywords</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal();
    });

    const disclaimer = actions.querySelector('.edm-disclaimer-trigger');
    if (disclaimer) {
      disclaimer.insertAdjacentElement('afterend', btn);
    } else {
      actions.prepend(btn);
    }
  }

  function schedule() {
    requestAnimationFrame(ensureKeywordsButton);
  }

  window.edmEnhanceKeywordsReference = ensureKeywordsButton;

  const root = document.getElementById('root') || document.body;
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  schedule();
})();
