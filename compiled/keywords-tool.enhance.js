/**
 * UI enhancements for EveryDayMeds SCR results page.
 */
(function () {
  const NAV_SELECTOR = 'nav[aria-label="Section navigation"]';
  const HEADER_SELECTOR = '.text-center.mb-8';

  /** Rx portal patient from order page (via renderSCRContent message). */
  let rxPortalPatient = null;
  let enhanceObserver = null;
  let enhanceQueued = false;
  let isEnhancing = false;

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.action === 'renderSCRContent' && msg.userData) {
        rxPortalPatient = msg.userData;
        scheduleEnhancements();
      }
    });
  }

  function scheduleEnhancements() {
    if (enhanceQueued) return;
    enhanceQueued = true;
    requestAnimationFrame(() => {
      enhanceQueued = false;
      runEnhancements();
    });
  }

  function withObserverPaused(fn) {
    const root = document.getElementById('root') || document.body;
    if (enhanceObserver) enhanceObserver.disconnect();
    isEnhancing = true;
    try {
      fn();
    } finally {
      isEnhancing = false;
      if (enhanceObserver && root) {
        enhanceObserver.observe(root, { childList: true, subtree: true });
      }
    }
  }

  const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };

  const NAV_ICON_VERSION = '2';

  const ICONS = {
    search:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    allergy:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    pill:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-4a2.2 2.2 0 0 0 2.7-2.7l-4-10a2.2 2.2 0 0 0-4.2 0l-4 10a2.2 2.2 0 0 0 2.7 2.7z"/><path d="M8.5 8.5 15 15"/></svg>',
    acuteMeds:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    repeatMeds:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
    discontinuedMeds:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-4a2.2 2.2 0 0 0 2.7-2.7l-4-10a2.2 2.2 0 0 0-4.2 0l-4 10a2.2 2.2 0 0 0 2.7 2.7z"/><path d="m14 10-4 4"/><path d="m10 10 4 4"/></svg>',
    diagnosis:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2v2"/><path d="M5 2v2"/><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/></svg>',
    problems:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
    vitals:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.94a2 2 0 0 1-3.88 0L9.24 2.18a2 2 0 0 0-3.88 0l-2.35 8.94A2 2 0 0 1 1.49 12H0"/></svg>',
    treatment:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/></svg>',
    lab:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.31"/><path d="M14 9.3V1.99"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/><path d="M5.52 16h12.96"/></svg>',
    calendar:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>',
    admin:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>',
    users:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    mail:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
    social:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    advice:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
    chevron:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    menu:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/></svg>',
    close:
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    file:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>',
    info:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  };

  /** Ordered rules — first match wins. Returns null if no known icon. */
  const SECTION_ICON_RULES = [
    { test: (t) => t.includes('search'), key: 'search' },
    { test: (t) => t.includes('allerg'), key: 'allergy' },
    { test: (t) => t.includes('discontinued') && t.includes('med'), key: 'discontinuedMeds' },
    { test: (t) => (t.includes('current repeat') || t.includes('repeat med')), key: 'repeatMeds' },
    { test: (t) => t.includes('acute') && t.includes('med'), key: 'acuteMeds' },
    { test: (t) => t.includes('problem') || t.includes('issues'), key: 'problems' },
    { test: (t) => t.includes('diagnos'), key: 'diagnosis' },
    { test: (t) => t.includes('observation') || t.includes('finding'), key: 'vitals' },
    { test: (t) => t.includes('treatment'), key: 'treatment' },
    { test: (t) => t.includes('investigation') || t.includes('result'), key: 'lab' },
    { test: (t) => t.includes('care event'), key: 'calendar' },
    { test: (t) => t.includes('administrative'), key: 'admin' },
    { test: (t) => t.includes('provision of advice') || (t.includes('advice') && t.includes('carer')), key: 'advice' },
    { test: (t) => t.includes('service') || t.includes('professional') || t.includes('supplier'), key: 'users' },
    { test: (t) => t.includes('correspond'), key: 'mail' },
    { test: (t) => t.includes('social') || t.includes('personal circum'), key: 'social' },
    { test: (t) => t.includes('medication') || t.includes('medicines'), key: 'pill' },
  ];

  function iconKey(title) {
    const t = title.toLowerCase();
    const rule = SECTION_ICON_RULES.find((r) => r.test(t));
    return rule ? rule.key : null;
  }

  const SHORT_LABELS = [
    [/^Search/i, 'Search record'],
    [/^Allergies/i, 'Allergies'],
    [/^Acute Medications/i, 'Acute medications'],
    [/^Current Repeat/i, 'Repeat medications'],
    [/^Discontinued/i, 'Discontinued meds'],
    [/^Diagnoses/i, 'Diagnoses'],
    [/^Problems and Issues/i, 'Problems & issues'],
    [/^Clinical Observations/i, 'Observations'],
    [/^Treatments/i, 'Treatments'],
    [/^Investigation Results/i, 'Investigations'],
    [/^Care Events/i, 'Care events'],
    [/^Administrative Procedures/i, 'Admin procedures'],
    [/^Provision of Advice/i, 'Advice & information'],
    [/^Services, Care Professionals/i, 'Services & professionals'],
    [/^Patient\/Carer Correspondence/i, 'Correspondence'],
    [/^Social and Personal/i, 'Social circumstances'],
  ];

  function shortLabel(title) {
    const t = title.trim();
    for (const [pattern, label] of SHORT_LABELS) {
      if (pattern.test(t)) return label;
    }
    if (t.length > 36) return `${t.slice(0, 34)}…`;
    return t;
  }

  function buildNavItemHtml(title) {
    const key = iconKey(title);
    const label = shortLabel(title);
    if (!key || !ICONS[key]) {
      return `<span class="edm-nav-label">${label}</span>`;
    }
    return (
      `<span class="edm-nav-icon" aria-hidden="true">${ICONS[key]}</span>`
      + `<span class="edm-nav-label">${label}</span>`
    );
  }

  function updateNavToggleIcon(toggle, expanded) {
    if (!toggle) return;
    toggle.innerHTML = expanded ? ICONS.close : ICONS.menu;
    toggle.setAttribute(
      'aria-label',
      expanded ? 'Close sections menu' : 'Open sections menu'
    );
  }

  function setNavExpanded(nav, expanded) {
    nav.classList.toggle('edm-section-nav--expanded', expanded);
    nav.dataset.edmExpanded = expanded ? '1' : '0';
    const toggle = nav.querySelector('.edm-nav-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      updateNavToggleIcon(toggle, expanded);
    }
  }

  function enhanceNav(nav) {
    const firstSetup = nav.dataset.edmEnhanced !== '1';
    if (firstSetup) {
      nav.dataset.edmEnhanced = '1';
      nav.classList.add('edm-section-nav');
      nav.classList.remove('w-[200px]', 'p-2');

      const heading = nav.querySelector('h3');
      if (heading) {
        heading.classList.add('edm-nav-heading');
        heading.textContent = 'Sections';
      }

      let topBar = nav.querySelector('.edm-nav-top');
      if (!topBar) {
        topBar = document.createElement('div');
        topBar.className = 'edm-nav-top';
        nav.insertBefore(topBar, nav.firstChild);
      }

      let toggle = nav.querySelector('.edm-nav-toggle');
      if (!toggle) {
        toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'edm-nav-toggle';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          setNavExpanded(nav, !nav.classList.contains('edm-section-nav--expanded'));
        });
      }

      if (!topBar.contains(toggle)) topBar.appendChild(toggle);
      if (heading && !topBar.contains(heading)) topBar.appendChild(heading);

      updateNavToggleIcon(toggle, nav.classList.contains('edm-section-nav--expanded'));
    }

    const toggle = nav.querySelector('.edm-nav-toggle');
    const topBar = nav.querySelector('.edm-nav-top');
    const heading = nav.querySelector('.edm-nav-heading, h3');
    if (toggle && !topBar) {
      const bar = document.createElement('div');
      bar.className = 'edm-nav-top';
      nav.insertBefore(bar, nav.firstChild);
      bar.appendChild(toggle);
      if (heading && !bar.contains(heading)) bar.appendChild(heading);
      updateNavToggleIcon(toggle, nav.classList.contains('edm-section-nav--expanded'));
    } else if (toggle) {
      const expanded = nav.classList.contains('edm-section-nav--expanded');
      const stateKey = expanded ? '1' : '0';
      if (toggle.dataset.edmExpandedState !== stateKey) {
        toggle.dataset.edmExpandedState = stateKey;
        updateNavToggleIcon(toggle, expanded);
      }
    }

    nav.querySelectorAll('ul button').forEach((btn) => {
      const full = (btn.dataset.edmNavTitle || btn.textContent).trim();
      const expectedKey = iconKey(full);
      if (btn.dataset.edmNavItem === '1'
        && btn.dataset.edmNavIconKey === (expectedKey || '')
        && btn.dataset.edmNavIconVer === NAV_ICON_VERSION) {
        return;
      }

      btn.dataset.edmNavItem = '1';
      btn.dataset.edmNavTitle = full;
      btn.dataset.edmNavIconKey = expectedKey || '';
      btn.dataset.edmNavIconVer = NAV_ICON_VERSION;
      btn.classList.remove('break-words', 'text-blue-700');
      btn.classList.add('edm-nav-item');
      if (expectedKey) {
        btn.classList.remove('edm-nav-item--no-icon');
      } else {
        btn.classList.add('edm-nav-item--no-icon');
      }
      btn.title = full;
      btn.innerHTML = buildNavItemHtml(full);
    });
  }

  function closeDisclaimerPanel(panel, trigger) {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function updateConditionBadge(entry) {
    const badge = document.getElementById('edm-condition-badge');
    if (!badge || !entry) return;
    badge.textContent = `${entry.icon ? entry.icon + ' ' : ''}${entry.label}`.trim();
    badge.hidden = false;
  }

  document.addEventListener('edm-condition-applied', (e) => updateConditionBadge(e.detail));

  function enhanceAppHeader() {
    const root = document.getElementById('root');
    if (!root) return;

    const legacyHeader = root.querySelector(HEADER_SELECTOR);
    if (!legacyHeader || legacyHeader.classList.contains('edm-app-header')) return;

    const titleRow = legacyHeader.querySelector('.flex.items-center.justify-center');
    const subtitle = legacyHeader.querySelector('p.text-slate-600');
    const disclaimerBox = legacyHeader.querySelector('[class*="bg-amber-50"]');
    const rulesWrap = legacyHeader.querySelector('.flex.justify-center.mt-4');

    const header = document.createElement('header');
    header.className = 'edm-app-header';

    const brand = document.createElement('div');
    brand.className = 'edm-app-header__brand';

    const icon = document.createElement('div');
    icon.className = 'edm-app-header__icon';
    icon.innerHTML = ICONS.file;
    brand.appendChild(icon);

    const titles = document.createElement('div');
    titles.className = 'edm-app-header__titles';

    const h1 = titleRow?.querySelector('h1');
    if (h1) {
      h1.classList.remove('text-3xl');
      h1.classList.add('edm-app-header__title');
      titles.appendChild(h1);
    }

    if (subtitle) {
      subtitle.classList.add('edm-app-header__subtitle');
      titles.appendChild(subtitle);
    }

    const conditionBadge = document.createElement('span');
    conditionBadge.className = 'edm-app-header__condition';
    conditionBadge.id = 'edm-condition-badge';
    conditionBadge.hidden = true;
    titles.appendChild(conditionBadge);

    brand.appendChild(titles);

    const actions = document.createElement('div');
    actions.className = 'edm-app-header__actions';

    if (disclaimerBox) {
      const disclaimerText = disclaimerBox.textContent.replace(/\s+/g, ' ').trim();
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'edm-disclaimer-trigger';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.innerHTML = `${ICONS.info}<span>Clinical note</span>`;

      const panel = document.createElement('div');
      panel.className = 'edm-disclaimer-panel';
      panel.hidden = true;
      panel.innerHTML = `<p><strong>Important:</strong> ${disclaimerText.replace(/^Important:\s*/i, '')}</p>`;

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = panel.hidden;
        panel.hidden = !open;
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });

      document.addEventListener('click', (e) => {
        if (!panel.hidden && !panel.contains(e.target) && !trigger.contains(e.target)) {
          closeDisclaimerPanel(panel, trigger);
        }
      });

      actions.appendChild(trigger);
      actions.appendChild(panel);
      disclaimerBox.remove();
    }

    if (rulesWrap) {
      rulesWrap.className = 'edm-app-header__rules';
      actions.appendChild(rulesWrap);
    }

    header.append(brand, actions);
    legacyHeader.replaceWith(header);

    if (typeof chrome?.storage?.local !== 'undefined') {
      fetch(chrome.runtime.getURL('src/conditions/registry.json'))
        .then((r) => r.json())
        .then((conditions) => chrome.storage.local.get('edmSelectedCondition').then((stored) => {
          const active = conditions.find((c) => c.id === (stored.edmSelectedCondition || 'weight-loss'));
          if (active) updateConditionBadge(active);
        }))
        .catch(() => {});
    }

    const shell = root.querySelector('.px-2.py-4');
    if (shell) shell.classList.add('edm-app-shell');
  }

  function enhanceScrSearch(proseRoot) {
    if (!proseRoot || proseRoot.dataset.edmScrSearchEnhanced === '1') return;
    proseRoot.dataset.edmScrSearchEnhanced = '1';

    const searchCard = proseRoot.querySelector('#scr-search');
    if (!searchCard) return;

    searchCard.classList.add('edm-scr-search-card');

    const input = searchCard.querySelector('#scr-search-input, .scr-search__input');
    if (input) {
      input.setAttribute('placeholder', 'Search this record…');
    }

    const heading = searchCard.querySelector('#scr-search-title, .nhsuk-card__heading');
    if (heading) heading.classList.add('edm-scr-search-title');

    searchCard.querySelectorAll('p').forEach((p) => {
      if (p.id === 'scr-search-result') {
        p.classList.add('edm-scr-search-hint');
        return;
      }
      if (/highlights any rows/i.test(p.textContent)) {
        p.classList.add('edm-scr-search-desc');
      }
    });

    const clearBtn = searchCard.querySelector('.scr-search__button, #scr-search-clear-field');
    if (clearBtn) clearBtn.classList.add('edm-scr-search-clear');
  }

  function parseScrPatient(proseEl) {
    if (!proseEl) return { name: null, dob: null, address: null };

    if (proseEl.dataset.edmScrPatient) {
      try {
        return JSON.parse(proseEl.dataset.edmScrPatient);
      } catch {
        delete proseEl.dataset.edmScrPatient;
      }
    }

    const summary = proseEl.querySelector('.scr-print-patient-summary');
    const text = summary ? summary.textContent : proseEl.textContent || '';
    let dob = null;
    const dobPatterns = [
      /DoB:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i,
      /Date of birth:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i,
      /DoB:\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/i,
      /DoB:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    ];
    for (const pattern of dobPatterns) {
      const match = text.match(pattern);
      if (match) {
        dob = match[1];
        break;
      }
    }

    let name = null;
    let address = null;
    if (summary) {
      for (const p of summary.querySelectorAll('p')) {
        const value = p.textContent.trim();
        if (/^Address:/i.test(value)) {
          address = value.replace(/^Address:\s*/i, '').trim();
          continue;
        }
        if (
          value
          && !/^NHS number:/i.test(value)
          && !/^Gender:/i.test(value)
          && !/^DoB:/i.test(value)
          && !/^Date of birth:/i.test(value)
          && !/^Date of death:/i.test(value)
          && !name
        ) {
          name = value;
        }
      }
    }

    if (!address) {
      const addressMatch = text.match(/Address:\s*(.+?)(?:\n|$)/i);
      if (addressMatch) address = addressMatch[1].trim();
    }

    const result = { name, dob, address };
    proseEl.dataset.edmScrPatient = JSON.stringify(result);
    return result;
  }

  function parseDobToIso(dob) {
    if (!dob) return null;
    const t = dob.trim().replace(/^DOB:\s*/i, '').replace(/\s+/g, ' ');

    let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }

    m = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/i);
    if (m) {
      const monthKey = m[2].toLowerCase().slice(0, 3);
      const month = MONTHS[monthKey];
      if (month) {
        return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      }
    }

    m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    return null;
  }

  function normalizeName(name) {
    return (name || '')
      .toLowerCase()
      .replace(/[''`]/g, "'")
      .replace(/[^a-z0-9'\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeAddress(address) {
    return (address || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[,.\u2019']/g, '')
      .trim();
  }

  function extractPostcode(address) {
    const match = (address || '').match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
    return match ? match[1].replace(/\s+/g, '').toUpperCase() : null;
  }

  function addressesMatch(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return null;
    const na = normalizeAddress(a);
    const nb = normalizeAddress(b);
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;
    const pa = extractPostcode(a);
    const pb = extractPostcode(b);
    if (pa && pb) return pa === pb;
    return false;
  }

  function namesMatch(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return normalizeName(a) === normalizeName(b);
  }

  function dobsMatch(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    const ia = parseDobToIso(a);
    const ib = parseDobToIso(b);
    if (ia && ib) return ia === ib;
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  function getRxPatient(fallbackTitleEl) {
    if (rxPortalPatient) {
      const rawDob = rxPortalPatient.dateOfBirth || rxPortalPatient.dob || '';
      return {
        name: [rxPortalPatient.firstName, rxPortalPatient.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || null,
        dob: rawDob.replace(/^DOB:\s*/i, '').trim() || null,
        address: rxPortalPatient.address?.trim() || null,
      };
    }
    const text = fallbackTitleEl?.textContent?.replace(/\s+/g, ' ').trim();
    if (text && !text.includes('Patient Summary')) {
      return { name: text, dob: null, address: null };
    }
    return { name: null, dob: null, address: null };
  }

  function buildCompareCol(source, label, data, match) {
    const col = document.createElement('div');
    col.className = `edm-patient-compare__col edm-patient-compare__col--${source}`;

    const nameState = !data.name
      ? 'is-empty'
      : match.nameMatch
        ? 'is-match'
        : 'is-mismatch';
    const dobState = !data.dob
      ? 'is-empty'
      : match.dobMatch
        ? 'is-match'
        : 'is-mismatch';
    const addressState = !data.address
      ? 'is-empty'
      : match.addressMatch === false
        ? 'is-mismatch'
        : match.addressMatch === true
          ? 'is-match'
          : 'is-neutral';

    if (data.name && data.dob && match.nameMatch && match.dobMatch) {
      col.classList.add('edm-patient-compare__col--all-match');
    } else if (
      (data.name && !match.nameMatch)
      || (data.dob && !match.dobMatch)
    ) {
      col.classList.add('edm-patient-compare__col--has-mismatch');
    }

    const labelEl = document.createElement('span');
    labelEl.className = 'edm-patient-compare__label';
    labelEl.textContent = label;

    const nameEl = document.createElement('span');
    nameEl.className = `edm-patient-compare__name ${nameState}`;
    nameEl.textContent = data.name || '—';

    const dobEl = document.createElement('span');
    dobEl.className = `edm-patient-compare__dob ${dobState}`;
    dobEl.textContent = data.dob ? `DOB: ${data.dob}` : 'DOB: —';

    col.append(labelEl, nameEl, dobEl);

    const addressEl = document.createElement('span');
    addressEl.className = `edm-patient-compare__address ${addressState}`;
    addressEl.textContent = data.address || 'Address: —';
    if (data.address) addressEl.title = data.address;
    col.appendChild(addressEl);

    return col;
  }

  function renderCompareStatus(compare, rx, scr, match) {
    const wrap = document.createElement('div');
    wrap.className = 'edm-patient-compare__status-wrap';

    const hasIdentity = rx.name && scr.name && rx.dob && scr.dob;
    if (hasIdentity) {
      const identityStatus = document.createElement('div');
      identityStatus.className = 'edm-patient-compare__status';
      if (match.nameMatch && match.dobMatch) {
        identityStatus.classList.add('edm-patient-compare__status--match');
        identityStatus.textContent = 'Name and DOB match';
      } else {
        identityStatus.classList.add('edm-patient-compare__status--mismatch');
        const parts = [];
        if (!match.nameMatch) parts.push('name');
        if (!match.dobMatch) parts.push('DOB');
        identityStatus.textContent = `${parts.join(' and ')} differ — verify patient`;
      }
      wrap.appendChild(identityStatus);
    }

    if (rx.address && scr.address && match.addressMatch === false) {
      const addressStatus = document.createElement('div');
      addressStatus.className =
        'edm-patient-compare__status edm-patient-compare__status--address-mismatch';
      addressStatus.textContent = 'Address does not match';
      wrap.appendChild(addressStatus);
    }

    if (wrap.childElementCount) compare.appendChild(wrap);
  }

  function renderPatientCompare(header, rx, scr) {
    const nameMatch = namesMatch(rx.name, scr.name);
    const dobMatch = dobsMatch(rx.dob, scr.dob);
    const addressMatch = addressesMatch(rx.address, scr.address);
    const match = { nameMatch, dobMatch, addressMatch };

    let compare = header.querySelector('.edm-patient-compare');
    if (!compare) {
      compare = document.createElement('div');
      compare.className = 'edm-patient-compare';
      header.replaceChildren(compare);
    }

    const renderKey = JSON.stringify({ rx, scr, match });
    if (compare.dataset.edmRenderKey === renderKey) return;
    compare.dataset.edmRenderKey = renderKey;
    compare.replaceChildren();

    compare.appendChild(buildCompareCol('scr', 'SCR', scr, match));

    const vs = document.createElement('div');
    vs.className = 'edm-patient-compare__vs';
    vs.setAttribute('aria-hidden', 'true');
    vs.textContent = 'vs';
    compare.appendChild(vs);

    compare.appendChild(buildCompareCol('rx', 'Rx portal', rx, match));

    renderCompareStatus(compare, rx, scr, match);
  }

  function enhanceScrCardHeader() {
    const prose = document.querySelector('#root .prose');
    if (!prose) return;

    const card = prose.closest('.border-slate-200.shadow-lg, [class*="shadow-lg"]');
    const header = card?.querySelector('.bg-slate-50.border-b');
    if (!header) return;

    const titleEl = header.querySelector('.text-2xl, [class*="CardTitle"]');
    const scr = parseScrPatient(prose);
    const rx = getRxPatient(titleEl);

    if (!rx.name && !scr.name) return;

    const signature = JSON.stringify({ rx, scr });
    const needsUpdate =
      header.dataset.edmPatientHeader !== signature
      || !header.querySelector('.edm-patient-compare')
      || header.textContent.includes('Patient Summary Care Record');
    if (!needsUpdate) return;
    header.dataset.edmPatientHeader = signature;

    header.classList.add('edm-scr-card-header');
    renderPatientCompare(header, rx, scr);
  }

  function parseNumericFromText(raw) {
    if (raw == null || raw === '') return null;
    const m = String(raw).match(/[\d.]+/);
    return m ? parseFloat(m[0]) : null;
  }

  function normalizeHeightToCm(value, rawText) {
    const text = (rawText || String(value ?? '')).toLowerCase();
    const ftIn = text.match(/(\d+)\s*(?:ft|'|feet)\s*(\d+)/);
    if (ftIn) {
      return parseInt(ftIn[1], 10) * 30.48 + parseInt(ftIn[2], 10) * 2.54;
    }
    const num = typeof value === 'number' ? value : parseNumericFromText(rawText ?? value);
    if (num == null || Number.isNaN(num)) return null;
    if ((text.includes('m') && !text.includes('cm') && num < 3) || (num > 0 && num < 3)) {
      return Math.round(num * 1000) / 10;
    }
    return num;
  }

  function normalizeWeightToKg(value, rawText) {
    const text = (rawText || String(value ?? '')).toLowerCase();
    const num = typeof value === 'number' ? value : parseNumericFromText(rawText ?? value);
    if (num == null || Number.isNaN(num)) return null;
    if (text.includes('lb') && !text.includes('kg')) return num * 0.453592;
    return num;
  }

  function parseObservationDate(raw) {
    if (!raw) return null;
    const t = raw.trim();
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

  function formatRxPortalDate(raw) {
    if (!raw) return null;
    const d = parseObservationDate(raw);
    return d && !Number.isNaN(d.getTime()) ? formatObservationDate(d) : raw;
  }

  function formatObservationDate(date) {
    if (!date || Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function extractScrVitals(proseEl) {
    if (!proseEl) return {};
    const html = proseEl.innerHTML;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const heading = Array.from(doc.querySelectorAll('h3.nhsuk-card__heading')).find(
      (h) => h.textContent?.trim() === 'Clinical Observations and Findings',
    );
    if (!heading) return {};

    const table = heading.closest('.nhsuk-card')?.querySelector('table.scr-table');
    if (!table) return {};

    const byDateKey = new Map();
    const rows = Array.from(table.querySelectorAll('tbody tr'));

    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll('td.scr-table__cell');
      if (cells[0]?.classList.contains('scr-table__cell--spacer')) continue;

      const dateRaw = cells[0]?.querySelector('p')?.textContent?.trim();
      const labelRaw = cells[1]?.querySelector('p')?.textContent?.trim();
      if (!dateRaw || !labelRaw) continue;

      const date = parseObservationDate(dateRaw);
      if (!date || Number.isNaN(date.getTime())) continue;

      const label = labelRaw.toLowerCase();
      const isWeight =
        label.includes('body weight') || label.includes('o / e - weight') || label === 'weight';
      const isHeight =
        label.includes('standing height')
        || label.includes('o / e - height')
        || label === 'height';
      if (!isWeight && !isHeight) continue;

      let valueRaw = cells[2]?.querySelector('p')?.textContent?.trim();
      if (!valueRaw) {
        const nextRow = rows[i + 1];
        if (
          !nextRow
          || !nextRow.querySelectorAll('td.scr-table__cell')[0]?.classList.contains(
            'scr-table__cell--spacer',
          )
        ) {
          continue;
        }
        valueRaw = nextRow.querySelector('p.scr-supporting-inset')?.textContent?.trim();
        if (!valueRaw) continue;
      }

      if (!byDateKey.has(dateRaw)) {
        byDateKey.set(dateRaw, { date, reading: {} });
      }
      const entry = byDateKey.get(dateRaw);
      if (isWeight) entry.reading.weight = parseNumericFromText(valueRaw);
      if (isHeight) entry.reading.height = parseNumericFromText(valueRaw);
    }

    let latestWeight = null;
    let latestHeight = null;
    for (const entry of byDateKey.values()) {
      if (entry.reading.weight !== undefined) {
        if (!latestWeight || entry.date > latestWeight.date) {
          latestWeight = { date: entry.date, value: entry.reading.weight };
        }
      }
      if (entry.reading.height !== undefined) {
        if (!latestHeight || entry.date > latestHeight.date) {
          latestHeight = { date: entry.date, value: entry.reading.height };
        }
      }
    }

    const result = {};
    if (latestWeight) {
      result.weight = latestWeight.value;
      result.weightDate = formatObservationDate(latestWeight.date);
    }
    if (latestHeight) {
      result.height = latestHeight.value;
      result.heightDate = formatObservationDate(latestHeight.date);
    }
    return result;
  }

  function getRxVitals() {
    if (!rxPortalPatient) return {};
    const rawDate = String(rxPortalPatient.heightWeightDate || '').trim();
    const recordedDate = formatRxPortalDate(rawDate || null);
    const clean = (value) => {
      const text = String(value || '').trim();
      return text && text !== '—' && text !== '-' ? text : null;
    };
    return {
      height: clean(rxPortalPatient.height),
      weight: clean(rxPortalPatient.weight),
      bmi: clean(rxPortalPatient.bmi),
      heightDate: recordedDate,
      weightDate: recordedDate,
    };
  }

  function formatScrVital(type, vitals) {
    if (type === 'weight') {
      if (vitals.weight == null) return null;
      return {
        display: `${vitals.weight} kg`,
        date: vitals.weightDate || null,
        normalized: normalizeWeightToKg(vitals.weight),
      };
    }
    if (vitals.height == null) return null;
    const cm = normalizeHeightToCm(vitals.height);
    return {
      display: cm != null ? `${cm} cm` : `${vitals.height}`,
      date: vitals.heightDate || null,
      normalized: cm,
    };
  }

  function formatRxVital(type, vitals) {
    const raw = type === 'weight' ? vitals.weight : vitals.height;
    if (!raw) return null;
    return {
      display: raw,
      date: type === 'weight' ? vitals.weightDate || null : vitals.heightDate || null,
      normalized: type === 'weight'
        ? normalizeWeightToKg(null, raw)
        : normalizeHeightToCm(null, raw),
    };
  }

  function vitalsComparableMatch(type, scrNorm, rxNorm) {
    if (scrNorm == null || rxNorm == null) return null;
    const tolerance = type === 'weight' ? 0.6 : 2;
    return Math.abs(scrNorm - rxNorm) <= tolerance;
  }

  function findLatestScrVitalRow(type) {
    const prose = document.querySelector('#root .prose');
    if (!prose) return null;
    let best = null;
    let bestTime = -1;
    prose.querySelectorAll('tr').forEach((row) => {
      const label = (row.innerText || '').replace(/\s+/g, ' ').trim();
      const isWeight = /\bweight\b/i.test(label) && !/\bheight\b/i.test(label);
      const isHeight = /\bheight\b/i.test(label) && !/\bweight\b/i.test(label);
      if (type === 'weight' ? !isWeight : !isHeight) return;
      const dateMatch = label.match(/(\d{1,2}[-\s][A-Za-z]{3,9}[-\s]\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/);
      const stamp = dateMatch ? Date.parse(dateMatch[1].replace(/-/g, ' ')) : 0;
      if (!best || stamp >= bestTime) {
        best = row;
        bestTime = Number.isNaN(stamp) ? 0 : stamp;
      }
    });
    return best;
  }

  function scrollToScrVital(type) {
    const row = findLatestScrVitalRow(type);
    if (!row) return;
    document.querySelectorAll('#root tr.edm-finding-row-active').forEach((item) => {
      item.classList.remove('edm-finding-row-active');
    });
    row.classList.add('edm-finding-row-active');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function buildVitalCell(source, data, matchState, type) {
    const cell = document.createElement('div');
    cell.className = `edm-vitals-compare__cell edm-vitals-compare__cell--${source}`;
    if (source === 'scr' && data) {
      cell.style.cursor = 'pointer';
      cell.title = 'Show this entry in the record';
      cell.setAttribute('role', 'button');
      cell.tabIndex = 0;
      const open = () => scrollToScrVital(type);
      cell.addEventListener('click', open);
      cell.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      });
    }

    const sourceEl = document.createElement('span');
    sourceEl.className = 'edm-vitals-compare__source';
    sourceEl.textContent = source === 'scr' ? 'SCR' : 'Rx portal';

    const valueEl = document.createElement('span');
    valueEl.className = 'edm-vitals-compare__value';
    if (data) {
      valueEl.textContent = data.display;
      if (matchState === true) valueEl.classList.add('is-match');
      if (matchState === false) valueEl.classList.add('is-mismatch');
    } else {
      valueEl.textContent = source === 'scr' ? 'Not found in SCR' : 'Not on Rx portal';
      valueEl.classList.add('is-missing');
    }

    cell.append(sourceEl, valueEl);

    if (data?.date) {
      const dateEl = document.createElement('span');
      dateEl.className = 'edm-vitals-compare__date';
      dateEl.textContent = `Recorded ${data.date}`;
      cell.appendChild(dateEl);
    }

    return cell;
  }

  function buildVitalRow(type, label, scrVitals, rxVitals) {
    const scr = formatScrVital(type, scrVitals);
    const rx = formatRxVital(type, rxVitals);
    if (!scr && !rx) return null;

    const match = vitalsComparableMatch(type, scr?.normalized ?? null, rx?.normalized ?? null);

    const row = document.createElement('div');
    row.className = 'edm-vitals-compare__row';

    const metricEl = document.createElement('div');
    metricEl.className = 'edm-vitals-compare__metric';
    metricEl.textContent = label;

    const grid = document.createElement('div');
    grid.className = 'edm-vitals-compare__grid';
    grid.appendChild(buildVitalCell('scr', scr, match, type));
    grid.appendChild(buildVitalCell('rx', rx, match, type));

    row.append(metricEl, grid);

    if (scr && rx) {
      const status = document.createElement('div');
      status.className = 'edm-vitals-compare__status';
      if (match) {
        status.classList.add('edm-vitals-compare__status--match');
        status.textContent = `${label} matches`;
      } else {
        status.classList.add('edm-vitals-compare__status--mismatch');
        status.textContent = `${label} differs — check values`;
      }
      row.appendChild(status);
    } else if (rx && !scr) {
      const status = document.createElement('div');
      status.className = 'edm-vitals-compare__status edm-vitals-compare__status--missing';
      status.textContent = `${label} not recorded in SCR`;
      row.appendChild(status);
    } else if (scr && !rx) {
      const status = document.createElement('div');
      status.className = 'edm-vitals-compare__status edm-vitals-compare__status--missing';
      status.textContent = `${label} not on Rx portal`;
      row.appendChild(status);
    }

    return row;
  }

  function hideBuiltInMeasurements(stickyCard) {
    stickyCard.querySelectorAll('.border-b.border-slate-200.bg-slate-50').forEach((el) => {
      const heading = el.querySelector('h3');
      if (heading?.textContent?.trim() === 'Most Recent Measurements') {
        el.hidden = true;
        el.dataset.edmHiddenMeasurements = '1';
      }
    });
  }

  function enhanceVitalsCompare() {
    const stickyCard = document.querySelector('#root .sticky.top-4');
    if (!stickyCard) return;

    const prose = document.querySelector('#root .prose');
    const scrVitals = extractScrVitals(prose);
    const rxVitals = getRxVitals();

    const hasScr = scrVitals.weight != null || scrVitals.height != null;
    const hasRx = rxVitals.weight || rxVitals.height;
    if (!hasScr && !hasRx) return;

    hideBuiltInMeasurements(stickyCard);

    const renderKey = JSON.stringify({ scrVitals, rxVitals });
    let panel = stickyCard.querySelector('.edm-vitals-compare');
    if (panel?.dataset.edmRenderKey === renderKey) return;

    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'edm-vitals-compare px-6 py-4 border-b border-slate-200 bg-slate-50';
      const cardHeader = stickyCard.querySelector('.border-b');
      if (cardHeader?.nextSibling) {
        stickyCard.insertBefore(panel, cardHeader.nextSibling);
      } else {
        stickyCard.prepend(panel);
      }
    }

    panel.dataset.edmRenderKey = renderKey;
    panel.replaceChildren();

    const heading = document.createElement('h3');
    heading.className = 'edm-vitals-compare__heading';
    heading.textContent = 'Height & weight comparison';
    panel.appendChild(heading);

    const subtitle = document.createElement('p');
    subtitle.className = 'edm-vitals-compare__subtitle';
    subtitle.textContent = 'Latest SCR observations vs Rx portal order vitals';
    panel.appendChild(subtitle);

    const weightRow = buildVitalRow('weight', 'Weight', scrVitals, rxVitals);
    const heightRow = buildVitalRow('height', 'Height', scrVitals, rxVitals);
    if (weightRow) panel.appendChild(weightRow);
    if (heightRow) panel.appendChild(heightRow);
  }

  const FINDING_DATE_PATTERNS = [
    /\b(\d{1,2}-[A-Za-z]{3}-\d{4})\b/g,
    /\b(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\b/g,
    /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g,
  ];

  function extractDatesFromSnippet(text) {
    if (!text) return [];
    const found = [];
    for (const pattern of FINDING_DATE_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        found.push({ raw: match[1], index: match.index });
      }
    }
    return found.sort((a, b) => a.index - b.index);
  }

  function pickFindingDate(dates, title, snippet) {
    if (!dates.length) return null;
    if (dates.length === 1) return dates[0].raw;

    const snippetLower = snippet.toLowerCase();
    const titleWords = title
      .toLowerCase()
      .split(/[\s-]+/)
      .filter((word) => word.length > 3);

    for (const word of titleWords) {
      const wordIndex = snippetLower.indexOf(word);
      if (wordIndex < 0) continue;

      const after = dates.find((entry) => entry.index >= wordIndex);
      if (after) return after.raw;

      const before = dates.filter((entry) => entry.index < wordIndex);
      if (before.length) return before[before.length - 1].raw;
    }

    let latestRaw = dates[0].raw;
    let latestTime = -Infinity;
    for (const entry of dates) {
      const parsed = parseObservationDate(entry.raw);
      if (!parsed || Number.isNaN(parsed.getTime())) continue;
      if (parsed.getTime() > latestTime) {
        latestTime = parsed.getTime();
        latestRaw = entry.raw;
      }
    }
    return latestRaw;
  }

  function formatFindingDate(raw) {
    if (!raw) return null;
    const entered = /^entered\s*:/i.test(raw);
    const prescribed = /^prescribed\s*:/i.test(raw);
    const lastIssued = /^last issued\s*:/i.test(raw);
    const authorised = /^authorised/i.test(raw);
    const recorded = /^recorded\s*:/i.test(raw);
    const onset = /^onset\s*:/i.test(raw);
    const cleaned = raw
      .replace(/^(entered|prescribed|last issued|authorised(?:\s*\([^)]*\))?|recorded|onset|start date|ended|resolved)\s*:\s*/i, '')
      .trim();
    const parsed = parseObservationDate(cleaned);
    const formatted = parsed && !Number.isNaN(parsed.getTime())
      ? formatObservationDate(parsed)
      : cleaned;
    if (entered) return `Entered ${formatted}`;
    if (prescribed) return `Prescribed ${formatted}`;
    if (lastIssued) return `Last issued ${formatted}`;
    if (authorised) return `Authorised ${formatted}`;
    if (recorded) return `Recorded ${formatted}`;
    if (onset) return `Onset ${formatted}`;
    return formatted;
  }

  function getFindingSnippet(card) {
    if (card.dataset.edmSnippet) return card.dataset.edmSnippet;

    const excerptBox = card.querySelector('.bg-white.border.rounded.p-3');
    const excerptEl = excerptBox?.querySelector('p.text-sm.text-slate-800.italic, p.italic');
    const excerptSnippet = excerptEl?.textContent?.replace(/^[\s"]+|[\s"]+$/g, '').trim() || '';
    if (excerptSnippet) return excerptSnippet;

    const inlineSnippet = card.querySelector('p.text-sm.text-red-800, p.text-sm.text-red-700, p.text-sm')?.textContent?.trim() || '';
    return inlineSnippet;
  }

  function getFindingCardKey(card) {
    const titleEl = card.querySelector('h4');
    const titleClone = titleEl?.cloneNode(true);
    titleClone?.querySelector('.edm-finding-date')?.remove();
    const title = card.dataset.edmFindingTitle
      || titleClone?.textContent?.trim()
      || titleEl?.textContent?.trim()
      || '';
    const snippet = getFindingSnippet(card);
    return `${title}::${snippet}`.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function dedupeFindingCards() {
    const list = getFindingCardsList();
    if (!list) return;

    const cards = Array.from(list.querySelectorAll(':scope > .bg-red-50.cursor-pointer'));
    const seen = new Map();

    cards.forEach((card) => {
      const key = getFindingCardKey(card);
      if (!key || key === '::') return;

      const prior = seen.get(key);
      if (prior) {
        card.hidden = true;
        card.dataset.edmDuplicateFinding = '1';
        card.classList.remove('edm-finding-card--active');
        return;
      }

      seen.set(key, card);
      card.hidden = false;
      delete card.dataset.edmDuplicateFinding;
    });
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

  function getFindingCardsList() {
    return document.querySelector('#root .sticky.top-4 .space-y-4');
  }

  function getFindingIndex(card) {
    const list = getFindingCardsList();
    if (!list) return null;
    const cards = Array.from(list.querySelectorAll(':scope > .bg-red-50.cursor-pointer'));
    const idx = cards.indexOf(card);
    return idx >= 0 ? idx : null;
  }

  function getFindingMark(findingIndex) {
    const root = document.querySelector('#root .prose') || document.getElementById('root');
    return root?.querySelector(`#finding-${findingIndex}`) || null;
  }

  function getDateFromFindingMark(findingIndex) {
    const mark = getFindingMark(findingIndex);
    if (!mark) return null;
    return getDateTextFromScrRow(getMedicationRowForMark(mark));
  }

  function clearFindingRowHighlights() {
    document.querySelectorAll('#root tr.edm-finding-row-active').forEach((row) => {
      row.classList.remove('edm-finding-row-active');
    });
  }

  function highlightFindingRow(findingIndex) {
    clearFindingRowHighlights();
    const row = getFindingMark(findingIndex)?.closest('tr');
    if (row) row.classList.add('edm-finding-row-active');
  }

  function syncFindingCardDate(card) {
    const titleEl = card.querySelector('h4');
    const findingIndex = getFindingIndex(card);
    let dateRaw = findingIndex != null ? getDateFromFindingMark(findingIndex) : null;

    if (!dateRaw) {
      const snippet = getFindingSnippet(card);
      const titleClone = titleEl?.cloneNode(true);
      titleClone?.querySelector('.edm-finding-date')?.remove();
      const title = titleClone?.textContent?.trim() || '';
      dateRaw = pickFindingDate(extractDatesFromSnippet(snippet), title, snippet);
    }

    if (!dateRaw) {
      titleEl?.querySelector('.edm-finding-date')?.remove();
      return;
    }

    if (!/\d/.test(dateRaw) && !/^(entered|prescribed|last issued|authorised|recorded|onset)/i.test(dateRaw)) {
      titleEl?.querySelector('.edm-finding-date')?.remove();
      return;
    }

    if (!titleEl) return;

    if (!card.dataset.edmFindingTitle) {
      const titleClone = titleEl.cloneNode(true);
      titleClone.querySelector('.edm-finding-date')?.remove();
      card.dataset.edmFindingTitle = titleClone.textContent.trim();
    }

    let dateEl = titleEl.querySelector('.edm-finding-date');
    if (!dateEl) {
      dateEl = document.createElement('span');
      dateEl.className = 'edm-finding-date';
      titleEl.appendChild(dateEl);
    }
    dateEl.textContent = formatFindingDate(dateRaw);
  }

  function compactFindingCardExcerpt(card) {
    const excerptBox = card.querySelector('.bg-white.border.rounded.p-3');
    const snippet = getFindingSnippet(card);
    if (snippet) card.dataset.edmSnippet = snippet;

    if (!excerptBox) return;
    excerptBox.remove();
  }

  function enhanceFindingCards() {
    document.querySelectorAll('#root .sticky.top-4 .bg-red-50.cursor-pointer').forEach((card) => {
      syncFindingCardDate(card);
      compactFindingCardExcerpt(card);

      if (card.dataset.edmFindingCard === '1') return;
      card.dataset.edmFindingCard = '1';
      card.classList.add('edm-finding-card');
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');

      const activate = () => {
        document.querySelectorAll('#root .edm-finding-card--active').forEach((el) => {
          el.classList.remove('edm-finding-card--active');
        });
        card.classList.add('edm-finding-card--active');
      };

      card.addEventListener('click', () => {
        activate();
        const idx = getFindingIndex(card);
        if (idx == null) return;
        setTimeout(() => highlightFindingRow(idx), 450);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });

    dedupeFindingCards();
  }

  function enhanceFindingMarks() {
    const root = document.querySelector('#root .prose');
    if (!root) return;

    root.querySelectorAll('mark[id^="finding-"]').forEach((mark) => {
      if (mark.dataset.edmMarkBound === '1') return;
      mark.dataset.edmMarkBound = '1';
      mark.addEventListener('click', () => {
        const idx = parseInt(mark.id.replace('finding-', ''), 10);
        if (!Number.isNaN(idx)) highlightFindingRow(idx);
      });
    });
  }

  function runEnhancements() {
    if (isEnhancing) return;

    withObserverPaused(() => {
      const nav = document.querySelector(NAV_SELECTOR);
      if (nav) enhanceNav(nav);

      enhanceAppHeader();
      if (typeof window.edmEnhanceKeywordsReference === 'function') {
        window.edmEnhanceKeywordsReference();
      }
      enhanceScrCardHeader();
      enhanceVitalsCompare();
      enhanceFindingCards();
      enhanceFindingMarks();

      document.querySelectorAll('#root .prose').forEach(enhanceScrSearch);
    });
  }

  const rootEl = document.getElementById('root') || document.body;
  enhanceObserver = new MutationObserver((records) => {
    if (isEnhancing) return;
    const fromUs = records.every((record) => {
      const target = record.target;
      return target instanceof Element && (
        target.closest('.edm-patient-compare')
        || target.closest('.edm-vitals-compare')
        || target.closest('.edm-section-nav')
        || target.closest('.edm-app-header')
        || target.closest('.edm-finding-card')
      );
    });
    if (fromUs) return;
    scheduleEnhancements();
  });
  enhanceObserver.observe(rootEl, { childList: true, subtree: true });

  scheduleEnhancements();

  function mountReturnToRxButton() {
    if (document.getElementById('mg-scr-close-btn')) return;

    async function directCloseScrTabs() {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ currentWindow: true }, (result) => resolve(result || []));
      });
      const rxTab = tabs.find((t) => /rx\.everydaymeds\.co\.uk\/order\//i.test(t.url || ''));
      const scrTabIds = tabs
        .filter((t) => t.id && (
          /keywords-tool\.html/i.test(t.url || '')
          || /portal\.spineservices\.nhs\.uk\/nationalcarerecordsservice/i.test(t.url || '')
        ))
        .map((t) => t.id)
        .filter((id) => id !== rxTab?.id);
      if (rxTab?.id) {
        await new Promise((resolve) => {
          chrome.tabs.update(rxTab.id, { active: true }, () => resolve());
        });
      }
      if (scrTabIds.length) {
        await new Promise((resolve) => {
          chrome.tabs.remove(scrTabIds, () => resolve());
        });
      }
      return { success: !!(rxTab?.id || scrTabIds.length), closedCount: scrTabIds.length };
    }

    if (!document.getElementById('mg-scr-close-btn-style')) {
      const style = document.createElement('style');
      style.id = 'mg-scr-close-btn-style';
      style.textContent = `
        #mg-scr-close-btn {
          position: fixed;
          top: 14px;
          right: 14px;
          z-index: 2147483647;
          width: 44px;
          height: 44px;
          border: none;
          border-radius: 50%;
          background: #dc2626;
          color: #fff;
          font-size: 28px;
          line-height: 1;
          font-weight: 400;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(220, 38, 38, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
        }
        #mg-scr-close-btn:hover:not(:disabled) {
          background: #b91c1c;
          transform: scale(1.06);
          box-shadow: 0 6px 18px rgba(220, 38, 38, 0.5);
        }
        #mg-scr-close-btn:active:not(:disabled) { transform: scale(0.96); }
        #mg-scr-close-btn:disabled { opacity: 0.65; cursor: wait; }
        #mg-scr-close-btn:focus-visible {
          outline: 3px solid #fca5a5;
          outline-offset: 2px;
        }
      `;
      document.documentElement.appendChild(style);
    }

    const btn = document.createElement('button');
    btn.id = 'mg-scr-close-btn';
    btn.type = 'button';
    btn.title = 'Close SCR tabs and return to prescription';
    btn.setAttribute('aria-label', 'Close SCR tabs and return to prescription');
    btn.textContent = '×';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      chrome.runtime.sendMessage({ action: 'closeScrAndReturn' }, (resp) => {
        if (chrome.runtime.lastError || !resp?.success) {
          directCloseScrTabs()
            .then((fallback) => {
              if (!fallback.success) btn.disabled = false;
            })
            .catch(() => { btn.disabled = false; });
        }
      });
    });
    document.body.appendChild(btn);
  }

  function ensureReturnToRxButton() {
    if (document.body) mountReturnToRxButton();
  }

  ensureReturnToRxButton();
  new MutationObserver(() => {
    if (!document.getElementById('mg-scr-close-btn') && document.body) {
      mountReturnToRxButton();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
