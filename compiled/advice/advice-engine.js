/**
 * SCR finding advice — match engine + modal UI.
 *
 * Rule data lives in compiled/advice/rules/*.data.js
 * Registry match order: compiled/advice/rules/registry.data.js
 *
 * @module advice/advice-engine
 */
(function () {
  const REGISTRY = window.EDM_ADVICE_REGISTRY || {
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
  const RULES = window.EDM_ADVICE_RULES || {};

  const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };

  const DATE_PATTERNS = [
    /\b(\d{1,2}-[A-Za-z]{3}-\d{4})\b/g,
    /\b(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\b/g,
    /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g,
    /\b(\d{4}-\d{2}-\d{2})\b/g,
  ];

  const KEYWORD_HINTS = {
    anxiety: 'ORL-28',
    depress: 'ORL-28',
    depression: 'ORL-28',
    suicid: 'ORL-28',
    alcohol: 'PA-ALCOHOL',
  };

  const RULE_NAME_HINTS = {
    'eating disorders': 'ORL-06',
    'eating disorder': 'ORL-06',
  };

  const ABSOLUTE_MED_RULE_NAMES = new Set([
    'insulin',
    'oral diabetic',
    'narrow index',
    'narrow therapeutic index',
    'nti',
  ]);

  const GLP1_MARKERS = ['wegovy', 'mounjaro', 'semaglutide', 'tirzepatide', 'liraglutide', 'saxenda', 'ozempic', 'glp-1', 'glp1'];

  let activeModal = null;

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getCategoryMod(rule) {
    const tab = String(rule.tab || '').toLowerCase();
    const type = String(rule.type || '').toLowerCase();
    const action = String(rule.action || '').toUpperCase();
    const outcome = String(rule.outcome || '').toLowerCase();

    if (tab === 'absolute' || tab === 'med-absolute' || type === 'medications-absolute') {
      return 'absolute';
    }
    if (
      type === 'time-sensitive-med'
      || type === 'time-sensitive-condition'
      || rule.timeSensitive
    ) {
      return 'time';
    }
    if (type === 'clinical-details') return 'clinical';
    if (type === 'patient-assessment') return 'patient';
    if (tab === 'counsel' || action === 'COUNSEL' || outcome === 'counsel') return 'patient';
    if (tab === 'info' || action === 'NONE' || outcome === 'none') return 'review';
    if (tab === 'prescriber-review' || tab === 'med-review') return 'review';
    if (rule.action === 'REJECT' || outcome === 'reject') return 'absolute';
    return 'review';
  }

  const CATEGORY_LABELS = {
    absolute: 'Absolute contraindication',
    review: 'Prescriber review',
    time: 'Time-sensitive',
    clinical: 'Clinical details required',
    patient: 'Patient assessment required',
  };

  function getCategoryLabel(rule) {
    return CATEGORY_LABELS[getCategoryMod(rule)] || rule.tabLabel || 'Advice';
  }

  function getCategoryIcon(rule, mod) {
    if (rule.icon) return rule.icon;
    const icons = {
      absolute: '⛔',
      review: '🔍',
      time: '⏱️',
      clinical: '📋',
      patient: '🎗️',
    };
    return icons[mod] || '📋';
  }

  function buildCardHead({ icon, title, tabLabel, mod }) {
    return `
      <div class="edm-advice-rule-card__head edm-advice-rule-card__head--${mod}">
        <span class="edm-advice-rule-icon-wrap edm-advice-rule-icon-wrap--${mod}" aria-hidden="true">${icon}</span>
        <div class="edm-advice-rule-card__titles">
          <h2 class="edm-advice-rule-card__title edm-advice-rule-card__title--${mod}" id="edm-advice-title">${escapeHtml(title)}</h2>
          <span class="edm-advice-rule-tab edm-advice-rule-tab--${mod}">${escapeHtml(tabLabel)}</span>
        </div>
      </div>`;
  }

  function wrapCardBody(html) {
    return `<div class="edm-advice-rule-card__body">${html}</div>`;
  }

  function buildActionSteps(steps, mod) {
    if (!steps?.length) return '';
    return `
      <div class="edm-advice-steps edm-advice-steps--${mod}">
        ${steps.map((step) => `
          <div class="edm-advice-step">
            <span class="edm-advice-step__key">${escapeHtml(step.label)}</span>
            <span class="edm-advice-step__text">${escapeHtml(step.text)}</span>
          </div>`).join('')}
      </div>`;
  }

  function buildStatusChip(message, status) {
    if (!message) return '';
    return `<div class="edm-advice-status-chip edm-advice-status-chip--${status}">${escapeHtml(message)}</div>`;
  }

  function getFindingIndex(card) {
    const list = document.querySelector('#root .sticky.top-4 .space-y-4');
    if (!list) return null;
    const cards = Array.from(list.querySelectorAll(':scope > .bg-red-50.cursor-pointer'));
    const idx = cards.indexOf(card);
    return idx >= 0 ? idx : null;
  }

  function getFindingMark(findingIndex) {
    const root = document.querySelector('#root .prose') || document.getElementById('root');
    return root?.querySelector(`#finding-${findingIndex}`) || null;
  }

  function getScrMedicationSection(findingIndex) {
    const mark = getFindingMark(findingIndex);
    if (!mark) return '';
    const table = mark.closest('table.scr-table');
    const card = table?.closest('.nhsuk-card, [class*="card"]');
    return card?.querySelector('h2, h3, .nhsuk-card__heading')?.textContent?.trim() || '';
  }

  function getCardContext(card) {
    const titleEl = card.querySelector('h4');
    const titleClone = titleEl?.cloneNode(true);
    titleClone?.querySelector('.edm-finding-date')?.remove();
    const title = titleClone?.textContent?.trim() || titleEl?.textContent?.trim() || '';
    const keywordMatch = title.match(/-\s*(.+)$/);
    const ruleName = keywordMatch ? title.replace(/\s*-\s*.+$/, '').trim() : title;
    const keyword = keywordMatch ? keywordMatch[1].trim() : '';

    let snippet = card.dataset.edmSnippet || '';
    if (!snippet) {
      const excerptEl = card.querySelector('.bg-white.border p.italic, .bg-white.border p.text-slate-800');
      snippet = excerptEl?.textContent?.replace(/^[\s"]+|[\s"]+$/g, '').trim() || '';
      if (!snippet) {
        snippet = card.querySelector('p.text-sm.text-red-800, p.text-sm.text-red-700, p.text-sm')?.textContent?.trim() || '';
      }
      if (snippet) card.dataset.edmSnippet = snippet;
    }

    const findingIndex = getFindingIndex(card);
    const scrSection = findingIndex != null ? getScrMedicationSection(findingIndex) : '';
    const sectionLower = scrSection.toLowerCase();
    const dateEl = titleEl?.querySelector('.edm-finding-date');
    const displayDate = dateEl?.textContent?.trim() || '';

    return {
      title,
      ruleName,
      keyword,
      snippet,
      combined: `${title} ${snippet}`.toLowerCase(),
      findingIndex,
      scrSection,
      isRepeatMedication: sectionLower.includes('repeat'),
      isAcuteMedication: sectionLower.includes('acute') && sectionLower.includes('med'),
      displayDate,
    };
  }

  function iterMedItems(rule) {
    const entries = [];
    for (const group of rule.groups || []) {
      if (group.subgroups) {
        for (const subgroup of group.subgroups) {
          for (const item of subgroup.items || []) {
            entries.push({ group, subgroup, item });
          }
        }
      } else {
        for (const item of group.items || []) {
          entries.push({ group, subgroup: null, item });
        }
      }
    }
    return entries;
  }

  function findMedRuleMatch(ctx, rule) {
    let best = null;

    for (const tag of rule.matchKeywords || []) {
      const lower = tag.toLowerCase();
      if (!ctx.combined.includes(lower)) continue;
      const weight = lower.length + (ctx.keyword.toLowerCase().includes(lower) ? 30 : 0);
      if (!best || weight > best.weight) {
        best = { group: null, subgroup: null, item: { label: rule.title }, weight, tag };
      }
    }

    for (const { group, subgroup, item } of iterMedItems(rule)) {
      for (const tag of item.keywords || []) {
        const lower = tag.toLowerCase();
        if (!ctx.combined.includes(lower)) continue;
        const weight = lower.length + (ctx.keyword.toLowerCase().includes(lower) ? 30 : 0);
        if (!best || weight > best.weight) {
          best = { group, subgroup, item, weight, tag };
        }
      }
    }
    return best;
  }

  function findMedicationMatch(ctx, rule) {
    return findMedRuleMatch(ctx, rule);
  }

  function scoreTimeSensitiveCondition(rule, ctx) {
    const text = ctx.combined;

    if (rule.id === 'TS-CHOLECYST') {
      const surgeryTerms = [
        'cholecystectomy',
        'gallbladder removal',
        'post-cholecystectomy',
        'post cholecystectomy',
        'post chole',
      ];
      const hasSurgery = surgeryTerms.some((tag) => text.includes(tag));
      const hasCholecyst = text.includes('cholecyst') && !text.includes('cholecystitis');
      if (!hasSurgery && !hasCholecyst) return null;
      if ((text.includes('gallstone') || text.includes('cholelithiasis')) && !hasSurgery && !hasCholecyst) {
        return null;
      }
      return { rule, score: 100 };
    }

    return scoreConditionRule(rule, ctx);
  }

  function matchTimeSensitive(ctx) {
    const rules = RULES.timeSensitive || [];

    for (const rule of rules) {
      if (rule.type !== 'time-sensitive-condition') continue;
      if (scoreTimeSensitiveCondition(rule, ctx)) {
        return { type: 'time-sensitive-condition', rule };
      }
    }

    const ruleName = ctx.ruleName.toLowerCase();

    if (ruleName === 'insulin' || ABSOLUTE_MED_RULE_NAMES.has(ruleName)) {
      return null;
    }

    for (const rule of rules) {
      if (rule.type === 'time-sensitive-condition') continue;
      const match = findMedRuleMatch(ctx, rule);
      if (match) {
        if (match.group?.id === 'insulin' && isGlp1Product(ctx.combined)) continue;
        return { type: 'time-sensitive-med', rule, match };
      }
    }

    return null;
  }

  function isGlp1Product(text) {
    return GLP1_MARKERS.some((m) => text.includes(m));
  }

  function getGlp1DrugFamily(text) {
    const lower = text.toLowerCase();
    if (lower.includes('mounjaro') || lower.includes('tirzepatide')) return 'tirzepatide';
    if (lower.includes('wegovy') || lower.includes('semaglutide') || lower.includes('ozempic')
      || lower.includes('rybelsus') || lower.includes('nevolat')) return 'semaglutide';
    if (lower.includes('saxenda') || lower.includes('liraglutide')) return 'liraglutide';
    if (lower.includes('glp-1') || lower.includes('glp1')) return 'glp1';
    return null;
  }

  function getMedicationSourceKey(ctx) {
    const section = (ctx.scrSection || '').toLowerCase();
    if (ctx.isRepeatMedication || section.includes('repeat')) return 'repeat';
    if (ctx.isAcuteMedication || (section.includes('acute') && section.includes('med'))) return 'acute';
    if (section.includes('discontinu')) return 'discontinued';
    if (section.includes('medication')) return 'medication-other';
    return 'unknown';
  }

  function scanGlp1SupplyHits() {
    const hits = [];
    const cards = document.querySelectorAll('#root .sticky.top-4 .bg-red-50.cursor-pointer');
    cards.forEach((card) => {
      const cardCtx = getCardContext(card);
      if (!isGlp1Product(cardCtx.combined)) return;
      const family = getGlp1DrugFamily(cardCtx.combined);
      if (!family) return;
      hits.push({
        family,
        source: getMedicationSourceKey(cardCtx),
        keyword: cardCtx.keyword,
        scrSection: cardCtx.scrSection,
      });
    });
    return hits;
  }

  function assessWeightLossInjectionOverlap(ctx) {
    const hits = scanGlp1SupplyHits();
    const activeHits = hits.filter((h) => h.source !== 'discontinued');

    if (!activeHits.length) {
      return {
        status: 'review',
        overlap: false,
        message: 'GLP-1 detected — confirm supply source on SCR',
      };
    }

    const families = [...new Set(activeHits.map((h) => h.family))];
    const activeSources = [...new Set(
      activeHits
        .map((h) => h.source)
        .filter((s) => s === 'repeat' || s === 'acute'),
    )];

    if (families.length > 1) {
      return {
        status: 'reject',
        overlap: true,
        message: `${families.length} different weight-loss injections on SCR — reject overlapping concurrent supply`,
      };
    }

    if (activeSources.includes('repeat') && activeSources.includes('acute')) {
      return {
        status: 'reject',
        overlap: true,
        message: 'GLP-1 on repeat and acute lists — overlapping supply from different sources',
      };
    }

    const acuteHits = activeHits.filter((h) => h.source === 'acute');
    if (acuteHits.length > 1) {
      return {
        status: 'reject',
        overlap: true,
        message: 'Multiple acute GLP-1 entries — possible overlapping supply',
      };
    }

    if (activeHits.every((h) => h.source === 'repeat')) {
      const drug = activeHits[0].keyword || ctx.keyword || 'GLP-1';
      return {
        status: 'prescribe',
        overlap: false,
        message: `${drug} on repeat list only — established GP supply; no overlap detected`,
      };
    }

    if (activeHits.length === 1 && activeHits[0].source === 'acute') {
      return {
        status: 'review',
        overlap: false,
        message: 'Acute supply only — confirm no concurrent GLP-1 from another source',
      };
    }

    return {
      status: 'review',
      overlap: false,
      message: 'Confirm patient is not receiving overlapping GLP-1 supply from another source',
    };
  }

  function matchMedicationsAbsolute(ctx) {
    const rule = RULES.medicationsAbsolute;
    if (!rule) return null;

    const medMatch = findMedicationMatch(ctx, rule);
    if (medMatch) {
      if (medMatch.group?.id === 'insulin' && isGlp1Product(ctx.combined)) return null;
      return { type: 'medications-absolute', rule, match: medMatch };
    }

    const ruleName = ctx.ruleName.toLowerCase();
    if (ruleName === 'insulin' || ABSOLUTE_MED_RULE_NAMES.has(ruleName)) {
      return { type: 'medications-absolute', rule, match: null };
    }

    return null;
  }

  function scoreConditionRule(rule, ctx) {
    const text = ctx.combined;
    if (rule.excludeTags?.some((tag) => text.includes(tag.toLowerCase()))) return null;

    let score = 0;
    for (const tag of rule.searchTags || []) {
      const lower = tag.toLowerCase();
      if (text.includes(lower)) {
        const weight = lower.length + (ctx.keyword.toLowerCase().includes(lower) ? 20 : 0);
        if (weight > score) score = weight;
      }
    }

    if (rule.priorityTags) {
      for (const tag of rule.priorityTags) {
        if (text.includes(tag.toLowerCase())) score += 100;
      }
    }

    return score > 0 ? { rule, score } : null;
  }

  function getActiveConditionId() {
    return (
      document.documentElement?.dataset?.edmCondition
      || window.edmGetActiveCondition?.()
      || ''
    );
  }

  function namesMatch(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function matchPrematureEjaculation(ctx) {
    const rules = RULES.prematureEjaculation || [];
    if (!rules.length) return null;

    const active = getActiveConditionId();
    if (active && active !== 'premature-ejaculation') return null;

    const exact = rules.find((rule) => {
      if (namesMatch(rule.title, ctx.ruleName)) return true;
      return (rule.matchRuleNames || []).some((name) => namesMatch(name, ctx.ruleName));
    });
    if (exact) return { type: 'premature-ejaculation', rule: exact };

    const byId = rules.find((rule) => namesMatch(rule.id, ctx.ruleName) || namesMatch(rule.id, ctx.keyword));
    if (byId) return { type: 'premature-ejaculation', rule: byId };

    const scored = rules.map((r) => scoreConditionRule(r, ctx)).filter(Boolean);
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    return { type: 'premature-ejaculation', rule: scored[0].rule };
  }

  /** Generated protocol packs (hair loss, weight loss): exact rule name, then id, then tags. */
  function matchProtocolPack(bucket, scope, ctx) {
    const rules = RULES[bucket] || [];
    if (!rules.length) return null;

    const active = getActiveConditionId();
    if (active && active !== scope) return null;

    const exact = rules.find((rule) => {
      if (namesMatch(rule.title, ctx.ruleName)) return true;
      return (rule.matchRuleNames || []).some((name) => namesMatch(name, ctx.ruleName));
    });
    if (exact) return { type: scope, rule: exact };

    const byId = rules.find((rule) => namesMatch(rule.id, ctx.ruleName) || namesMatch(rule.id, ctx.keyword));
    if (byId) return { type: scope, rule: byId };

    if (active !== scope) return null;
    const scored = rules.map((r) => scoreConditionRule(r, ctx)).filter(Boolean);
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    return { type: scope, rule: scored[0].rule };
  }

  function matchHairLoss(ctx) {
    return matchProtocolPack('hairLoss', 'hair-loss', ctx);
  }

  function matchWeightLoss(ctx) {
    return matchProtocolPack('weightLoss', 'weight-loss', ctx);
  }

  function matchErectileDysfunction(ctx) {
    const rules = RULES.erectileDysfunction || [];
    if (!rules.length) return null;

    const active = getActiveConditionId();
    if (active && active !== 'erectile-dysfunction') return null;

    const exact = rules.find((rule) => {
      if (namesMatch(rule.title, ctx.ruleName)) return true;
      return (rule.matchRuleNames || []).some((name) => namesMatch(name, ctx.ruleName));
    });
    if (exact) return { type: 'erectile-dysfunction', rule: exact };

    const byId = rules.find((rule) => namesMatch(rule.id, ctx.ruleName) || namesMatch(rule.id, ctx.keyword));
    if (byId) return { type: 'erectile-dysfunction', rule: byId };

    const scored = rules.map((r) => scoreConditionRule(r, ctx)).filter(Boolean);
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    return { type: 'erectile-dysfunction', rule: scored[0].rule };
  }

  function matchCondition(ctx) {
    const activeCondition = getActiveConditionId();
    if (activeCondition === 'premature-ejaculation' || activeCondition === 'erectile-dysfunction' || activeCondition === 'hair-loss') return null;

    const rules = RULES.conditions || [];
    const keywordKey = ctx.keyword.toLowerCase();
    const keywordHint = KEYWORD_HINTS[keywordKey]
      || (keywordKey.includes('anxiety') ? 'ORL-28' : null)
      || (keywordKey.includes('depress') ? 'ORL-28' : null);
    if (keywordHint) {
      const hinted = rules.find((r) => r.id === keywordHint);
      if (hinted) return { type: 'conditions', rule: hinted };
    }

    const hintName = RULE_NAME_HINTS[ctx.ruleName.toLowerCase()];
    if (hintName && hintName.startsWith('ORL-')) {
      const hinted = rules.find((r) => r.id === hintName);
      if (hinted && scoreConditionRule(hinted, ctx)) return { type: 'conditions', rule: hinted };
    }

    const scored = rules.map((r) => scoreConditionRule(r, ctx)).filter(Boolean);
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    return { type: 'conditions', rule: scored[0].rule };
  }

  function scoreClinicalDetailsRule(rule, ctx) {
    const text = ctx.combined;

    if (rule.excludeTags?.some((tag) => text.includes(tag.toLowerCase()))) return null;

    if (rule.id === 'CLIN-GALLSTONES') {
      const hasGallstone = ['gallstone', 'cholelithiasis', 'cholecystitis', 'calculus', 'calculi']
        .some((tag) => text.includes(tag));
      const hasCholecyst = text.includes('cholecyst') && !text.includes('cholecystitis')
        && !text.includes('cholecystectomy');
      if (!hasGallstone && !hasCholecyst) return null;
      return { rule, score: 100 };
    }

    let score = 0;
    for (const tag of rule.searchTags || []) {
      const lower = tag.toLowerCase();
      if (text.includes(lower)) {
        const weight = lower.length + (ctx.keyword.toLowerCase().includes(lower) ? 20 : 0);
        if (weight > score) score = weight;
      }
    }

    if (rule.priorityTags) {
      for (const tag of rule.priorityTags) {
        if (text.includes(tag.toLowerCase())) score += 100;
      }
    }

    return score > 0 ? { rule, score } : null;
  }

  function matchClinicalDetails(ctx) {
    const rules = RULES.clinicalDetails || [];
    const scored = rules.map((r) => scoreClinicalDetailsRule(r, ctx)).filter(Boolean);
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    return { type: 'clinical-details', rule: scored[0].rule };
  }

  function tagMatchesText(text, tag) {
    const lower = tag.toLowerCase();
    if (lower.length <= 6) {
      const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
    }
    return text.includes(lower);
  }

  function scorePatientAssessmentRule(rule, ctx) {
    const text = ctx.combined;
    if (rule.excludeTags?.some((tag) => text.includes(tag.toLowerCase()))) return null;

    let score = 0;
    for (const tag of rule.searchTags || []) {
      const lower = tag.toLowerCase();
      if (tagMatchesText(text, lower)) {
        const weight = lower.length + (ctx.keyword.toLowerCase().includes(lower) ? 20 : 0);
        if (weight > score) score = weight;
      }
    }

    if (rule.priorityTags) {
      for (const tag of rule.priorityTags) {
        if (text.includes(tag.toLowerCase())) score += 100;
      }
    }

    return score > 0 ? { rule, score } : null;
  }

  function matchPatientAssessment(ctx) {
    const rules = RULES.patientAssessment || [];
    const keywordKey = ctx.keyword.toLowerCase();

    const keywordHint = KEYWORD_HINTS[keywordKey]
      || (keywordKey.includes('alcohol') ? 'PA-ALCOHOL' : null);
    if (keywordHint) {
      const hinted = rules.find((r) => r.id === keywordHint);
      if (hinted && scorePatientAssessmentRule(hinted, ctx)) {
        return { type: 'patient-assessment', rule: hinted };
      }
    }

    const scored = rules.map((r) => scorePatientAssessmentRule(r, ctx)).filter(Boolean);
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    return { type: 'patient-assessment', rule: scored[0].rule };
  }

  function getActiveSpecialConsiderations(rule, ctx) {
    return (rule.specialConsiderations || []).filter((item) =>
      item.matchTags?.some((tag) => ctx.combined.includes(tag.toLowerCase())),
    );
  }

  function parseEgfr(text) {
    const patterns = [
      /egfr\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
      /estimated\s+glomerular\s+filtration\s+rate[^\d]{0,40}(\d+(?:\.\d+)?)/i,
      /gfr\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return parseFloat(match[1]);
    }
    if (/stage\s*(?:4|5|iv|v)\b/i.test(text) && /kidney|renal|ckd/i.test(text)) return 25;
    return null;
  }

  function parseHfStage(text) {
    if (/stage\s*iv|nyha\s*(?:class\s*)?iv|\bclass\s*iv\b|shortness of breath at rest/i.test(text)) {
      return 4;
    }
    if (/stage\s*iii|nyha\s*(?:class\s*)?iii|\bclass\s*iii\b/i.test(text)) return 3;
    if (/stage\s*ii\b|nyha\s*(?:class\s*)?ii\b|\bclass\s*ii\b/i.test(text)) return 2;
    if (/stage\s*i\b|nyha\s*(?:class\s*)?i\b|\bclass\s*i\b/i.test(text)) return 1;
    return null;
  }

  function assessClinicalDetails(ctx, rule) {
    if (rule.id === 'CLIN-CKD') {
      const egfr = parseEgfr(ctx.combined);
      if (egfr == null) {
        return { status: 'info-needed', message: 'No eGFR on SCR — email patient for recent result' };
      }
      if (egfr < 30) {
        return { status: 'reject', message: `eGFR ${egfr} ml/min on SCR — severe CKD (Stage 4-5)` };
      }
      return { status: 'prescribe', message: `eGFR ${egfr} ml/min on SCR — Stage 1-3` };
    }

    if (rule.id === 'CLIN-HF') {
      const stage = parseHfStage(ctx.combined);
      if (stage == null) {
        return { status: 'info-needed', message: 'No HF stage on SCR — email patient for cardiology letter' };
      }
      if (stage >= 4) {
        return { status: 'reject', message: 'Stage IV heart failure indicated on SCR' };
      }
      return { status: 'prescribe', message: `Stage ${['I', 'II', 'III', 'IV'][stage - 1]} heart failure on SCR` };
    }

    if (rule.id === 'CLIN-GALLSTONES') {
      return { status: 'info-needed', message: 'No cholecystectomy on SCR — hold order and ask patient' };
    }

    return null;
  }

  function matchAdvice(ctx) {
    for (const key of REGISTRY.matchOrder) {
      if (key === 'premature-ejaculation') {
        const hit = matchPrematureEjaculation(ctx);
        if (hit) return hit;
      }
      if (key === 'erectile-dysfunction') {
        const hit = matchErectileDysfunction(ctx);
        if (hit) return hit;
      }
      if (key === 'hair-loss') {
        const hit = matchHairLoss(ctx);
        if (hit) return hit;
      }
      if (key === 'weight-loss') {
        const hit = matchWeightLoss(ctx);
        if (hit) return hit;
      }
      if (key === 'time-sensitive') {
        const hit = matchTimeSensitive(ctx);
        if (hit) return hit;
      }
      if (key === 'clinical-details') {
        const hit = matchClinicalDetails(ctx);
        if (hit) return hit;
      }
      if (key === 'medications-absolute') {
        const hit = matchMedicationsAbsolute(ctx);
        if (hit) return hit;
      }
      if (key === 'patient-assessment') {
        const hit = matchPatientAssessment(ctx);
        if (hit) return hit;
      }
      if (key === 'conditions') {
        const hit = matchCondition(ctx);
        if (hit) return hit;
      }
    }
    return null;
  }

  function getMedicationRowForMark(mark) {
    if (!mark) return null;
    const row = mark.closest('tr');
    if (!row) return null;
    if (!mark.closest('.scr-supporting-inset')) return row;

    let prev = row.previousElementSibling;
    while (prev) {
      const first = prev.querySelector('td:first-child');
      if (first && !first.classList.contains('scr-table__cell--spacer')) return prev;
      prev = prev.previousElementSibling;
    }
    return row;
  }

  function getDateTextFromScrRow(row) {
    if (!row) return null;

    const cells = Array.from(row.querySelectorAll('td.scr-table__cell:not(.scr-table__cell--spacer)'));
    for (const cell of cells) {
      const text = cell.querySelector('p')?.textContent?.trim() || '';
      if (/^(entered|prescribed|last issued|authorised|recorded|onset|start date|ended|resolved)/i.test(text)) {
        return text;
      }
    }

    for (let i = 1; i < cells.length; i += 1) {
      const dateText = cells[i].querySelector('p')?.textContent?.trim() || '';
      if (dateText && dateText !== '—' && /\d/.test(dateText)) return dateText;
    }

    return null;
  }

  function getDateFromFindingRow(findingIndex) {
    const mark = getFindingMark(findingIndex);
    if (!mark) return null;
    return getDateTextFromScrRow(getMedicationRowForMark(mark));
  }

  function getMostRecentDate(ctx) {
    const sources = [
      getDateFromFindingRow(ctx.findingIndex),
      ctx.displayDate,
      ...extractDates(ctx.snippet).map((d) => d.raw),
      ...extractDates(ctx.combined).map((d) => d.raw),
    ].filter(Boolean);

    let best = null;
    for (const raw of sources) {
      const parsed = parseDate(raw);
      if (!parsed || Number.isNaN(parsed.getTime())) continue;
      if (!best || parsed > best.date) best = { raw, date: parsed };
    }
    return best;
  }

  function assessMedicationTiming(ctx, rule) {
    const threshold = rule.monthsThreshold || 3;

    if (ctx.isRepeatMedication) {
      return {
        status: 'reject',
        reason: 'repeat',
        threshold,
        message: 'Present on repeat medication list',
      };
    }

    const recent = getMostRecentDate(ctx);
    if (!recent) {
      return {
        status: 'reject',
        reason: 'unknown',
        threshold,
        message: 'No prescription date found — confirm before approving',
      };
    }

    const monthsAgo = monthsBetween(recent.date, new Date());
    if (monthsAgo < threshold) {
      return {
        status: 'reject',
        reason: 'within',
        threshold,
        monthsAgo,
        eventDate: formatDate(recent.date),
        message: `Prescribed ${formatDate(recent.date)} — ${monthsAgo} month${monthsAgo === 1 ? '' : 's'} ago (within ${threshold}-month window)`,
      };
    }

    return {
      status: 'caution',
      reason: 'outside',
      threshold,
      monthsAgo,
      eventDate: formatDate(recent.date),
      message: `Prescribed ${formatDate(recent.date)} — ${monthsAgo} months ago (outside ${threshold}-month window)`,
    };
  }

  function assessEventTiming(ctx, rule) {
    const threshold = rule.monthsThreshold || 12;
    const recent = getMostRecentDate(ctx);

    if (!recent) {
      return {
        status: 'reject',
        reason: 'unknown',
        threshold,
        message: `Confirm date of ${rule.eventLabel || 'procedure'}`,
      };
    }

    const monthsAgo = monthsBetween(recent.date, new Date());
    if (monthsAgo < threshold) {
      return {
        status: 'reject',
        reason: 'within',
        threshold,
        monthsAgo,
        eventDate: formatDate(recent.date),
        message: `Surgery ${formatDate(recent.date)} — ${monthsAgo} month${monthsAgo === 1 ? '' : 's'} ago (within ${threshold}-month exclusion)`,
      };
    }

    return {
      status: 'caution',
      reason: 'outside',
      threshold,
      monthsAgo,
      eventDate: formatDate(recent.date),
      message: `Surgery ${formatDate(recent.date)} — ${monthsAgo} months ago (≥ ${threshold} months)`,
    };
  }

  function assessTimeSensitiveTiming(ctx, result) {
    if (result.type === 'time-sensitive-condition') {
      return assessEventTiming(ctx, result.rule);
    }
    return assessMedicationTiming(ctx, result.rule);
  }

  function parseDate(raw) {
    if (!raw) return null;
    const t = raw.trim().replace(/^(entered|prescribed|last issued|authorised(?:\s*\([^)]*\))?|recorded|onset|start date|ended|resolved)\s*:\s*/i, '');
    let m = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/i);
    if (m) {
      const month = MONTHS[m[2].toLowerCase()];
      if (month) return new Date(parseInt(m[3], 10), month - 1, parseInt(m[1], 10));
    }
    m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/i);
    if (m) {
      const month = MONTHS[m[2].toLowerCase()];
      if (month) return new Date(parseInt(m[3], 10), month - 1, parseInt(m[1], 10));
    }
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    return null;
  }

  function formatDate(date) {
    if (!date || Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function monthsBetween(from, to) {
    return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  }

  function extractDates(text) {
    if (!text) return [];
    const found = [];
    for (const pattern of DATE_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const parsed = parseDate(match[1]);
        if (parsed && !Number.isNaN(parsed.getTime())) {
          found.push({ raw: match[1], date: parsed });
        }
      }
    }
    return found;
  }

  function assessTimeSensitivity(rule, ctx) {
    if (!rule.timeSensitive) return null;
    const dates = extractDates(ctx.snippet);
    if (!dates.length) return { status: 'unknown' };
    const eventDate = dates[0].date;
    const monthsAgo = monthsBetween(eventDate, new Date());
    const threshold = rule.timeSensitive.monthsThreshold;
    if (rule.timeSensitive.rejectIfWithinMonths) {
      return {
        status: monthsAgo < threshold ? 'reject' : 'review',
        monthsAgo,
        threshold,
        eventDate: formatDate(eventDate),
      };
    }
    return null;
  }

  function buildConditionsList(items) {
    if (!items?.length) return '';
    return `<ul class="edm-advice-rule-conditions">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }

  function buildTimeSensitiveMedCard(rule, match, timing) {
    const statusClass = timing?.status === 'caution' ? 'time-caution' : 'time-reject';

    const groupsHtml = (rule.groups || []).map((group) => {
      const isMatchedGroup = match?.group?.id === group.id;

      if (group.subgroups) {
        const subgroupsHtml = group.subgroups.map((subgroup) => {
          const itemsHtml = (subgroup.items || []).map((item) => {
            const isMatchedItem = isMatchedGroup && match?.item?.label === item.label;
            return `<li class="edm-advice-med-item${isMatchedItem ? ' edm-advice-med-item--matched' : ''}">${escapeHtml(item.label)}</li>`;
          }).join('');

          return `
            <div class="edm-advice-med-subgroup">
              <h4 class="edm-advice-med-subgroup__title">${escapeHtml(subgroup.title)}</h4>
              <ul class="edm-advice-med-group__list">${itemsHtml}</ul>
            </div>`;
        }).join('');

        return `
          <section class="edm-advice-med-group${isMatchedGroup ? ' edm-advice-med-group--matched' : ''}">
            <h3 class="edm-advice-med-group__title edm-advice-med-group__title--time">${escapeHtml(group.title)}</h3>
            ${subgroupsHtml}
          </section>`;
      }

      const itemsHtml = (group.items || []).map((item) => {
        const isMatchedItem = isMatchedGroup && match?.item?.label === item.label;
        return `<li class="edm-advice-med-item${isMatchedItem ? ' edm-advice-med-item--matched' : ''}">${escapeHtml(item.label)}</li>`;
      }).join('');

      return `
        <section class="edm-advice-med-group${isMatchedGroup ? ' edm-advice-med-group--matched' : ''}">
          <h3 class="edm-advice-med-group__title edm-advice-med-group__title--time">${escapeHtml(group.title)}</h3>
          <ul class="edm-advice-med-group__list">${itemsHtml}</ul>
        </section>`;
    }).join('');

    const safeBlock = timing?.status === 'caution'
      ? `<div class="edm-advice-callout edm-advice-callout--safe">✓ ${escapeHtml(rule.safeIfLabel)}</div>`
      : '';

    const timingNote = timing?.message
      ? buildStatusChip(timing.message, statusClass === 'time-caution' ? 'prescribe' : 'reject')
      : '';

    const body = `
        <div class="edm-advice-hold-row">
          <span class="edm-advice-pill edm-advice-pill--reject">REJECT</span>
          <span class="edm-advice-pill edm-advice-pill--muted">${escapeHtml(rule.actionSubLabel)}</span>
        </div>
        <div class="edm-advice-section-label">Conditions</div>
        ${buildConditionsList(rule.rejectConditions)}
        ${timingNote}
        ${safeBlock}
        ${(rule.groups || []).length ? `<div class="edm-advice-med-groups edm-advice-med-groups--time">${groupsHtml}</div>` : ''}
        <div class="edm-advice-rationale edm-advice-rationale--time">
          <strong>Rationale</strong>
          <span>${escapeHtml(rule.rationale)}</span>
        </div>`;

    return `
      <div class="edm-advice-rule-card edm-advice-rule-card--time-sensitive edm-advice-rule-card--time edm-advice-rule-card--${statusClass}">
        ${buildCardHead({
          icon: getCategoryIcon(rule, 'time'),
          title: rule.title,
          tabLabel: getCategoryLabel(rule),
          mod: 'time',
        })}
        ${wrapCardBody(body)}
      </div>`;
  }

  function buildTimeSensitiveConditionCard(rule, timing) {
    const statusClass = timing?.status === 'caution' ? 'time-caution' : 'time-reject';

    const body = `
        <div class="edm-advice-hold-row">
          <span class="edm-advice-pill edm-advice-pill--reject">REJECT</span>
          <span class="edm-advice-pill edm-advice-pill--muted">${escapeHtml(rule.actionSubLabel)}</span>
        </div>
        ${buildStatusChip(timing?.message, statusClass === 'time-caution' ? 'prescribe' : 'reject')}
        <div class="edm-advice-callout edm-advice-callout--safe">✓ ${escapeHtml(rule.safeIfLabel)}</div>
        <div class="edm-advice-rationale edm-advice-rationale--condition">
          <strong>Rationale</strong>
          <span>${escapeHtml(rule.rationale)}</span>
        </div>
        ${rule.ifNeeded ? `<div class="edm-advice-callout edm-advice-callout--info">${escapeHtml(rule.ifNeeded)}</div>` : ''}`;

    return `
      <div class="edm-advice-rule-card edm-advice-rule-card--time-sensitive edm-advice-rule-card--time edm-advice-rule-card--time-condition edm-advice-rule-card--${statusClass}">
        ${buildCardHead({
          icon: getCategoryIcon(rule, 'time'),
          title: rule.title,
          tabLabel: getCategoryLabel(rule),
          mod: 'time',
        })}
        ${wrapCardBody(body)}
      </div>`;
  }

  function buildMedicationsCard(rule, match) {
    const groupsHtml = (rule.groups || []).map((group) => {
      const isMatchedGroup = match?.group?.id === group.id;
      const itemsHtml = (group.items || []).map((item) => {
        const isMatchedItem = isMatchedGroup && match?.item?.label === item.label;
        return `<li class="edm-advice-med-item${isMatchedItem ? ' edm-advice-med-item--matched' : ''}">${escapeHtml(item.label)}</li>`;
      }).join('');

      return `
        <section class="edm-advice-med-group${isMatchedGroup ? ' edm-advice-med-group--matched' : ''}">
          <h3 class="edm-advice-med-group__title">${escapeHtml(group.title)}</h3>
          <ul class="edm-advice-med-group__list">${itemsHtml}</ul>
        </section>`;
    }).join('');

    const body = `
        <div class="edm-advice-banner edm-advice-banner--reject">${escapeHtml(rule.actionLabel)}</div>
        <div class="edm-advice-med-groups">${groupsHtml}</div>
        <div class="edm-advice-rationale edm-advice-rationale--absolute">
          <strong>Rationale</strong>
          <span>${escapeHtml(rule.rationale)}</span>
        </div>`;

    return `
      <div class="edm-advice-rule-card edm-advice-rule-card--absolute edm-advice-rule-card--absolute-med">
        ${buildCardHead({
          icon: getCategoryIcon(rule, 'absolute'),
          title: rule.title,
          tabLabel: getCategoryLabel(rule),
          mod: 'absolute',
        })}
        ${wrapCardBody(body)}
      </div>`;
  }

  function buildWeightLossInjectionCard(rule, assessment) {
    const mod = assessment?.status === 'reject' ? 'absolute' : 'review';
    const actionLabel = assessment?.status === 'reject' ? 'REJECT IMMEDIATELY' : 'PRESCRIBER REVIEW';
    const actionClass = assessment?.status === 'reject'
      ? 'edm-advice-rule-action--reject'
      : 'edm-advice-rule-action--review';

    const body = `
        <div class="edm-advice-rule-row edm-advice-rule-row--in-body">
          <span class="edm-advice-rule-label">Action</span>
          <span class="edm-advice-rule-action ${actionClass}">${actionLabel}</span>
        </div>
        ${buildStatusChip(assessment?.message, assessment?.status || 'review')}
        ${buildClinicalOutcomeBlock('Reject if', rule.rejectIf, 'reject')}
        ${buildClinicalOutcomeBlock('Accept if', rule.acceptIf, 'prescribe')}`;

    return `
      <div class="edm-advice-rule-card edm-advice-rule-card--${mod}">
        ${buildCardHead({
          icon: assessment?.status === 'reject' ? '⛔' : '💉',
          title: rule.title,
          tabLabel: assessment?.status === 'reject' ? 'Absolute contraindication' : getCategoryLabel(rule),
          mod,
        })}
        ${wrapCardBody(body)}
      </div>`;
  }

  function resolveActionPresentation(rule, timing) {
    const action = timing?.status === 'reject' ? 'REJECT' : String(rule.action || '').toUpperCase();
    const outcome = String(rule.outcome || '').toLowerCase();

    if (rule.actionLabel && !timing) {
      return {
        actionLabel: rule.actionLabel,
        actionClass: outcome === 'reject' ? 'edm-advice-rule-action--reject' : 'edm-advice-rule-action--review',
      };
    }
    if (timing?.status === 'reject' || action === 'REJECT' || outcome === 'reject') {
      return { actionLabel: 'REJECT IMMEDIATELY', actionClass: 'edm-advice-rule-action--reject' };
    }
    if (action === 'COUNSEL' || outcome === 'counsel') {
      return { actionLabel: 'COUNSEL', actionClass: 'edm-advice-rule-action--review' };
    }
    if (action === 'NONE' || outcome === 'none') {
      return { actionLabel: 'NOT AN EXCLUSION', actionClass: 'edm-advice-rule-action--review' };
    }
    return { actionLabel: 'PRESCRIBER REVIEW', actionClass: 'edm-advice-rule-action--review' };
  }

  function buildProtocolBlock(rule) {
    const bits = [];
    if (rule.protocolRef || rule.protocolSection) {
      bits.push(`
        <div class="edm-advice-rule-row edm-advice-rule-row--in-body">
          <span class="edm-advice-rule-label">Protocol</span>
          <p class="edm-advice-rule-note">${escapeHtml(rule.protocolRef || rule.protocolSection)}</p>
        </div>`);
    }
    if (rule.protocolCondition) {
      bits.push(`
        <div class="edm-advice-rule-row edm-advice-rule-row--in-body">
          <span class="edm-advice-rule-label">Protocol wording</span>
          <p class="edm-advice-rule-note">${escapeHtml(rule.protocolCondition)}</p>
        </div>`);
    }
    if (rule.summary) {
      bits.push(`
        <div class="edm-advice-rule-row edm-advice-rule-row--in-body">
          <span class="edm-advice-rule-label">Summary</span>
          <p class="edm-advice-rule-note">${escapeHtml(rule.summary)}</p>
        </div>`);
    }
    if (rule.counselText) {
      bits.push(`
        <div class="edm-advice-callout edm-advice-callout--info">${escapeHtml(rule.counselText)}</div>`);
    }
    if (rule.patientMessage && rule.patientMessage !== rule.counselText) {
      bits.push(`
        <div class="edm-advice-rule-row edm-advice-rule-row--in-body">
          <span class="edm-advice-rule-label">Patient message</span>
          <p class="edm-advice-rule-note">${escapeHtml(rule.patientMessage)}</p>
        </div>`);
    } else if (rule.patientMessage && !rule.counselText) {
      bits.push(`
        <div class="edm-advice-callout edm-advice-callout--info">${escapeHtml(rule.patientMessage)}</div>`);
    }
    if (rule.rationale) {
      bits.push(`
        <div class="edm-advice-rationale">
          <strong>Rationale</strong>
          <span>${escapeHtml(rule.rationale)}</span>
        </div>`);
    }
    if (rule.source) {
      bits.push(`
        <div class="edm-advice-rule-row edm-advice-rule-row--in-body">
          <span class="edm-advice-rule-label">Source</span>
          <p class="edm-advice-rule-note">${escapeHtml(rule.source)}</p>
        </div>`);
    }
    return bits.join('');
  }

  function buildConditionCard(rule, timing, ctx) {
    if (rule.id === 'ORL-26' && ctx) {
      return buildWeightLossInjectionCard(rule, assessWeightLossInjectionOverlap(ctx));
    }

    const mod = getCategoryMod(rule);
    const action = timing?.status === 'reject' ? 'REJECT' : rule.action;
    const conditions = [...(rule.conditions || rule.rejectIf || [])];

    if (timing?.status === 'reject') {
      conditions.unshift(`Surgery ${timing.eventDate} — ${timing.monthsAgo} month${timing.monthsAgo === 1 ? '' : 's'} ago (within ${timing.threshold}-month exclusion)`);
    } else if (timing?.status === 'review') {
      conditions.unshift(`Surgery ${timing.eventDate} — ${timing.monthsAgo} months ago (outside ${timing.threshold}-month exclusion)`);
    } else if (timing?.status === 'unknown' && rule.timeSensitive) {
      conditions.unshift(`Confirm date of ${rule.timeSensitive.eventLabel}`);
    }

    const { actionLabel, actionClass } = resolveActionPresentation(rule, timing);
    const conditionsLabel = rule.conditions ? 'Conditions' : 'Reject if';

    const acceptBlock = rule.acceptIf?.length && (action === 'REVIEW' || rule.outcome === 'flag' || ['hair-loss', 'weight-loss'].includes(rule.conditionScope))
      ? buildClinicalOutcomeBlock('Accept if', rule.acceptIf, 'prescribe')
      : '';
    const askBlock = rule.askPatient?.length
      ? buildClinicalOutcomeBlock('Ask / confirm', rule.askPatient, 'prescribe')
      : '';

    const body = `
        <div class="edm-advice-rule-row edm-advice-rule-row--in-body">
          <span class="edm-advice-rule-label">Action</span>
          <span class="edm-advice-rule-action ${actionClass}">${actionLabel}</span>
        </div>
        ${buildProtocolBlock(rule)}
        ${buildClinicalOutcomeBlock(conditionsLabel, conditions, 'reject')}
        ${askBlock}
        ${acceptBlock}
        ${rule.overridePermitted && rule.overrideRequires ? buildClinicalOutcomeBlock('Prescriber override permitted', [rule.overrideRequires], 'prescribe') : ''}`;

    return `
      <div class="edm-advice-rule-card edm-advice-rule-card--${mod}">
        ${buildCardHead({
          icon: getCategoryIcon(rule, mod),
          title: rule.title,
          tabLabel: getCategoryLabel(rule) || rule.tabLabel || 'Advice',
          mod,
        })}
        ${wrapCardBody(body)}
      </div>`;
  }

  function buildClinicalOutcomeBlock(label, items, variant) {
    if (!items?.length) return '';
    return `
      <div class="edm-advice-outcome edm-advice-outcome--${variant}">
        <h3 class="edm-advice-outcome__label">${escapeHtml(label)}</h3>
        ${buildConditionsList(items)}
      </div>`;
  }

  function buildClinicalDetailsCard(rule, assessment) {
    const steps = [];
    if (rule.actionText) steps.push({ label: 'Action', text: rule.actionText });
    if (rule.request) steps.push({ label: 'Request', text: rule.request });

    const body = `
      ${rule.holdAction ? `<div class="edm-advice-hold-row">
          <span class="edm-advice-pill edm-advice-pill--hold">${escapeHtml(rule.holdAction)}</span>
          <span class="edm-advice-pill edm-advice-pill--hold-sub">${escapeHtml(rule.holdSubLabel)}</span>
        </div>` : ''}
      ${rule.question ? `<div class="edm-advice-callout edm-advice-callout--question">
          <span class="edm-advice-callout__badge">?</span>
          <p><strong>Question to ask:</strong> &ldquo;${escapeHtml(rule.question)}&rdquo;</p>
        </div>` : ''}
      ${buildActionSteps(steps, 'clinical')}
      ${buildStatusChip(assessment?.message, assessment?.status || 'info-needed')}
      ${buildClinicalOutcomeBlock('Reject if', rule.rejectIf, 'reject')}
      ${buildClinicalOutcomeBlock('Prescribe if', rule.prescribeIf, 'prescribe')}`;

    return `
      <div class="edm-advice-rule-card edm-advice-rule-card--clinical">
        ${buildCardHead({
          icon: getCategoryIcon(rule, 'clinical'),
          title: rule.title,
          tabLabel: getCategoryLabel(rule),
          mod: 'clinical',
        })}
        ${wrapCardBody(body)}
      </div>`;
  }

  function buildPatientAssessmentInfoBlock(label, items) {
    if (!items?.length) return '';
    return `
      <div class="edm-advice-outcome edm-advice-outcome--info">
        <h3 class="edm-advice-outcome__label">${escapeHtml(label)}</h3>
        ${buildConditionsList(items)}
      </div>`;
  }

  function buildScreeningQuestionsBlock(questions) {
    if (!questions?.length) return '';
    return `
      <div class="edm-advice-screening">
        <h3 class="edm-advice-screening__label">CAGE screening</h3>
        ${buildConditionsList(questions)}
      </div>`;
  }

  function buildPatientAssessmentCard(rule, ctx) {
    const exclusionBlock = rule.exclusionNote
      ? `<div class="edm-advice-callout edm-advice-callout--exclusion">
          <span class="edm-advice-callout__badge">!</span>
          <p><strong>Exclusion</strong> ${escapeHtml(rule.exclusionNote)}</p>
        </div>`
      : '';

    const specialBlocks = getActiveSpecialConsiderations(rule, ctx).map((item) => `
      <div class="edm-advice-callout edm-advice-callout--special">
        <span class="edm-advice-callout__badge">${item.icon || '🌷'}</span>
        <div>
          <h3 class="edm-advice-callout__title">${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.text)}</p>
        </div>
      </div>`).join('');

    const body = `
        ${exclusionBlock}
        ${specialBlocks}
        ${rule.emailAction ? `<div class="edm-advice-banner edm-advice-banner--patient">${escapeHtml(rule.emailAction)}</div>` : ''}
        ${buildScreeningQuestionsBlock(rule.screeningQuestions)}
        ${buildClinicalOutcomeBlock('Reject if', rule.rejectIf, 'reject')}
        ${buildClinicalOutcomeBlock('Prescribe if', rule.prescribeIf, 'prescribe')}
        ${buildPatientAssessmentInfoBlock('Information needed', rule.informationNeeded)}`;

    return `
      <div class="edm-advice-rule-card edm-advice-rule-card--patient">
        ${buildCardHead({
          icon: getCategoryIcon(rule, 'patient'),
          title: rule.title,
          tabLabel: getCategoryLabel(rule),
          mod: 'patient',
        })}
        ${wrapCardBody(body)}
      </div>`;
  }

  function buildModalContent(result, ctx) {
    if (result.type === 'patient-assessment') {
      return buildPatientAssessmentCard(result.rule, ctx);
    }
    if (result.type === 'clinical-details') {
      const assessment = assessClinicalDetails(ctx, result.rule);
      return buildClinicalDetailsCard(result.rule, assessment);
    }
    if (result.type === 'time-sensitive-condition') {
      const timing = assessEventTiming(ctx, result.rule);
      return buildTimeSensitiveConditionCard(result.rule, timing);
    }
    if (result.type === 'time-sensitive-med') {
      const timing = assessMedicationTiming(ctx, result.rule);
      return buildTimeSensitiveMedCard(result.rule, result.match, timing);
    }
    if (result.type === 'medications-absolute') {
      return buildMedicationsCard(result.rule, result.match);
    }
    if (['premature-ejaculation', 'erectile-dysfunction', 'hair-loss', 'weight-loss'].includes(result.type)) {
      return buildConditionCard(result.rule, null, ctx);
    }
    const timing = assessTimeSensitivity(result.rule, ctx);
    return buildConditionCard(result.rule, timing, ctx);
  }

  function closeModal() {
    if (!activeModal) return;
    activeModal.remove();
    activeModal = null;
    document.body.classList.remove('edm-advice-modal-open');
  }

  function openAdviceModal(result, ctx) {
    closeModal();

    const overlay = document.createElement('div');
    overlay.className = 'edm-advice-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'edm-advice-modal edm-advice-modal--compact';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'edm-advice-title');

    dialog.innerHTML = `
      <button type="button" class="edm-advice-modal__close" aria-label="Close advice">&times;</button>
      ${buildModalContent(result, ctx)}
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.body.classList.add('edm-advice-modal-open');
    activeModal = overlay;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    dialog.querySelector('.edm-advice-modal__close')?.addEventListener('click', closeModal);

    const onKey = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
  }

  function showFallbackModal(ctx) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'edm-advice-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'edm-advice-modal edm-advice-modal--compact';
    const displayTitle = ctx.title
      || (ctx.ruleName && ctx.keyword ? `${ctx.ruleName} — ${ctx.keyword}` : (ctx.keyword || ctx.ruleName));
    const body = `
        <div class="edm-advice-rule-row edm-advice-rule-row--in-body">
          <span class="edm-advice-rule-label">Action</span>
          <span class="edm-advice-rule-action edm-advice-rule-action--review">PRESCRIBER REVIEW</span>
        </div>
        <div class="edm-advice-rule-row edm-advice-rule-row--in-body">
          <span class="edm-advice-rule-label">Note</span>
          <p class="edm-advice-rule-note">No matching advice rule — review contraindications reference manually.</p>
        </div>`;
    dialog.innerHTML = `
      <button type="button" class="edm-advice-modal__close" aria-label="Close">&times;</button>
      <div class="edm-advice-rule-card edm-advice-rule-card--review">
        ${buildCardHead({
          icon: '🔍',
          title: displayTitle,
          tabLabel: 'Prescriber review',
          mod: 'review',
        })}
        ${wrapCardBody(body)}
      </div>`;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    activeModal = overlay;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    dialog.querySelector('.edm-advice-modal__close')?.addEventListener('click', closeModal);
  }

  function createAdviceButton(card) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'edm-advice-btn';
    btn.textContent = 'Advice';
    btn.setAttribute('aria-label', 'View prescriber advice');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const ctx = getCardContext(card);
      const result = matchAdvice(ctx);
      if (result) openAdviceModal(result, ctx);
      else showFallbackModal(ctx);
    });

    return btn;
  }

  function applyAdviceFindingStyle(card) {
    const ctx = getCardContext(card);
    card.classList.remove(
      'edm-finding-card--time-reject',
      'edm-finding-card--time-caution',
      'edm-finding-card--clinical',
      'edm-finding-card--patient',
    );

    const btn = card.querySelector('.edm-advice-btn');
    btn?.classList.remove('edm-advice-btn--caution', 'edm-advice-btn--clinical', 'edm-advice-btn--patient');

    const absMed = matchMedicationsAbsolute(ctx);
    if (absMed) {
      card.classList.add('edm-finding-card--time-reject');
      card.dataset.edmAdviceCategory = 'absolute-med';
      return;
    }

    const ts = matchTimeSensitive(ctx);
    if (ts) {
      const timing = assessTimeSensitiveTiming(ctx, ts);
      if (timing.status === 'caution') {
        card.classList.add('edm-finding-card--time-caution');
        btn?.classList.add('edm-advice-btn--caution');
      } else {
        card.classList.add('edm-finding-card--time-reject');
      }
      card.dataset.edmAdviceCategory = 'time-sensitive';
      card.dataset.edmTimeStatus = timing.status;
      return;
    }

    const clinical = matchClinicalDetails(ctx);
    if (clinical) {
      card.classList.add('edm-finding-card--clinical');
      btn?.classList.add('edm-advice-btn--clinical');
      card.dataset.edmAdviceCategory = 'clinical-details';
      return;
    }

    const patient = matchPatientAssessment(ctx);
    if (patient) {
      card.classList.add('edm-finding-card--patient');
      btn?.classList.add('edm-advice-btn--patient');
      card.dataset.edmAdviceCategory = 'patient-assessment';
      return;
    }

    if (isGlp1Product(ctx.combined)) {
      const weightLossRule = (RULES.conditions || []).find((r) => r.id === 'ORL-26');
      if (weightLossRule && scoreConditionRule(weightLossRule, ctx)) {
        const assessment = assessWeightLossInjectionOverlap(ctx);
        if (assessment.overlap || assessment.status === 'reject') {
          card.classList.add('edm-finding-card--time-reject');
        } else {
          card.classList.add('edm-finding-card--time-caution');
          btn?.classList.add('edm-advice-btn--caution');
        }
        card.dataset.edmAdviceCategory = 'weight-loss-injection';
        card.dataset.edmOverlapStatus = assessment.status;
        return;
      }
    }

    delete card.dataset.edmAdviceCategory;
    delete card.dataset.edmTimeStatus;
    delete card.dataset.edmOverlapStatus;
  }

  function enhanceFindingAdvice() {
    document.querySelectorAll('#root .sticky.top-4 .bg-red-50.cursor-pointer').forEach((card) => {
      if (card.hidden || card.dataset.edmDuplicateFinding === '1') return;

      const badgeArea = card.querySelector('.flex.gap-2.items-center, .flex.gap-2');
      if (!badgeArea) return;

      const presentBadge = Array.from(badgeArea.children).find(
        (el) => el.textContent?.trim() === 'Present',
      );
      if (!presentBadge || badgeArea.querySelector('.edm-advice-btn')) {
        applyAdviceFindingStyle(card);
        return;
      }

      const excerptEl = card.querySelector('.bg-white.border p.italic, .bg-white.border p.text-slate-800');
      if (excerptEl?.textContent) {
        card.dataset.edmSnippet = excerptEl.textContent.replace(/^[\s"]+|[\s"]+$/g, '').trim();
      }

      presentBadge.replaceWith(createAdviceButton(card));
      applyAdviceFindingStyle(card);
    });
  }

  function schedule() {
    requestAnimationFrame(enhanceFindingAdvice);
  }

  const root = document.getElementById('root') || document.body;
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  schedule();

  window.EDM_ADVICE = {
    matchAdvice,
    openAdviceModal,
    showFallbackModal,
    getCardContext,
    matchPrematureEjaculation,
    matchErectileDysfunction,
  };
})();
