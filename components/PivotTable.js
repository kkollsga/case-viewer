// components/PivotTable.js — Zone/segment hierarchy table (core view)

import { getState, getRuntime, getActiveField, getActiveCase, getUI, getExpandedZones, toggleZoneExpanded, store } from '../core/state.js';
import { getGroupValueOrder, getGroupTypeOrder } from '../core/storage.js';
import { formatNumber } from '../utils/format.js';
import { calculateParameters, PARAMETER_COLUMNS, getParameterUnits, formatParameterValue, calculateGroupParameters } from '../utils/parameters.js';
import { el, clear } from '../utils/dom.js';

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

  // Toggle column
  headerRow.appendChild(el('th', { class: 'w-6 px-2 py-1' }));

  // Group column headers (empty, but reserve space)
  for (let i = 0; i < groupColumns.length; i++) {
    headerRow.appendChild(el('th', { class: 'px-2 py-1 min-w-[150px]' }));
  }

  // Numeric headers
  for (const col of formattedHeaders) {
    const th = el('th', { class: 'w-32 px-2 py-2 text-right font-semibold text-gray-600', style: { fontSize: '11px' } });
    th.innerHTML = `<div>${col.label}</div>${col.unit ? `<div class="text-[10px] text-gray-400 leading-tight">${col.unit}</div>` : ''}`;
    headerRow.appendChild(th);
  }
  headerContainer.appendChild(headerRow);

  // ── Nested data ──
  const nestedData = createMultiLevelGroups(data, groupColumns);
  renderGroups(body, nestedData, 0, groupColumns, displayColumns, formattedHeaders, units, data);

  // ── Total row ──
  renderTotalRow(body, data, groupColumns, formattedHeaders, units);

  // ── Legend ──
  if (legendContainer && groupColumns.length > 0) {
    const legendText = el('span', { textContent: 'Grouping: ' });
    legendContainer.appendChild(legendText);
    groupColumns.forEach((col, i) => {
      const item = el('span', { class: 'pivot-legend-item' });
      item.appendChild(el('span', { class: 'pivot-legend-label', textContent: `Level ${i + 1}` }));
      item.appendChild(el('span', { textContent: ` = ${col}` }));
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

function renderGroups(container, nestedData, level, groupColumns, displayColumns, formattedHeaders, units, allData) {
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

    // ── Group summary row ──
    const groupRow = el('tr', {
      class: `pivot-row-toggle hover:bg-gray-50 ${isExpanded ? 'font-medium text-gray-800' : 'text-gray-700'}`,
      dataset: { group: groupKey },
      style: { fontSize: '13px' },
    });

    // Toggle cell
    const toggleCell = el('td', { class: 'w-6 px-2 py-1' });
    if (hasSubgroups) {
      toggleCell.innerHTML = `<i class="fas ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'} text-gray-500"></i>`;
    }
    groupRow.appendChild(toggleCell);

    // Label cell
    const labelCell = el('td', {
      class: 'px-2 py-1 text-gray-800 font-medium min-w-[150px]',
      colSpan: Math.max(1, groupColumns.length),
    });
    const indent = level * 16;
    labelCell.innerHTML = `<div style="padding-left: ${indent}px">${groupValue}</div>`;
    groupRow.appendChild(labelCell);

    // Value cells
    if (ui.showParameters) {
      const params = calculateGroupParameters(groupItems, groupColumns, units);
      for (const col of formattedHeaders) {
        groupRow.appendChild(el('td', {
          class: 'px-2 py-1 text-right text-gray-700',
          textContent: formatParameterValue(col.key, params[col.key] || 0),
        }));
      }
    } else {
      for (const col of formattedHeaders) {
        const sum = groupItems.reduce((acc, row) => acc + (parseFloat(row[col.key]) || 0), 0);
        groupRow.appendChild(el('td', {
          class: 'px-2 py-1 text-right text-gray-700',
          textContent: formatNumber(sum),
        }));
      }
    }

    container.appendChild(groupRow);

    // Toggle handler
    if (hasSubgroups) {
      groupRow.addEventListener('click', () => {
        toggleZoneExpanded(caseKey, groupKey);
        render();
      });
    }

    // Expanded content
    if (isExpanded && hasSubgroups && groupData.subgroups) {
      renderGroups(container, groupData.subgroups, level + 1, groupColumns, displayColumns, formattedHeaders, units, allData);

      // Subtotal row at bottom of expanded group
      renderSubtotalRow(container, groupItems, level, groupColumns, formattedHeaders, units, groupValue);
    }

    if (isExpanded && !hasSubgroups) {
      renderDetailRows(container, groupItems, level, groupColumns, formattedHeaders, units);

      // Subtotal row at bottom of detail rows
      renderSubtotalRow(container, groupItems, level, groupColumns, formattedHeaders, units, groupValue);
    }
  }
}

function renderSubtotalRow(container, items, level, groupColumns, formattedHeaders, units, groupName) {
  const ui = getUI();
  const subtotalRow = el('tr', {
    style: { fontSize: '12px' },
    class: 'border-t border-gray-200',
  });

  // Spacer
  const spacer = el('td', { class: 'w-6' });
  spacer.style.cssText = 'background:linear-gradient(to right, #e5e7eb 0%, transparent 100%); height:1px; padding:0;';
  subtotalRow.appendChild(spacer);

  // Label
  const labelCell = el('td', {
    class: 'px-2 py-1.5 text-gray-400 italic min-w-[150px]',
    colSpan: Math.max(1, groupColumns.length),
  });
  const indent = (level + 1) * 16;
  labelCell.innerHTML = `<div style="padding-left: ${indent}px">sum</div>`;
  subtotalRow.appendChild(labelCell);

  // Values
  if (ui.showParameters) {
    const params = calculateGroupParameters(items, groupColumns, units);
    for (const col of formattedHeaders) {
      subtotalRow.appendChild(el('td', {
        class: 'px-2 py-1.5 text-right text-gray-400',
        textContent: formatParameterValue(col.key, params[col.key] || 0),
      }));
    }
  } else {
    for (const col of formattedHeaders) {
      const sum = items.reduce((acc, row) => acc + (parseFloat(row[col.key]) || 0), 0);
      subtotalRow.appendChild(el('td', {
        class: 'px-2 py-1.5 text-right text-gray-400',
        textContent: formatNumber(sum),
      }));
    }
  }

  container.appendChild(subtotalRow);
}

function renderDetailRows(container, items, level, groupColumns, formattedHeaders, units) {
  const ui = getUI();
  let detailItems = items;

  if (ui.hideEmpty) {
    detailItems = items.filter(r => (parseFloat(r['Bulk volume']) || 0) > 0);
  }

  detailItems.forEach((row, idx) => {
    const detailRow = el('tr', {
      class: 'pivot-detail-row',
      style: { fontSize: '12px' },
    });

    // Spacer
    detailRow.appendChild(el('td', { class: 'w-6' }));

    // Label — show the next grouping level value if available
    const labelCell = el('td', {
      class: 'px-2 py-1 text-gray-500 min-w-[150px]',
      colSpan: Math.max(1, groupColumns.length),
    });
    const indent = (level + 1) * 16;
    labelCell.innerHTML = `<div style="padding-left: ${indent}px">Row ${idx + 1}</div>`;
    detailRow.appendChild(labelCell);

    // Values
    if (ui.showParameters) {
      const params = calculateParameters(row, units);
      for (const col of formattedHeaders) {
        detailRow.appendChild(el('td', {
          class: 'px-2 py-1 text-right text-gray-800',
          textContent: formatParameterValue(col.key, params[col.key] || 0),
        }));
      }
    } else {
      for (const col of formattedHeaders) {
        detailRow.appendChild(el('td', {
          class: 'px-2 py-1 text-right text-gray-800',
          textContent: formatNumber(parseFloat(row[col.key]) || 0),
        }));
      }
    }

    container.appendChild(detailRow);
  });
}

function renderTotalRow(body, data, groupColumns, formattedHeaders, units) {
  const ui = getUI();
  const totalRow = el('tr', { class: 'pivot-total-row', style: { fontSize: '13px' } });

  totalRow.appendChild(el('td', { class: 'w-6 px-2 py-1' }));

  const labelCell = el('td', {
    class: 'px-2 py-1 text-left font-medium min-w-[150px]',
    colSpan: Math.max(1, groupColumns.length),
    textContent: 'Total',
  });
  totalRow.appendChild(labelCell);

  if (ui.showParameters) {
    const params = calculateGroupParameters(data, groupColumns, units);
    for (const col of formattedHeaders) {
      totalRow.appendChild(el('td', {
        class: 'px-2 py-1 text-right',
        textContent: formatParameterValue(col.key, params[col.key] || 0),
      }));
    }
  } else {
    for (const col of formattedHeaders) {
      const sum = data.reduce((acc, row) => acc + (parseFloat(row[col.key]) || 0), 0);
      totalRow.appendChild(el('td', {
        class: 'px-2 py-1 text-right',
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
