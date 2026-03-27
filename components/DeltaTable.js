// components/DeltaTable.js — Delta comparison overlay for PivotTable
// Shows side-by-side values, Δ and Δ% when a compare case is selected.

import { getRuntime, getUI, getActiveField, getActiveCase, getActiveScenario } from '../core/state.js';
import { getCaseData } from '../core/storage.js';
import { on, EVENTS } from '../core/events.js';
import { formatNumber } from '../utils/format.js';
import { calculateGroupParameters, PARAMETER_COLUMNS, getParameterUnits, formatParameterValue } from '../utils/parameters.js';
import { el, clear } from '../utils/dom.js';

export function init() {}

/**
 * Render the delta pivot table.
 * Replaces the normal pivot table content when a compare case is active.
 */
export function render() {
  const ui = getUI();
  const runtime = getRuntime();
  const field = getActiveField();
  const activeCase = getActiveCase();
  const compareCaseName = ui.compareCase;

  const headerContainer = document.getElementById('pivot-headers');
  const body = document.getElementById('pivot-body');
  const legendContainer = document.getElementById('pivot-legend');

  clear(headerContainer);
  clear(body);
  if (legendContainer) clear(legendContainer);

  if (!compareCaseName || !activeCase || !field) return false;

  const activeData = runtime.volumetricData;
  const scenario = getActiveScenario();
  const compareData = getCaseData(field, compareCaseName, scenario);

  if (!activeData || !activeData.data || !compareData || !compareData.data) return false;

  // Apply value conversions to compare data
  let compareRows = compareData.data;
  if (compareData.valueConversions) {
    compareRows = applyConversions(compareRows, compareData.valueConversions);
  }

  const groupColumns = activeData.volumeGroups?.columns || [];
  const units = activeData.units || {};

  // Build lookup for compare data by group key
  const compareMap = buildGroupMap(compareRows, groupColumns);
  const activeMap = buildGroupMap(activeData.data, groupColumns);

  // Get all unique group keys
  const allKeys = new Set([...activeMap.keys(), ...compareMap.keys()]);

  // Determine display columns (volumes only for delta, not parameters)
  const columns = Object.keys(activeData.data[0] || {});
  const numericColumns = columns.filter(col =>
    !groupColumns.includes(col) && !col.startsWith('__') && col.trim() !== ''
  );

  // ── Header row ──
  const headerRow = el('tr');
  headerRow.appendChild(el('th', { class: 'px-2 py-1 min-w-[150px] text-left text-xs font-semibold text-gray-700', textContent: 'Group' }));

  for (const col of numericColumns) {
    headerRow.appendChild(el('th', { class: 'px-2 py-1 text-right text-xs font-semibold text-gray-700', textContent: `${col} (${activeCase})` }));
    headerRow.appendChild(el('th', { class: 'px-2 py-1 text-right text-xs font-semibold text-gray-400', textContent: `${col} (${compareCaseName})` }));
    headerRow.appendChild(el('th', { class: 'px-2 py-1 text-right text-xs font-semibold text-indigo-600', textContent: `Δ ${col}` }));
    headerRow.appendChild(el('th', { class: 'px-2 py-1 text-right text-xs font-semibold text-indigo-400', textContent: 'Δ%' }));
  }
  headerContainer.appendChild(headerRow);

  // ── Summary banner ──
  const primaryMetric = ui.metric || 'STOIIP';
  let totalDelta = 0;
  let topContributor = { key: '', delta: 0 };

  // ── Data rows ──
  // Collect deltas for sorting
  const deltaRows = [];

  for (const key of allKeys) {
    const activeRows = activeMap.get(key) || [];
    const compareRowsForKey = compareMap.get(key) || [];

    const activeSums = sumRows(activeRows, numericColumns);
    const compareSums = sumRows(compareRowsForKey, numericColumns);

    const deltas = {};
    const deltaPercents = {};
    for (const col of numericColumns) {
      deltas[col] = activeSums[col] - compareSums[col];
      deltaPercents[col] = compareSums[col] !== 0
        ? ((activeSums[col] - compareSums[col]) / Math.abs(compareSums[col])) * 100
        : (activeSums[col] !== 0 ? Infinity : 0);
    }

    const primaryDelta = deltas[primaryMetric] || 0;
    totalDelta += primaryDelta;
    if (Math.abs(primaryDelta) > Math.abs(topContributor.delta)) {
      topContributor = { key, delta: primaryDelta };
    }

    // Skip rows where both are zero in primary metric (when hideEmpty)
    if (ui.hideEmpty && activeSums[primaryMetric] === 0 && compareSums[primaryMetric] === 0) {
      continue;
    }

    deltaRows.push({ key, activeSums, compareSums, deltas, deltaPercents, absDelta: Math.abs(primaryDelta) });
  }

  // Sort by |Δ| descending in primary metric
  deltaRows.sort((a, b) => b.absDelta - a.absDelta);

  for (const row of deltaRows) {
    const tr = el('tr', { class: 'text-sm hover:bg-gray-50' });

    // Group name
    tr.appendChild(el('td', { class: 'px-2 py-1 font-medium text-gray-700', textContent: row.key }));

    for (const col of numericColumns) {
      // Active value
      tr.appendChild(el('td', { class: 'px-2 py-1 text-right text-gray-700', textContent: formatNumber(row.activeSums[col]) }));

      // Compare value
      tr.appendChild(el('td', { class: 'px-2 py-1 text-right text-gray-400', textContent: formatNumber(row.compareSums[col]) }));

      // Delta
      const delta = row.deltas[col];
      const deltaColor = delta > 0.005 ? 'text-green-600' : delta < -0.005 ? 'text-red-600' : 'text-gray-400';
      const deltaPrefix = delta > 0.005 ? '+' : '';
      tr.appendChild(el('td', { class: `px-2 py-1 text-right font-medium ${deltaColor}`, textContent: `${deltaPrefix}${formatNumber(delta)}` }));

      // Delta %
      const dp = row.deltaPercents[col];
      let dpText;
      if (dp === Infinity) dpText = 'new';
      else if (dp === -Infinity) dpText = 'removed';
      else dpText = `${dp > 0 ? '+' : ''}${dp.toFixed(1)}%`;
      tr.appendChild(el('td', { class: `px-2 py-1 text-right text-xs ${deltaColor}`, textContent: dpText }));
    }

    body.appendChild(tr);
  }

  // ── Total row ──
  const totalTr = el('tr', { class: 'pivot-total-row text-sm' });
  totalTr.appendChild(el('td', { class: 'px-2 py-1 font-medium', textContent: 'Total' }));

  const allActiveRows = [...activeMap.values()].flat();
  const allCompareRows = [...compareMap.values()].flat();
  const totalActive = sumRows(allActiveRows, numericColumns);
  const totalCompare = sumRows(allCompareRows, numericColumns);

  for (const col of numericColumns) {
    const delta = totalActive[col] - totalCompare[col];
    const dp = totalCompare[col] !== 0 ? ((delta / Math.abs(totalCompare[col])) * 100) : 0;
    const deltaColor = delta > 0.005 ? 'text-green-600' : delta < -0.005 ? 'text-red-600' : 'text-gray-400';

    totalTr.appendChild(el('td', { class: 'px-2 py-1 text-right', textContent: formatNumber(totalActive[col]) }));
    totalTr.appendChild(el('td', { class: 'px-2 py-1 text-right text-gray-400', textContent: formatNumber(totalCompare[col]) }));
    totalTr.appendChild(el('td', { class: `px-2 py-1 text-right font-medium ${deltaColor}`, textContent: `${delta > 0 ? '+' : ''}${formatNumber(delta)}` }));
    totalTr.appendChild(el('td', { class: `px-2 py-1 text-right text-xs ${deltaColor}`, textContent: `${dp > 0 ? '+' : ''}${dp.toFixed(1)}%` }));
  }
  body.appendChild(totalTr);

  // ── Summary banner in legend ──
  if (legendContainer) {
    const deltaColor = totalDelta > 0 ? 'text-green-600' : totalDelta < 0 ? 'text-red-600' : 'text-gray-500';
    legendContainer.innerHTML = `
      <span class="font-medium">Δ ${primaryMetric}: </span>
      <span class="${deltaColor} font-semibold">${totalDelta > 0 ? '+' : ''}${formatNumber(totalDelta)} ${units[primaryMetric] || ''}</span>
      <span class="ml-3 text-gray-500">Top: ${topContributor.key} (${topContributor.delta > 0 ? '+' : ''}${formatNumber(topContributor.delta)})</span>
    `;
  }

  return true; // Signal that delta table was rendered
}

// ─── Helpers ────────────────────────────────────────────────

function buildGroupMap(rows, groupColumns) {
  const map = new Map();
  if (!rows || !groupColumns || groupColumns.length === 0) {
    // No grouping — single "Total" group
    map.set('Total', rows || []);
    return map;
  }

  for (const row of rows) {
    const key = groupColumns.map(col => row[col] || 'Unspecified').join(' / ');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function sumRows(rows, columns) {
  const sums = {};
  for (const col of columns) sums[col] = 0;
  for (const row of rows) {
    for (const col of columns) {
      sums[col] += parseFloat(row[col]) || 0;
    }
  }
  return sums;
}

function applyConversions(data, conversions) {
  if (!conversions || Object.keys(conversions).length === 0) return data;
  const converted = JSON.parse(JSON.stringify(data));
  for (const [col, config] of Object.entries(conversions)) {
    if (config.enabled && config.mappings) {
      for (const row of converted) {
        if (row[col] in config.mappings) row[col] = config.mappings[row[col]];
      }
    }
  }
  return converted;
}

// ─── Events ─────────────────────────────────────────────────

export function setupEvents() {
  on(EVENTS.COMPARE_CHANGED, () => render());
  on(EVENTS.TOGGLE_DELTA, () => render());
}
