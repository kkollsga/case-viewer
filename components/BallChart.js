// components/BallChart.js — D3 circle packing volume visualisation
// Renders a zoomable packed-circle diagram driven by the active case's
// volumetric data, with metric selection, depth control, legend, and
// per-case persisted settings.

import { getRuntime, getUI, getActiveField, getActiveCase, getActiveScenario, store, setMetric } from '../core/state.js';
import {
  saveCircleSettings, loadCircleSettings,
  saveFieldCircleSettings, loadFieldCircleSettings,
  saveLegendLayer, loadLegendLayer,
  saveFieldSettings, getCaseData,
} from '../core/storage.js';
import { on, emit, EVENTS } from '../core/events.js';
import { formatNumber, formatCompact } from '../utils/format.js';
import {
  getNodeColor, getPalette, THEME,
  getNodeOpacity, getLabelTextColor,
  truncateTextToFit, resetColorAssignments,
} from '../utils/color.js';

// ─── Standard metrics shown in the metric dropdown ────────────
const METRIC_OPTIONS = [
  'Bulk volume',
  'Net volume',
  'Pore volume',
  'HCPV oil',
  'HCPV gas',
  'STOIIP',
  'GIIP',
];

// Standard volume columns that must not be treated as hierarchy levels
const STANDARD_COLUMNS = [
  'Bulk volume', 'Net volume', 'Pore volume',
  'HCPV oil', 'HCPV gas', 'STOIIP', 'GIIP',
  'NTG', 'Por', 'So', 'Sg', '1/Bo', '1/Bg', 'GRV',
];

// ─── Circle configuration ─────────────────────────────────────
const CIRCLE_CFG = {
  sizeThresholdPercent: 0.02,
  minRadius:  { 1: 18, 2: 16, 3: 14, 4: 12, other: 10 },
  fontSize:   { 0: 12, 1: 11, 2: 10, 3: 9, 4: 8, other: 7 },
  padding: 3,
};

// ─── Per-case settings (defaults) ─────────────────────────────
let settings = {
  showValues: true,
  zoomEnabled: false,
  maxDepth: 5,
  showExtendedSettings: false,
  showLegend: true,           // field-level
};

// Internal bookkeeping
let sharedTooltip = null;
let currentHierarchyData = null;
let currentValidDescendants = null;
let resizeTimer = null;

// ─── Exported: init ───────────────────────────────────────────

export function init() {
  populateMetricSelector();
  setupSettingsPanel();
  setupControlListeners();
}

// ─── Exported: render ─────────────────────────────────────────

export function render() {
  const runtime = getRuntime();
  const vData = runtime.volumetricData;

  updateTitle();

  if (!vData || !vData.data || vData.data.length === 0) {
    clearDiagram();
    return;
  }

  // Restore persisted settings for this case
  restoreSettings();

  // Update the metric dropdown to match field-level metric
  syncMetricSelector();

  // Update total / unit display
  updateCurrentUnit();

  // Draw the visualisation
  drawCirclePacking();
}

// ─── Exported: setupEvents ────────────────────────────────────

export function setupEvents() {
  store.subscribe(
    s => [s.data.volumetricData, s.ui.metric, s.activeCase, s.activeField],
    ([data, metric]) => {
      if (data) { updateCurrentUnit(); render(); }
      else clearDiagram();
    }
  );

  // Responsive redraw
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (store.select('data.volumetricData')) drawCirclePacking();
    }, 250);
  });
}

// ====================================================================
// SETTINGS PERSISTENCE
// ====================================================================

function restoreSettings() {
  const field = getActiveField();
  const caseName = getActiveCase();
  if (!field || !caseName) return;

  // Case-level settings
  const saved = loadCircleSettings(field, caseName);
  if (saved) {
    settings.showValues = saved.showValues !== undefined ? saved.showValues : true;
    settings.zoomEnabled = saved.zoomEnabled !== undefined ? saved.zoomEnabled : false;
    settings.maxDepth = saved.maxDepth !== undefined ? saved.maxDepth : 5;
    settings.showExtendedSettings = saved.showExtendedSettings !== undefined ? saved.showExtendedSettings : false;
  } else {
    settings.showValues = true;
    settings.zoomEnabled = false;
    settings.maxDepth = 5;
    settings.showExtendedSettings = false;
  }

  // Field-level settings
  const fieldSaved = loadFieldCircleSettings(field);
  settings.showLegend = fieldSaved.showLegend !== undefined ? fieldSaved.showLegend : true;

  // Reflect into DOM
  const showValuesToggle = document.getElementById('show-values-toggle');
  const zoomToggle = document.getElementById('enable-zoom-toggle');
  const depthSlider = document.getElementById('max-depth-slider');
  const depthValue = document.getElementById('max-depth-value');
  const legendToggle = document.getElementById('show-legend-toggle');

  if (showValuesToggle) showValuesToggle.checked = settings.showValues;
  if (zoomToggle) zoomToggle.checked = settings.zoomEnabled;
  if (depthSlider) {
    depthSlider.value = settings.maxDepth;
  }
  if (depthValue) depthValue.textContent = settings.maxDepth;
  if (legendToggle) legendToggle.checked = settings.showLegend;

  // Extended settings panel
  applyExtendedSettingsVisibility();
}

function persistSettings() {
  const field = getActiveField();
  const caseName = getActiveCase();
  if (!field || !caseName) return;

  saveCircleSettings(field, caseName, {
    showValues: settings.showValues,
    zoomEnabled: settings.zoomEnabled,
    maxDepth: settings.maxDepth,
    showExtendedSettings: settings.showExtendedSettings,
  });

  saveFieldCircleSettings(field, { showLegend: settings.showLegend });
}

// ====================================================================
// METRIC SELECTOR
// ====================================================================

function populateMetricSelector() {
  const sel = document.getElementById('metric-selector');
  if (!sel) return;
  sel.innerHTML = '';
  for (const metric of METRIC_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = metric;
    opt.textContent = metric;
    sel.appendChild(opt);
  }
  sel.value = getUI().metric;
}

function syncMetricSelector() {
  const sel = document.getElementById('metric-selector');
  if (sel) sel.value = getUI().metric;
}

// ====================================================================
// SETTINGS PANEL
// ====================================================================

function setupSettingsPanel() {
  const header = document.getElementById('settings-header');
  if (!header) return;
  header.addEventListener('click', () => {
    settings.showExtendedSettings = !settings.showExtendedSettings;
    applyExtendedSettingsVisibility();
    persistSettings();
  });
}

function applyExtendedSettingsVisibility() {
  const extended = document.getElementById('extended-settings');
  const header = document.getElementById('settings-header');
  const arrow = document.getElementById('settings-arrow');
  if (!extended || !header || !arrow) return;

  if (settings.showExtendedSettings) {
    extended.classList.remove('hidden');
    header.classList.add('text-blue-500');
    arrow.classList.add('transform', 'rotate-180');
  } else {
    extended.classList.add('hidden');
    header.classList.remove('text-blue-500');
    arrow.classList.remove('transform', 'rotate-180');
  }
}

function setupControlListeners() {
  // Metric selector
  const metricSel = document.getElementById('metric-selector');
  if (metricSel) {
    metricSel.addEventListener('change', (e) => {
      setMetric(e.target.value); // Goes through store → notifies all subscribers
      const field = getActiveField();
      if (field) saveFieldSettings(field, { currentMetric: e.target.value });
    });
  }

  // Show values
  const showValToggle = document.getElementById('show-values-toggle');
  if (showValToggle) {
    showValToggle.addEventListener('change', (e) => {
      settings.showValues = e.target.checked;
      persistSettings();
      drawCirclePacking();
    });
  }

  // Enable zoom
  const zoomToggle = document.getElementById('enable-zoom-toggle');
  if (zoomToggle) {
    zoomToggle.addEventListener('change', (e) => {
      settings.zoomEnabled = e.target.checked;
      persistSettings();
      drawCirclePacking();
    });
  }

  // Show legend
  const legendToggle = document.getElementById('show-legend-toggle');
  if (legendToggle) {
    legendToggle.addEventListener('change', (e) => {
      settings.showLegend = e.target.checked;
      const legend = document.getElementById('circle-legend');
      if (legend) {
        legend.classList.toggle('hidden', !settings.showLegend);
      }
      persistSettings();
    });
  }

  // Max depth slider
  const depthSlider = document.getElementById('max-depth-slider');
  if (depthSlider) {
    depthSlider.addEventListener('input', (e) => {
      settings.maxDepth = parseInt(e.target.value, 10);
      const depthValue = document.getElementById('max-depth-value');
      if (depthValue) depthValue.textContent = settings.maxDepth;
      persistSettings();
      drawCirclePacking();
    });
  }
}

// ====================================================================
// TITLE AND UNIT DISPLAY
// ====================================================================

function updateTitle() {
  const titleEl = document.getElementById('ball-chart-title');
  const subtitleEl = document.getElementById('ball-chart-subtitle');
  const caseName = getActiveCase();
  const field = getActiveField();

  if (titleEl) {
    titleEl.textContent = caseName || 'Ball Chart';
  }
  if (subtitleEl) {
    subtitleEl.textContent = caseName ? (field || '') : 'No case selected';
  }
}

function updateCurrentUnit() {
  const unitEl = document.getElementById('current-unit');
  if (!unitEl) return;

  const runtime = getRuntime();
  const vData = runtime.volumetricData;
  const metric = getUI().metric;

  if (!vData || !metric) {
    unitEl.textContent = '';
    return;
  }

  const units = vData.units || {};
  const unit = units[metric] || '';

  const total = vData.data.reduce((sum, row) => sum + (parseFloat(row[metric]) || 0), 0);
  unitEl.textContent = `Total ${metric}: ${formatCompact(total)} ${unit}`;
}

// ====================================================================
// HIERARCHY BUILDING
// ====================================================================

/**
 * Build the hierarchical data structure from flat rows.
 * Root -> level-1 groups -> level-2 groups -> ... -> leaf rows
 */
function prepareHierarchicalData() {
  const runtime = getRuntime();
  const vData = runtime.volumetricData;
  const metric = getUI().metric;
  if (!vData || !vData.data || !metric) return null;

  const data = vData.data;
  const volumeGroups = vData.volumeGroups || {};
  const groupColumns = volumeGroups.columns || [];

  // Identify numeric columns (anything that isn't a group column or internal)
  const allColumns = Object.keys(data[0] || {});
  const numericColumns = allColumns.filter(
    (col) => !groupColumns.includes(col) && !col.startsWith('__') && col.trim() !== ''
  );

  // Total volumetrics across all rows
  const totalVolumetrics = {};
  numericColumns.forEach((col) => (totalVolumetrics[col] = 0));

  data.forEach((row) => {
    if (!row) return;
    numericColumns.forEach((col) => {
      if (!(col in row)) return;
      const raw = row[col];
      let val = 0;
      if (typeof raw === 'number') {
        val = isNaN(raw) ? 0 : raw;
      } else if (typeof raw === 'string') {
        val = parseFloat(raw.replace(/,/g, '')) || 0;
      }
      totalVolumetrics[col] += val;
    });
  });

  const root = { name: 'Total', volumetrics: totalVolumetrics, children: [] };

  if (groupColumns.length === 0) {
    // No grouping — rows become direct children
    data.forEach((row) => {
      if (!row) return;
      const vol = {};
      numericColumns.forEach((col) => (vol[col] = parseFloat(row[col]) || 0));
      const metricVal = vol[metric] || 0;
      if (metricVal > 0) {
        root.children.push({ name: 'Item', volumetrics: vol, value: metricVal });
      }
    });
    return root;
  }

  buildHierarchy(data, groupColumns, 0, root, metric, numericColumns);
  return root;
}

function buildHierarchy(data, groupColumns, level, parentNode, metric, numericColumns) {
  if (!data || !data.length || level >= groupColumns.length || !groupColumns[level]) return;

  const col = groupColumns[level];
  const groups = {};

  data.forEach((row) => {
    if (!row) return;
    const key = row[col] || 'Unspecified';
    if (!groups[key]) {
      groups[key] = { rows: [], volumetrics: {} };
      numericColumns.forEach((c) => (groups[key].volumetrics[c] = 0));
    }
    groups[key].rows.push(row);
    numericColumns.forEach((c) => {
      if (!(c in row)) return;
      groups[key].volumetrics[c] += parseFloat(row[c]) || 0;
    });
  });

  const sorted = Object.entries(groups).sort(
    (a, b) => (b[1].volumetrics[metric] || 0) - (a[1].volumetrics[metric] || 0)
  );

  sorted.forEach(([name, grp]) => {
    const node = {
      name,
      volumetrics: grp.volumetrics,
      value: parseFloat(grp.volumetrics[metric]) || 0,
      children: [],
    };
    parentNode.children.push(node);

    if (level < groupColumns.length - 1) {
      buildHierarchy(grp.rows, groupColumns, level + 1, node, metric, numericColumns);
    }
  });
}

/**
 * Compute the maximum depth of a plain hierarchy object.
 */
function getMaxDepth(node, depth = 0) {
  if (!node || !node.children || node.children.length === 0) return depth;
  return Math.max(...node.children.map((c) => getMaxDepth(c, depth + 1)));
}

// ====================================================================
// NODE STYLING HELPERS
// ====================================================================

function nodeColor(d) {
  if (d.depth === 0) return THEME.totalCircle;
  return getNodeColor(d.data.name, d.depth);
}

function nodeOpacity(d) {
  if (d.depth === 0) return 1;
  switch (d.depth) {
    case 1: return 0.85;
    case 2: return 0.9;
    case 3: return 0.95;
    default: return 1;
  }
}

function nodeStroke(d) {
  if (d.depth === 0) return THEME.totalBorder;
  if (d.depth === 1) return '#D1D5DB';
  if (d.depth === 2) return '#E5E7EB';
  if (d.depth === 3) return 'rgba(0,0,0,0.1)';
  return 'none';
}

function nodeStrokeWidth(d) {
  if (d.depth === 0) return 2;
  if (d.depth === 1) return 1;
  if (d.depth === 2) return 0.75;
  if (d.depth === 3) return 0.5;
  return 0;
}

function labelColor(d) {
  if (d.depth >= 3) return THEME.textLight;
  return THEME.textDark;
}

function fontSizeForDepth(depth) {
  return CIRCLE_CFG.fontSize[depth] !== undefined ? CIRCLE_CFG.fontSize[depth] : CIRCLE_CFG.fontSize.other;
}

function minRadiusForDepth(depth) {
  return CIRCLE_CFG.minRadius[depth] !== undefined ? CIRCLE_CFG.minRadius[depth] : CIRCLE_CFG.minRadius.other;
}

// ====================================================================
// MAIN DRAWING FUNCTION
// ====================================================================

function drawCirclePacking() {
  const runtime = getRuntime();
  const vData = runtime.volumetricData;
  if (!vData || !vData.data) return;

  resetColorAssignments();

  const container = document.getElementById('circle-diagram');
  if (!container) return;

  // Preserve the legend element if it exists; we will re-insert after clearing
  const existingLegend = document.getElementById('circle-legend');

  // Clear only the SVG and tooltip, leave static legend skeleton in DOM
  const oldSvg = container.querySelector('svg');
  if (oldSvg) oldSvg.remove();
  removeTooltip();

  const metric = getUI().metric;
  const units = vData.units || {};

  // Build hierarchy
  const hierarchyData = prepareHierarchicalData();
  if (!hierarchyData || !hierarchyData.children || hierarchyData.children.length === 0) {
    clearDiagramContent(container);
    return;
  }
  currentHierarchyData = hierarchyData;

  const dataMaxDepth = getMaxDepth(hierarchyData);

  // Clamp settings.maxDepth to actual data depth and update slider
  const depthSlider = document.getElementById('max-depth-slider');
  if (depthSlider) {
    depthSlider.max = dataMaxDepth;
    if (settings.maxDepth > dataMaxDepth) settings.maxDepth = dataMaxDepth;
    depthSlider.value = settings.maxDepth;
    const depthValue = document.getElementById('max-depth-value');
    if (depthValue) depthValue.textContent = settings.maxDepth;
  }

  // Container dimensions
  const width = container.clientWidth;
  const height = container.clientHeight || 850;

  // Shared tooltip
  sharedTooltip = createTooltip();

  // D3 hierarchy + pack layout
  const root = d3.hierarchy(hierarchyData)
    .sum((d) => {
      const val = d.value || 0;
      return isNaN(val) ? 0 : Math.max(0, val);
    })
    .sort((a, b) => (b.value || 0) - (a.value || 0));

  d3.pack()
    .size([width - 20, height - 20])
    .padding(CIRCLE_CFG.padding)(root);

  // Filter by depth and validity
  const validDescendants = root.descendants().filter(
    (d) => d.depth <= settings.maxDepth && d.value > 0 && !isNaN(d.x) && !isNaN(d.y) && !isNaN(d.r) && d.r > 0
  );
  currentValidDescendants = validDescendants;

  if (validDescendants.length === 0) {
    clearDiagramContent(container);
    return;
  }

  // Create SVG
  const svg = d3.select(container)
    .insert('svg', ':first-child')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [0, 0, width, height])
    .style('max-width', '100%')
    .style('height', '100%')
    .style('position', 'relative')
    .style('z-index', 5);

  const g = svg.append('g').attr('transform', 'translate(10,10)');

  // ── Zoom behaviour ──
  let currentFocus = root;
  let currentView = [root.x, root.y, root.r * 2];

  function zoomTo(v) {
    const k = Math.min(width, height) / v[2];
    currentView = v;
    g.selectAll('circle')
      .attr('cx', (d) => (d.x - v[0]) * k + width / 2)
      .attr('cy', (d) => (d.y - v[1]) * k + height / 2)
      .attr('r', (d) => d.r * k);

    g.selectAll('text.label-text')
      .attr('x', (d) => (d.x - v[0]) * k + width / 2)
      .attr('y', (d) => (d.y - v[1]) * k + height / 2 - d.r * k + 16);
  }

  function zoomClick(event, d) {
    if (!settings.zoomEnabled) return;
    event.stopPropagation();

    const target = currentFocus === d ? root : d;
    currentFocus = target;

    const v = [target.x, target.y, target.r * 2];
    const transition = svg.transition()
      .duration(750)
      .tween('zoom', () => {
        const interp = d3.interpolateZoom(currentView, v);
        return (t) => zoomTo(interp(t));
      });
  }

  // ── Draw circles ──
  const circles = g.selectAll('circle')
    .data(validDescendants)
    .join('circle')
    .attr('cx', (d) => d.x)
    .attr('cy', (d) => d.y)
    .attr('r', (d) => d.r)
    .attr('fill', nodeColor)
    .attr('fill-opacity', nodeOpacity)
    .attr('stroke', nodeStroke)
    .attr('stroke-width', nodeStrokeWidth)
    .style('cursor', settings.zoomEnabled ? 'pointer' : 'default')
    .on('click', zoomClick);

  // ── Circle hover tooltips ──
  circles
    .on('mouseover', function (event, d) {
      sharedTooltip.transition().duration(200).style('opacity', 0.9);
      sharedTooltip.html(buildCircleTooltipHTML(d, units, metric));
    })
    .on('mouseout', function () {
      sharedTooltip.transition().duration(500).style('opacity', 0);
    });

  // ── Delta overlay (Phase 3) ──
  applyDeltaOverlay(g, validDescendants, metric);

  // ── Value labels ──
  if (settings.showValues) {
    drawValueLabels(g, validDescendants, root, metric);
  }

  // ── Legend ──
  updateLegendPanel(hierarchyData, validDescendants, dataMaxDepth, units, metric);
}

// ====================================================================
// DELTA OVERLAY — when a compare case is active, show border colours
// ====================================================================

function applyDeltaOverlay(g, descendants, metric) {
  const ui = getUI();
  const compareCaseName = ui.compareCase;
  if (!compareCaseName) return;

  const field = getActiveField();
  const compareData = getCaseData(field, compareCaseName, getActiveScenario());
  if (!compareData || !compareData.data) return;

  const runtime = getRuntime();
  const activeData = runtime.volumetricData;
  if (!activeData) return;

  const groupColumns = activeData.volumeGroups?.columns || [];

  // Build compare value map: groupKey → sum of metric
  const compareMap = new Map();
  for (const row of compareData.data) {
    const key = groupColumns.map(c => row[c] || '').join('/');
    compareMap.set(key, (compareMap.get(key) || 0) + (parseFloat(row[metric]) || 0));
  }

  // Build active value map
  const activeMap = new Map();
  for (const row of activeData.data) {
    const key = groupColumns.map(c => row[c] || '').join('/');
    activeMap.set(key, (activeMap.get(key) || 0) + (parseFloat(row[metric]) || 0));
  }

  // Apply border overlays to circles
  g.selectAll('circle').each(function (d) {
    if (d.depth === 0) return; // Skip root

    // Build the group key for this node by walking up the hierarchy
    // excluding the root "Total" node
    const path = [];
    let node = d;
    while (node.depth > 0) {
      path.unshift(node.data.name || '');
      node = node.parent;
    }
    const key = path.join('/');

    // Try exact match first, then just the leaf name for single-level grouping
    let activeVal = activeMap.get(key);
    let compareVal = compareMap.get(key);

    // Fallback: if no match and this is a leaf, try just the node name
    if (activeVal === undefined && compareVal === undefined && d.data.name) {
      activeVal = activeMap.get(d.data.name);
      compareVal = compareMap.get(d.data.name);
    }

    if (activeVal === undefined && compareVal === undefined) return;

    const delta = (activeVal || 0) - (compareVal || 0);
    const absDeltaPct = compareVal ? Math.abs(delta / compareVal) : 0;

    if (Math.abs(delta) < 0.0001) return;

    // Green border = grew, red = shrank
    const color = delta > 0 ? '#10b981' : '#ef4444';
    // Border width proportional to |Δ%|, clamped 2–6px
    const strokeWidth = Math.max(2, Math.min(6, absDeltaPct * 20));

    d3.select(this)
      .attr('stroke', color)
      .attr('stroke-width', strokeWidth)
      .attr('stroke-opacity', 0.8);
  });
}

// ====================================================================
// VALUE LABELS
// ====================================================================

function drawValueLabels(g, descendants, root, metric) {
  const totalValue = root.value || 0.0001;

  const eligible = descendants.filter((d) => {
    if (d.depth === 0) return true;
    if (d.depth === 1 && d.r > 30) return true;
    const minR = minRadiusForDepth(d.depth);
    const ratio = d.value / totalValue;
    if (d.depth <= 3) return d.r > minR && ratio >= CIRCLE_CFG.sizeThresholdPercent;
    return d.r > minR && ratio >= CIRCLE_CFG.sizeThresholdPercent * 2;
  });

  g.selectAll('text.label-text')
    .data(eligible)
    .join('text')
    .attr('class', 'label-text')
    .attr('x', (d) => d.x)
    .attr('y', (d) => d.y - d.r + 16)
    .attr('text-anchor', 'middle')
    .attr('font-size', (d) => fontSizeForDepth(d.depth))
    .attr('fill', labelColor)
    .attr('fill-opacity', 0.9)
    .attr('pointer-events', 'none')
    .each(function (d) {
      const el = d3.select(this);

      const val = d.data && d.data.volumetrics ? (d.data.volumetrics[metric] || 0) : 0;
      const formatted = formatCompact(val);

      if (d.depth === 1 && d.data && d.data.name) {
        el.text('');
        el.append('tspan')
          .attr('x', d.x)
          .attr('dy', '0')
          .attr('font-weight', 'bold')
          .text(formatted);

        const maxW = d.r * 2 * 0.85;
        const fs = fontSizeForDepth(1) * 0.9;
        const truncated = truncateTextToFit(d.data.name, maxW, fs);
        el.append('tspan')
          .attr('x', d.x)
          .attr('dy', '1.2em')
          .attr('font-size', fs)
          .attr('font-weight', 'normal')
          .attr('opacity', 0.85)
          .text(truncated);
      } else {
        el.text(formatted);
      }
    });
}

// ====================================================================
// LEGEND
// ====================================================================

function updateLegendPanel(hierarchyData, validDescendants, dataMaxDepth, units, metric) {
  const field = getActiveField();
  const legendEl = document.getElementById('circle-legend');
  if (!legendEl) return;

  // Visibility
  legendEl.classList.toggle('hidden', !settings.showLegend);

  // Update slider max
  const slider = document.getElementById('legend-layer-slider');
  if (!slider) return;

  const effectiveMax = Math.min(settings.maxDepth, dataMaxDepth);
  slider.max = effectiveMax;

  // Max value label (last text child in legend header)
  const maxLabel = legendEl.querySelector('.slider-container + .text-xs');
  if (maxLabel) maxLabel.textContent = effectiveMax;

  // Determine initial layer
  let currentLayer = 1;
  if (field) {
    const savedLayer = loadLegendLayer(field);
    currentLayer = Math.max(1, Math.min(effectiveMax, savedLayer));
  }
  slider.value = currentLayer;

  // Populate legend items for initial layer
  renderLegendItems(hierarchyData, currentLayer, validDescendants, units, metric);

  // Replace slider to clear old listeners
  const newSlider = slider.cloneNode(true);
  slider.parentNode.replaceChild(newSlider, slider);

  newSlider.addEventListener('input', function () {
    const layer = parseInt(this.value, 10);
    renderLegendItems(hierarchyData, layer, validDescendants, units, metric);
    if (field) saveLegendLayer(field, layer);
  });
}

function renderLegendItems(hierarchyData, selectedLayer, validDescendants, units, metric) {
  const legendItems = document.getElementById('legend-items');
  if (!legendItems) return;
  legendItems.innerHTML = '';

  const volumeGroups = getRuntime().volumetricData?.volumeGroups || {};
  const groupColumns = volumeGroups.columns || [];
  const layerColumnName = groupColumns[selectedLayer - 1] || '';

  // Update legend title
  const legendTitle = document.querySelector('#circle-legend .legend-title-text');
  if (legendTitle) {
    legendTitle.textContent = layerColumnName ? `Legend - ${layerColumnName.toUpperCase()}` : 'Legend';
  }

  // Gather nodes at the selected depth
  let layerNodes = validDescendants
    ? validDescendants.filter((d) => d.depth === selectedLayer && d.r > 0)
    : [];

  // Fallback: traverse plain hierarchy if validDescendants not available
  if (layerNodes.length === 0 && hierarchyData) {
    const collected = [];
    (function traverse(node, depth) {
      if (depth === selectedLayer) { collected.push(node); return; }
      if (node.children) node.children.forEach((c) => traverse(c, depth + 1));
    })(hierarchyData, 0);

    layerNodes = collected.map((n) => ({
      data: n,
      depth: selectedLayer,
      r: 1, // dummy
      parent: null,
    }));
  }

  // Aggregate by name
  const types = new Map();
  layerNodes.forEach((node) => {
    const name = node.data?.name || 'Unnamed';
    if (!types.has(name)) {
      types.set(name, {
        name,
        color: nodeColor(node),
        opacity: nodeOpacity(node),
        totalValue: 0,
        parentBreakdown: new Map(),
      });
    }
    const entry = types.get(name);
    const val = node.data?.volumetrics?.[metric] || 0;
    entry.totalValue += val;

    if (node.parent && node.parent.depth > 0) {
      const pName = node.parent.data?.name || 'Unknown';
      entry.parentBreakdown.set(pName, (entry.parentBreakdown.get(pName) || 0) + val);
    }
  });

  const sorted = Array.from(types.values()).sort((a, b) => b.totalValue - a.totalValue);
  const unit = (units || {})[metric] || '';

  sorted.forEach((item) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'legend-item flex items-center gap-2 relative cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 w-full min-w-0';

    const colorBox = document.createElement('div');
    colorBox.className = 'legend-color-box w-5 h-5 rounded border border-gray-300 flex-shrink-0';
    colorBox.style.backgroundColor = item.color;
    colorBox.style.opacity = item.opacity;

    const label = document.createElement('div');
    label.className = 'legend-label text-sm text-gray-700 whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0';
    label.textContent = item.name;

    itemDiv.appendChild(colorBox);
    itemDiv.appendChild(label);

    const formattedTotal = formatCompact(item.totalValue);

    // Tooltip on hover
    itemDiv.addEventListener('mouseenter', () => {
      if (!sharedTooltip) return;
      sharedTooltip.transition().duration(200).style('opacity', 0.9);

      let html = `<div class="font-semibold">${item.name}</div>`;
      html += `<div>${metric}: <strong>${formattedTotal} ${unit}</strong></div>`;

      if (item.parentBreakdown.size > 0) {
        html += '<div class="border-t border-gray-200 mt-2 pt-2">';
        const parentArr = Array.from(item.parentBreakdown.entries()).sort((a, b) => b[1] - a[1]);
        parentArr.forEach(([pName, pVal]) => {
          const pct = ((pVal / item.totalValue) * 100).toFixed(1);
          const truncName = pName.length > 20 ? pName.substring(0, 20) + '...' : pName;
          html += `<div>${truncName}: <strong>${pct}%</strong></div>`;
        });
        html += '</div>';
      }
      sharedTooltip.html(html);
    });

    itemDiv.addEventListener('mouseleave', () => {
      if (!sharedTooltip) return;
      sharedTooltip.transition().duration(500).style('opacity', 0);
    });

    legendItems.appendChild(itemDiv);
  });

  // Update layer label
  const layerLabel = document.getElementById('legend-layer-label');
  if (layerLabel) {
    layerLabel.textContent = layerColumnName || `Layer ${selectedLayer}`;
  }
}

// ====================================================================
// TOOLTIP HELPERS
// ====================================================================

function createTooltip() {
  removeTooltip();
  return d3.select('body')
    .append('div')
    .attr('class', 'legend-shared-tooltip')
    .style('opacity', 0)
    .style('z-index', 1000);
}

function removeTooltip() {
  d3.selectAll('.legend-shared-tooltip').remove();
  sharedTooltip = null;
}

function buildCircleTooltipHTML(d, units, metric) {
  let html = '';
  if (d.depth === 0) {
    html = '<div class="font-semibold">Total Volumes</div>';
  } else {
    const path = [];
    let cur = d;
    while (cur && cur.depth > 0) {
      if (cur.data && cur.data.name) path.unshift(cur.data.name);
      cur = cur.parent;
    }
    const name = d.data?.name || 'Unnamed';
    html = `<div class="font-semibold">${name}</div>`;
    if (path.length > 1) {
      html += `<div>Path: ${path.join(' \u203A ')}</div>`;
    }
  }

  if (d.data && d.data.volumetrics) {
    for (const key in d.data.volumetrics) {
      const val = d.data.volumetrics[key];
      const unit = units[key] ? ` ${units[key]}` : '';
      html += `<div>${key}: <strong>${formatNumber(val)}</strong>${unit}</div>`;
    }
  }
  return html;
}

// ====================================================================
// CLEAR / UTILITY
// ====================================================================

function clearDiagram() {
  clearDiagramContent(document.getElementById('circle-diagram'));
  const unitEl = document.getElementById('current-unit');
  if (unitEl) unitEl.textContent = '';
  removeTooltip();
}

function clearDiagramContent(container) {
  if (!container) return;
  const svg = container.querySelector('svg');
  if (svg) svg.remove();
  // Do not remove the legend skeleton — it lives in the HTML template
}
