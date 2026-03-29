// components/RevisionTimeline.js — D3 multi-line chart showing metric evolution across cases
// X axis = case index (ordered), Y axis = selected metric, one line per zone.

import { getRuntime, getUI, getActiveField, getActiveCase, store } from '../core/state.js';
import { getCasesForField, getOrderedCaseNames, computeColumnColors } from '../core/storage.js';
// events.js no longer needed — using store.subscribe
import { formatNumber, formatDateShort } from '../utils/format.js';
import { PALETTES } from '../utils/color.js';
import { el, clear, $ } from '../utils/dom.js';

// ─── Constants ──────────────────────────────────────────────

const MARGIN = { top: 20, right: 20, bottom: 60, left: 60 };
const HEIGHT = 350;
const POINT_RADIUS = 4;

// ─── Module state ───────────────────────────────────────────

let expanded = false;
let tooltip = null;

// ─── Tooltip management ─────────────────────────────────────

function ensureTooltip() {
  if (tooltip) return tooltip;

  if (window.sharedVisualizationTooltip) {
    tooltip = window.sharedVisualizationTooltip;
    return tooltip;
  }

  d3.selectAll('.timeline-tooltip').remove();
  tooltip = d3.select('body')
    .append('div')
    .attr('class', 'legend-shared-tooltip timeline-tooltip')
    .style('opacity', 0)
    .style('pointer-events', 'none');
  return tooltip;
}

// ─── Data extraction ────────────────────────────────────────

/**
 * Build the dataset for the timeline chart.
 * Returns { caseNames, zones, series } where:
 *   caseNames = ordered array of case names (X positions)
 *   zones     = sorted unique zone names
 *   series    = Map<zoneName, Array<{ caseIndex, caseName, value } | null>>
 *               Each array has one entry per case; null if zone is absent.
 */
function extractTimelineData() {
  const field = getActiveField();
  if (!field) return null;

  const caseNames = getOrderedCaseNames(field);
  if (caseNames.length === 0) return null;

  const cases = getCasesForField(field);
  const ui = getUI();
  const metric = ui.metric || 'STOIIP';

  // Collect all zone names across every case and build per-case aggregates
  const allZones = new Set();
  const caseAggregates = []; // array parallel to caseNames

  for (const caseName of caseNames) {
    const caseData = cases[caseName];
    if (!caseData?.data || !Array.isArray(caseData.data) || caseData.data.length === 0) {
      caseAggregates.push(null);
      continue;
    }

    const groupColumns = caseData.volumeGroups?.columns || [];
    const groupCol = groupColumns[0];

    if (!groupCol) {
      // No grouping column — aggregate entire case as a single "Total" zone
      const total = caseData.data.reduce((s, r) => s + (parseFloat(r[metric]) || 0), 0);
      const groupMap = new Map();
      groupMap.set('Total', total);
      allZones.add('Total');
      caseAggregates.push(groupMap);
      continue;
    }

    // Group rows by the first grouping column and sum the metric
    const groupMap = new Map();
    for (const row of caseData.data) {
      if (!row) continue;
      const zoneName = row[groupCol] || 'Unspecified';
      const value = parseFloat(row[metric]) || 0;
      groupMap.set(zoneName, (groupMap.get(zoneName) || 0) + value);
      allZones.add(zoneName);
    }

    caseAggregates.push(groupMap);
  }

  if (allZones.size === 0) return null;

  const zones = [...allZones].sort();

  // Build series: one array per zone, one entry per case
  const series = new Map();
  for (const zone of zones) {
    const points = [];
    for (let i = 0; i < caseNames.length; i++) {
      const agg = caseAggregates[i];
      if (!agg || !agg.has(zone)) {
        points.push(null);
      } else {
        points.push({
          caseIndex: i,
          caseName: caseNames[i],
          value: agg.get(zone),
        });
      }
    }
    series.set(zone, points);
  }

  return { caseNames, zones, series };
}

// ─── Colour helper ──────────────────────────────────────────

// Cached color map for the current render
let _timelineColorMap = {};

function getZoneColor(zoneName, index) {
  return _timelineColorMap[zoneName] || PALETTES.vibrant[index % PALETTES.vibrant.length];
}

// ─── Main render ────────────────────────────────────────────

export function render() {
  const container = document.getElementById('timeline-container');
  const outerContainer = document.getElementById('timeline-outer-container');
  if (!container || !outerContainer || outerContainer.classList.contains('hidden')) return;

  clear(container);

  // Build zone color map from group settings
  const field = getActiveField();
  const runtime = getRuntime();
  const groupCol = runtime.volumetricData?.volumeGroups?.columns?.[0];
  _timelineColorMap = (field && groupCol) ? computeColumnColors(field, groupCol) : {};

  const data = extractTimelineData();
  if (!data) {
    container.innerHTML = '<div class="flex items-center justify-center h-48 text-gray-500 text-sm">No case data available for timeline</div>';
    return;
  }

  const { caseNames, zones, series } = data;
  const ui = getUI();
  const metric = ui.metric || 'STOIIP';

  // ── Dimensions ──
  const width = container.clientWidth || 800;
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  // ── Scales ──
  const xScale = d3.scalePoint()
    .domain(caseNames)
    .range([0, innerWidth])
    .padding(0.5);

  // Compute Y extent across all series
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const points of series.values()) {
    for (const pt of points) {
      if (pt === null) continue;
      if (pt.value < yMin) yMin = pt.value;
      if (pt.value > yMax) yMax = pt.value;
    }
  }
  if (!isFinite(yMin)) { yMin = 0; yMax = 1; }
  const yPad = (yMax - yMin) * 0.08 || 1;

  const yScale = d3.scaleLinear()
    .domain([Math.min(0, yMin - yPad), yMax + yPad])
    .range([innerHeight, 0])
    .nice();

  // ── SVG ──
  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', HEIGHT)
    .attr('viewBox', [0, 0, width, HEIGHT]);

  const g = svg.append('g')
    .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

  // ── Grid lines (Y axis) ──
  g.append('g')
    .attr('class', 'grid')
    .attr('opacity', 0.15)
    .call(d3.axisLeft(yScale).tickSize(-innerWidth).tickFormat(''))
    .call(sel => sel.select('.domain').remove())
    .selectAll('line')
    .attr('stroke', '#9ca3af');

  // ── Axes ──
  // X axis with rotated labels
  const xAxis = g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale));

  xAxis.selectAll('text')
    .attr('text-anchor', 'end')
    .attr('dx', '-0.6em')
    .attr('dy', '0.25em')
    .attr('transform', 'rotate(-45)')
    .attr('font-size', '11px');

  // Y axis
  g.append('g')
    .call(d3.axisLeft(yScale).ticks(6).tickFormat(d => {
      if (Math.abs(d) >= 1e6) return `${(d / 1e6).toFixed(1)}M`;
      if (Math.abs(d) >= 1e3) return `${(d / 1e3).toFixed(1)}k`;
      return d.toFixed(1);
    }));

  // Y axis label
  svg.append('text')
    .attr('text-anchor', 'middle')
    .attr('transform', `translate(${14},${MARGIN.top + innerHeight / 2}) rotate(-90)`)
    .attr('font-size', '12px')
    .attr('fill', '#374151')
    .text(metric);

  // ── D3 line generator ──
  const lineGen = d3.line()
    .defined(d => d !== null)
    .x(d => xScale(d.caseName))
    .y(d => yScale(d.value))
    .curve(d3.curveMonotoneX);

  // ── Lines + points per zone ──
  zones.forEach((zone, zIdx) => {
    const color = getZoneColor(zone, zIdx);
    const points = series.get(zone);

    // Draw line (skip null gaps naturally via .defined())
    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('d', lineGen);

    // Draw circles for non-null points
    g.selectAll(`.point-${zIdx}`)
      .data(points.filter(p => p !== null))
      .join('circle')
      .attr('cx', d => xScale(d.caseName))
      .attr('cy', d => yScale(d.value))
      .attr('r', POINT_RADIUS)
      .attr('fill', color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .attr('class', 'timeline-point')
      .attr('data-zone', zone)
      .attr('data-case', d => d.caseName);
  });

  // ── Crosshair + hover overlay ──
  const crosshairLine = g.append('line')
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .attr('stroke', '#6b7280')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4,3')
    .attr('opacity', 0);

  const tip = ensureTooltip();

  // Invisible overlay for mouse tracking
  g.append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'none')
    .attr('pointer-events', 'all')
    .on('mousemove', function (event) {
      const [mx] = d3.pointer(event, this);

      // Find the closest case index
      let closestCase = null;
      let closestDist = Infinity;
      for (const name of caseNames) {
        const cx = xScale(name);
        const dist = Math.abs(mx - cx);
        if (dist < closestDist) {
          closestDist = dist;
          closestCase = name;
        }
      }

      if (!closestCase || closestDist > xScale.step() * 0.6) {
        crosshairLine.attr('opacity', 0);
        tip.transition().duration(100).style('opacity', 0);
        g.selectAll('.timeline-point')
          .attr('r', POINT_RADIUS);
        return;
      }

      const cx = xScale(closestCase);
      crosshairLine
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('opacity', 0.6);

      // Highlight points at this case
      g.selectAll('.timeline-point')
        .attr('r', d => d.caseName === closestCase ? POINT_RADIUS + 2 : POINT_RADIUS);

      // Build tooltip content
      const caseIdx = caseNames.indexOf(closestCase);
      let html = `<div class="font-semibold border-b border-gray-200 pb-1 mb-1">${closestCase}</div>`;

      zones.forEach((zone, zIdx) => {
        const pt = series.get(zone)[caseIdx];
        if (!pt) return;
        const color = getZoneColor(zone, zIdx);
        html += `<div class="flex items-center gap-2 py-0.5">`;
        html += `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></span>`;
        html += `<span class="text-gray-700">${zone}:</span>`;
        html += `<strong>${formatNumber(pt.value)}</strong>`;
        html += `</div>`;
      });

      tip.html(html);
      tip.transition().duration(100).style('opacity', 0.95);

      // Position tooltip near cursor, clamped to viewport
      const pageX = event.pageX;
      const pageY = event.pageY;
      const tipNode = tip.node();
      const tipWidth = tipNode.offsetWidth || 180;
      const tipHeight = tipNode.offsetHeight || 100;
      const maxX = window.innerWidth - tipWidth - 16;
      const maxY = window.innerHeight - tipHeight - 16;

      tip
        .style('left', `${Math.min(pageX + 14, maxX)}px`)
        .style('top', `${Math.min(pageY - 28, maxY + window.scrollY)}px`);
    })
    .on('mouseleave', function () {
      crosshairLine.attr('opacity', 0);
      tip.transition().duration(200).style('opacity', 0);
      g.selectAll('.timeline-point')
        .attr('r', POINT_RADIUS);
    });

  // ── Legend ──
  buildLegend(container, zones);
}

// ─── Legend ──────────────────────────────────────────────────

function buildLegend(container, zones) {
  const legend = el('div', {
    class: 'flex flex-wrap gap-x-5 gap-y-1 mt-2 px-2',
  });

  zones.forEach((zone, idx) => {
    const color = getZoneColor(zone, idx);

    const item = el('div', { class: 'flex items-center gap-1.5' });

    // Small coloured line + dot to mimic the chart line style
    const swatch = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    swatch.setAttribute('width', '22');
    swatch.setAttribute('height', '12');
    swatch.setAttribute('viewBox', '0 0 22 12');
    swatch.style.flexShrink = '0';

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '6');
    line.setAttribute('x2', '22');
    line.setAttribute('y2', '6');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');
    swatch.appendChild(line);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '11');
    circle.setAttribute('cy', '6');
    circle.setAttribute('r', '3');
    circle.setAttribute('fill', color);
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '1');
    swatch.appendChild(circle);

    item.appendChild(swatch);

    const label = el('span', {
      class: 'text-xs text-gray-700',
      textContent: zone,
    });
    item.appendChild(label);
    legend.appendChild(item);
  });

  container.appendChild(legend);
}

// ─── Collapse / expand toggle ───────────────────────────────

function toggleCollapse() {
  const outerContainer = document.getElementById('timeline-outer-container');
  const toggleBtn = document.getElementById('toggle-timeline');
  if (!outerContainer || !toggleBtn) return;

  const icon = toggleBtn.querySelector('i');
  expanded = !expanded;

  if (expanded) {
    outerContainer.classList.remove('hidden');
    if (icon) {
      icon.classList.remove('fa-chevron-down');
      icon.classList.add('fa-chevron-up');
    }
    render();
  } else {
    outerContainer.classList.add('hidden');
    if (icon) {
      icon.classList.remove('fa-chevron-up');
      icon.classList.add('fa-chevron-down');
    }
  }
}

// ─── Public API ─────────────────────────────────────────────

export function init() {
  // Nothing to restore on init; the chart renders on expand.
}

export function setupEvents() {
  // Toggle button
  const toggleBtn = document.getElementById('toggle-timeline');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleCollapse);
  }

  // Re-render on data/metric/field changes (only if expanded)
  store.subscribe(
    s => [s.data.volumetricData, s.ui.metric, s.activeField],
    ([data, , field]) => {
      if (!data) { const c = document.getElementById('timeline-container'); if (c) clear(c); return; }
      if (expanded) render();
    }
  );

  // Collapse on field change
  store.subscribe('activeField', () => {
    expanded = false;
    const outerContainer = document.getElementById('timeline-outer-container');
    const toggleBtnEl = document.getElementById('toggle-timeline');
    if (outerContainer) outerContainer.classList.add('collapsed');
    if (toggleBtnEl) toggleBtnEl.dataset.expanded = 'false';
  });

  // Responsive resize with debounce
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (expanded) render();
    }, 250);
  });
}
