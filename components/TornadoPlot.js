// components/TornadoPlot.js — Tornado chart of parameter sensitivity around a base case.
// Each parameter (assigned to one or more cases) becomes a row.
// Bar from min→base = blue, base→max = red. Bars sorted by |max-min| descending.

import { getActiveField, getActiveScenario, store } from '../core/state.js';
import { getCasesForScenario, getBaseCaseName } from '../core/storage.js';
import { formatCompact } from '../utils/format.js';
import { el, clear } from '../utils/dom.js';

const METRICS = [
  { key: 'oil', label: 'Oil (STOIIP)', column: 'STOIIP' },
  { key: 'gas', label: 'Gas (GIIP)', column: 'GIIP' },
  { key: 'oe',  label: 'OE',          column: null },
];

let containerEl = null;
let activeMetricKey = 'oil';

export function init() {
  containerEl = document.getElementById('tornado-container');
}

export function setupEvents() {
  store.subscribe(
    (s) => [s.activeField, s.activeScenario, s._sig?.caseUpdated, s._sig?.caseDeleted, s._sig?.caseCreated],
    () => render(),
  );
}

export function render() {
  if (!containerEl) containerEl = document.getElementById('tornado-container');
  if (!containerEl) return;
  clear(containerEl);

  const field = getActiveField();
  const scenario = getActiveScenario();
  if (!field || !scenario) {
    containerEl.appendChild(emptyState('Select a field and scenario.'));
    return;
  }

  const cases = getCasesForScenario(field, scenario);
  const baseName = getBaseCaseName(field, scenario);

  const header = el('div', { class: 'flex items-center justify-between mb-3 gap-3 flex-wrap' });
  header.appendChild(buildMetricSelector());
  header.appendChild(buildExportButtons());
  containerEl.appendChild(header);

  if (!baseName) {
    containerEl.appendChild(emptyState('Mark one case as the reference (★ on the case card) to enable the tornado.'));
    return;
  }

  const baseCase = cases[baseName];
  const metric = METRICS.find((m) => m.key === activeMetricKey) || METRICS[0];

  const baseValue = computeMetric(baseCase, metric);
  if (!Number.isFinite(baseValue)) {
    containerEl.appendChild(emptyState('Reference case has no value for the selected metric.'));
    return;
  }

  // Build parameter buckets (skip the base case + cases without a parameter name)
  const buckets = new Map();
  for (const [name, c] of Object.entries(cases)) {
    if (!c) continue;
    if (name === baseName) continue;
    const param = (c.parameterName || '').trim();
    if (!param) continue;
    const value = computeMetric(c, metric);
    if (!Number.isFinite(value)) continue;
    if (!buckets.has(param)) buckets.set(param, []);
    buckets.get(param).push({ caseName: name, value });
  }

  const rows = [];
  for (const [param, entries] of buckets.entries()) {
    if (entries.length < 2) continue;
    const sorted = entries.slice().sort((a, b) => a.value - b.value);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    if (min.value === max.value) continue;
    rows.push({
      param,
      minValue: min.value,
      maxValue: max.value,
      minCase: min.caseName,
      maxCase: max.caseName,
      delta: Math.abs(max.value - min.value),
    });
  }
  rows.sort((a, b) => b.delta - a.delta);

  if (rows.length === 0) {
    containerEl.appendChild(emptyState('Assign a parameter name to two or more non-reference cases (via the pen icon on the card) to see the tornado.'));
    return;
  }

  const svg = drawTornado(rows, baseValue, baseName, metric);
  containerEl.appendChild(svg);
}

// ─── Metric / case helpers ─────────────────────────────────

function computeMetric(caseData, metric) {
  if (!caseData?.data) return NaN;
  if (metric.key === 'oe') {
    const stoiip = sumColumn(caseData.data, 'STOIIP');
    const giip = sumColumn(caseData.data, 'GIIP');
    return stoiip + giip;
  }
  return sumColumn(caseData.data, metric.column);
}

function sumColumn(rows, col) {
  let s = 0;
  for (const r of rows) s += parseFloat(r[col]) || 0;
  return s;
}

function getMetricUnit(metric) {
  // Best-effort unit lookup from the active case (or fall back).
  const field = getActiveField();
  const scenario = getActiveScenario();
  if (!field || !scenario) return '';
  const cases = getCasesForScenario(field, scenario);
  const sample = Object.values(cases).find((c) => c?.units);
  if (!sample) return '';
  if (metric.key === 'oe') return sample.units?.STOIIP || '';
  return sample.units?.[metric.column] || '';
}

// ─── UI helpers ────────────────────────────────────────────

function emptyState(text) {
  return el('div', {
    class: 'text-sm text-gray-400 italic py-6 text-center',
    textContent: text,
  });
}

function buildMetricSelector() {
  const wrap = el('div', { class: 'inline-flex bg-gray-100 rounded-full p-0.5' });
  for (const m of METRICS) {
    const isActive = m.key === activeMetricKey;
    const btn = el('button', {
      class: `px-3 py-1 text-xs rounded-full transition-colors ${isActive ? 'bg-white text-indigo-700 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`,
      textContent: m.label,
    });
    btn.addEventListener('click', () => {
      if (activeMetricKey === m.key) return;
      activeMetricKey = m.key;
      render();
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function buildExportButtons() {
  const wrap = el('div', { class: 'flex items-center gap-2' });
  const svgBtn = el('button', {
    class: 'inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors',
    title: 'Download SVG',
    innerHTML: '<i class="fas fa-download text-[10px]"></i><span>SVG</span>',
  });
  const pngBtn = el('button', {
    class: 'inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors',
    title: 'Download PNG (high resolution)',
    innerHTML: '<i class="fas fa-download text-[10px]"></i><span>PNG</span>',
  });
  svgBtn.addEventListener('click', () => exportSvg());
  pngBtn.addEventListener('click', () => exportPng());
  wrap.append(svgBtn, pngBtn);
  return wrap;
}

// ─── Drawing ───────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';
const ROW_HEIGHT = 32;
const BAR_HEIGHT = 18;
const LABEL_WIDTH = 140;
const VALUE_GUTTER = 64;     // space outside the bar for printed extreme values
const RIGHT_PADDING = 12;
const TOP_PADDING = 56;      // header (Ref Case label + base value)
const BOTTOM_PADDING = 24;

function drawTornado(rows, baseValue, baseName, metric) {
  const allValues = [baseValue];
  for (const r of rows) { allValues.push(r.minValue, r.maxValue); }
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const span = (maxV - minV) || Math.abs(baseValue) || 1;
  // Pad the domain a touch so labels don't sit on the edge
  const pad = span * 0.05;
  const domainMin = minV - pad;
  const domainMax = maxV + pad;

  // Estimate available width — we'll set viewBox and let CSS fit it
  const PLOT_WIDTH = 540;
  const plotLeft = LABEL_WIDTH + VALUE_GUTTER;
  const plotRight = plotLeft + PLOT_WIDTH;
  const totalWidth = plotRight + VALUE_GUTTER + RIGHT_PADDING;
  const totalHeight = TOP_PADDING + rows.length * ROW_HEIGHT + BOTTOM_PADDING;

  const scaleX = (v) => plotLeft + ((v - domainMin) / (domainMax - domainMin)) * PLOT_WIDTH;
  const baseX = scaleX(baseValue);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
  svg.setAttribute('class', 'tornado-svg');
  svg.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  svg.style.background = '#ffffff';

  // ── Header: "Ref Case" label + base case name + base value ──
  const headerText = svgText('Ref Case', baseX, 16, {
    'text-anchor': 'middle',
    'font-size': '11',
    'font-weight': '600',
    fill: '#4338ca',
    'letter-spacing': '0.06em',
    'text-transform': 'uppercase',
  });
  svg.appendChild(headerText);

  const baseLabel = svgText(baseName, baseX, 32, {
    'text-anchor': 'middle',
    'font-size': '12',
    'font-weight': '500',
    fill: '#374151',
  });
  svg.appendChild(baseLabel);

  const unit = getMetricUnit(metric);
  const baseValueText = `${formatCompact(baseValue)}${unit ? ' ' + unit : ''}`;
  const baseValueLabel = svgText(baseValueText, baseX, 46, {
    'text-anchor': 'middle',
    'font-size': '11',
    fill: '#6b7280',
  });
  svg.appendChild(baseValueLabel);

  // ── Reference line spanning all rows ──
  const refLine = document.createElementNS(SVG_NS, 'line');
  refLine.setAttribute('x1', baseX);
  refLine.setAttribute('x2', baseX);
  refLine.setAttribute('y1', TOP_PADDING - 6);
  refLine.setAttribute('y2', TOP_PADDING + rows.length * ROW_HEIGHT);
  refLine.setAttribute('stroke', '#1f2937');
  refLine.setAttribute('stroke-width', '2.5');
  svg.appendChild(refLine);

  // ── Rows ──
  rows.forEach((row, i) => {
    const rowY = TOP_PADDING + i * ROW_HEIGHT;
    const barY = rowY + (ROW_HEIGHT - BAR_HEIGHT) / 2;

    // Parameter label (left)
    svg.appendChild(svgText(row.param, LABEL_WIDTH - 10, rowY + ROW_HEIGHT / 2 + 4, {
      'text-anchor': 'end',
      'font-size': '12',
      fill: '#374151',
      'font-weight': '500',
    }));

    // Blue bar: min ↔ base
    const blueX1 = Math.min(scaleX(row.minValue), baseX);
    const blueX2 = Math.max(scaleX(row.minValue), baseX);
    if (blueX2 > blueX1) {
      svg.appendChild(svgRect(blueX1, barY, blueX2 - blueX1, BAR_HEIGHT, '#3b82f6'));
    }

    // Red bar: base ↔ max
    const redX1 = Math.min(scaleX(row.maxValue), baseX);
    const redX2 = Math.max(scaleX(row.maxValue), baseX);
    if (redX2 > redX1) {
      svg.appendChild(svgRect(redX1, barY, redX2 - redX1, BAR_HEIGHT, '#ef4444'));
    }

    // Min value label (left of blue bar)
    const minTextX = scaleX(row.minValue);
    const minAnchor = (row.minValue < baseValue) ? 'end' : 'start';
    const minDx = (row.minValue < baseValue) ? -6 : 6;
    svg.appendChild(svgText(formatCompact(row.minValue), minTextX + minDx, rowY + ROW_HEIGHT / 2 + 4, {
      'text-anchor': minAnchor,
      'font-size': '11',
      fill: '#1d4ed8',
      'font-weight': '500',
    }));

    // Max value label (right of red bar)
    const maxTextX = scaleX(row.maxValue);
    const maxAnchor = (row.maxValue > baseValue) ? 'start' : 'end';
    const maxDx = (row.maxValue > baseValue) ? 6 : -6;
    svg.appendChild(svgText(formatCompact(row.maxValue), maxTextX + maxDx, rowY + ROW_HEIGHT / 2 + 4, {
      'text-anchor': maxAnchor,
      'font-size': '11',
      fill: '#b91c1c',
      'font-weight': '500',
    }));
  });

  return svg;
}

function svgText(text, x, y, attrs = {}) {
  const t = document.createElementNS(SVG_NS, 'text');
  t.setAttribute('x', x);
  t.setAttribute('y', y);
  for (const [k, v] of Object.entries(attrs)) t.setAttribute(k, v);
  t.textContent = text;
  return t;
}

function svgRect(x, y, w, h, fill) {
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', x);
  r.setAttribute('y', y);
  r.setAttribute('width', w);
  r.setAttribute('height', h);
  r.setAttribute('rx', '2');
  r.setAttribute('fill', fill);
  return r;
}

// ─── Export ────────────────────────────────────────────────

function getCurrentSvgString() {
  const svg = containerEl?.querySelector('svg.tornado-svg');
  if (!svg) return null;
  // Clone so we can add explicit dimensions for stand-alone files
  const clone = svg.cloneNode(true);
  const vb = clone.getAttribute('viewBox').split(' ').map(Number);
  clone.setAttribute('width', vb[2]);
  clone.setAttribute('height', vb[3]);
  clone.setAttribute('xmlns', SVG_NS);
  return new XMLSerializer().serializeToString(clone);
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportSvg() {
  const str = getCurrentSvgString();
  if (!str) return;
  const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, `${exportFilenameStem()}.svg`);
}

function exportPng() {
  const svg = containerEl?.querySelector('svg.tornado-svg');
  if (!svg) return;
  const str = getCurrentSvgString();
  const vb = svg.getAttribute('viewBox').split(' ').map(Number);
  const width = vb[2];
  const height = vb[3];
  const scale = 3; // 3× for crisp text in slides / docs

  const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((png) => {
      if (png) downloadBlob(png, `${exportFilenameStem()}.png`);
      URL.revokeObjectURL(url);
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); };
  img.src = url;
}

function exportFilenameStem() {
  const field = (getActiveField() || 'field').replace(/\s+/g, '_');
  const scenario = (getActiveScenario() || 'scenario').replace(/\s+/g, '_');
  return `${field}_${scenario}_tornado_${activeMetricKey}`;
}
