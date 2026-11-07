/**
 * ReferenceFolder-style full-document keyword scan with * wildcard support.
 * Pass the active condition's rules.json — never hardcode a condition here.
 *
 * Supports EDM-PE-01 outcomes: reject | flag | counsel | none
 * fail_if_found remains for ED/weight-loss matchers (true only for reject).
 */

const NEGATION_RE =
  /\b(no|not|nil|denies|denied|negative for|absence of|ruled out|excluded|never had|no history of|no personal history of|nil of note|without|no known|not known|screening for|at risk of|risk of|advice given|counselled about|leaflet given|information given|discussed|considered|query|suspected|possible|rule out|for exclusion|declined|did not attend|referral for|awaiting)\b/i;

/** Hair loss: strong negation drops the hit; uncertain wording keeps it as prescriber review. */
const HL_NEGATION_RE =
  /\b(no|not|no history of|no evidence of|no known|denies|denied|nil|nkda|none known|not known|negative for|ruled out|excluded)\b/i;

const HL_UNCERTAIN_RE =
  /\b(screening for|at risk of|advice given about|leaflet given|discussed|declined|offered|awaiting|query|suspected|possible|differential|to exclude|rule out|referral for)\b|\?\s*$/i;

/** Last sentence/row boundary before a hit: punctuation or an SCR date. */
const HL_BOUNDARY_RE =
  /[.;|]|\b\d{1,2}[-/ ](?:[A-Za-z]{3,9}|\d{1,2})[-/ ]\d{2,4}\b/g;

const MONTH_INDEX = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const SCR_DATE_RE = new RegExp(
  [
    '\\b(\\d{1,2})[-/ .](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/ .](\\d{4})\\b',
    '\\b(\\d{1,2})/(\\d{1,2})/(\\d{4})\\b',
    '\\b(\\d{4})-(\\d{2})-(\\d{2})\\b',
    '\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+(\\d{4})\\b',
    '\\b((?:19|20)\\d{2})\\b(?!\\s*(?:units|unit|mg|mcg|micrograms|iu|ml|g)\\b)',
  ].join('|'),
  'gi',
);

/** Set per scan so date-window maths can be tested with a fixed "today". */
let scanNow = Date.now();

const FAMILY_HISTORY_RE =
  /\b(family history|family history of|fhx?|fh of|father|mother|parent|parents|brother|sister|sibling|son|daughter|maternal|paternal|grandfather|grandmother)\b/i;

/**
 * Flatten SCR HTML to normalised searchable text (matches ReferenceFolder preprocessing).
 * @param {string} html
 * @returns {string}
 */
export function flattenScrHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll('*').forEach((el) => el.prepend(' '));
  return doc.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/**
 * Build a case-insensitive RegExp from a keyword ( * → \S* ).
 * @param {string} keyword
 * @returns {RegExp}
 */
export function keywordToRegex(keyword) {
  const lower = keyword.toLowerCase();
  const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '\\S*');
  return new RegExp(escaped, 'gi');
}

function isShortAbbreviation(keyword) {
  return keyword.length <= 4 && !/\s/.test(keyword);
}

/**
 * @param {string} text
 * @param {string} keyword
 * @param {{ wholeWord?: boolean }} [options]
 * @returns {{ index: number, actualMatch: string }[]}
 */
function findKeywordMatches(text, keyword, options = {}) {
  if (keyword.includes('*')) {
    return findWildcardMatches(text, keyword);
  }

  const hits = [];
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const useWholeWord = Boolean(options.wholeWord) || isShortAbbreviation(keyword);

  if (useWholeWord) {
    const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|[^a-z0-9])(${escaped})(?=[^a-z0-9]|$)`, 'gi');
    let match;
    while ((match = re.exec(lowerText)) !== null) {
      const index = lowerText.indexOf(match[1], match.index);
      hits.push({
        index,
        actualMatch: text.substring(index, index + match[1].length),
      });
    }
    return hits;
  }

  let from = 0;
  while (from < lowerText.length) {
    const index = lowerText.indexOf(lowerKeyword, from);
    if (index === -1) break;
    hits.push({
      index,
      actualMatch: text.substring(index, index + keyword.length),
    });
    from = index + 1;
  }

  return hits;
}

/**
 * Prefix / stem matches (word starts with stem).
 * Filters known false positives (e.g. heart → heartburn).
 * @param {string} text
 * @param {string} stem
 * @returns {{ index: number, actualMatch: string }[]}
 */
function findStemMatches(text, stem) {
  const hits = [];
  const lowerText = text.toLowerCase();
  const lowerStem = String(stem || '').toLowerCase();
  if (!lowerStem || lowerStem.length < 3) return hits;

  const falsePositives = STEM_FALSE_POSITIVES[lowerStem] || [];
  const escaped = lowerStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word-start stem: heart → heart / heartfailure; not "sweetheart"
  const re = new RegExp(`(?:^|[^a-z0-9])(${escaped}[a-z0-9]*)`, 'gi');
  let match;
  while ((match = re.exec(lowerText)) !== null) {
    const token = match[1].toLowerCase();
    if (falsePositives.some((fp) => token === fp || token.startsWith(fp))) continue;
    const index = lowerText.indexOf(match[1], match.index);
    hits.push({
      index,
      actualMatch: text.substring(index, index + match[1].length),
    });
  }
  return hits;
}

/** Stem → matched tokens to ignore */
const STEM_FALSE_POSITIVES = {
  heart: ['heartburn', 'heartache', 'hearth', 'heartily', 'heartfelt', 'heartland', 'heartwood'],
  stroke: ['keystroke', 'brushstroke'],
  cancer: ['cancelling', 'canceled', 'cancelled'],
  ulcer: ['ulcerative'],
  depress: [],
  alcohol: [],
  liver: [],
};

/**
 * Wildcard keywords (heart*, myocard*) — word-bounded prefix when * is trailing.
 * @param {string} text
 * @param {string} keyword
 * @returns {{ index: number, actualMatch: string }[]}
 */
function findWildcardMatches(text, keyword) {
  const lower = String(keyword || '').toLowerCase().trim();
  if (!lower.includes('*')) return [];

  // Trailing stem form: "heart*" / "myocard*"
  if (/^[a-z0-9][a-z0-9\s-]*\*$/i.test(keyword.trim()) && !lower.slice(0, -1).includes('*')) {
    const stem = lower.replace(/\*$/, '').trim();
    return findStemMatches(text, stem);
  }

  const hits = [];
  const re = keywordToRegex(keyword);
  let match;
  while ((match = re.exec(text)) !== null) {
    hits.push({ index: match.index, actualMatch: match[0] });
  }
  return hits;
}

/**
 * @param {string} text
 * @param {number} index
 * @param {number} matchLen
 * @returns {string}
 */
function buildSnippet(text, index, matchLen) {
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + matchLen + 50);
  let snippet = text.substring(start, end).trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

function precedingWindow(text, index, chars = 90) {
  return text.slice(Math.max(0, index - chars), index);
}

/**
 * @param {object} rule
 * @returns {'reject'|'flag'|'counsel'|'none'}
 */
export function ruleOutcome(rule) {
  if (rule?.action) return actionToOutcome(rule.action);
  if (rule?.outcome) return rule.outcome;
  return rule?.fail_if_found ? 'reject' : 'flag';
}

function actionToOutcome(action) {
  const raw = String(action ?? '');
  const lower = raw.toLowerCase();
  if (raw === 'CAP_FOUNDAYO_9MG' || raw === 'FLAG_PRESCRIBER') return 'flag';
  if (lower === 'reject' || raw.startsWith('REJECT')) return 'reject';
  if (lower === 'review') return 'flag';
  if (lower === 'counsel' || raw === 'COUNSEL') return 'counsel';
  if (lower === 'none') return 'none';
  return 'flag';
}

function pathwayEffect(action, conditionId = '') {
  switch (action) {
    case 'REJECT_SERVICE':
      return conditionId === 'weight-loss' ? 'all weight-loss products' : 'both';
    case 'REJECT_FINASTERIDE':
      return 'finasteride';
    case 'REJECT_MINOXIDIL':
      return 'minoxidil';
    case 'REJECT_MINOXIDIL_FOAM':
      return 'foam only';
    case 'REJECT_MINOXIDIL_SOLUTION':
      return 'solution only';
    case 'REJECT_FOUNDAYO':
      return 'Foundayo only';
    case 'REJECT_WEGOVY_TABLETS':
      return 'Wegovy tablets only';
    case 'REJECT_PRODUCTS':
      return 'listed products only';
    case 'CAP_FOUNDAYO_9MG':
      return 'Foundayo max 9 mg';
    default:
      return 'none';
  }
}

/** R001–R006 keep fail_if_found and no action. Weight loss treats that as reject-all. */
function legacyWeightLossAction(rule, conditionId) {
  if (conditionId === 'weight-loss' && rule?.fail_if_found && !rule.action) {
    return 'REJECT_SERVICE';
  }
  return null;
}

function shouldScanRule(rule) {
  if (rule.match_type === 'computed') return false;
  if (rule.match_type === 'regex' || rule.id === 'HL-OBS-BP' || rule.id === 'HL-OBS-LABS') {
    return Boolean(
      rule.pattern
      || (Array.isArray(rule.patterns) && rule.patterns.length)
      || (Array.isArray(rule.lab_patterns) && rule.lab_patterns.length)
    );
  }
  return Array.isArray(rule.keywords) && rule.keywords.length > 0;
}

/**
 * Hair-loss rules and any rule marked `structured: true` (weight loss EDM-WL-01) use
 * clause-level negation, exclude phrases, nearby-term checks and date windows.
 */
function isStructuredRule(rule) {
  return Boolean(rule?.structured) || String(rule?.id || '').startsWith('HL-');
}

/** Repeat vs acute: the nearest "repeat"/"acute" heading before the hit. */
function isRepeatContext(text, index) {
  const before = precedingWindow(text, index, 400);
  const re = /\b(repeat|acute)\b/gi;
  let last = null;
  let m;
  while ((m = re.exec(before)) !== null) last = m[1].toLowerCase();
  return last === 'repeat';
}

/** Text between the last row/sentence boundary and the hit. */
function clauseBefore(text, index, chars = 90) {
  const before = precedingWindow(text, index, chars);
  let cut = 0;
  HL_BOUNDARY_RE.lastIndex = 0;
  let m;
  while ((m = HL_BOUNDARY_RE.exec(before)) !== null) cut = m.index + m[0].length;
  return before.slice(cut);
}

function classifyContext(rule, text, index) {
  const isHl = isStructuredRule(rule);
  if (isHl) {
    const clause = clauseBefore(text, index);
    return {
      negated: HL_NEGATION_RE.test(clause),
      uncertain: HL_UNCERTAIN_RE.test(clause),
      familyHistory: FAMILY_HISTORY_RE.test(clause),
    };
  }
  const before = precedingWindow(text, index);
  return {
    negated: NEGATION_RE.test(before),
    uncertain: false,
    familyHistory: FAMILY_HISTORY_RE.test(before),
  };
}

function parseDateMatch(m) {
  if (m[1] && m[2] && m[3]) {
    return { ts: new Date(+m[3], MONTH_INDEX[m[2].slice(0, 3).toLowerCase()], +m[1]).getTime(), yearOnly: false };
  }
  if (m[4] && m[5] && m[6]) return { ts: new Date(+m[6], +m[5] - 1, +m[4]).getTime(), yearOnly: false };
  if (m[7] && m[8] && m[9]) return { ts: new Date(+m[7], +m[8] - 1, +m[9]).getTime(), yearOnly: false };
  if (m[10] && m[11]) return { ts: new Date(+m[11], MONTH_INDEX[m[10].slice(0, 3).toLowerCase()], 15).getTime(), yearOnly: false };
  if (m[12]) return { year: +m[12], yearOnly: true };
  return null;
}

/**
 * Nearest SCR date to a hit: the closest one before it (same row in date-first layouts),
 * unless a date immediately follows the hit.
 */
function nearestScrDate(text, index, matchLen) {
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + matchLen + 25);
  const segment = text.slice(start, end);
  let before = null;
  let after = null;
  SCR_DATE_RE.lastIndex = 0;
  let m;
  while ((m = SCR_DATE_RE.exec(segment)) !== null) {
    const pos = start + m.index;
    const parsed = parseDateMatch(m);
    if (!parsed) continue;
    if (parsed.yearOnly && parsed.year > new Date(scanNow).getFullYear()) continue;
    if (pos < index) before = { ...parsed, raw: m[0] };
    else if (pos >= index + matchLen && !after) after = { ...parsed, raw: m[0] };
  }
  return before || after;
}

const MONTH_MS = 30.44 * 24 * 3600 * 1000;

/** @returns {{ within: boolean|undefined, eventDate: string, monthsAgo: number|null }} */
function dateWindow(rule, text, hit) {
  const found = nearestScrDate(text, hit.index, hit.actualMatch.length);
  const lookback = rule.lookback_months || 12;
  if (!found) return { within: undefined, eventDate: '', monthsAgo: null };
  if (found.yearOnly) {
    const latest = new Date(found.year, 11, 31).getTime();
    const earliest = new Date(found.year, 0, 1).getTime();
    if ((scanNow - latest) / MONTH_MS > lookback) {
      return { within: false, eventDate: found.raw, monthsAgo: Math.round((scanNow - latest) / MONTH_MS) };
    }
    if ((scanNow - earliest) / MONTH_MS <= lookback) {
      return { within: true, eventDate: found.raw, monthsAgo: Math.round((scanNow - earliest) / MONTH_MS) };
    }
    return { within: undefined, eventDate: found.raw, monthsAgo: null };
  }
  const monthsAgo = (scanNow - found.ts) / MONTH_MS;
  return { within: monthsAgo <= lookback, eventDate: found.raw, monthsAgo: Math.max(0, Math.round(monthsAgo)) };
}

/** True if the hit sits inside one of the rule's exclude phrases (e.g. "ocular hypertension"). */
function isExcludedHit(rule, text, hit) {
  const phrases = rule.exclude_phrases || [];
  if (!phrases.length) return false;
  const lower = text.toLowerCase();
  const hitEnd = hit.index + hit.actualMatch.length;
  for (const phrase of phrases) {
    const p = phrase.toLowerCase();
    let from = Math.max(0, hit.index - p.length);
    while (from <= hit.index) {
      const at = lower.indexOf(p, from);
      if (at < 0 || at > hit.index) break;
      if (at + p.length >= hitEnd) return true;
      from = at + 1;
    }
  }
  return false;
}

/** For allergy-style rules: the drug name must sit near allergy wording. */
function hasNearbyTerm(rule, text, hit) {
  const near = rule.require_nearby;
  if (!near?.terms?.length) return true;
  const w = near.window || 50;
  const around = text
    .slice(Math.max(0, hit.index - w), Math.min(text.length, hit.index + hit.actualMatch.length + w))
    .toLowerCase();
  return near.terms.some((t) => around.includes(String(t).toLowerCase()));
}

function applyContextOutcome(rule, outcome, { negated, uncertain, familyHistory }) {
  const isHl = isStructuredRule(rule);
  if (isHl && (uncertain || negated) && outcome === 'reject') return 'flag';
  if (isHl && negated) return 'none';
  if (isHl && familyHistory && !rule.family_history_counts) return 'flag';
  if (negated && outcome === 'reject') return 'flag';
  if (familyHistory && rule.id !== 'PE-EYE-GLAUCOMA' && !rule.family_history_counts && outcome === 'reject') return 'flag';
  return outcome;
}

function resolveHlAction(rule, extra = {}, ctx = {}) {
  let action = extra.action || rule.action || null;
  if (rule.date_sensitive && extra.undated !== false) {
    if (extra.datedWithinWindow === true) action = rule.action_if_within_window || rule.action;
    else if (extra.datedWithinWindow === false) action = rule.action_if_outside_window || 'FLAG_PRESCRIBER';
    else action = rule.action_if_undated || 'FLAG_PRESCRIBER';
  }
  if (ctx.familyHistory && !rule.family_history_counts && action && String(action).startsWith('REJECT')) {
    action = 'FLAG_PRESCRIBER';
  }
  if ((ctx.negated || ctx.uncertain) && action && String(action).startsWith('REJECT')) {
    action = 'FLAG_PRESCRIBER';
  }
  return action;
}

function pushFinding(findings, rule, keyword, text, hit, occurrence, extra = {}, conditionId = '') {
  const isHl = isStructuredRule(rule);
  if (isHl && !extra.keepNegated) {
    if (isExcludedHit(rule, text, hit) || !hasNearbyTerm(rule, text, hit)) return;
  }
  const ctx = classifyContext(rule, text, hit.index);
  if (isHl && ctx.negated && !ctx.uncertain && !extra.keepNegated) {
    return;
  }
  if (isHl && rule.date_sensitive && extra.undated === undefined && extra.datedWithinWindow === undefined) {
    if (rule.reject_if_repeat && isRepeatContext(text, hit.index)) {
      extra = { ...extra, datedWithinWindow: true, onRepeat: true };
    } else {
      const dw = dateWindow(rule, text, hit);
      extra = { ...extra, datedWithinWindow: dw.within, eventDate: dw.eventDate, monthsAgo: dw.monthsAgo };
    }
  }
  let action = extra.action || resolveHlAction(rule, extra, ctx);
  if (!action) action = legacyWeightLossAction(rule, conditionId);
  const baseOutcome = extra.outcome || (action ? actionToOutcome(action) : ruleOutcome(rule));
  const outcome = extra.outcome || applyContextOutcome(rule, baseOutcome, ctx);
  let rationale = extra.rationale || rule.rationale || `Found "${keyword}" in clinical record (occurrence ${occurrence})`;
  if (isHl && rule.date_sensitive && !extra.rationale && extra.onRepeat) {
    rationale = `Listed under repeat medication — treated as current. ${rationale}`;
  } else if (isHl && rule.date_sensitive && !extra.rationale) {
    const when = extra.eventDate
      ? `Nearest SCR date ${extra.eventDate}${extra.monthsAgo != null ? ` (~${extra.monthsAgo} months ago)` : ''}`
      : 'No date found next to this entry — confirm recency';
    const verdict = extra.datedWithinWindow === true
      ? `within the ${rule.lookback_months}-month window`
      : extra.datedWithinWindow === false
        ? `outside the ${rule.lookback_months}-month window`
        : 'recency uncertain';
    rationale = `${when}: ${verdict}. ${rationale}`;
  }
  if (isHl && (ctx.uncertain || ctx.familyHistory) && String(rule.action || '').startsWith('REJECT')) {
    rationale = `${ctx.familyHistory ? 'Family-history wording' : 'Uncertain wording (query / possible / awaiting)'} — reduced to review. ${rationale}`;
  }
  const finding = {
    ruleId: rule.id,
    ruleName: rule.name,
    category: rule.category,
    protocolRef: rule.protocol_ref || '',
    basis: rule.basis || '',
    action: action || null,
    pathwayEffect: pathwayEffect(action, conditionId),
    overridePermitted: Boolean(rule.prescriber_override_permitted),
    outcome,
    counselText: rule.counsel_text || '',
    contextSensitive: Boolean(rule.context_sensitive),
    negated: ctx.negated,
    familyHistory: ctx.familyHistory,
    keyword,
    present: true,
    rationale,
    snippet: extra.snippet || buildSnippet(text, hit.index, hit.actualMatch.length),
    matchIndex: hit.index,
    actualMatch: hit.actualMatch,
  };
  if (isHl) {
    finding.actionLabel = rule.action_labels?.[action]
      || (rule.action === action ? (rule.action_label || action) : action);
    finding.uncertain = ctx.uncertain;
    finding.eventDate = extra.eventDate || '';
    finding.overrideRequires = rule.override_requires || '';
  }
  const products = extra.products || rule.products;
  if (Array.isArray(products) && products.length) {
    finding.products = products.slice();
  }
  findings.push(finding);
}

function scanKeywordRule(text, rule, findings, conditionId = '') {
  const matchMode = String(rule.match || '').toLowerCase();
  // Explicit whole_word (or whole_word_except_stems) → boundary-match every keyword on the rule.
  // Otherwise keep legacy behaviour: whole-word only for short acronyms (≤4, no spaces).
  const wholeWordAll =
    matchMode === 'whole_word'
    || matchMode === 'whole_word_except_stems';

  for (const keyword of rule.keywords || []) {
    const matches = findKeywordMatches(text, keyword, {
      wholeWord: wholeWordAll || isShortAbbreviation(keyword),
    });
    matches.forEach((hit, i) => {
      pushFinding(findings, rule, keyword, text, hit, i + 1, {}, conditionId);
    });
  }

  for (const stem of rule.stem_keywords || []) {
    const matches = findStemMatches(text, stem);
    matches.forEach((hit, i) => {
      pushFinding(findings, rule, stem, text, hit, i + 1, {}, conditionId);
    });
  }
}

function plausibleBp(sys, dia) {
  return sys > dia && sys >= 60 && sys <= 260 && dia >= 30 && dia <= 160;
}

function scanRegexRule(text, rule, findings, conditionId = '') {
  const patterns = (rule.patterns || []).map((p) => new RegExp(p, 'gi'));

  if (rule.id === 'PE-BP-NUMERIC') {
    const readings = [];
    for (const re of patterns) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(text)) !== null) {
        if (match[1] && match[2]) {
          const sys = Number(match[1]);
          const dia = Number(match[2]);
          if (!plausibleBp(sys, dia)) continue;
          readings.push({ sys, dia, index: match.index, actualMatch: match[0] });
        }
      }
    }
    for (const reading of readings) {
      let outcome = 'flag';
      let reason = 'Blood pressure reading on SCR — review against Section 5.';
      if (reading.sys < 90 || reading.dia < 50) {
        outcome = 'reject';
        reason = 'Below the Section 5 threshold (90/50).';
      } else if (reading.sys <= 104 || reading.dia <= 64) {
        outcome = 'flag';
        reason = 'Low-normal; postural reserve reduced.';
      } else if (reading.sys >= 180 || reading.dia >= 110) {
        outcome = 'flag';
        reason = 'Severe hypertension — cardiovascular assessment likely indicated.';
      } else {
        continue;
      }
      pushFinding(findings, rule, `${reading.sys}/${reading.dia}`, text, {
        index: reading.index,
        actualMatch: reading.actualMatch,
      }, 1, { outcome, rationale: reason });
    }
    return;
  }

  if (rule.id === 'PE-RENAL-NUMERIC') {
    for (const re of patterns) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(text)) !== null) {
        const egfr = Number(match[1]);
        if (!Number.isFinite(egfr) || egfr < 1 || egfr > 200) continue;
        let outcome = 'flag';
        let reason = `eGFR ${egfr}`;
        if (egfr < 30) {
          outcome = 'reject';
          reason = 'Severe renal impairment — dapoxetine contraindicated';
        } else if (egfr <= 59) {
          outcome = 'reject';
          reason = 'Moderate impairment; declined under the Section 5 kidney exclusion';
        } else if (egfr <= 89) {
          outcome = 'flag';
          reason = 'Mild reduction; prescriber to review alongside age and any other exclusion';
        } else {
          continue;
        }
        pushFinding(findings, rule, `eGFR ${egfr}`, text, {
          index: match.index,
          actualMatch: match[0],
        }, 1, { outcome, rationale: reason }, conditionId);
      }
    }
    return;
  }

  if (rule.id === 'WL-OBS-EGFR' || rule.id === 'WL-OBS-TG') {
    const isEgfr = rule.id === 'WL-OBS-EGFR';
    for (const re of patterns) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(text)) !== null) {
        const v = Number(match[1]);
        if (!Number.isFinite(v)) continue;
        let action;
        let reason;
        if (isEgfr) {
          if (v < 1 || v > 200) continue;
          if (v < 30) {
            action = 'REJECT_SERVICE';
            reason = `eGFR ${v} ml/min: below 30 — severe CKD (stage 4–5), reject all products (EDM-WL-01 §9.8 Cat A).`;
          } else {
            continue;
          }
        } else {
          if (v <= 4.5 || v > 60) continue;
          action = 'FLAG_PRESCRIBER';
          reason = `Triglycerides ${v} mmol/L: above 4.5 — confirm the sample was fasted; if fasting TG >4.5, do not prescribe (pancreatitis risk, §9.8 knowledge base).`;
        }
        const hit = { index: match.index, actualMatch: match[0] };
        const dw = dateWindow({ lookback_months: 12 }, text, hit);
        if (dw.eventDate) reason = `${dw.eventDate}${dw.monthsAgo != null ? ` (~${dw.monthsAgo} months ago)` : ''}: ${reason}`;
        pushFinding(findings, rule, `${isEgfr ? 'eGFR' : 'TG'} ${v}`, text, hit, 1, {
          action,
          outcome: actionToOutcome(action),
          rationale: reason,
          undated: false,
          eventDate: dw.eventDate,
        }, conditionId);
      }
    }
    return;
  }

  if (rule.id === 'HL-OBS-BP') {
    const source = rule.pattern || (rule.patterns || [])[0];
    if (!source) return;
    const re = new RegExp(source, 'gi');
    let match;
    while ((match = re.exec(text)) !== null) {
      const sys = Number(match[1]);
      const dia = Number(match[2]);
      if (!plausibleBp(sys, dia)) continue;
      const nearby = precedingWindow(text, match.index, 40) + text.slice(match.index, match.index + 40);
      const looksLikeDate = /\b(19|20)\d{2}\b/.test(nearby) && !/\b(BP|blood pressure|mm\s*Hg|systolic|diastolic)\b/i.test(nearby);
      if (looksLikeDate && !/\b(BP|blood pressure|mm\s*Hg)\b/i.test(nearby)) continue;
      let action = 'FLAG_PRESCRIBER';
      let reason;
      if (sys >= 180 || dia >= 110) {
        action = 'REJECT_MINOXIDIL';
        reason = 'Severe-range reading (≥180/110): treat as untreated hypertension (Regaine SmPC 4.3) — decline minoxidil and advise prompt GP review. Finasteride unaffected.';
      } else if (sys >= 140 || dia >= 90) {
        reason = 'Reading ≥140/90: possible untreated hypertension. Check for a later normal reading or ABPM; if hypertension is diagnosed or being investigated, decline minoxidil.';
      } else if (sys <= 90 || dia <= 60) {
        reason = 'Low reading (≤90/60): hypotension — counsel to stop minoxidil if dizzy/faint (SmPC 4.4); check for cardiac cause.';
      } else {
        continue;
      }
      const hit = { index: match.index, actualMatch: match[0] };
      const dw = dateWindow({ lookback_months: 12 }, text, hit);
      if (dw.eventDate) reason = `${dw.eventDate}${dw.monthsAgo != null ? ` (~${dw.monthsAgo} months ago)` : ''}: ${reason}`;
      pushFinding(findings, rule, `${sys}/${dia}`, text, hit, 1, {
        action,
        outcome: actionToOutcome(action),
        rationale: reason,
        undated: false,
        eventDate: dw.eventDate,
        products: ['minoxidil_solution', 'minoxidil_foam'],
      }, conditionId);
    }
    return;
  }

  if (rule.id === 'HL-OBS-LABS') {
    for (const lab of rule.lab_patterns || []) {
      const re = new RegExp(lab.regex, 'gi');
      let match;
      while ((match = re.exec(text)) !== null) {
        const v = Number(match[1]);
        if (!Number.isFinite(v)) continue;
        const action = 'FLAG_PRESCRIBER';
        const FIN = ['finasteride'];
        const ALL = ['finasteride', 'minoxidil_solution', 'minoxidil_foam'];
        let reason;
        let products = FIN;
        if (lab.test === 'PSA' && v > 0) {
          reason = `PSA ${v} ng/ml on record — establish why it was tested. A prostate problem closes finasteride (S5). Finasteride roughly halves PSA (SmPC 4.4).`;
        } else if ((lab.test === 'ALT' || lab.test === 'AST') && v > 50) {
          reason = `Raised ${lab.test} ${v} U/L — possible liver disease; any liver disease closes finasteride (S5).`;
        } else if (lab.test === 'Bilirubin' && v > 21) {
          reason = `Raised bilirubin ${v} umol/L — liver disease or Gilbert’s? Liver disease closes finasteride.`;
        } else if (lab.test === 'TSH' && (v > 4.5 || v < 0.4)) {
          reason = `Abnormal TSH ${v} — thyroid disease can cause hair loss; if causal, decline both (S5).`;
          products = ALL;
        } else if (lab.test === 'Ferritin' && v < 30) {
          reason = `Low ferritin ${v} ug/L — consider telogen effluvium; if causal, decline both (S5).`;
          products = ALL;
        } else if (lab.test === 'Haemoglobin' && v >= 60 && v < 130) {
          reason = `Hb ${v} g/L — anaemia may cause hair loss; if causal, decline both (S5).`;
          products = ALL;
        } else {
          continue;
        }
        pushFinding(findings, rule, `${lab.test} ${v}`, text, {
          index: match.index,
          actualMatch: match[0],
        }, 1, { action, outcome: actionToOutcome(action), rationale: reason, undated: false, products }, conditionId);
      }
    }
    return;
  }

  let occurrence = 0;
  for (const re of patterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      if (!match[0]) {
        re.lastIndex += 1;
        continue;
      }
      occurrence += 1;
      pushFinding(findings, rule, match[0], text, {
        index: match.index,
        actualMatch: match[0],
      }, occurrence, {}, conditionId);
    }
  }
}

function applyHlPostRules(findings, text, rules) {
  const lower = String(text || '').toLowerCase();
  const ruleById = Object.fromEntries((rules || []).map((r) => [r.id, r]));

  for (const f of findings) {
    const rule = ruleById[f.ruleId];
    if (!rule?.escalate_if_cooccurs_with?.length || !rule.escalate_to) continue;
    const cooccurs = rule.escalate_if_cooccurs_with.some((term) =>
      lower.includes(String(term).toLowerCase())
    );
    if (cooccurs) {
      f.action = rule.escalate_to;
      f.outcome = actionToOutcome(rule.escalate_to);
      f.pathwayEffect = pathwayEffect(rule.escalate_to);
      f.rationale = `${f.rationale} (escalated: co-occurs with hair-loss terms)`;
    }
  }
  return findings;
}

function applyPePostRules(findings) {
  const hasRecurrentSyncope = findings.some(
    (f) => f.ruleId === 'PE-CV-SYNCOPE-RECURRENT' && f.outcome === 'reject'
  );
  if (hasRecurrentSyncope) {
    for (const f of findings) {
      if (f.ruleId === 'PE-CV-SYNCOPE-SINGLE') f.outcome = 'reject';
    }
  }

  const hairLossFinasteride = findings.some((f) => f.ruleId === 'PE-FLAG-FINASTERIDE-1MG');
  if (hairLossFinasteride) {
    return findings.filter((f) => {
      if (f.ruleId !== 'PE-URO-PROSTATE') return true;
      return !/psa|propecia|finasteride 1/i.test(f.keyword);
    });
  }
  return findings;
}

const WEIGHT_LOSS_PRODUCTS = ['mounjaro', 'wegovy_inj', 'wegovy_tab', 'foundayo'];

const VERDICT_RANK = { pass: 0, review: 1, cap_9mg: 2, reject: 3 };

function raiseProductVerdict(verdicts, product, next) {
  if (!Object.prototype.hasOwnProperty.call(verdicts, product)) return;
  if ((VERDICT_RANK[next] || 0) > (VERDICT_RANK[verdicts[product]] || 0)) {
    verdicts[product] = next;
  }
}

function productsForFinding(finding) {
  if (Array.isArray(finding.products) && finding.products.length) return finding.products;
  return WEIGHT_LOSS_PRODUCTS;
}

/**
 * Per-product verdict. Precedence: reject > cap_9mg > review > pass.
 * @param {object[]} findings
 */
function computeWeightLossProductVerdicts(findings) {
  const verdicts = {
    mounjaro: 'pass',
    wegovy_inj: 'pass',
    wegovy_tab: 'pass',
    foundayo: 'pass',
  };

  for (const finding of findings) {
    const action = finding.action;
    if (action === 'COUNSEL' || finding.outcome === 'counsel') continue;

    if (action === 'CAP_FOUNDAYO_9MG') {
      raiseProductVerdict(verdicts, 'foundayo', 'cap_9mg');
      continue;
    }

    if (finding.outcome === 'reject') {
      const targets = action === 'REJECT_FOUNDAYO'
        ? ['foundayo']
        : action === 'REJECT_WEGOVY_TABLETS'
          ? ['wegovy_tab']
          : action === 'REJECT_PRODUCTS' && finding.products?.length
            ? finding.products
            : WEIGHT_LOSS_PRODUCTS;
      for (const product of targets) raiseProductVerdict(verdicts, product, 'reject');
      continue;
    }

    if (action === 'FLAG_PRESCRIBER' || finding.outcome === 'flag') {
      for (const product of productsForFinding(finding)) {
        raiseProductVerdict(verdicts, product, 'review');
      }
    }
  }

  return verdicts;
}

const HAIR_LOSS_PRODUCTS = ['finasteride', 'minoxidil_solution', 'minoxidil_foam'];

const HL_REJECT_TARGETS = {
  REJECT_SERVICE: HAIR_LOSS_PRODUCTS,
  REJECT_FINASTERIDE: ['finasteride'],
  REJECT_MINOXIDIL: ['minoxidil_solution', 'minoxidil_foam'],
  REJECT_MINOXIDIL_SOLUTION: ['minoxidil_solution'],
  REJECT_MINOXIDIL_FOAM: ['minoxidil_foam'],
};

/**
 * Hair loss per-product verdict (EDM-HL-01 S5): a pathway reject closes only its products.
 * Precedence: reject > review > pass. Counsel never changes a verdict.
 * @param {object[]} findings
 */
function computeHairLossProductVerdicts(findings) {
  const verdicts = Object.fromEntries(HAIR_LOSS_PRODUCTS.map((p) => [p, 'pass']));
  for (const finding of findings) {
    if (finding.outcome === 'counsel' || finding.action === 'COUNSEL') continue;
    if (finding.outcome === 'reject') {
      for (const p of HL_REJECT_TARGETS[finding.action] || HAIR_LOSS_PRODUCTS) {
        raiseProductVerdict(verdicts, p, 'reject');
      }
      continue;
    }
    for (const p of finding.products?.length ? finding.products : HAIR_LOSS_PRODUCTS) {
      raiseProductVerdict(verdicts, p, 'review');
    }
  }
  return verdicts;
}

/**
 * Scan flattened SCR text against a condition's rules.json.
 * @param {string} text
 * @param {object[]} rules
 * @param {{ conditionId?: string }|string} [options]
 * @returns {{ overallPass: boolean, findings: object[], productVerdicts?: object }}
 */
export function scanReferenceFolderKeywords(text, rules, options = {}) {
  if (!Array.isArray(rules) || !rules.length) {
    throw new Error('scanReferenceFolderKeywords requires a condition rules.json array');
  }
  const conditionId = typeof options === 'string' ? options : (options?.conditionId || '');
  scanNow = (typeof options === 'object' && options?.now) ? new Date(options.now).getTime() : Date.now();
  let findings = [];

  for (const rule of rules) {
    if (!shouldScanRule(rule)) continue;
    if (rule.match_type === 'regex') {
      scanRegexRule(text, rule, findings, conditionId);
      continue;
    }
    scanKeywordRule(text, rule, findings, conditionId);
  }

  findings = applyPePostRules(findings);
  findings = applyHlPostRules(findings, text, rules);
  findings = findings.filter((f) => f.outcome !== 'none');

  const productVerdicts = conditionId === 'weight-loss'
    ? computeWeightLossProductVerdicts(findings)
    : conditionId === 'hair-loss'
      ? computeHairLossProductVerdicts(findings)
      : null;
  const rejects = findings.filter((f) => f.outcome === 'reject');
  const overallPass = productVerdicts
    ? Object.values(productVerdicts).some((verdict) => verdict !== 'reject')
    : rejects.length === 0;

  return {
    overallPass,
    findings,
    ...(productVerdicts ? { productVerdicts } : {}),
  };
}

/**
 * Scan raw SCR HTML (primary entry point).
 * @param {string} html
 * @param {object[]} rules
 * @param {{ conditionId?: string }|string} [options]
 * @returns {{ overallPass: boolean, findings: object[], flattenedText: string, productVerdicts?: object }}
 */
export function scanReferenceFolderHtml(html, rules, options = {}) {
  const flattenedText = flattenScrHtml(html);
  const result = scanReferenceFolderKeywords(flattenedText, rules, options);
  return { ...result, flattenedText };
}
