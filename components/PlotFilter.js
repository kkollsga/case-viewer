// components/PlotFilter.js — Shared filter for the Tornado + Distribution
// sections. Lets the user (1) override the field name in plot titles via a
// custom prefix, and (2) toggle which segment / zone / facies values are
// included when aggregating volumes.
//
// State is persisted per field. Two callers (Tornado, Distribution) mount
// the same filter UI; changes in one instance re-render both plots via the
// pub-sub below.

import {
  loadPlotFilter, savePlotFilter, getCasesForScenario,
  loadGroupMappings, getGroupValueOrder,
} from '../core/storage.js';
import { getActiveField, getActiveScenario } from '../core/state.js';
import { el } from '../utils/dom.js';

const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notifyAll() {
  for (const fn of subscribers) {
    try { fn(); } catch (e) { console.warn('PlotFilter subscriber failed:', e); }
  }
}

// Public read API — callers want the title prefix and the row predicate.
export function getFilter(field) {
  return loadPlotFilter(field);
}

export function getTitlePrefix(field) {
  const f = loadPlotFilter(field);
  const p = (f.prefix || '').trim();
  return p || field || 'Field';
}

// Collect unique values per group column across all cases of the active
// scenario, **after** applying the field's group mappings. So if you've
// stacked "Sand 5" + "Sand 3" into "Channel", the pill shows "Channel".
// Ordering follows the user-defined `__order_<col>` if present, otherwise
// alphabetical.
function collectFilterValues(field, scenario) {
  const cases = getCasesForScenario(field, scenario);
  const mappings = loadGroupMappings(field);

  // Build raw → stack-name lookup per column
  const stackLookup = {};
  if (mappings) {
    for (const [col, stacks] of Object.entries(mappings)) {
      if (col.startsWith('__') || !Array.isArray(stacks)) continue;
      stackLookup[col] = {};
      for (const stack of stacks) {
        if (!stack || !Array.isArray(stack.values)) continue;
        for (const v of stack.values) stackLookup[col][String(v)] = stack.name;
      }
    }
  }

  const cols = new Set();
  const vals = {};
  for (const c of Object.values(cases)) {
    if (!c?.data || !c.volumeGroups?.columns) continue;
    for (const col of c.volumeGroups.columns) {
      cols.add(col);
      if (!vals[col]) vals[col] = new Set();
      for (const row of c.data) {
        const raw = row[col];
        if (raw === undefined || raw === null || raw === '') continue;
        const display = (stackLookup[col] && stackLookup[col][String(raw)]) || String(raw);
        vals[col].add(display);
      }
    }
  }

  const out = {};
  for (const col of cols) {
    const present = vals[col] || new Set();
    const customOrder = getGroupValueOrder(field, col);
    if (customOrder && customOrder.length > 0) {
      const ordered = customOrder.filter((v) => present.has(v));
      const extras = Array.from(present).filter((v) => !customOrder.includes(v)).sort();
      out[col] = [...ordered, ...extras];
    } else {
      out[col] = Array.from(present).sort();
    }
  }
  return out;
}

// Build the filter <div>. Mounts the full UI: prefix input + per-column pills
// + reset button. The same UI is rendered in two places — both share state
// via localStorage and the subscribe() callback.
export function buildFilterDiv(field) {
  const wrap = el('div', {
    class: 'border border-gray-200 rounded-lg p-3 bg-gray-50/50 mt-4',
  });

  const scenario = getActiveScenario();
  if (!field || !scenario) {
    wrap.appendChild(el('div', {
      class: 'text-xs text-gray-400 italic',
      textContent: 'Plot filter — select a field and scenario.',
    }));
    return wrap;
  }

  const filter = loadPlotFilter(field);
  const valuesByCol = collectFilterValues(field, scenario);
  const cols = Object.keys(valuesByCol);
  const totalActiveExcludes = cols.reduce(
    (n, c) => n + ((filter.exclude?.[c] || []).length),
    0,
  );

  // ── Header row: title + prefix input + reset ──
  const header = el('div', { class: 'flex items-center justify-between gap-3 flex-wrap mb-3' });

  const left = el('div', { class: 'flex items-center gap-2' });
  left.appendChild(el('div', {
    class: 'text-xs font-medium text-gray-500 uppercase tracking-wider',
    textContent: 'Plot filter',
  }));
  if (totalActiveExcludes > 0) {
    left.appendChild(el('span', {
      class: 'inline-block px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded',
      textContent: `${totalActiveExcludes} excluded`,
    }));
  }
  header.appendChild(left);

  const right = el('div', { class: 'flex items-center gap-2 flex-wrap' });

  const prefixLabel = el('label', { class: 'text-xs text-gray-500 flex items-center gap-1' });
  prefixLabel.appendChild(document.createTextNode('Title prefix:'));
  const prefixInput = el('input', {
    type: 'text',
    value: filter.prefix || '',
    placeholder: field,
    class: 'w-48 text-xs px-2 py-1 bg-white border border-gray-200 rounded focus:ring-1 focus:ring-indigo-500 focus:border-transparent',
    title: 'Replaces the field name in plot titles. Leave blank to use the field name.',
  });
  prefixInput.addEventListener('input', (e) => {
    const next = loadPlotFilter(field);
    next.prefix = e.target.value || null;
    savePlotFilter(field, next);
    notifyAll();
  });
  prefixLabel.appendChild(prefixInput);
  right.appendChild(prefixLabel);

  const resetBtn = el('button', {
    class: 'text-xs text-gray-500 hover:text-indigo-700 transition-colors px-2 py-1 border border-gray-200 hover:border-indigo-300 rounded',
    textContent: 'Reset',
    title: 'Clear prefix and re-include all values',
  });
  resetBtn.addEventListener('click', () => {
    savePlotFilter(field, { prefix: null, exclude: {} });
    notifyAll();
  });
  right.appendChild(resetBtn);

  header.appendChild(right);
  wrap.appendChild(header);

  // ── Per-column pills ──
  if (cols.length === 0) {
    wrap.appendChild(el('div', {
      class: 'text-xs text-gray-400 italic',
      textContent: 'No volume-group columns defined for this scenario — nothing to filter.',
    }));
    return wrap;
  }

  const pillsTable = el('div', { class: 'space-y-1.5' });
  for (const col of cols) {
    const row = el('div', { class: 'flex items-start gap-2' });
    row.appendChild(el('div', {
      class: 'text-xs font-medium text-gray-600 w-20 pt-1 flex-shrink-0',
      textContent: col + ':',
    }));
    const pillsWrap = el('div', { class: 'flex items-center gap-1.5 flex-wrap' });
    const excluded = new Set(filter.exclude?.[col] || []);
    for (const val of valuesByCol[col]) {
      const isOn = !excluded.has(val);
      const pill = el('button', {
        class: isOn
          ? 'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors'
          : 'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-400 border border-gray-200 hover:bg-gray-100 transition-colors line-through',
        textContent: val,
        title: isOn ? `Click to exclude ${val}` : `Click to include ${val}`,
      });
      pill.addEventListener('click', () => togglePill(field, col, val));
      pillsWrap.appendChild(pill);
    }
    // "Toggle all" links: select-all / clear-all
    const allBtn = el('button', {
      class: 'text-[10px] text-gray-400 hover:text-indigo-700 transition-colors ml-2',
      textContent: 'all',
    });
    allBtn.addEventListener('click', () => setAllForColumn(field, col, /*include=*/true));
    pillsWrap.appendChild(allBtn);
    const noneBtn = el('button', {
      class: 'text-[10px] text-gray-400 hover:text-indigo-700 transition-colors',
      textContent: 'none',
    });
    noneBtn.addEventListener('click', () => setAllForColumn(field, col, /*include=*/false, valuesByCol[col]));
    pillsWrap.appendChild(noneBtn);
    row.appendChild(pillsWrap);
    pillsTable.appendChild(row);
  }
  wrap.appendChild(pillsTable);

  return wrap;
}

function togglePill(field, col, val) {
  const filter = loadPlotFilter(field);
  if (!filter.exclude) filter.exclude = {};
  if (!Array.isArray(filter.exclude[col])) filter.exclude[col] = [];
  const list = filter.exclude[col];
  const idx = list.indexOf(val);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(val);
  savePlotFilter(field, filter);
  notifyAll();
}

function setAllForColumn(field, col, include, allValues) {
  const filter = loadPlotFilter(field);
  if (!filter.exclude) filter.exclude = {};
  if (include) {
    delete filter.exclude[col];
  } else {
    filter.exclude[col] = (allValues || []).slice();
  }
  savePlotFilter(field, filter);
  notifyAll();
}
