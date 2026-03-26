// components/DriverChart.js — Informal tornado chart: Δ ranked by absolute value
// Shows which zone/segment is driving the volume change between two cases.

import { getRuntime, getUI, getActiveField, getActiveCase } from '../core/state.js';
import { getCaseData } from '../core/storage.js';
import { on, EVENTS } from '../core/events.js';
import { formatNumber } from '../utils/format.js';
import { PALETTES } from '../utils/color.js';
import { el, clear, $ } from '../utils/dom.js';

let containerEl = null;

export function init() {
  containerEl = document.getElementById('driver-chart-container');
}

export function render() {
  if (!containerEl) return;
  clear(containerEl);

  const ui = getUI();
  const runtime = getRuntime();
  const field = getActiveField();
  const activeCase = getActiveCase();
  const compareCaseName = ui.compareCase;

  if (!compareCaseName || !activeCase || !field) {
    containerEl.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">Select a compare case to see driver analysis</div>';
    return;
  }

  const activeData = runtime.volumetricData;
  const compareData = getCaseData(field, compareCaseName);

  if (!activeData?.data || !compareData?.data) {
    containerEl.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">No data available for comparison</div>';
    return;
  }

  const groupColumns = activeData.volumeGroups?.columns || [];
  const metric = ui.metric || 'STOIIP';
  const units = activeData.units || {};

  // Apply value conversions to compare data
  let compareRows = compareData.data;
  if (compareData.valueConversions) {
    compareRows = applyConversions(compareRows, compareData.valueConversions);
  }

  // Build group maps
  const activeMap = buildGroupMap(activeData.data, groupColumns);
  const compareMap = buildGroupMap(compareRows, groupColumns);
  const allKeys = new Set([...activeMap.keys(), ...compareMap.keys()]);

  // Calculate deltas
  const bars = [];
  for (const key of allKeys) {
    const activeRows = activeMap.get(key) || [];
    const compareRowsForKey = compareMap.get(key) || [];

    const activeSum = activeRows.reduce((s, r) => s + (parseFloat(r[metric]) || 0), 0);
    const compareSum = compareRowsForKey.reduce((s, r) => s + (parseFloat(r[metric]) || 0), 0);
    const delta = activeSum - compareSum;
    const deltaPercent = compareSum !== 0 ? (delta / Math.abs(compareSum)) * 100 : (activeSum !== 0 ? Infinity : 0);

    if (Math.abs(delta) < 0.001 && activeSum === 0 && compareSum === 0) continue;

    bars.push({ key, delta, deltaPercent, absDelta: Math.abs(delta) });
  }

  if (bars.length === 0) {
    containerEl.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">No differences found for the selected metric</div>';
    return;
  }

  // Sort by |Δ| descending
  bars.sort((a, b) => b.absDelta - a.absDelta);

  // ── Controls bar ──
  const controls = el('div', { class: 'flex items-center gap-4 mb-4' });

  const title = el('h3', { class: 'text-sm font-semibold text-gray-700' });
  title.textContent = `${metric} change: ${activeCase} vs ${compareCaseName}`;
  controls.appendChild(title);

  const unitLabel = el('span', { class: 'text-xs text-gray-400' });
  unitLabel.textContent = units[metric] || '';
  controls.appendChild(unitLabel);

  containerEl.appendChild(controls);

  // ── D3 horizontal bar chart ──
  const margin = { top: 10, right: 80, bottom: 30, left: 160 };
  const width = containerEl.clientWidth - margin.left - margin.right;
  const barHeight = 28;
  const height = bars.length * barHeight + margin.top + margin.bottom;

  const maxAbs = d3.max(bars, d => d.absDelta) || 1;

  const xScale = d3.scaleLinear()
    .domain([-maxAbs, maxAbs])
    .range([0, width])
    .nice();

  const yScale = d3.scaleBand()
    .domain(bars.map(d => d.key))
    .range([margin.top, height - margin.bottom])
    .padding(0.2);

  const svg = d3.select(containerEl)
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},0)`);

  // Centre line
  g.append('line')
    .attr('x1', xScale(0))
    .attr('x2', xScale(0))
    .attr('y1', margin.top)
    .attr('y2', height - margin.bottom)
    .attr('stroke', '#9ca3af')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3,3');

  // Grid lines
  const ticks = xScale.ticks(5);
  g.selectAll('.grid-line')
    .data(ticks)
    .enter()
    .append('line')
    .attr('x1', d => xScale(d))
    .attr('x2', d => xScale(d))
    .attr('y1', margin.top)
    .attr('y2', height - margin.bottom)
    .attr('stroke', '#f3f4f6')
    .attr('stroke-width', 1);

  // Bars
  g.selectAll('.bar')
    .data(bars)
    .enter()
    .append('rect')
    .attr('x', d => d.delta >= 0 ? xScale(0) : xScale(d.delta))
    .attr('y', d => yScale(d.key))
    .attr('width', d => Math.abs(xScale(d.delta) - xScale(0)))
    .attr('height', yScale.bandwidth())
    .attr('rx', 3)
    .attr('fill', d => d.delta >= 0 ? '#10b981' : '#ef4444')
    .attr('opacity', 0.8);

  // Bar labels (delta value)
  g.selectAll('.bar-label')
    .data(bars)
    .enter()
    .append('text')
    .attr('x', d => d.delta >= 0 ? xScale(d.delta) + 4 : xScale(d.delta) - 4)
    .attr('y', d => yScale(d.key) + yScale.bandwidth() / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', d => d.delta >= 0 ? 'start' : 'end')
    .attr('font-size', '11px')
    .attr('fill', '#374151')
    .text(d => {
      const prefix = d.delta > 0 ? '+' : '';
      const pct = d.deltaPercent === Infinity ? '' : ` (${d.deltaPercent > 0 ? '+' : ''}${d.deltaPercent.toFixed(1)}%)`;
      return `${prefix}${formatNumber(d.delta)}${pct}`;
    });

  // Y-axis labels (group names)
  g.selectAll('.y-label')
    .data(bars)
    .enter()
    .append('text')
    .attr('x', -8)
    .attr('y', d => yScale(d.key) + yScale.bandwidth() / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'end')
    .attr('font-size', '12px')
    .attr('fill', '#374151')
    .text(d => d.key.length > 22 ? d.key.substring(0, 20) + '…' : d.key);

  // X-axis
  g.append('g')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat(d => {
      if (Math.abs(d) >= 1000) return `${(d / 1000).toFixed(0)}k`;
      return d.toFixed(1);
    }))
    .selectAll('text')
    .attr('font-size', '10px')
    .attr('fill', '#6b7280');

  // ── Summary bar below chart ──
  const totalDelta = bars.reduce((s, b) => s + b.delta, 0);
  const summary = el('div', { class: 'flex items-center gap-4 mt-3 text-sm' });

  const totalColor = totalDelta > 0 ? 'text-green-600' : totalDelta < 0 ? 'text-red-600' : 'text-gray-500';
  summary.innerHTML = `
    <span class="font-medium text-gray-600">Total Δ ${metric}:</span>
    <span class="${totalColor} font-semibold">${totalDelta > 0 ? '+' : ''}${formatNumber(totalDelta)} ${units[metric] || ''}</span>
    <span class="text-gray-400">|</span>
    <span class="text-gray-500">Top driver: <strong>${bars[0].key}</strong> (${bars[0].delta > 0 ? '+' : ''}${formatNumber(bars[0].delta)})</span>
  `;
  containerEl.appendChild(summary);
}

// ─── Helpers ────────────────────────────────────────────────

function buildGroupMap(rows, groupColumns) {
  const map = new Map();
  if (!rows || !groupColumns || groupColumns.length === 0) {
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
  on(EVENTS.METRIC_CHANGED, () => render());
  on(EVENTS.DATA_LOADED, () => render());
  on(EVENTS.DATA_CLEARED, () => { if (containerEl) clear(containerEl); });
}
