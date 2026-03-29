// components/CrossPlot.js — D3 scatter plot for multi-case cross-plotting
// Shows ALL cases for the current field, grouped by a selectable hierarchy level.

import {
  getRuntime, getUI, getActiveField, getActiveCase,
  setCrossPlotAxes, setCrossPlotGroupLevel, store,
} from '../core/state.js';
import {
  getCasesForField, saveCrossPlotSettings, loadCrossPlotSettings, saveFieldSettings,
  computeColumnColors,
} from '../core/storage.js';
// events.js no longer needed — using store.subscribe
import { formatNumber, formatPercent, formatMetricName } from '../utils/format.js';
import { getColorForCase, PALETTES } from '../utils/color.js';

// ─── Constants ──────────────────────────────────────────────

const MARGIN = { top: 20, right: 20, bottom: 50, left: 60 };
const HEIGHT = 500;

const VOLUME_METRICS = [
  'bulkVolume', 'netVolume', 'poreVolume', 'hcpvOil', 'hcpvGas', 'stoiip', 'giip',
];
const PARAMETER_METRICS = [
  'ntg', 'porosity', 'soOil', 'sgGas', 'boOil', 'bgGas',
];
const ALL_METRICS = [...VOLUME_METRICS, ...PARAMETER_METRICS];

const SYMBOL_TYPES = [
  d3.symbolCircle,
  d3.symbolSquare,
  d3.symbolTriangle,
  d3.symbolDiamond,
  d3.symbolStar,
  d3.symbolWye,
  d3.symbolCross,
];

// ─── Module state ───────────────────────────────────────────

let expanded = false;
let tooltip = null;

// Visibility state: { groups: { name: bool }, cases: { name: bool } }
function getVisibility() {
  return getRuntime().crossPlotVisibility;
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Determine whether a metric is a ratio/parameter (displayed as percent in tooltip).
 */
function isParameterMetric(metric) {
  return PARAMETER_METRICS.includes(metric);
}

/**
 * Format a metric value contextually (percent for ratios, number otherwise).
 */
function formatMetricValue(metric, value) {
  if (['ntg', 'porosity', 'soOil', 'sgGas'].includes(metric)) return formatPercent(value);
  return formatNumber(value);
}

/**
 * Collect grouping-level metadata across all cases for the active field.
 * Returns { maxLevels, columnsByLevel: { 1: Set, 2: Set, ... } }
 */
function collectGroupingLevels() {
  const field = getActiveField();
  if (!field) return { maxLevels: 1, columnsByLevel: {} };

  const cases = getCasesForField(field);
  let maxLevels = 1;
  const columnsByLevel = {};

  for (const caseData of Object.values(cases)) {
    const cols = caseData?.volumeGroups?.columns || [];
    maxLevels = Math.max(maxLevels, cols.length);
    cols.forEach((col, idx) => {
      const lvl = idx + 1;
      if (!columnsByLevel[lvl]) columnsByLevel[lvl] = new Set();
      columnsByLevel[lvl].add(col);
    });
  }

  return { maxLevels, columnsByLevel };
}

/**
 * Populate the #cross-plot-grouping dropdown.
 */
function populateGroupingSelector() {
  const selector = document.getElementById('cross-plot-grouping');
  if (!selector) return;

  selector.innerHTML = '';
  const { maxLevels, columnsByLevel } = collectGroupingLevels();
  const ui = getUI();

  for (let i = 1; i <= maxLevels; i++) {
    const option = document.createElement('option');
    option.value = i;

    const names = columnsByLevel[i];
    if (names && names.size === 1) {
      option.textContent = Array.from(names)[0];
    } else if (names && names.size > 1) {
      option.textContent = Array.from(names).join('/');
    } else {
      option.textContent = `Level ${i}`;
    }

    selector.appendChild(option);
  }

  // Restore persisted level
  selector.value = ui.crossPlotGroupLevel || 1;
}

/**
 * Extract grouped data points for the cross-plot.
 * Returns array of { caseName, groupName, groupColumn, data: { bulkVolume, ... } }
 */
function extractGroups() {
  const field = getActiveField();
  if (!field) return [];

  const cases = getCasesForField(field);
  const ui = getUI();
  const groupingLevel = ui.crossPlotGroupLevel || 1;
  const groups = [];

  for (const [caseName, caseData] of Object.entries(cases)) {
    if (!caseData?.data || !Array.isArray(caseData.data)) continue;

    const groupColumns = caseData.volumeGroups?.columns || [];
    if (groupingLevel > groupColumns.length) continue;

    const groupColumn = groupColumns[groupingLevel - 1];
    if (!groupColumn) continue;

    // Accumulate volumes per group
    const groupMap = new Map();

    for (const row of caseData.data) {
      if (!row) continue;
      const groupName = row[groupColumn] || 'Unspecified';

      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, {
          bulkVolume: 0, netVolume: 0, poreVolume: 0,
          hcpvOil: 0, hcpvGas: 0, stoiip: 0, giip: 0,
          ntg: 0, porosity: 0, soOil: 0, sgGas: 0, boOil: 0, bgGas: 0,
          count: 0,
        });
      }

      const g = groupMap.get(groupName);
      g.bulkVolume += parseFloat(row['Bulk volume']) || 0;
      g.netVolume  += parseFloat(row['Net volume']) || 0;
      g.poreVolume += parseFloat(row['Pore volume']) || 0;
      g.hcpvOil    += parseFloat(row['HCPV oil']) || 0;
      g.hcpvGas    += parseFloat(row['HCPV gas']) || 0;
      g.stoiip     += parseFloat(row['STOIIP']) || 0;
      g.giip       += parseFloat(row['GIIP']) || 0;
      g.count++;
    }

    // Derive parameters from summed volumes
    for (const [name, d] of groupMap) {
      if (d.count === 0) continue;

      d.ntg      = d.bulkVolume > 0 ? d.netVolume / d.bulkVolume : 0;
      d.porosity = d.netVolume > 0  ? d.poreVolume / d.netVolume : 0;
      d.soOil    = d.poreVolume > 0 ? d.hcpvOil / d.poreVolume : 0;
      d.sgGas    = d.poreVolume > 0 ? d.hcpvGas / d.poreVolume : 0;
      d.boOil    = d.hcpvOil > 0    ? d.stoiip / d.hcpvOil : 0;
      d.bgGas    = d.hcpvGas > 0    ? d.giip / d.hcpvGas : 0;

      groups.push({ caseName, groupName: name, groupColumn, data: d });
    }
  }

  return groups;
}

/**
 * Determine point visibility from the runtime visibility state.
 */
function isPointVisible(d) {
  const vis = getVisibility();
  const groupOk = vis.groups?.[d.groupName] !== false;
  const caseOk  = vis.cases?.[d.caseName] !== false;
  return groupOk && caseOk;
}

/**
 * Update opacity/pointer-events of existing points without full redraw.
 */
function updatePlotVisibility() {
  const container = d3.select('#cross-plot-points-container');
  if (container.empty()) return;

  container.selectAll('.cross-plot-point')
    .attr('opacity', d => isPointVisible(d) ? 0.85 : 0)
    .style('pointer-events', d => isPointVisible(d) ? 'auto' : 'none');
}

// ─── Tooltip management ─────────────────────────────────────

function ensureTooltip() {
  if (tooltip) return tooltip;

  if (window.sharedVisualizationTooltip) {
    tooltip = window.sharedVisualizationTooltip;
    return tooltip;
  }

  d3.selectAll('.cross-plot-tooltip').remove();
  tooltip = d3.select('body')
    .append('div')
    .attr('class', 'legend-shared-tooltip cross-plot-tooltip')
    .style('opacity', 0);
  return tooltip;
}

// ─── Metric dropdown ────────────────────────────────────────

function showMetricDropdown(axis) {
  d3.selectAll('.metric-dropdown').remove();

  const metrics = ALL_METRICS.map(m => ({ value: m, label: formatMetricName(m) }));

  const dropdown = d3.select('body')
    .append('div')
    .attr('class', 'legend-shared-tooltip metric-dropdown')
    .style('opacity', 1)
    .style('z-index', 1100)
    .style('width', '180px')
    .style('max-height', '300px')
    .style('overflow-y', 'auto')
    .style('pointer-events', 'auto')
    .style('bottom', '5rem')
    .style('right', '1rem');

  dropdown.append('div')
    .attr('class', 'font-semibold border-b border-gray-200 pb-1 mb-1')
    .text(`Select ${axis.toUpperCase()}-Axis Metric`);

  metrics.forEach(metric => {
    dropdown.append('div')
      .attr('class', 'px-2 py-1.5 hover:bg-blue-50 cursor-pointer text-sm border-b border-gray-100 last:border-b-0')
      .text(metric.label)
      .on('click', () => {
        const ui = getUI();
        if (axis === 'x') {
          setCrossPlotAxes(metric.value, undefined);
        } else {
          setCrossPlotAxes(undefined, metric.value);
        }

        // Persist
        const field = getActiveField();
        if (field) {
          saveCrossPlotSettings(field, {
            crossPlotX: axis === 'x' ? metric.value : ui.crossPlotX,
            crossPlotY: axis === 'y' ? metric.value : ui.crossPlotY,
          });
        }

        render();
        dropdown.remove();
      });
  });

  // Close when clicking outside
  setTimeout(() => {
    d3.select('body').on('click.metric-dropdown', function (event) {
      if (!dropdown.node()?.contains(event.target)) {
        dropdown.remove();
        d3.select('body').on('click.metric-dropdown', null);
      }
    });
  }, 0);
}

// ─── Legend ──────────────────────────────────────────────────

function buildLegend(container, groups, caseToSymbol) {
  d3.select('#cross-plot-legend').remove();

  const vis = getVisibility();
  const uniqueGroups = [...new Set(groups.map(g => g.groupName))].sort();
  const uniqueCases  = [...new Set(groups.map(g => g.caseName))];

  const symbolGen = d3.symbol().size(80);

  // Determine grouping column name for the section title
  let groupColumnName = groups.length > 0 ? (groups[0].groupColumn || '') : '';

  const legendEl = document.createElement('div');
  legendEl.id = 'cross-plot-legend';
  legendEl.className = 'bg-white/95 border border-gray-200 rounded-lg p-3 shadow-sm mt-1 relative';

  // ── Group section ──
  const groupSection = document.createElement('div');
  groupSection.className = 'mb-3';

  // Title row with grouping selector
  const groupTitleRow = document.createElement('div');
  groupTitleRow.className = 'flex justify-between items-center mb-1';

  const groupTitle = document.createElement('div');
  groupTitle.className = 'text-xs font-light text-gray-500 uppercase tracking-wider legend-title-text';
  groupTitle.textContent = groupColumnName ? `${groupColumnName} (Colors)` : 'Groups (Colors)';
  groupTitleRow.appendChild(groupTitle);

  // Right side — grouping selector
  const rightSide = document.createElement('div');
  rightSide.className = 'flex items-center gap-3';

  const groupingWrapper = document.createElement('div');
  groupingWrapper.className = 'flex items-center gap-2';

  const groupingLabel = document.createElement('label');
  groupingLabel.className = 'text-xs text-gray-700';
  groupingLabel.textContent = 'Grouping:';
  groupingWrapper.appendChild(groupingLabel);

  // Build inline selector (mirrors the one in the legend from v1)
  const selector = document.createElement('select');
  selector.id = 'cross-plot-grouping';
  selector.className = 'text-xs border border-gray-300 rounded py-0.5 px-2';

  const { maxLevels, columnsByLevel } = collectGroupingLevels();
  const ui = getUI();

  for (let i = 1; i <= maxLevels; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.selected = (i === (ui.crossPlotGroupLevel || 1));
    const names = columnsByLevel[i];
    if (names && names.size === 1) {
      opt.textContent = Array.from(names)[0];
    } else if (names && names.size > 1) {
      opt.textContent = Array.from(names).join('/');
    } else {
      opt.textContent = `Level ${i}`;
    }
    selector.appendChild(opt);
  }

  selector.addEventListener('change', function () {
    const level = parseInt(this.value, 10);
    setCrossPlotGroupLevel(level);
    const field = getActiveField();
    if (field) {
      saveCrossPlotSettings(field, {
        ...loadCrossPlotSettings(field),
        crossPlotGroupLevel: level,
      });
    }
    render();
  });

  groupingWrapper.appendChild(selector);
  rightSide.appendChild(groupingWrapper);
  groupTitleRow.appendChild(rightSide);
  groupSection.appendChild(groupTitleRow);

  // Group colour items
  const maxInitialGroups = 8;
  const hasExtraGroups = uniqueGroups.length > maxInitialGroups;

  const groupItemsContainer = document.createElement('div');
  groupItemsContainer.className = 'flex flex-wrap gap-x-4 gap-y-1';

  function makeGroupItem(name) {
    const color = groupColor(name);
    const isVisible = vis.groups?.[name] !== false;

    const item = document.createElement('div');
    item.className = `flex items-center gap-1 cursor-pointer legend-item ${isVisible ? '' : 'opacity-50 line-through'}`;
    item.title = isVisible ? 'Click to hide' : 'Click to show';
    item.dataset.name = name;

    const colorBox = document.createElement('div');
    colorBox.className = 'w-3 h-3 rounded border border-gray-300 flex-shrink-0';
    colorBox.style.backgroundColor = color;
    item.appendChild(colorBox);

    const label = document.createElement('span');
    label.className = 'text-xs text-gray-700 truncate max-w-[100px]';
    label.title = name;
    label.textContent = name;
    item.appendChild(label);

    item.addEventListener('click', () => {
      const v = getVisibility();
      if (!v.groups) v.groups = {};
      const current = v.groups[name] !== false;
      v.groups[name] = !current;
      item.classList.toggle('opacity-50', !v.groups[name]);
      item.classList.toggle('line-through', !v.groups[name]);
      item.title = v.groups[name] ? 'Click to hide' : 'Click to show';
      updatePlotVisibility();
    });

    return item;
  }

  uniqueGroups.slice(0, maxInitialGroups).forEach(name => {
    groupItemsContainer.appendChild(makeGroupItem(name));
  });

  if (hasExtraGroups) {
    const toggleBtn = document.createElement('div');
    toggleBtn.className = 'text-xs text-blue-600 hover:text-blue-800 cursor-pointer flex items-center px-1';
    toggleBtn.innerHTML = '<i class="fas fa-plus-circle mr-1"></i> Show more';
    toggleBtn.onclick = function () {
      const extra = document.getElementById('group-legend-extra');
      const isHidden = extra.classList.contains('hidden');
      if (isHidden) {
        extra.classList.remove('hidden');
        this.innerHTML = '<i class="fas fa-minus-circle mr-1"></i> Show fewer';
      } else {
        extra.classList.add('hidden');
        this.innerHTML = '<i class="fas fa-plus-circle mr-1"></i> Show more';
      }
    };
    groupItemsContainer.appendChild(toggleBtn);
  }

  groupSection.appendChild(groupItemsContainer);

  if (hasExtraGroups) {
    const collapsible = document.createElement('div');
    collapsible.className = 'mt-1 overflow-hidden hidden';
    collapsible.id = 'group-legend-extra';

    const extra = document.createElement('div');
    extra.className = 'flex flex-wrap gap-x-4 gap-y-1';
    uniqueGroups.slice(maxInitialGroups).forEach(name => extra.appendChild(makeGroupItem(name)));
    collapsible.appendChild(extra);
    groupSection.appendChild(collapsible);
  }

  legendEl.appendChild(groupSection);

  // ── Case section ──
  const caseSection = document.createElement('div');

  const caseTitleRow = document.createElement('div');
  caseTitleRow.className = 'flex justify-between items-center mb-1';
  const caseTitle = document.createElement('div');
  caseTitle.className = 'text-xs font-light text-gray-500 uppercase tracking-wider legend-title-text';
  caseTitle.textContent = 'Cases (Shapes)';
  caseTitleRow.appendChild(caseTitle);
  caseSection.appendChild(caseTitleRow);

  const caseItemsContainer = document.createElement('div');
  caseItemsContainer.className = 'flex flex-wrap gap-x-4 gap-y-1';

  const maxInitialCases = 5;
  const hasExtraCases = uniqueCases.length > maxInitialCases;

  function makeCaseItem(caseName) {
    const isVisible = vis.cases?.[caseName] !== false;
    let symbolType;
    try {
      symbolType = caseToSymbol[caseName] || d3.symbolCircle;
    } catch {
      symbolType = d3.symbolCircle;
    }

    const item = document.createElement('div');
    item.className = `flex items-center gap-1 cursor-pointer legend-item ${isVisible ? '' : 'opacity-50 line-through'}`;
    item.title = isVisible ? 'Click to hide' : 'Click to show';
    item.dataset.name = caseName;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.style.minWidth = '16px';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('transform', 'translate(8, 8)');
    try {
      path.setAttribute('d', symbolGen.type(symbolType)());
    } catch {
      path.setAttribute('d', symbolGen.type(d3.symbolCircle)());
    }
    path.setAttribute('fill', '#aaaaaa');
    path.setAttribute('stroke', '#333');
    path.setAttribute('stroke-width', '1');
    svg.appendChild(path);
    item.appendChild(svg);

    const label = document.createElement('span');
    label.className = 'text-xs text-gray-700 truncate max-w-[100px]';
    label.title = caseName;
    label.textContent = caseName;
    item.appendChild(label);

    item.addEventListener('click', () => {
      const v = getVisibility();
      if (!v.cases) v.cases = {};
      const current = v.cases[caseName] !== false;
      v.cases[caseName] = !current;
      item.classList.toggle('opacity-50', !v.cases[caseName]);
      item.classList.toggle('line-through', !v.cases[caseName]);
      item.title = v.cases[caseName] ? 'Click to hide' : 'Click to show';
      updatePlotVisibility();
    });

    return item;
  }

  uniqueCases.slice(0, maxInitialCases).forEach(name => {
    caseItemsContainer.appendChild(makeCaseItem(name));
  });

  if (hasExtraCases) {
    const toggleBtn = document.createElement('div');
    toggleBtn.className = 'text-xs text-blue-600 hover:text-blue-800 cursor-pointer flex items-center px-1';
    toggleBtn.innerHTML = '<i class="fas fa-plus-circle mr-1"></i> Show more';
    toggleBtn.onclick = function () {
      const extra = document.getElementById('case-legend-extra');
      const isHidden = extra.classList.contains('hidden');
      if (isHidden) {
        extra.classList.remove('hidden');
        this.innerHTML = '<i class="fas fa-minus-circle mr-1"></i> Show fewer';
      } else {
        extra.classList.add('hidden');
        this.innerHTML = '<i class="fas fa-plus-circle mr-1"></i> Show more';
      }
    };
    caseItemsContainer.appendChild(toggleBtn);
  }

  caseSection.appendChild(caseItemsContainer);

  if (hasExtraCases) {
    const collapsible = document.createElement('div');
    collapsible.className = 'mt-1 overflow-hidden hidden';
    collapsible.id = 'case-legend-extra';

    const extra = document.createElement('div');
    extra.className = 'flex flex-wrap gap-x-4 gap-y-1';
    uniqueCases.slice(maxInitialCases).forEach(name => extra.appendChild(makeCaseItem(name)));
    collapsible.appendChild(extra);
    caseSection.appendChild(collapsible);
  }

  legendEl.appendChild(caseSection);
  container.appendChild(legendEl);
}

// ─── Main render ────────────────────────────────────────────

export function render() {
  const container = document.getElementById('cross-plot');
  const outerContainer = document.getElementById('cross-plot-outer-container');
  if (!container || !outerContainer || outerContainer.classList.contains('hidden')) return;

  // Build color map for the current group column
  const field = getActiveField();
  const runtime = getRuntime();
  const groupingLevel = getUI().crossPlotGroupLevel || 1;
  const groupCol = runtime.volumetricData?.volumeGroups?.columns?.[groupingLevel - 1];
  const _cpColorMap = (field && groupCol) ? computeColumnColors(field, groupCol) : {};
  const groupColor = (name) => _cpColorMap[name] || PALETTES.vibrant[0];

  const groups = extractGroups();
  if (groups.length === 0) {
    container.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500">No group data available</div>';
    return;
  }

  // Ensure visibility state is initialised
  const vis = getVisibility();
  if (!vis.groups) vis.groups = {};
  if (!vis.cases) vis.cases = {};

  const ui = getUI();
  const xMetric = ui.crossPlotX || 'bulkVolume';
  const yMetric = ui.crossPlotY || 'stoiip';

  // Clear
  container.innerHTML = '';

  // Title
  const titleDiv = document.createElement('div');
  titleDiv.className = 'text-center font-semibold text-lg mb-2 text-gray-700';
  titleDiv.textContent = 'Case Comparison Chart';
  container.appendChild(titleDiv);

  // Dimensions
  const width = container.clientWidth || 800;
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  // Symbol mapping
  const uniqueCases = [...new Set(groups.map(g => g.caseName))];
  const caseToSymbol = {};
  uniqueCases.forEach((name, i) => {
    caseToSymbol[name] = SYMBOL_TYPES[i % SYMBOL_TYPES.length];
  });

  // Scales
  const xValues = groups.map(g => g.data[xMetric]);
  const yValues = groups.map(g => g.data[yMetric]);
  const xExtent = d3.extent(xValues);
  const yExtent = d3.extent(yValues);
  const xPad = (xExtent[1] - xExtent[0]) * 0.05 || 1;
  const yPad = (yExtent[1] - yExtent[0]) * 0.05 || 1;

  const xScale = d3.scaleLinear()
    .domain([Math.max(0, xExtent[0] - xPad), xExtent[1] + xPad])
    .range([0, innerWidth]);

  const yScale = d3.scaleLinear()
    .domain([Math.max(0, yExtent[0] - yPad), yExtent[1] + yPad])
    .range([innerHeight, 0]);

  // SVG
  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', HEIGHT)
    .attr('viewBox', [0, 0, width, HEIGHT]);

  const g = svg.append('g')
    .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)
    .attr('id', 'cross-plot-points-container');

  // Grid lines (drawn first so they sit behind points)
  g.append('g')
    .attr('class', 'grid')
    .attr('opacity', 0.2)
    .call(d3.axisBottom(xScale).tickSize(innerHeight).tickFormat(''))
    .selectAll('line')
    .attr('stroke', '#ddd');

  g.append('g')
    .attr('class', 'grid')
    .attr('opacity', 0.2)
    .call(d3.axisLeft(yScale).tickSize(-innerWidth).tickFormat(''))
    .selectAll('line')
    .attr('stroke', '#ddd');

  // Axes
  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale));

  g.append('g')
    .call(d3.axisLeft(yScale));

  // Axis titles (clickable)
  svg.append('text')
    .attr('class', 'axis-title x-axis-title')
    .attr('text-anchor', 'middle')
    .attr('x', width / 2)
    .attr('y', HEIGHT - 10)
    .style('font-size', '12px')
    .style('cursor', 'pointer')
    .text(formatMetricName(xMetric))
    .on('click', () => showMetricDropdown('x'));

  svg.append('text')
    .attr('class', 'axis-title y-axis-title')
    .attr('text-anchor', 'middle')
    .attr('transform', `translate(${MARGIN.left / 3},${HEIGHT / 2}) rotate(-90)`)
    .style('font-size', '12px')
    .style('cursor', 'pointer')
    .text(formatMetricName(yMetric))
    .on('click', () => showMetricDropdown('y'));

  // Tooltip
  const tip = ensureTooltip();

  // Symbol generator
  const symbolGen = d3.symbol().size(160);

  // Data points
  g.selectAll('.data-point')
    .data(groups)
    .join('path')
    .attr('class', 'cross-plot-point')
    .attr('id', d => `point-${d.caseName}-${d.groupName}`.replace(/\s+/g, '-'))
    .attr('data-case', d => d.caseName)
    .attr('data-group', d => d.groupName)
    .attr('transform', d => `translate(${xScale(d.data[xMetric])},${yScale(d.data[yMetric])})`)
    .attr('d', d => {
      try {
        return symbolGen.type(caseToSymbol[d.caseName])();
      } catch {
        return symbolGen.type(d3.symbolCircle)();
      }
    })
    .attr('fill', d => groupColor(d.groupName))
    .attr('stroke', '#333')
    .attr('stroke-width', 1)
    .attr('opacity', d => isPointVisible(d) ? 0.85 : 0)
    .style('pointer-events', d => isPointVisible(d) ? 'auto' : 'none')
    .on('mouseover', function (_event, d) {
      tip.transition().duration(200).style('opacity', 0.9);

      const content = `
        <div class="font-semibold">${d.groupName} (${d.caseName})</div>
        <div>${formatMetricName(xMetric)}: <strong>${formatMetricValue(xMetric, d.data[xMetric])}</strong></div>
        <div>${formatMetricName(yMetric)}: <strong>${formatMetricValue(yMetric, d.data[yMetric])}</strong></div>
        <div class="border-t border-gray-200 mt-2 pt-2">
          <div>NTG: <strong>${formatPercent(d.data.ntg)}</strong></div>
          <div>Porosity: <strong>${formatPercent(d.data.porosity)}</strong></div>
          <div>So: <strong>${formatPercent(d.data.soOil)}</strong></div>
          <div>Sg: <strong>${formatPercent(d.data.sgGas)}</strong></div>
          <div>1/Bo: <strong>${formatNumber(d.data.boOil)}</strong></div>
          <div>1/Bg: <strong>${formatNumber(d.data.bgGas)}</strong></div>
        </div>
      `;
      tip.html(content);

      // Highlight same-group points
      g.selectAll('.cross-plot-point')
        .filter(c => c.groupName === d.groupName)
        .attr('stroke-width', 2)
        .attr('opacity', 1);
    })
    .on('mouseout', function () {
      tip.transition().duration(500).style('opacity', 0);

      g.selectAll('.cross-plot-point')
        .attr('stroke-width', 1)
        .filter(d => isPointVisible(d))
        .attr('opacity', 0.85);
    });

  // ── Regression line ──
  drawRegressionLine(g, groups, xMetric, yMetric, xScale, yScale, innerWidth, innerHeight);

  // Legend
  buildLegend(container, groups, caseToSymbol);
}

// ─── Regression line (simple linear, purely visual) ─────────

function drawRegressionLine(g, groups, xMetric, yMetric, xScale, yScale, width, height) {
  // Collect all visible data points
  const points = groups
    .filter(d => isPointVisible(d))
    .map(d => [d.data[xMetric], d.data[yMetric]])
    .filter(([x, y]) => isFinite(x) && isFinite(y) && x !== 0 && y !== 0);

  if (points.length < 2) return;

  const n = points.length;
  const sumX = points.reduce((s, p) => s + p[0], 0);
  const sumY = points.reduce((s, p) => s + p[1], 0);
  const sumXY = points.reduce((s, p) => s + p[0] * p[1], 0);
  const sumX2 = points.reduce((s, p) => s + p[0] * p[0], 0);

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R²
  const meanY = sumY / n;
  const ssRes = points.reduce((s, p) => s + Math.pow(p[1] - (slope * p[0] + intercept), 2), 0);
  const ssTot = points.reduce((s, p) => s + Math.pow(p[1] - meanY, 2), 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // Line endpoints (clamp to scale domain)
  const [xMin, xMax] = xScale.domain();
  const y1 = slope * xMin + intercept;
  const y2 = slope * xMax + intercept;

  g.append('line')
    .attr('class', 'regression-line')
    .attr('x1', xScale(xMin))
    .attr('y1', yScale(y1))
    .attr('x2', xScale(xMax))
    .attr('y2', yScale(y2))
    .attr('stroke', '#6366f1')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '6,4')
    .attr('opacity', 0.6);

  // R² label
  g.append('text')
    .attr('x', xScale(xMax) - 5)
    .attr('y', yScale(y2) - 8)
    .attr('text-anchor', 'end')
    .attr('font-size', '10px')
    .attr('fill', '#6366f1')
    .attr('opacity', 0.8)
    .text(`R² = ${r2.toFixed(3)}`);
}

// ─── Collapse / expand toggle ───────────────────────────────

function toggleCollapse() {
  const outerContainer = document.getElementById('cross-plot-outer-container');
  const toggleBtn = document.getElementById('toggle-cross-plot');
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

// ─── Persistence helpers ────────────────────────────────────

function restoreSettings() {
  const field = getActiveField();
  if (!field) return;

  const saved = loadCrossPlotSettings(field);
  if (saved.crossPlotX) setCrossPlotAxes(saved.crossPlotX, undefined);
  if (saved.crossPlotY) setCrossPlotAxes(undefined, saved.crossPlotY);
  if (saved.crossPlotGroupLevel) setCrossPlotGroupLevel(saved.crossPlotGroupLevel);
}

function persistCurrentSettings() {
  const field = getActiveField();
  if (!field) return;

  const ui = getUI();
  saveCrossPlotSettings(field, {
    crossPlotX: ui.crossPlotX,
    crossPlotY: ui.crossPlotY,
    crossPlotGroupLevel: ui.crossPlotGroupLevel,
  });
}

// ─── Public API ─────────────────────────────────────────────

export function init() {
  restoreSettings();
  populateGroupingSelector();
}

export function setupEvents() {
  // Toggle button
  const toggleBtn = document.getElementById('toggle-cross-plot');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleCollapse);
  }

  // Standalone grouping selector (the one that exists in HTML outside the legend)
  const standaloneGrouping = document.getElementById('cross-plot-grouping');
  if (standaloneGrouping) {
    standaloneGrouping.addEventListener('change', function () {
      const level = parseInt(this.value, 10);
      setCrossPlotGroupLevel(level);
      persistCurrentSettings();
      render();
    });
  }

  // Re-render when field or case data changes
  // Field change: collapse and reset
  store.subscribe('activeField', () => {
    expanded = false;
    const outerContainer = document.getElementById('cross-plot-outer-container');
    const toggleBtnEl = document.getElementById('toggle-cross-plot');
    if (outerContainer) outerContainer.classList.add('collapsed');
    if (toggleBtnEl) toggleBtnEl.dataset.expanded = 'false';
    const vis = getVisibility();
    vis.groups = {}; vis.cases = {};
    restoreSettings();
    populateGroupingSelector();
  });

  // Data or case changes: re-render if expanded
  store.subscribe(
    s => [s.data.volumetricData, s.activeField],
    () => { populateGroupingSelector(); if (expanded) render(); }
  );

  // Responsive resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (expanded) render();
    }, 250);
  });
}
