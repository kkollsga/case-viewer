// components/CaseBrowser.js — Opening screen case selection component
// Apple-like: clean, minimal, progressive disclosure.

import {
  getActiveField, getActiveScenario, getSelectedCases, getScenariosForField,
  setActiveField, setActiveScenario, setActiveCase, setSelectedCases,
  toggleCaseSelection, openBrowser, addScenario, addField, getFields, getState,
} from '../core/state.js';
import {
  getCasesForScenario, getOrderedCaseNames, saveAppState,
  hasLegacyData, clearLegacyData,
} from '../core/storage.js';
import { on, emit, EVENTS } from '../core/events.js';
import { formatNumber, formatDateShort, formatDateTime } from '../utils/format.js';
import { PALETTES } from '../utils/color.js';
import { el, clear, $ } from '../utils/dom.js';

let containerEl = null;
let lastClickTime = {};

// ─── Public API ──────────────────────────────────────────────

export function init() {
  containerEl = document.getElementById('case-browser');
}

export function render() {
  if (!containerEl) return;
  clear(containerEl);

  const field = getActiveField();
  const scenario = getActiveScenario();
  const selected = getSelectedCases();

  // Root wrapper
  const root = el('div', {
    class: 'min-h-screen bg-gray-50/80',
  });

  // Inner content with max width and padding
  const inner = el('div', {
    class: 'max-w-6xl mx-auto px-6 py-10',
  });

  // Legacy data banner
  if (hasLegacyData()) {
    inner.appendChild(renderLegacyBanner());
  }

  // Title
  inner.appendChild(el('h1', {
    class: 'text-3xl font-semibold text-gray-900 tracking-tight',
    textContent: 'Case Viewer',
  }));

  // Spacer
  inner.appendChild(el('div', { class: 'mt-8' }));

  // Field tabs
  inner.appendChild(renderFieldTabs(field));

  // Scenario pills (only if field is selected)
  if (field) {
    inner.appendChild(el('div', { class: 'mt-4' }));
    inner.appendChild(renderScenarioPills(field, scenario));
  }

  // Main content area
  if (!field) {
    inner.appendChild(renderEmptyStateWithInput(
      'Create your first field',
      'A field represents a geographical area or project (e.g. a licence or prospect).',
      (name) => {
        addField(name);
        saveAppState();
        render();
      },
    ));
  } else if (!scenario) {
    const scenarios = getScenariosForField(field);
    if (scenarios.length === 0) {
      inner.appendChild(renderEmptyStateWithInput(
        'Create a scenario',
        'A scenario organises related case revisions together.',
        (name) => {
          addScenario(field, name);
          setActiveScenario(name);
          saveAppState();
          render();
        },
      ));
    } else {
      inner.appendChild(renderEmptyState(
        'Select a scenario',
        'Choose a scenario above to see its cases.',
      ));
    }
  } else {
    // Case cards
    const caseNames = getOrderedCaseNames(field, scenario);
    const casesData = getCasesForScenario(field, scenario);

    if (caseNames.length === 0) {
      inner.appendChild(renderEmptyStateWithButton(
        'Import your first case',
        'Paste volumetric data from Petrel to create your first case revision.',
        'Import Case',
        () => import('../components/CaseImport.js').then(m => m.show()),
      ));
    } else {
      inner.appendChild(el('div', { class: 'mt-8' }));
      inner.appendChild(renderCaseGrid(caseNames, casesData, selected));
    }
  }

  // Bottom action bar
  if (field && scenario && selected.length > 0) {
    root.appendChild(inner);
    root.appendChild(renderActionBar(selected));
  } else {
    // Import button (always visible when we have a scenario)
    if (field && scenario) {
      const importRow = el('div', {
        class: 'mt-10 flex justify-end',
      });
      importRow.appendChild(el('button', {
        class: 'inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition-colors shadow-sm',
        onClick: () => import('../components/CaseImport.js').then(m => m.show()),
      }, [
        el('span', { textContent: '+' }),
        el('span', { textContent: 'Import' }),
      ]));
      inner.appendChild(importRow);
    }
    root.appendChild(inner);
  }

  containerEl.appendChild(root);
}

export function setupEvents() {
  on(EVENTS.FIELD_CHANGED, () => render());
  on(EVENTS.SCENARIO_CHANGED, () => render());
  on(EVENTS.SCENARIO_CREATED, () => render());
  on(EVENTS.SELECTION_CHANGED, () => render());
  on(EVENTS.CASE_CREATED, () => render());
  on(EVENTS.CASE_UPDATED, () => render());
  on(EVENTS.CASE_DELETED, () => render());
  on(EVENTS.BROWSER_OPENED, () => render());
  on(EVENTS.STATE_LOADED, () => render());
}

// ─── Legacy Banner ───────────────────────────────────────────

function renderLegacyBanner() {
  const banner = el('div', {
    class: 'mb-6 px-4 py-3 bg-amber-50 text-amber-800 text-sm rounded-xl flex items-center justify-between',
  });

  banner.appendChild(el('span', {
    textContent: 'Old data detected from a previous version.',
  }));

  const clearBtn = el('button', {
    class: 'ml-4 text-amber-700 underline hover:text-amber-900 text-sm font-medium',
    textContent: 'Clear old data',
    onClick: () => {
      clearLegacyData();
      banner.remove();
    },
  });
  banner.appendChild(clearBtn);

  return banner;
}

// ─── Field Tabs ──────────────────────────────────────────────

function renderFieldTabs(activeField) {
  const row = el('div', {
    class: 'flex items-center gap-2 flex-wrap',
  });

  for (const field of getFields()) {
    const isActive = field === activeField;
    const pill = el('button', {
      class: isActive
        ? 'px-5 py-2 text-sm font-medium rounded-full bg-indigo-600 text-white transition-all shadow-sm'
        : 'px-5 py-2 text-sm font-medium rounded-full border border-gray-300 text-gray-600 hover:border-indigo-400 hover:text-indigo-600 transition-all',
      textContent: field,
      onClick: () => {
        setActiveField(field);
        saveAppState();
      },
    });
    row.appendChild(pill);
  }

  // Add field button / inline input
  row.appendChild(renderInlineAddButton('Field', (name) => {
    addField(name);
    setActiveField(name);
    saveAppState();
    render();
  }));

  return row;
}

// ─── Scenario Pills ─────────────────────────────────────────

function renderScenarioPills(field, activeScenario) {
  const row = el('div', {
    class: 'flex items-center gap-2 flex-wrap',
  });

  const scenarios = getScenariosForField(field);

  for (const sc of scenarios) {
    const isActive = sc === activeScenario;
    const pill = el('button', {
      class: isActive
        ? 'px-4 py-1.5 text-xs font-medium rounded-full bg-indigo-500 text-white transition-all'
        : 'px-4 py-1.5 text-xs font-medium rounded-full border border-gray-300 text-gray-500 hover:border-indigo-300 hover:text-indigo-500 transition-all',
      textContent: sc,
      onClick: () => {
        setActiveScenario(sc);
        saveAppState();
      },
    });
    row.appendChild(pill);
  }

  // Add scenario inline
  row.appendChild(renderInlineAddButton('Scenario', (name) => {
    addScenario(field, name);
    setActiveScenario(name);
    saveAppState();
    render();
  }));

  return row;
}

// ─── Inline Add Button ──────────────────────────────────────

function renderInlineAddButton(label, onSubmit) {
  const wrapper = el('div', {
    class: 'inline-flex items-center',
  });

  const plusBtn = el('button', {
    class: 'w-8 h-8 flex items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-all text-sm',
    textContent: '+',
    title: `Add ${label}`,
  });

  const inputContainer = el('div', {
    class: 'items-center gap-1',
  });
  inputContainer.style.display = 'none';

  const input = el('input', {
    type: 'text',
    class: 'px-3 py-1.5 text-sm border border-gray-300 rounded-full focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 w-36',
    placeholder: `${label} name`,
  });

  const confirmBtn = el('button', {
    class: 'w-7 h-7 flex items-center justify-center rounded-full bg-indigo-500 text-white text-xs hover:bg-indigo-600 transition-colors',
    textContent: '\u2713',
  });

  const cancelBtn = el('button', {
    class: 'w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 text-xs transition-colors',
    textContent: '\u2715',
  });

  function showInput() {
    plusBtn.style.display = 'none';
    inputContainer.style.display = 'flex';
    input.value = '';
    requestAnimationFrame(() => input.focus());
  }

  function hideInput() {
    plusBtn.style.display = '';
    inputContainer.style.display = 'none';
  }

  function submit() {
    const name = input.value.trim();
    if (name) {
      onSubmit(name);
    }
    hideInput();
  }

  plusBtn.addEventListener('click', showInput);
  cancelBtn.addEventListener('click', hideInput);
  confirmBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') hideInput();
  });

  inputContainer.append(input, confirmBtn, cancelBtn);
  wrapper.append(plusBtn, inputContainer);

  return wrapper;
}

// ─── Case Card Grid ──────────────────────────────────────────

function renderCaseGrid(caseNames, casesData, selected) {
  const grid = el('div', {
    class: 'grid gap-5',
    style: { gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' },
  });

  for (const caseName of caseNames) {
    const caseData = casesData[caseName];
    if (!caseData) continue;
    const isSelected = selected.includes(caseName);
    grid.appendChild(renderCaseCard(caseName, caseData, isSelected));
  }

  return grid;
}

function renderCaseCard(caseName, caseData, isSelected) {
  const card = el('div', {
    class: [
      'relative bg-white rounded-2xl p-5 cursor-pointer transition-all group',
      isSelected
        ? 'border-l-4 border-l-indigo-500 border border-indigo-100 bg-indigo-50/30 shadow-sm'
        : 'border border-transparent hover:shadow-md',
    ].join(' '),
  });

  // Title
  card.appendChild(el('div', {
    class: 'text-base font-semibold text-gray-900 truncate pr-8',
    textContent: caseData.title || caseName,
  }));

  // Timestamp
  if (caseData.timestamp) {
    card.appendChild(el('div', {
      class: 'mt-1 text-xs text-gray-400',
      textContent: formatDateShort(caseData.timestamp),
    }));
  }

  // Description
  if (caseData.description) {
    card.appendChild(el('div', {
      class: 'mt-1.5 text-xs text-gray-400 italic truncate',
      textContent: caseData.description,
    }));
  }

  // Summary stats
  const stats = computeCaseStats(caseData);
  if (stats) {
    card.appendChild(el('div', { class: 'mt-4' }));
    card.appendChild(renderCaseStats(stats, caseData.units));
  }

  // Zone OE breakdown bar
  const zoneBreakdown = computeZoneOEBreakdown(caseData);
  if (zoneBreakdown && zoneBreakdown.length > 0) {
    card.appendChild(el('div', { class: 'mt-4' }));
    card.appendChild(renderZoneBar(zoneBreakdown));
  }

  // Checkbox
  const checkbox = renderCheckbox(isSelected);
  checkbox.classList.add('absolute', 'bottom-4', 'right-4');
  card.appendChild(checkbox);

  // Click → toggle selection
  card.addEventListener('click', (e) => {
    if (e.detail === 1) {
      // Single click — defer slightly to allow double-click detection
      const now = Date.now();
      const last = lastClickTime[caseName] || 0;
      lastClickTime[caseName] = now;

      if (now - last < 350) {
        // Double-click detected
        setSelectedCases([caseName]);
        setActiveCase(caseName);
        saveAppState();
        return;
      }

      setTimeout(() => {
        // If another click happened (double-click), skip
        if (lastClickTime[caseName] !== now) return;
        toggleCaseSelection(caseName);
        saveAppState();
      }, 250);
    }
  });

  // Prevent text selection on double-click
  card.addEventListener('dblclick', (e) => {
    e.preventDefault();
    setSelectedCases([caseName]);
    setActiveCase(caseName);
    saveAppState();
  });

  return card;
}

// ─── Case Stats ──────────────────────────────────────────────

function computeCaseStats(caseData) {
  if (!caseData.data || caseData.data.length === 0) return null;

  const data = caseData.data;
  const units = caseData.units || {};

  let stoiipTotal = 0;
  let giipTotal = 0;

  for (const row of data) {
    stoiipTotal += parseFloat(row['STOIIP']) || 0;
    giipTotal += parseFloat(row['GIIP']) || 0;
  }

  const stoiipUnit = units['STOIIP'] || '';
  const giipUnit = units['GIIP'] || '';

  // OE calculation: stoiip (MCM-equiv) + giip (BCM-equiv, 1 BCM gas = 1 MCM OE)
  const oeMcm = stoiipTotal + giipTotal;

  return {
    stoiip: stoiipTotal,
    stoiipUnit,
    giip: giipTotal,
    giipUnit,
    oe: oeMcm,
  };
}

function renderCaseStats(stats, units) {
  const container = el('div', { class: 'space-y-1.5' });

  // STOIIP
  container.appendChild(renderStatRow('STOIIP', stats.stoiip, stats.stoiipUnit));

  // GIIP
  container.appendChild(renderStatRow('GIIP', stats.giip, stats.giipUnit));

  // Divider
  container.appendChild(el('div', {
    class: 'border-t border-gray-100 my-2',
  }));

  // OE total
  const oeRow = el('div', { class: 'flex justify-between items-baseline' });
  oeRow.appendChild(el('span', {
    class: 'text-xs font-medium text-gray-700',
    textContent: 'OE',
  }));
  oeRow.appendChild(el('span', {
    class: 'text-sm font-semibold text-gray-900',
    textContent: `${formatNumber(stats.oe)} MCM`,
  }));
  container.appendChild(oeRow);

  return container;
}

function renderStatRow(label, value, unit) {
  const row = el('div', { class: 'flex justify-between items-baseline' });
  row.appendChild(el('span', {
    class: 'text-xs text-gray-500',
    textContent: label,
  }));
  row.appendChild(el('span', {
    class: 'text-sm font-medium text-gray-800',
    textContent: `${formatNumber(value)} ${unit}`,
  }));
  return row;
}

// ─── Zone OE Breakdown Bar ──────────────────────────────────

function computeZoneOEBreakdown(caseData) {
  if (!caseData.data || caseData.data.length === 0) return null;

  // Use the first grouping column
  const groupCols = caseData.volumeGroups?.columns || [];
  if (groupCols.length === 0) return null;

  const groupCol = groupCols[0];
  const zoneMap = {};

  for (const row of caseData.data) {
    const zone = row[groupCol];
    if (!zone) continue;
    if (!zoneMap[zone]) zoneMap[zone] = 0;
    const stoiip = parseFloat(row['STOIIP']) || 0;
    const giip = parseFloat(row['GIIP']) || 0;
    zoneMap[zone] += stoiip + giip;
  }

  const zones = Object.entries(zoneMap)
    .map(([name, oe]) => ({ name, oe }))
    .filter(z => z.oe > 0);

  return zones;
}

function renderZoneBar(zones) {
  const totalOE = zones.reduce((s, z) => s + z.oe, 0);
  if (totalOE === 0) return el('div');

  const container = el('div', { class: 'space-y-1.5' });

  // Label
  container.appendChild(el('div', {
    class: 'text-xs text-gray-400 font-medium',
    textContent: 'Zone OE',
  }));

  // Stacked bar
  const bar = el('div', {
    class: 'flex h-2.5 rounded-full overflow-hidden',
  });

  const palette = PALETTES.vibrant;

  zones.forEach((zone, i) => {
    const pct = (zone.oe / totalOE) * 100;
    const segment = el('div', {
      class: 'h-full transition-all',
      title: `${zone.name}: ${formatNumber(zone.oe)} MCM`,
    });
    segment.style.width = `${pct}%`;
    segment.style.backgroundColor = palette[i % palette.length];
    bar.appendChild(segment);
  });

  container.appendChild(bar);

  // Zone labels
  const labels = el('div', { class: 'flex flex-wrap gap-x-3 gap-y-0.5 mt-1' });
  zones.forEach((zone, i) => {
    const label = el('div', { class: 'flex items-center gap-1' });
    const dot = el('div', {
      class: 'w-2 h-2 rounded-full flex-shrink-0',
    });
    dot.style.backgroundColor = palette[i % palette.length];
    label.appendChild(dot);
    label.appendChild(el('span', {
      class: 'text-xs text-gray-500 truncate',
      textContent: zone.name,
    }));
    labels.appendChild(label);
  });
  container.appendChild(labels);

  return container;
}

// ─── Checkbox ────────────────────────────────────────────────

function renderCheckbox(checked) {
  const outer = el('div', {
    class: [
      'w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all',
      checked
        ? 'bg-indigo-600 border-indigo-600'
        : 'border-gray-300 group-hover:border-gray-400',
    ].join(' '),
  });

  if (checked) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('class', 'w-3.5 h-3.5 text-white');
    svg.innerHTML = '<polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
    outer.appendChild(svg);
  }

  return outer;
}

// ─── Action Bar ──────────────────────────────────────────────

function renderActionBar(selected) {
  const bar = el('div', {
    class: 'sticky bottom-0 bg-white/90 backdrop-blur-lg border-t border-gray-200 py-4 px-6',
  });

  const inner = el('div', {
    class: 'max-w-6xl mx-auto flex items-center justify-between',
  });

  // Left: count
  inner.appendChild(el('span', {
    class: 'text-sm text-gray-600',
    textContent: `${selected.length} case${selected.length !== 1 ? 's' : ''} selected`,
  }));

  // Right: actions
  const actions = el('div', { class: 'flex items-center gap-3' });

  // View button
  const viewBtn = el('button', {
    class: 'px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition-colors shadow-sm',
    textContent: selected.length === 1 ? 'View' : `View ${selected.length} Cases`,
    onClick: () => {
      if (selected.length === 1) {
        setActiveCase(selected[0]);
      } else {
        // View first, rest are compare candidates
        setActiveCase(selected[0]);
      }
      saveAppState();
    },
  });
  actions.appendChild(viewBtn);

  // Import button
  const importBtn = el('button', {
    class: 'inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-full hover:bg-indigo-50 transition-colors',
    onClick: () => import('../components/CaseImport.js').then(m => m.show()),
  }, [
    el('span', { textContent: '+' }),
    el('span', { textContent: 'Import' }),
  ]);
  actions.appendChild(importBtn);

  inner.appendChild(actions);
  bar.appendChild(inner);

  return bar;
}

// ─── Empty States ────────────────────────────────────────────

function renderEmptyState(title, subtitle) {
  const container = el('div', {
    class: 'mt-20 text-center',
  });

  container.appendChild(el('div', {
    class: 'text-lg font-medium text-gray-500',
    textContent: title,
  }));

  if (subtitle) {
    container.appendChild(el('div', {
      class: 'mt-2 text-sm text-gray-400',
      textContent: subtitle,
    }));
  }

  return container;
}

function renderEmptyStateWithInput(title, subtitle, onSubmit) {
  const container = el('div', {
    class: 'mt-20 text-center',
  });

  container.appendChild(el('div', {
    class: 'text-lg font-medium text-gray-500',
    textContent: title,
  }));

  if (subtitle) {
    container.appendChild(el('div', {
      class: 'mt-2 text-sm text-gray-400',
      textContent: subtitle,
    }));
  }

  const form = el('div', {
    class: 'mt-6 inline-flex items-center gap-2',
  });

  const input = el('input', {
    type: 'text',
    class: 'px-4 py-2 text-sm border border-gray-300 rounded-full focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 w-48',
    placeholder: 'Scenario name',
  });

  const btn = el('button', {
    class: 'px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition-colors',
    textContent: 'Create',
    onClick: () => {
      const name = input.value.trim();
      if (name) onSubmit(name);
    },
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const name = input.value.trim();
      if (name) onSubmit(name);
    }
  });

  form.append(input, btn);
  container.appendChild(form);

  return container;
}

function renderEmptyStateWithButton(title, subtitle, buttonText, onClick) {
  const container = el('div', {
    class: 'mt-20 text-center',
  });

  container.appendChild(el('div', {
    class: 'text-lg font-medium text-gray-500',
    textContent: title,
  }));

  if (subtitle) {
    container.appendChild(el('div', {
      class: 'mt-2 text-sm text-gray-400 max-w-md mx-auto',
      textContent: subtitle,
    }));
  }

  container.appendChild(el('div', { class: 'mt-6' }, [
    el('button', {
      class: 'inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition-colors shadow-sm',
      textContent: buttonText,
      onClick,
    }),
  ]));

  return container;
}
