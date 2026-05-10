// components/DistributionPlot.js — Monte Carlo distribution of field volumes.
//
// Strategy:
//   • Each tornado-tagged case is treated as one sampling slot. Its label
//     (parameterName) names the slot — e.g. "Structure", "OWC", "NTG", "Por".
//     Multiple slots can affect the same fundamental (Structure + OWC both
//     move GRV); they compound multiplicatively across slots.
//   • For each slot we derive a vector of fundamental-parameter multipliers
//     {GRV, NTG, Por, So, Sg, 1/Bo, 1/Bg} by comparing the case's aggregate
//     ratios to the reference case's. Slots have a low and/or high case;
//     missing extreme = identity (all 1.0).
//   • Per Monte Carlo trial: sample {low, ref, high} per slot using user
//     weights (default 30/40/30), element-wise multiply the vectors across
//     all slots, then apply per-zone in the ref case.
//   • Volumes computed zone-by-zone exactly like resolveLinkedCase, so
//     deterministic case views and MC stay consistent.

import { getActiveField, getActiveScenario, store } from '../core/state.js';
import {
  getCasesForScenario, getBaseCaseName, saveSimulation, loadSimulation,
} from '../core/storage.js';
import { formatCompact } from '../utils/format.js';
import { el, clear } from '../utils/dom.js';

const FUNDAMENTALS = ['GRV', 'NTG', 'Por', 'So', 'Sg', '1/Bo', '1/Bg'];
const METRICS = [
  { key: 'oil', label: 'Oil (STOIIP)', column: 'STOIIP' },
  { key: 'gas', label: 'Gas (GIIP)',   column: 'GIIP' },
  { key: 'oe',  label: 'OE',           column: null },
];
const DEFAULT_WEIGHTS = [0.30, 0.40, 0.30];
const DEFAULT_RUNS = 1000;
const DEFAULT_BINS = 60;
const MIN_BINS = 10;
const MAX_BINS = 250;

let containerEl = null;
let activeMetricKey = 'oil';
let pendingConfig = null; // edited but not yet simulated

export function init() {
  containerEl = document.getElementById('distribution-container');
}

export function setupEvents() {
  store.subscribe(
    (s) => [s.activeField, s.activeScenario, s._sig?.caseUpdated, s._sig?.caseDeleted, s._sig?.caseCreated],
    () => { pendingConfig = null; render(); },
  );
}

export function render() {
  if (!containerEl) containerEl = document.getElementById('distribution-container');
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
  if (!baseName) {
    containerEl.appendChild(emptyState('Mark one case as the reference (★ on the case card) to enable the simulation.'));
    return;
  }

  const slots = buildSlots(cases, baseName);
  if (slots.length === 0) {
    containerEl.appendChild(emptyState('Assign a parameter name to one or more non-reference cases (via the pen icon on the card) to enable the simulation.'));
    return;
  }

  // Hydrate pending config from prior simulation if available
  const prior = loadSimulation(field);
  if (!pendingConfig) {
    pendingConfig = hydrateConfig(prior, slots, scenario, baseName);
  } else {
    // Reconcile in case slots changed
    pendingConfig = reconcileConfig(pendingConfig, slots, scenario, baseName);
  }

  // ── Header (metric selector + export) ──
  const header = el('div', { class: 'flex items-center justify-between mb-3 gap-3 flex-wrap' });
  header.appendChild(buildMetricSelector());
  header.appendChild(buildExportButtons());
  containerEl.appendChild(header);

  // ── Quick assumptions panel ──
  containerEl.appendChild(buildAssumptionsPanel(slots, field));

  // ── Plot (or hint to simulate) ──
  const plotMount = el('div', { class: 'mt-4' });
  containerEl.appendChild(plotMount);

  const sim = loadSimulation(field);
  const fresh = sim
    && sim.scenario === scenario
    && sim.refCase === baseName
    && simSignatureMatches(sim, slots, pendingConfig);

  if (fresh) {
    plotMount.appendChild(buildPlot(sim, field));
  } else if (sim) {
    plotMount.appendChild(staleNotice());
    plotMount.appendChild(buildPlot(sim, field, /*stale=*/true));
  } else {
    plotMount.appendChild(emptyState('Click Simulate to run the Monte Carlo.'));
  }
}

// ─── Aggregate parameter extraction ─────────────────────────

function aggregates(caseData) {
  if (!caseData?.data) return null;
  let bulk = 0, net = 0, pore = 0, ho = 0, hg = 0, st = 0, gi = 0;
  for (const r of caseData.data) {
    bulk += parseFloat(r['Bulk volume']) || 0;
    net  += parseFloat(r['Net volume'])  || 0;
    pore += parseFloat(r['Pore volume']) || 0;
    ho   += parseFloat(r['HCPV oil'])    || 0;
    hg   += parseFloat(r['HCPV gas'])    || 0;
    st   += parseFloat(r['STOIIP'])      || 0;
    gi   += parseFloat(r['GIIP'])        || 0;
  }
  return {
    GRV:    bulk,
    NTG:    bulk > 0 ? net / bulk : 0,
    Por:    net  > 0 ? pore / net : 0,
    So:     pore > 0 ? ho / pore : 0,
    Sg:     pore > 0 ? hg / pore : 0,
    '1/Bo': ho   > 0 ? st / ho : 0,
    '1/Bg': hg   > 0 ? gi / hg : 0,
    STOIIP: st,
    GIIP:   gi,
  };
}

function multiplierVector(refAgg, caseAgg) {
  const v = {};
  for (const k of FUNDAMENTALS) {
    const r = refAgg[k];
    const c = caseAgg[k];
    v[k] = (r > 0 && Number.isFinite(c)) ? (c / r) : 1;
  }
  return v;
}

function identityVector() {
  const v = {};
  for (const k of FUNDAMENTALS) v[k] = 1;
  return v;
}

// ─── Per-zone refs (cached during a simulation) ─────────────

function zoneVectors(refCase) {
  const out = [];
  for (const row of refCase.data || []) {
    const bulk = parseFloat(row['Bulk volume']) || 0;
    const net  = parseFloat(row['Net volume'])  || 0;
    const pore = parseFloat(row['Pore volume']) || 0;
    const ho   = parseFloat(row['HCPV oil'])    || 0;
    const hg   = parseFloat(row['HCPV gas'])    || 0;
    const st   = parseFloat(row['STOIIP'])      || 0;
    const gi   = parseFloat(row['GIIP'])        || 0;
    out.push({
      GRV:  bulk,
      NTG:  bulk > 0 ? net / bulk : 0,
      Por:  net  > 0 ? pore / net : 0,
      So:   pore > 0 ? ho / pore : 0,
      Sg:   pore > 0 ? hg / pore : 0,
      Bo:   ho   > 0 ? st / ho : 0,
      Bg:   hg   > 0 ? gi / hg : 0,
    });
  }
  return out;
}

// ─── Slot construction (each tornado label = one slot) ──────

function buildSlots(cases, baseName) {
  const refCase = cases[baseName];
  if (!refCase) return [];
  const refAgg = aggregates(refCase);
  if (!refAgg || refAgg.GRV <= 0) return [];

  // Group cases by parameterName
  const groups = new Map();
  for (const [name, c] of Object.entries(cases)) {
    if (!c || name === baseName) continue;
    const param = (c.parameterName || '').trim();
    if (!param) continue;
    if (!groups.has(param)) groups.set(param, []);
    const agg = aggregates(c);
    if (!agg) continue;
    groups.get(param).push({ name, agg, multVec: multiplierVector(refAgg, agg) });
  }

  // For each label: identify the DOMINANT fundamental (largest |log mult| averaged
  // across cases for the slot), then pick low/high by that fundamental's value.
  // Univariate sampling: only the dominant fundamental moves when this slot is sampled.
  // Other components are reported as "drift" but ignored by the MC.
  const slots = [];
  for (const [label, entries] of groups.entries()) {
    if (entries.length === 0) continue;

    // Score each fundamental: average |log(multVec[k])| across cases for this label
    const scores = {};
    for (const k of FUNDAMENTALS) {
      let s = 0;
      for (const e of entries) s += Math.abs(Math.log(e.multVec[k] || 1));
      scores[k] = s / entries.length;
    }
    let fund = FUNDAMENTALS[0];
    for (const k of FUNDAMENTALS) if (scores[k] > scores[fund]) fund = k;
    if (scores[fund] < 1e-6) continue; // Slot has no detectable impact at all

    // Sort cases by their dominant-fund multiplier
    const sorted = entries.slice().sort((a, b) => a.multVec[fund] - b.multVec[fund]);
    let lowEntry = null, highEntry = null;
    if (sorted.length === 1) {
      const only = sorted[0];
      if (only.multVec[fund] < 1) lowEntry = only;
      else if (only.multVec[fund] > 1) highEntry = only;
      else continue;
    } else {
      lowEntry  = sorted[0].multVec[fund]                  < 1 ? sorted[0]                  : null;
      highEntry = sorted[sorted.length - 1].multVec[fund]  > 1 ? sorted[sorted.length - 1]  : null;
      if (!lowEntry && !highEntry) continue;
    }

    slots.push({
      label,
      fund,
      lowCase:   lowEntry  ? lowEntry.name  : null,
      highCase:  highEntry ? highEntry.name : null,
      lowMult:   lowEntry  ? lowEntry.multVec[fund]  : 1,
      highMult:  highEntry ? highEntry.multVec[fund] : 1,
      lowVec:    lowEntry  ? lowEntry.multVec  : identityVector(),
      highVec:   highEntry ? highEntry.multVec : identityVector(),
      lowDelta:  lowEntry  ? (lowEntry.multVec[fund]  - 1) : 0,
      highDelta: highEntry ? (highEntry.multVec[fund] - 1) : 0,
    });
  }

  // Sort by absolute range of the dominant-fund multiplier (descending)
  slots.sort((a, b) => Math.abs(b.highMult - b.lowMult) - Math.abs(a.highMult - a.lowMult));
  return slots;
}

// ─── Config (weights/runs) hydration ────────────────────────

function defaultConfig(slots, scenario, baseName) {
  const weights = {};
  for (const s of slots) weights[s.label] = DEFAULT_WEIGHTS.slice();
  return { runs: DEFAULT_RUNS, bins: DEFAULT_BINS, weights, scenario, refCase: baseName };
}

function hydrateConfig(prior, slots, scenario, baseName) {
  if (!prior || prior.scenario !== scenario || prior.refCase !== baseName) {
    return defaultConfig(slots, scenario, baseName);
  }
  const cfg = defaultConfig(slots, scenario, baseName);
  cfg.runs = prior.config?.runs || DEFAULT_RUNS;
  cfg.bins = clampBins(prior.config?.bins);
  for (const s of slots) {
    const w = prior.config?.weights?.[s.label];
    if (Array.isArray(w) && w.length === 3) cfg.weights[s.label] = normalizeWeights(w);
  }
  return cfg;
}

function clampBins(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return DEFAULT_BINS;
  return Math.max(MIN_BINS, Math.min(MAX_BINS, v));
}

function reconcileConfig(cfg, slots, scenario, baseName) {
  const out = { ...cfg, scenario, refCase: baseName, weights: { ...cfg.weights } };
  for (const s of slots) {
    if (!out.weights[s.label]) out.weights[s.label] = DEFAULT_WEIGHTS.slice();
  }
  // Drop weights for labels that no longer exist
  const valid = new Set(slots.map((s) => s.label));
  for (const k of Object.keys(out.weights)) if (!valid.has(k)) delete out.weights[k];
  return out;
}

function normalizeWeights(w) {
  const nums = w.map((x) => Math.max(0, parseFloat(x) || 0));
  const sum = nums.reduce((a, b) => a + b, 0);
  if (sum <= 0) return DEFAULT_WEIGHTS.slice();
  return nums.map((x) => x / sum);
}

function simSignatureMatches(sim, slots, cfg) {
  if (!sim?.config) return false;
  if ((sim.config.runs || 0) !== (cfg.runs || 0)) return false;
  if ((sim.config.bins || DEFAULT_BINS) !== (cfg.bins || DEFAULT_BINS)) return false;
  const labels = slots.map((s) => s.label).sort();
  const simLabels = Object.keys(sim.config.weights || {}).sort();
  if (labels.join('|') !== simLabels.join('|')) return false;
  for (const s of slots) {
    const w = sim.config.weights[s.label];
    const cw = cfg.weights[s.label];
    if (!w || !cw) return false;
    for (let i = 0; i < 3; i++) if (Math.abs(w[i] - cw[i]) > 1e-6) return false;
    // Also check that the dominant fund + its multipliers haven't drifted
    const stored = sim.config.slotMults?.[s.label];
    if (!stored) return false;
    if (stored.fund !== s.fund) return false;
    if (Math.abs((stored.low ?? 1)  - s.lowMult)  > 1e-6) return false;
    if (Math.abs((stored.high ?? 1) - s.highMult) > 1e-6) return false;
  }
  return true;
}

// ─── Monte Carlo engine ─────────────────────────────────────

function runMonteCarlo(refCase, slots, cfg) {
  const zones = zoneVectors(refCase);
  const N = Math.max(10, Math.min(200000, parseInt(cfg.runs, 10) || DEFAULT_RUNS));
  const binCount = clampBins(cfg.bins);

  // Pre-build per-slot CDF for fast sampling: [w_low_cum, w_low_cum+w_ref_cum]
  const slotCdfs = slots.map((s) => {
    const w = normalizeWeights(cfg.weights[s.label] || DEFAULT_WEIGHTS);
    return [w[0], w[0] + w[1]]; // index 0 = low, 1 = ref, 2 = high
  });

  const oilArr = new Float64Array(N);
  const gasArr = new Float64Array(N);
  const oeArr  = new Float64Array(N);

  // Working multiplier vector (reused every trial). Univariate: each slot only
  // touches its dominant fundamental — multiple slots with the same dominant
  // fundamental compose multiplicatively (e.g. Structure × OWC both on GRV).
  const m = { GRV: 1, NTG: 1, Por: 1, So: 1, Sg: 1, '1/Bo': 1, '1/Bg': 1 };

  for (let t = 0; t < N; t++) {
    m.GRV = 1; m.NTG = 1; m.Por = 1; m.So = 1; m.Sg = 1; m['1/Bo'] = 1; m['1/Bg'] = 1;

    for (let i = 0; i < slots.length; i++) {
      const r = Math.random();
      const cdf = slotCdfs[i];
      let pick;
      if (r < cdf[0])      pick = slots[i].lowMult;
      else if (r < cdf[1]) pick = 1; // ref → identity for this slot
      else                 pick = slots[i].highMult;
      if (pick === 1) continue;
      m[slots[i].fund] *= pick;
    }

    // Apply per-zone
    let oil = 0, gas = 0;
    for (let z = 0; z < zones.length; z++) {
      const zv = zones[z];
      const grv = zv.GRV * m.GRV;
      const ntg = zv.NTG * m.NTG;
      const por = zv.Por * m.Por;
      const so  = zv.So  * m.So;
      const sg  = zv.Sg  * m.Sg;
      const bo  = zv.Bo  * m['1/Bo'];
      const bg  = zv.Bg  * m['1/Bg'];
      oil += grv * ntg * por * so * bo;
      gas += grv * ntg * por * sg * bg;
    }
    oilArr[t] = oil;
    gasArr[t] = gas;
    oeArr[t]  = oil + gas;
  }

  return {
    oil: summarize(oilArr, binCount),
    gas: summarize(gasArr, binCount),
    oe:  summarize(oeArr,  binCount),
  };
}

function summarize(arr, binCount) {
  const N = arr.length;
  const sorted = Float64Array.from(arr).sort();
  const pct = (q) => {
    const idx = Math.max(0, Math.min(N - 1, Math.floor(q * (N - 1) + 0.5)));
    return sorted[idx];
  };
  // P-naming convention: P90 = low (10th percentile from bottom),
  //                      P50 = median,
  //                      P10 = high (90th percentile from bottom)
  const p90 = pct(0.10);
  const p50 = pct(0.50);
  const p10 = pct(0.90);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += sorted[i];
  const mean = sum / N;
  const min = sorted[0], max = sorted[N - 1];

  // Histogram with nice-snapped bin edges. The user asks for approximately
  // `binCount` bins; we snap the bin width to {1, 2, 5} × 10^k so edges land
  // at round numbers (e.g. 1.0M, 1.05M, 1.10M instead of 0.987M, 1.034M…).
  // The actual bin count therefore drifts slightly from the requested target.
  const span = max - min;
  const w = niceStep(span / binCount);
  const lo = Math.floor(min / w) * w;
  const hi = Math.ceil((max + w * 1e-9) / w) * w;
  const actualBins = Math.max(1, Math.round((hi - lo) / w));
  const bins = new Array(actualBins).fill(0);
  for (let i = 0; i < N; i++) {
    let idx = Math.floor((sorted[i] - lo) / w);
    if (idx < 0) idx = 0;
    if (idx >= actualBins) idx = actualBins - 1;
    bins[idx]++;
  }

  // Quantile curve — sampled at K evenly-spaced probabilities. Decoupled
  // from the histogram: the bin choice affects the bars, not the cumulative
  // line. K=100 is smooth at typical plot widths without bloating storage.
  const K = 100;
  const quantiles = new Array(K);
  for (let i = 0; i < K; i++) {
    const idx = Math.round((i / (K - 1)) * (N - 1));
    quantiles[i] = sorted[idx];
  }

  return {
    p90, p50, p10, mean, min, max,
    binMin: lo, binMax: hi, binCount: actualBins, binWidth: w,
    bins,
    quantiles,
  };
}

// Snap a rough step to the nearest "nice" {1, 2, 5} × 10^k value.
function niceStep(rough) {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let nice;
  if (norm < 1.5)      nice = 1;
  else if (norm < 3.5) nice = 2;
  else if (norm < 7.5) nice = 5;
  else                 nice = 10;
  return nice * mag;
}

// ─── UI: assumptions panel ──────────────────────────────────

function buildAssumptionsPanel(slots, field) {
  const wrap = el('div', {
    class: 'border border-gray-200 rounded-lg p-3 bg-gray-50/50',
  });

  // Header row: title + runs input + simulate
  const top = el('div', { class: 'flex items-center justify-between gap-3 flex-wrap mb-2' });
  top.appendChild(el('div', {
    class: 'text-xs font-medium text-gray-500 uppercase tracking-wider',
    textContent: 'Quick assumptions',
  }));

  const right = el('div', { class: 'flex items-center gap-3' });

  const runsLabel = el('label', { class: 'text-xs text-gray-500 flex items-center gap-1' });
  runsLabel.appendChild(document.createTextNode('Runs:'));
  const runsInput = el('input', {
    type: 'number',
    min: '50', max: '200000', step: '100',
    value: String(pendingConfig.runs),
    class: 'w-20 text-xs px-2 py-1 bg-white border border-gray-200 rounded focus:ring-1 focus:ring-indigo-500 focus:border-transparent',
  });
  runsInput.addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v) && v >= 50) pendingConfig.runs = v;
  });
  runsLabel.appendChild(runsInput);
  right.appendChild(runsLabel);

  const binsLabel = el('label', { class: 'text-xs text-gray-500 flex items-center gap-1' });
  binsLabel.appendChild(document.createTextNode('Bins:'));
  const binsInput = el('input', {
    type: 'number',
    min: String(MIN_BINS), max: String(MAX_BINS), step: '5',
    value: String(pendingConfig.bins),
    class: 'w-16 text-xs px-2 py-1 bg-white border border-gray-200 rounded focus:ring-1 focus:ring-indigo-500 focus:border-transparent',
    title: `Histogram bin count (${MIN_BINS}–${MAX_BINS}). Higher = finer detail; lower = smoother. Re-simulate after changing.`,
  });
  binsInput.addEventListener('input', (e) => {
    pendingConfig.bins = clampBins(e.target.value);
  });
  binsLabel.appendChild(binsInput);
  right.appendChild(binsLabel);

  const simBtn = el('button', {
    class: 'px-3 py-1 text-xs text-white bg-indigo-500 hover:bg-indigo-600 rounded transition-colors',
    textContent: 'Simulate',
  });
  simBtn.addEventListener('click', () => simulate(slots, field));
  right.appendChild(simBtn);

  top.appendChild(right);
  wrap.appendChild(top);

  // Per-slot table
  const table = el('table', { class: 'w-full text-xs' });
  const thead = el('thead');
  const headRow = el('tr', { class: 'text-gray-500 uppercase tracking-wider' });
  for (const h of ['Parameter', 'Low case', 'High case', 'Δ on dominant (L / H)', 'Sampled fund.', 'Weights (L / R / H)']) {
    headRow.appendChild(el('th', {
      class: 'text-left font-medium py-1 px-2',
      textContent: h,
    }));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const s of slots) {
    const tr = el('tr', { class: 'border-t border-gray-200/70 align-middle' });

    tr.appendChild(el('td', { class: 'py-1.5 px-2 font-medium text-gray-700', textContent: s.label }));
    tr.appendChild(el('td', {
      class: 'py-1.5 px-2 text-gray-500',
      textContent: s.lowCase || '—',
    }));
    tr.appendChild(el('td', {
      class: 'py-1.5 px-2 text-gray-500',
      textContent: s.highCase || '—',
    }));

    // Impact column: dominant-fundamental relative delta (low / high)
    const impactCell = el('td', { class: 'py-1.5 px-2 text-gray-600 whitespace-nowrap' });
    const fmtPct = (d) => {
      const v = (d * 100).toFixed(1);
      return (d >= 0 ? '+' : '') + v + '%';
    };
    impactCell.innerHTML = `<span class="text-blue-600">${s.lowCase  ? fmtPct(s.lowDelta)  : '—'}</span>` +
                           ` <span class="text-gray-300">/</span> ` +
                           `<span class="text-red-600">${s.highCase ? fmtPct(s.highDelta) : '—'}</span>`;
    tr.appendChild(impactCell);

    // Drift column — show non-trivial fundamentals beyond the dominant one
    const driftCell = el('td', { class: 'py-1.5 px-2 text-gray-500 whitespace-nowrap' });
    driftCell.appendChild(driftBadge(s));
    tr.appendChild(driftCell);

    // Weights inputs
    const wts = pendingConfig.weights[s.label] || DEFAULT_WEIGHTS.slice();
    const wCell = el('td', { class: 'py-1.5 px-2' });
    const wWrap = el('div', { class: 'flex items-center gap-1' });
    const inputs = [];
    for (let i = 0; i < 3; i++) {
      const inp = el('input', {
        type: 'number',
        min: '0', max: '100', step: '1',
        value: String(Math.round(wts[i] * 100)),
        class: 'w-12 text-xs px-1 py-0.5 bg-white border border-gray-200 rounded focus:ring-1 focus:ring-indigo-500 focus:border-transparent text-center',
      });
      inp.addEventListener('input', () => {
        const vals = inputs.map((x) => Math.max(0, parseFloat(x.value) || 0));
        pendingConfig.weights[s.label] = normalizeWeights(vals);
      });
      inputs.push(inp);
      wWrap.appendChild(inp);
      if (i < 2) wWrap.appendChild(el('span', { class: 'text-gray-300', textContent: '/' }));
    }
    wCell.appendChild(wWrap);
    tr.appendChild(wCell);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  const tableScroll = el('div', { class: 'overflow-x-auto' });
  tableScroll.appendChild(table);
  wrap.appendChild(tableScroll);

  return wrap;
}

function driftBadge(s) {
  // Univariate: only the dominant fundamental (s.fund) is sampled. Anything
  // else with non-trivial movement in the tagged case(s) is reported here as
  // "ignored drift" so the user can sanity-check whether their labels are
  // clean. To attribute drift, give that fundamental its own tagged case.
  const others = [];
  for (const k of FUNDAMENTALS) {
    if (k === s.fund) continue;
    const lo = s.lowVec[k] ?? 1;
    const hi = s.highVec[k] ?? 1;
    const dev = Math.max(Math.abs(Math.log(lo)), Math.abs(Math.log(hi)));
    if (dev > 0.02) others.push({ k, lo, hi, dev });
  }
  others.sort((a, b) => b.dev - a.dev);

  const wrap = el('span', { class: 'inline-flex items-center gap-1' });
  const pill = el('span', {
    class: 'inline-block px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium',
    textContent: s.fund,
    title: 'Sampled fundamental for this slot',
  });
  wrap.appendChild(pill);
  if (others.length > 0) {
    const extra = el('span', {
      class: 'text-amber-600 cursor-help text-[10px]',
      title: 'Ignored drift in this slot\'s case(s) — give these fundamentals their own tagged cases to capture them:\n\n' +
             others.map((x) => `${x.k}: low ${(x.lo * 100).toFixed(1)}% / high ${(x.hi * 100).toFixed(1)}%`).join('\n'),
      textContent: `⚠ +${others.length}`,
    });
    wrap.appendChild(extra);
  }
  return wrap;
}

// ─── Simulate action ─────────────────────────────────────────

function simulate(slots, field) {
  const scenario = getActiveScenario();
  const baseName = getBaseCaseName(field, scenario);
  const cases = getCasesForScenario(field, scenario);
  const refCase = cases[baseName];
  if (!refCase) return;

  const cfg = pendingConfig;
  const t0 = performance.now();
  const results = runMonteCarlo(refCase, slots, cfg);
  const t1 = performance.now();

  // Persist a compact record (bins + percentiles, no raw trials)
  const slotMults = {};
  for (const s of slots) slotMults[s.label] = { fund: s.fund, low: s.lowMult, high: s.highMult };

  const sim = {
    ts: Date.now(),
    scenario,
    refCase: baseName,
    runMs: Math.round(t1 - t0),
    config: {
      runs: cfg.runs,
      bins: clampBins(cfg.bins),
      weights: cfg.weights,
      slotMults,
      slotMeta: slots.map((s) => ({
        label: s.label,
        fund: s.fund,
        lowCase: s.lowCase,
        highCase: s.highCase,
        lowMult: s.lowMult,
        highMult: s.highMult,
      })),
    },
    results,
  };
  saveSimulation(field, sim);
  render();
}

// ─── Plot rendering ─────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildPlot(sim, field, stale = false) {
  const metric = METRICS.find((m) => m.key === activeMetricKey) || METRICS[0];
  const r = sim.results[metric.key];
  if (!r || !Array.isArray(r.bins)) return emptyState('No data for this metric.');

  const cases = getCasesForScenario(field, sim.scenario);
  const sample = Object.values(cases).find((c) => c?.units);
  const unit = metric.key === 'oe'
    ? (sample?.units?.STOIIP || '')
    : (sample?.units?.[metric.column] || '');

  // Title, subtitle, and `n=…` are drawn INSIDE the SVG so they're included
  // in SVG/PNG exports. Runtime info (runs/ms/ref) is kept OUTSIDE the SVG
  // so exported images stay clean.
  const wrap = el('div');
  wrap.appendChild(drawDistribution(r, unit, metric, sim, field));
  wrap.appendChild(el('div', {
    class: 'text-[10px] text-gray-400 mt-1 text-right',
    textContent: `${sim.config.runs} runs · ${sim.runMs} ms · ref: ${sim.refCase}`,
  }));
  return wrap;
}

function staleNotice() {
  return el('div', {
    class: 'text-xs text-amber-600 italic mb-2 text-center',
    textContent: 'Inputs changed — click Simulate to refresh. Showing previous result.',
  });
}

const PLOT_W = 720;
const PLOT_H = 360;
// Top padding fits the title (y≈20) + subtitle/n (y≈40);
// bottom fits x-axis ticks (y≈+14) and label (y≈+30).
const PAD = { top: 60, right: 48, bottom: 42, left: 48 };

function drawDistribution(r, unit, metric, sim, field) {
  const innerW = PLOT_W - PAD.left - PAD.right;
  const innerH = PLOT_H - PAD.top - PAD.bottom;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('viewBox', `0 0 ${PLOT_W} ${PLOT_H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
  svg.setAttribute('class', 'distribution-svg');
  svg.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  svg.style.background = '#ffffff';

  // ── Title + percentile subtitle (inside the SVG so the export includes them) ──
  const cx = PAD.left + innerW / 2;
  const titleText = `${field || 'Field'} distribution plot`;
  svg.appendChild(svgText(titleText.toUpperCase(), cx, 20, {
    'text-anchor': 'middle',
    'font-size': '12',
    'font-weight': '600',
    fill: '#4338ca',
    'letter-spacing': '0.12em',
  }));

  const fmtP = (v) => `${formatCompact(v)}${unit ? ' ' + unit : ''}`;
  const subParts = [
    { label: `P90: ${fmtP(r.p90)}`,   color: '#2563eb' },
    { label: `P50: ${fmtP(r.p50)}`,   color: '#374151' },
    { label: `P10: ${fmtP(r.p10)}`,   color: '#dc2626' },
    { label: `Mean: ${fmtP(r.mean)}`, color: '#9ca3af' },
  ];
  const subtitle = document.createElementNS(SVG_NS, 'text');
  subtitle.setAttribute('x', cx);
  subtitle.setAttribute('y', 40);
  subtitle.setAttribute('text-anchor', 'middle');
  subtitle.setAttribute('font-size', '11');
  subParts.forEach((part, i) => {
    const ts = document.createElementNS(SVG_NS, 'tspan');
    ts.setAttribute('fill', part.color);
    if (i > 0) ts.setAttribute('dx', '12');
    ts.textContent = part.label;
    subtitle.appendChild(ts);
  });
  svg.appendChild(subtitle);

  const N = sim.config.runs;
  const xMin = r.binMin;
  const xMax = r.binMax;
  const xToPx = (x) => PAD.left + ((x - xMin) / (xMax - xMin)) * innerW;
  const maxCount = Math.max(...r.bins);
  const yHistToPx = (c) => PAD.top + innerH - (c / maxCount) * innerH * 0.9; // leave headroom

  // Histogram bars
  const binW = innerW / r.binCount;
  for (let i = 0; i < r.bins.length; i++) {
    const c = r.bins[i];
    if (c === 0) continue;
    const x = PAD.left + i * binW;
    const y = yHistToPx(c);
    const h = (PAD.top + innerH) - y;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', x + 0.5);
    rect.setAttribute('y', y);
    rect.setAttribute('width', Math.max(0.5, binW - 1));
    rect.setAttribute('height', h);
    rect.setAttribute('fill', '#cbd5e1'); // slate-300
    svg.appendChild(rect);
  }

  // Exceedance curve (descending): y(x) = P(X > x). Starts at 100% on the
  // left and counts down to 0% on the right. Matches the P-naming convention
  // P90 = low (90% chance the truth EXCEEDS this), P50 = median, P10 = high.
  //
  // Drawn from the stored quantile array — independent of bin count, so
  // changing bins doesn't distort the curve. (Legacy sims without
  // `quantiles` fall back to deriving from bin counts.)
  const yCdfToPx = (p) => PAD.top + innerH - p * innerH;
  let dPath;
  if (Array.isArray(r.quantiles) && r.quantiles.length > 1) {
    const Q = r.quantiles.length;
    // quantiles[i] is the value at probability i/(Q-1) ascending →
    // exceedance at that value is 1 - i/(Q-1).
    dPath = `M ${xToPx(r.quantiles[0])} ${yCdfToPx(1)}`;
    for (let i = 1; i < Q; i++) {
      dPath += ` L ${xToPx(r.quantiles[i])} ${yCdfToPx(1 - i / (Q - 1))}`;
    }
  } else {
    let acc = 0;
    const exceed = [];
    for (let i = 0; i < r.bins.length; i++) {
      acc += r.bins[i];
      exceed.push(1 - acc / N);
    }
    dPath = `M ${PAD.left} ${yCdfToPx(1)}`;
    for (let i = 0; i < exceed.length; i++) {
      dPath += ` L ${PAD.left + (i + 1) * binW} ${yCdfToPx(exceed[i])}`;
    }
  }
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', dPath);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#4338ca');
  path.setAttribute('stroke-width', '1.6');
  svg.appendChild(path);

  // P-percentile vertical markers
  const markers = [
    { value: r.p90, label: 'P90', color: '#2563eb' },
    { value: r.p50, label: 'P50', color: '#374151' },
    { value: r.p10, label: 'P10', color: '#dc2626' },
  ];
  for (const m of markers) {
    const x = xToPx(m.value);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x); line.setAttribute('x2', x);
    line.setAttribute('y1', PAD.top); line.setAttribute('y2', PAD.top + innerH);
    line.setAttribute('stroke', m.color);
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '3 3');
    svg.appendChild(line);
    const tx = svgText(m.label, x, PAD.top - 2, {
      'text-anchor': 'middle',
      'font-size': '10',
      'font-weight': '600',
      fill: m.color,
    });
    svg.appendChild(tx);
  }

  // Bottom axis: a few ticks
  const ticks = niceTicks(xMin, xMax, 6);
  for (const t of ticks) {
    const x = xToPx(t);
    const tick = document.createElementNS(SVG_NS, 'line');
    tick.setAttribute('x1', x); tick.setAttribute('x2', x);
    tick.setAttribute('y1', PAD.top + innerH);
    tick.setAttribute('y2', PAD.top + innerH + 4);
    tick.setAttribute('stroke', '#9ca3af');
    svg.appendChild(tick);
    svg.appendChild(svgText(formatCompact(t), x, PAD.top + innerH + 14, {
      'text-anchor': 'middle',
      'font-size': '10',
      fill: '#6b7280',
    }));
  }

  // X-axis label (units / metric)
  const xLabelText = `${metric.label}${unit ? ' (' + unit + ')' : ''}`;
  svg.appendChild(svgText(xLabelText, PAD.left + innerW / 2, PAD.top + innerH + 30, {
    'text-anchor': 'middle',
    'font-size': '11',
    fill: '#374151',
  }));

  // Sample size — small, top-right inside the plot area. The runtime
  // info (runs/ms/ref) is intentionally kept OUTSIDE the SVG so exported
  // images stay clean; only `n` is included since it's needed to interpret
  // the curve.
  svg.appendChild(svgText(`n = ${sim.config.runs}`, PAD.left + innerW, 40, {
    'text-anchor': 'end',
    'font-size': '10',
    fill: '#9ca3af',
  }));

  // Right Y axis: exceedance probability P(X > x)
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    const y = yCdfToPx(p);
    svg.appendChild(svgText(`${(p * 100).toFixed(0)}%`, PAD.left + innerW + 6, y + 3, {
      'text-anchor': 'start',
      'font-size': '9',
      fill: '#6366f1',
    }));
    if (p > 0 && p < 1) {
      const grid = document.createElementNS(SVG_NS, 'line');
      grid.setAttribute('x1', PAD.left); grid.setAttribute('x2', PAD.left + innerW);
      grid.setAttribute('y1', y); grid.setAttribute('y2', y);
      grid.setAttribute('stroke', '#eef2ff');
      grid.setAttribute('stroke-width', '1');
      svg.appendChild(grid);
    }
  }

  // Left Y axis: histogram count
  svg.appendChild(svgText('Frequency', PAD.left - 6, PAD.top + innerH / 2, {
    'text-anchor': 'middle',
    'font-size': '10',
    fill: '#6b7280',
    transform: `rotate(-90, ${PAD.left - 6}, ${PAD.top + innerH / 2})`,
  }));

  // Axis baseline
  const baseline = document.createElementNS(SVG_NS, 'line');
  baseline.setAttribute('x1', PAD.left); baseline.setAttribute('x2', PAD.left + innerW);
  baseline.setAttribute('y1', PAD.top + innerH); baseline.setAttribute('y2', PAD.top + innerH);
  baseline.setAttribute('stroke', '#9ca3af');
  svg.appendChild(baseline);

  return svg;
}

function niceTicks(lo, hi, count) {
  const span = hi - lo;
  if (span <= 0) return [lo];
  const rough = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const nice = [1, 2, 2.5, 5, 10].map((n) => n * mag);
  let step = nice[0];
  for (const s of nice) if (Math.abs(s - rough) < Math.abs(step - rough)) step = s;
  const start = Math.ceil(lo / step) * step;
  const out = [];
  for (let v = start; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

// ─── UI helpers ─────────────────────────────────────────────

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

function svgText(text, x, y, attrs = {}) {
  const t = document.createElementNS(SVG_NS, 'text');
  t.setAttribute('x', x);
  t.setAttribute('y', y);
  for (const [k, v] of Object.entries(attrs)) t.setAttribute(k, v);
  t.textContent = text;
  return t;
}

// ─── Export ─────────────────────────────────────────────────

function getCurrentSvgString() {
  const svg = containerEl?.querySelector('svg.distribution-svg');
  if (!svg) return null;
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
  const svg = containerEl?.querySelector('svg.distribution-svg');
  if (!svg) return;
  const str = getCurrentSvgString();
  const vb = svg.getAttribute('viewBox').split(' ').map(Number);
  const width = vb[2];
  const height = vb[3];
  const scale = 3;

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
  return `${field}_${scenario}_distribution_${activeMetricKey}`;
}
