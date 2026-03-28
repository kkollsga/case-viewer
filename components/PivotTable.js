// components/PivotTable.js — Zone/segment hierarchy table (core view)

import { getState, getRuntime, getActiveField, getActiveCase, getUI, getExpandedZones, toggleZoneExpanded, store } from '../core/state.js';
import { getGroupValueOrder, getGroupTypeOrder, loadGroupMappings } from '../core/storage.js';
import { formatNumber } from '../utils/format.js';
import { calculateParameters, PARAMETER_COLUMNS, getParameterUnits, formatParameterValue, calculateGroupParameters } from '../utils/parameters.js';
import { el, clear } from '../utils/dom.js';
import { faintColor } from '../utils/color.js';

export function init() {}

/**
 * Render the pivot table for the current case's data.
 */
export function render() {
  const runtime = getRuntime();
  const ui = getUI();
  const vData = runtime.volumetricData;

  const headerContainer = document.getElementById('pivot-headers');
  const body = document.getElementById('pivot-body');
  const legendContainer = document.getElementById('pivot-legend');

  clear(headerContainer);
  clear(body);
  if (legendContainer) clear(legendContainer);

  if (!vData || !vData.data || vData.data.length === 0) return;

  let data = [...vData.data];
  const units = vData.units || {};
  const field = getActiveField();
  const mappings = loadGroupMappings(field);

  // Apply group type order from field settings
  let groupColumns = vData.volumeGroups?.columns || [];
  const typeOrder = getGroupTypeOrder(field);
  if (typeOrder) {
    const ordered = typeOrder.filter(c => groupColumns.includes(c));
    const extras = groupColumns.filter(c => !ordered.includes(c));
    groupColumns = [...ordered, ...extras];
  }

  // Filter empty rows
  if (ui.hideEmpty) {
    data = data.filter(row => (parseFloat(row['Bulk volume']) || 0) > 0);
    if (data.length === 0) {
      body.appendChild(el('tr', {}, [
        el('td', {
          class: 'text-center text-gray-500 py-4',
          colSpan: 100,
          textContent: 'No data with non-zero bulk volume',
        }),
      ]));
      return;
    }
  }

  const columns = Object.keys(data[0]);

  // Determine display columns
  let displayColumns, formattedHeaders;

  if (ui.showParameters) {
    displayColumns = PARAMETER_COLUMNS;
    const paramUnits = getParameterUnits(units);
    formattedHeaders = displayColumns.map(col => ({
      key: col, label: col, unit: paramUnits[col] || '',
    }));
  } else {
    const numericColumns = columns.filter(col =>
      !groupColumns.includes(col) && !col.startsWith('__') && col.trim() !== ''
    );
    formattedHeaders = numericColumns.map(col => ({
      key: col, label: col, unit: units[col] || '',
    }));
    displayColumns = numericColumns;
  }

  // ── Header row ──
  const headerRow = el('tr');

  // Single label column
  headerRow.appendChild(el('th', {
    class: 'pivot-header-label',
    textContent: groupColumns[0] || '',
  }));

  // Value headers (horizontal, right-aligned)
  for (const col of formattedHeaders) {
    const th = el('th', { class: 'pivot-header-value' });
    th.appendChild(el('div', { textContent: col.label }));
    if (col.unit) {
      th.appendChild(el('div', { class: 'pivot-header-unit', textContent: col.unit }));
    }
    headerRow.appendChild(th);
  }
  headerContainer.appendChild(headerRow);

  // ── Nested data ──
  const nestedData = createMultiLevelGroups(data, groupColumns);
  renderGroups(body, nestedData, 0, groupColumns, displayColumns, formattedHeaders, units, data, mappings, null);

  // ── Total row ──
  renderTotalRow(body, data, groupColumns, formattedHeaders, units);

  // ── Legend ──
  if (legendContainer && groupColumns.length > 0) {
    groupColumns.forEach((col, i) => {
      const item = el('span', { class: 'pivot-legend-item' });
      item.appendChild(el('span', { class: `pivot-legend-swatch level-${Math.min(i, 2)}` }));
      item.appendChild(el('span', { textContent: col }));
      legendContainer.appendChild(item);
    });
  }
}

// ─── Grouping ───────────────────────────────────────────────

function createMultiLevelGroups(data, groupColumns) {
  if (!data || data.length === 0 || !groupColumns || groupColumns.length === 0) {
    return { items: data || [], subgroups: {} };
  }

  const currentCol = groupColumns[0];
  const remaining = groupColumns.slice(1);
  const groups = {};

  for (const row of data) {
    const key = row[currentCol] || 'Unspecified';
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  const result = {};
  for (const [key, rows] of Object.entries(groups)) {
    result[key] = {
      items: rows,
      subgroups: remaining.length > 0 ? createMultiLevelGroups(rows, remaining) : {},
    };
  }
  return result;
}

function renderGroups(container, nestedData, level, groupColumns, displayColumns, formattedHeaders, units, allData, mappings, parentHue) {
  if (!nestedData || typeof nestedData !== 'object') return;

  const ui = getUI();
  // Use field+scenario as key (not case) so expanded state persists across case switches
  const field = getActiveField();
  const caseKey = `${field}_pivot`;

  // Sort groups: user-defined order first, then by Bulk volume
  const currentCol = groupColumns[level];
  const valueOrder = currentCol ? getGroupValueOrder(field, currentCol) : null;

  const entries = Object.entries(nestedData)
    .filter(([, v]) => v && v.items)
    .sort((a, b) => {
      if (valueOrder) {
        const ai = valueOrder.indexOf(a[0]);
        const bi = valueOrder.indexOf(b[0]);
        // Items in the order list come first, in order. Unlisted items go to end by volume.
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
      }
      // Fallback: sort by Bulk volume descending
      const aVol = a[1].items.reduce((s, r) => s + (parseFloat(r['Bulk volume']) || 0), 0);
      const bVol = b[1].items.reduce((s, r) => s + (parseFloat(r['Bulk volume']) || 0), 0);
      return bVol - aVol;
    });

  for (const [groupValue, groupData] of entries) {
    const groupItems = groupData.items || [];
    const groupBulk = groupItems.reduce((s, r) => s + (parseFloat(r['Bulk volume']) || 0), 0);

    if (ui.hideEmpty && groupBulk === 0) continue;

    const groupKey = `level_${level}_${groupValue}`;
    const expandedZones = getExpandedZones(caseKey);
    if (expandedZones[groupKey] === undefined) expandedZones[groupKey] = false;
    const isExpanded = expandedZones[groupKey];
    const hasSubgroups = groupColumns.length > level + 1;

    // ── Group row ──
    const groupRow = el('tr', {
      class: `pivot-row pivot-level-${Math.min(level, 2)}${hasSubgroups ? ' expandable' : ''}`,
      dataset: { group: groupKey },
    });

    // Label cell — single column with indentation
    const labelCell = el('td', { class: 'pivot-label' });
    const indent = level * 20;
    let prefix = '';
    if (hasSubgroups) {
      prefix = `<i class="fas ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'} pivot-chevron"></i>`;
    } else if (level > 0) {
      prefix = '<span class="pivot-bullet">\u2022</span>';
    }
    labelCell.innerHTML = `<div class="pivot-label-inner" style="padding-left:${indent}px">${prefix}<span>${groupValue}</span></div>`;
    groupRow.appendChild(labelCell);

    // Value cells
    if (ui.showParameters) {
      const params = calculateGroupParameters(groupItems, groupColumns, units);
      for (const col of formattedHeaders) {
        groupRow.appendChild(el('td', {
          class: 'pivot-cell-value',
          textContent: formatParameterValue(col.key, params[col.key] || 0),
        }));
      }
    } else {
      for (const col of formattedHeaders) {
        const sum = groupItems.reduce((acc, row) => acc + (parseFloat(row[col.key]) || 0), 0);
        groupRow.appendChild(el('td', {
          class: 'pivot-cell-value',
          textContent: formatNumber(sum),
        }));
      }
    }

    // Apply stack/pill color — own color or inherited from parent, fainter per level
    let hue = null;
    if (mappings) {
      const col = groupColumns[level];
      const stacks = mappings[col] || [];
      const st = stacks.find(s => s.name === groupValue);
      const pillColors = mappings[`__colors_${col}`] || {};
      hue = st?.color || pillColors[groupValue] || parentHue || null;
    }
    if (hue) {
      const faintAmount = Math.min(0.82 + level * 0.05, 0.96);
      const bg = faintColor(hue, faintAmount);
      const bgHover = faintColor(hue, faintAmount - 0.06);
      const offset = level * 10;
      const grad = (bgc) => `linear-gradient(to right, transparent ${offset}px, ${hue} ${offset}px, ${hue} ${offset + 3}px, ${bgc} ${offset + 3}px)`;
      groupRow.style.borderLeft = 'none';
      groupRow.style.background = grad(bg);
      groupRow.addEventListener('mouseenter', () => { groupRow.style.background = grad(bgHover); });
      groupRow.addEventListener('mouseleave', () => { groupRow.style.background = grad(bg); });
    }

    container.appendChild(groupRow);

    // Toggle handler
    if (hasSubgroups) {
      groupRow.addEventListener('click', () => {
        toggleZoneExpanded(caseKey, groupKey);
        render();
      });
    }

    // Expanded content (no subtotal rows — the group row already shows the sum)
    if (isExpanded && hasSubgroups && groupData.subgroups) {
      renderGroups(container, groupData.subgroups, level + 1, groupColumns, displayColumns, formattedHeaders, units, allData, mappings, hue || parentHue);
    }

    if (isExpanded && !hasSubgroups) {
      renderDetailRows(container, groupItems, level, groupColumns, formattedHeaders, units);
    }
  }
}

function renderDetailRows(container, items, level, groupColumns, formattedHeaders, units) {
  const ui = getUI();
  let detailItems = items;

  if (ui.hideEmpty) {
    detailItems = items.filter(r => (parseFloat(r['Bulk volume']) || 0) > 0);
  }

  detailItems.forEach((row, idx) => {
    const detailRow = el('tr', { class: 'pivot-row pivot-level-2' });

    const labelCell = el('td', { class: 'pivot-label' });
    const indent = (level + 1) * 20;
    labelCell.innerHTML = `<div class="pivot-label-inner" style="padding-left:${indent}px"><span>Row ${idx + 1}</span></div>`;
    detailRow.appendChild(labelCell);

    if (ui.showParameters) {
      const params = calculateParameters(row, units);
      for (const col of formattedHeaders) {
        detailRow.appendChild(el('td', {
          class: 'pivot-cell-value',
          textContent: formatParameterValue(col.key, params[col.key] || 0),
        }));
      }
    } else {
      for (const col of formattedHeaders) {
        detailRow.appendChild(el('td', {
          class: 'pivot-cell-value',
          textContent: formatNumber(parseFloat(row[col.key]) || 0),
        }));
      }
    }

    container.appendChild(detailRow);
  });
}

function renderTotalRow(body, data, groupColumns, formattedHeaders, units) {
  const ui = getUI();
  const totalRow = el('tr', { class: 'pivot-total-row' });

  const labelCell = el('td', { class: 'pivot-label' });
  labelCell.innerHTML = '<div class="pivot-label-inner">Total</div>';
  totalRow.appendChild(labelCell);

  if (ui.showParameters) {
    const params = calculateGroupParameters(data, groupColumns, units);
    for (const col of formattedHeaders) {
      totalRow.appendChild(el('td', {
        class: 'pivot-cell-value',
        textContent: formatParameterValue(col.key, params[col.key] || 0),
      }));
    }
  } else {
    for (const col of formattedHeaders) {
      const sum = data.reduce((acc, row) => acc + (parseFloat(row[col.key]) || 0), 0);
      totalRow.appendChild(el('td', {
        class: 'pivot-cell-value',
        textContent: formatNumber(sum),
      }));
    }
  }

  body.appendChild(totalRow);
}

// ─── Event subscriptions ────────────────────────────────────

export function setupEvents() {
  // Watch data loading
  store.subscribe('data.volumetricData', (data) => {
    const ui = getUI();
    if (ui.compareCase) return;
    if (data) render();
    else { clear(document.getElementById('pivot-headers')); clear(document.getElementById('pivot-body')); }
  });

  // Watch UI toggles
  store.subscribe(
    s => [s.ui.showParameters, s.ui.hideEmpty, s.ui.compareCase],
    () => {
      const ui = getUI();
      if (ui.compareCase) return;
      const runtime = getRuntime();
      if (runtime.volumetricData) render();
    }
  );
}
