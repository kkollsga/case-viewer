// components/RevisionTimeline.js — Multi-line chart showing metric evolution across cases

import { getRuntime, getUI, getActiveField, getActiveCase } from '../core/state.js';
import { getCasesForField, getOrderedCaseNames } from '../core/storage.js';
import { on, EVENTS } from '../core/events.js';
import { formatNumber, formatDateShort } from '../utils/format.js';
import { PALETTES } from '../utils/color.js';
import { el, clear, $ } from '../utils/dom.js';

let containerEl = null;
let expanded = false;

export function init() {
  containerEl = document.getElementById('timeline-container');
}

export function render() {
  if (!containerEl || !expanded) return;
  clear(containerEl);

  const field = getActiveField();
  if (!field) {
    containerEl.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">No field selected</div>';
    return;
  }

  const caseNames = getOrderedCaseNames(field);
  if (caseNames.length < 2) {
    containerEl.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">Need at least 2 cases for timeline</div>';
    return;
  }

  const allCases = getCasesForField(field);
  const metric = getUI().metric || 'STOIIP';

  // Extract data: for each case, group by first volume group column, sum metric
  const zoneSet = new Set();
  const caseData = []; // { caseName, zones: { zoneName: value } }

  for (const caseName of caseNames) {
    const cd = allCases[caseName];
    if (!cd || !cd.data || cd.data.length === 0) continue;

    const groupCol = cd.volumeGroups?.columns?.[0];
    const zones = {};

    if (groupCol) {
      for (const row of cd.data) {
        const zone = row[groupCol] || 'Unspecified';
        zones[zone] = (zones[zone] || 0) + (parseFloat(row[metric]) || 0);
        zoneSet.add(zone);
      }
    } else {
      // No grouping — single total
      const total = cd.data.reduce((s, r) => s + (parseFloat(r[metric]) || 0), 0);
      zones['Total'] = total;
      zoneSet.add('Total');
    }

    caseData.push({ caseName, zones });
  }

  if (caseData.length < 2) {
    containerEl.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">Not enough data for timeline</div>';
    return;
  }

  const zoneNames = [...zoneSet];
  const colors = PALETTES.vibrant;

  // ── D3 line chart ──
  const margin = { top: 20, right: 20, bottom: 60, left: 70 };
  const width = containerEl.clientWidth - margin.left - margin.right;
  const height = 350 - margin.top - margin.bottom;

  const svg = d3.select(containerEl)
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Scales
  const xScale = d3.scalePoint()
    .domain(caseData.map(d => d.caseName))
    .range([0, width])
    .padding(0.3);

  const allValues = caseData.flatMap(d => Object.values(d.zones));
  const yMax = d3.max(allValues) || 1;

  const yScale = d3.scaleLinear()
    .domain([0, yMax * 1.1])
    .range([height, 0])
    .nice();

  // Grid
  g.append('g')
    .attr('class', 'grid')
    .call(d3.axisLeft(yScale).tickSize(-width).tickFormat(''))
    .selectAll('line')
    .attr('stroke', '#f3f4f6');

  g.selectAll('.grid .domain').remove();

  // Axes
  g.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(xScale))
    .selectAll('text')
    .attr('transform', 'rotate(-35)')
    .attr('text-anchor', 'end')
    .attr('font-size', '11px')
    .attr('fill', '#6b7280');

  g.append('g')
    .call(d3.axisLeft(yScale).ticks(6))
    .selectAll('text')
    .attr('font-size', '11px')
    .attr('fill', '#6b7280');

  // Y-axis label
  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('y', -margin.left + 15)
    .attr('x', -height / 2)
    .attr('text-anchor', 'middle')
    .attr('font-size', '11px')
    .attr('fill', '#9ca3af')
    .text(metric);

  // Lines and points
  const line = d3.line()
    .defined(d => d.value !== undefined && d.value !== null)
    .x(d => xScale(d.caseName))
    .y(d => yScale(d.value));

  for (let zi = 0; zi < zoneNames.length; zi++) {
    const zone = zoneNames[zi];
    const color = colors[zi % colors.length];

    const lineData = caseData.map(d => ({
      caseName: d.caseName,
      value: d.zones[zone] !== undefined ? d.zones[zone] : null,
    })).filter(d => d.value !== null);

    if (lineData.length < 1) continue;

    // Line
    g.append('path')
      .datum(lineData)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('d', line);

    // Points
    g.selectAll(`.point-${zi}`)
      .data(lineData)
      .enter()
      .append('circle')
      .attr('cx', d => xScale(d.caseName))
      .attr('cy', d => yScale(d.value))
      .attr('r', 4)
      .attr('fill', color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5);
  }

  // ── Vertical crosshair on hover ──
  const crosshairLine = g.append('line')
    .attr('stroke', '#d1d5db')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4,4')
    .attr('y1', 0)
    .attr('y2', height)
    .style('opacity', 0);

  const tooltip = d3.select(containerEl)
    .append('div')
    .attr('class', 'absolute bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm pointer-events-none')
    .style('opacity', 0)
    .style('z-index', 100);

  // Invisible overlay for hover detection
  const overlay = g.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', 'none')
    .attr('pointer-events', 'all');

  overlay.on('mousemove', function (event) {
    const [mx] = d3.pointer(event);
    // Find nearest case
    const domain = xScale.domain();
    let nearest = domain[0];
    let minDist = Infinity;
    for (const name of domain) {
      const dist = Math.abs(xScale(name) - mx);
      if (dist < minDist) {
        minDist = dist;
        nearest = name;
      }
    }

    const x = xScale(nearest);
    crosshairLine.attr('x1', x).attr('x2', x).style('opacity', 1);

    const cd = caseData.find(d => d.caseName === nearest);
    if (!cd) return;

    let html = `<div class="font-semibold mb-1">${nearest}</div>`;
    for (let zi = 0; zi < zoneNames.length; zi++) {
      const zone = zoneNames[zi];
      const val = cd.zones[zone];
      if (val === undefined) continue;
      const color = colors[zi % colors.length];
      html += `<div class="flex items-center gap-2"><span style="background:${color};width:10px;height:10px;border-radius:50%;display:inline-block"></span>${zone}: <strong>${formatNumber(val)}</strong></div>`;
    }

    tooltip.html(html)
      .style('opacity', 1)
      .style('left', `${x + margin.left + 15}px`)
      .style('top', `${margin.top + 10}px`);
  });

  overlay.on('mouseleave', function () {
    crosshairLine.style('opacity', 0);
    tooltip.style('opacity', 0);
  });

  // ── Legend ──
  const legend = el('div', { class: 'flex flex-wrap gap-4 mt-3 px-2' });
  for (let zi = 0; zi < zoneNames.length; zi++) {
    const color = colors[zi % colors.length];
    const item = el('div', { class: 'flex items-center gap-1.5 text-sm text-gray-600' });
    item.innerHTML = `<span style="background:${color};width:12px;height:3px;border-radius:2px;display:inline-block"></span>${zoneNames[zi]}`;
    legend.appendChild(item);
  }
  containerEl.appendChild(legend);
}

// ─── Toggle ─────────────────────────────────────────────────

function toggleCollapse() {
  const outerContainer = document.getElementById('timeline-outer-container');
  const toggleBtn = document.getElementById('toggle-timeline');
  if (!outerContainer || !toggleBtn) return;

  const icon = toggleBtn.querySelector('i');
  expanded = !expanded;

  if (expanded) {
    outerContainer.classList.remove('hidden');
    if (icon) { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-up'); }
    render();
  } else {
    outerContainer.classList.add('hidden');
    if (icon) { icon.classList.remove('fa-chevron-up'); icon.classList.add('fa-chevron-down'); }
  }
}

// ─── Events ─────────────────────────────────────────────────

export function setupEvents() {
  const toggleBtn = document.getElementById('toggle-timeline');
  if (toggleBtn) toggleBtn.addEventListener('click', toggleCollapse);

  const rerender = () => { if (expanded) render(); };

  on(EVENTS.DATA_LOADED, rerender);
  on(EVENTS.METRIC_CHANGED, rerender);
  on(EVENTS.CASE_CREATED, rerender);
  on(EVENTS.CASE_DELETED, rerender);
  on(EVENTS.CASE_UPDATED, rerender);
  on(EVENTS.FIELD_CHANGED, () => { expanded = false; });
  on(EVENTS.DATA_CLEARED, () => { if (containerEl) clear(containerEl); });

  window.addEventListener('resize', () => { if (expanded) render(); });
}
