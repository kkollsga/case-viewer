// core/storage.js — localStorage read/write with versioned schema
// ONE localStorage key per field. Structure:
// caseviewer_field_{name} = { scenarios: { name: { cases: {}, caseOrder: [] } }, settings: {}, groupMappings: {} }
// caseviewer_app = { schema, activeField, activeScenario, defaultAuthor, fields: [names], scenarios: {field:[names]} }

import {
  getState, getActiveField, getActiveCase, getActiveScenario,
  serializeState, hydrateState, setDefaultAuthor,
} from './state.js';
import { SCHEMA_VERSION } from './state.js';
import { PALETTES } from '../utils/color.js';

// ─── JSON helpers ───────────────────────────────────────────

function readJSON(key, fallback = null) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ─── Field data access (single key per field) ───────────────

const STORAGE_VERSION = 1;
const FIELD_KEY = (field) => `caseviewer_field_${field}`;
const APP_KEY = 'caseviewer_app';

function getFieldStore(field) {
  return readJSON(FIELD_KEY(field), {
    _v: STORAGE_VERSION,
    scenarios: {},
    settings: {},
    groupMappings: {},
  });
}

function createFieldStore() {
  return { _v: STORAGE_VERSION, scenarios: {}, settings: {}, groupMappings: {} };
}

function saveFieldStore(field, store) {
  writeJSON(FIELD_KEY(field), store);
}

function getScenarioStore(field, scenario) {
  const fs = getFieldStore(field);
  if (!fs.scenarios[scenario]) fs.scenarios[scenario] = { cases: {}, caseOrder: [] };
  return fs.scenarios[scenario];
}

// ─── App state persistence ──────────────────────────────────

export function saveAppState() {
  // No-op: the store auto-persists to localStorage.
  // Kept for API compatibility during migration.
}

export function loadAppState() {
  const saved = readJSON(APP_KEY);
  if (saved) {
    if (saved.schema && saved.schema < SCHEMA_VERSION) migrateAppState(saved);
    hydrateState(saved);
  }
  const author = readJSON('caseviewer_defaultAuthor', null);
  if (author) setDefaultAuthor(author);

}

function migrateAppState(saved) {
  saved.schema = SCHEMA_VERSION;
  if (!saved.scenarios) saved.scenarios = {};
}

// ─── Legacy data detection ──────────────────────────────────

export function hasLegacyData() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    // Any key from older versions
    if (key.startsWith('volumetric') || key.startsWith('cv3_') ||
        key === 'caseviewer_v2_state' || key === 'caseviewer_v3_state' ||
        key === 'defaultAuthor') return true;
    // Current-format keys with old _v
    if (key.startsWith('caseviewer_')) {
      try {
        const obj = JSON.parse(localStorage.getItem(key));
        if (obj && typeof obj === 'object' && obj._v !== STORAGE_VERSION) return true;
      } catch {}
    }
  }
  return false;
}

export function clearLegacyData() {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === APP_KEY) continue; // Keep current app state
    if (key.startsWith('caseviewer_field_')) {
      // Check version
      try {
        const obj = JSON.parse(localStorage.getItem(key));
        if (!obj || obj._v !== STORAGE_VERSION) toRemove.push(key);
      } catch { toRemove.push(key); }
      continue;
    }
    // Everything else that's not ours: old prefixes
    if (key.startsWith('volumetric') || key.startsWith('cv3_') || key.startsWith('fieldSettings_') ||
        key.startsWith('crossPlotSettings_') || key.startsWith('circleSettings_') ||
        key.startsWith('fieldCircleSettings_') || key.startsWith('legendLayer_') ||
        key === 'caseviewer_v2_state' || key === 'caseviewer_v3_state' ||
        key === 'defaultAuthor' || key === 'caseviewer_v2_settings') {
      toRemove.push(key);
    }
  }
  toRemove.forEach(k => localStorage.removeItem(k));
  return toRemove.length;
}

// ─── Case data ──────────────────────────────────────────────

export function getCasesForScenario(field, scenario) {
  const sc = getScenarioStore(field, scenario);
  const raw = sc.cases || {};
  // Resolve linked cases so callers see multiplied data transparently.
  const out = {};
  for (const [name, c] of Object.entries(raw)) {
    out[name] = c?.linkedFrom ? resolveLinkedCase(c, raw) : c;
  }
  return out;
}

export function getRawCasesForScenario(field, scenario) {
  const sc = getScenarioStore(field, scenario);
  return sc.cases || {};
}

export function getCasesForField(field) {
  const scenario = getActiveScenario();
  return scenario ? getCasesForScenario(field, scenario) : {};
}

export function getCaseData(field, caseName, scenario) {
  const sc = scenario || getActiveScenario();
  if (!sc) return null;
  const raw = getRawCasesForScenario(field, sc);
  const c = raw[caseName];
  if (!c) return null;
  return c.linkedFrom ? resolveLinkedCase(c, raw) : c;
}

export function getRawCase(field, scenario, caseName) {
  const raw = getRawCasesForScenario(field, scenario);
  return raw[caseName] || null;
}

// Valid targets a linked case can override. Mode is 'multiplier' or 'value'.
export const LINK_TARGETS = ['GRV', 'NTG', 'Por', 'So', 'Sg', '1/Bo', '1/Bg'];

function readLinkOverride(linked) {
  // Backward compat: legacy linked cases only had `multiplier` (= GRV ×).
  const target = LINK_TARGETS.includes(linked.paramTarget) ? linked.paramTarget : 'GRV';
  const mode = linked.paramMode === 'value' ? 'value' : 'multiplier';
  const raw = linked.paramValue !== undefined ? linked.paramValue : linked.multiplier;
  const num = parseFloat(raw);
  const value = Number.isFinite(num) ? num : (mode === 'multiplier' ? 1 : 0);
  return { target, mode, value };
}

function resolveLinkedCase(linked, rawCases) {
  const source = rawCases[linked.linkedFrom];
  if (!source || !source.data) {
    return { ...linked, data: [], _linkBroken: true };
  }
  const { target, mode, value } = readLinkOverride(linked);
  const apply = (orig) => (mode === 'multiplier' ? orig * value : value);

  // Apply the override to one parameter; cascade the rest from source ratios.
  const data = source.data.map((row) => {
    const out = { ...row };
    const bulk = parseFloat(row['Bulk volume']) || 0;
    const net = parseFloat(row['Net volume']) || 0;
    const pore = parseFloat(row['Pore volume']) || 0;
    const hcpvOil = parseFloat(row['HCPV oil']) || 0;
    const hcpvGas = parseFloat(row['HCPV gas']) || 0;
    const stoiipOrig = parseFloat(row['STOIIP']) || 0;
    const giipOrig = parseFloat(row['GIIP']) || 0;

    const ntgOrig = bulk > 0 ? net / bulk : 0;
    const porOrig = net > 0 ? pore / net : 0;
    const soOrig = pore > 0 ? hcpvOil / pore : 0;
    const sgOrig = pore > 0 ? hcpvGas / pore : 0;
    const boOrig = hcpvOil > 0 ? stoiipOrig / hcpvOil : 0;   // 1/Bo
    const bgOrig = hcpvGas > 0 ? giipOrig / hcpvGas : 0;     // 1/Bg

    const newGrv = target === 'GRV' ? apply(bulk) : bulk;
    const newNtg = target === 'NTG' ? apply(ntgOrig) : ntgOrig;
    const newPor = target === 'Por' ? apply(porOrig) : porOrig;
    const newSo = target === 'So' ? apply(soOrig) : soOrig;
    const newSg = target === 'Sg' ? apply(sgOrig) : sgOrig;
    const newBo = target === '1/Bo' ? apply(boOrig) : boOrig;
    const newBg = target === '1/Bg' ? apply(bgOrig) : bgOrig;

    const newNet = newGrv * newNtg;
    const newPore = newNet * newPor;
    const newHcpvOil = newPore * newSo;
    const newHcpvGas = newPore * newSg;
    const newStoiip = newHcpvOil * newBo;
    const newGiip = newHcpvGas * newBg;

    if ('Bulk volume' in row) out['Bulk volume'] = newGrv;
    if ('Net volume' in row) out['Net volume'] = newNet;
    if ('Pore volume' in row) out['Pore volume'] = newPore;
    if ('HCPV oil' in row) out['HCPV oil'] = newHcpvOil;
    if ('HCPV gas' in row) out['HCPV gas'] = newHcpvGas;
    if ('STOIIP' in row) out['STOIIP'] = newStoiip;
    if ('GIIP' in row) out['GIIP'] = newGiip;
    return out;
  });

  return {
    ...source,
    title: linked.title,
    description: linked.description,
    parameterName: linked.parameterName,
    isBaseCase: linked.isBaseCase,
    timestamp: linked.timestamp || source.timestamp,
    author: linked.author || source.author,
    linkedFrom: linked.linkedFrom,
    paramTarget: target,
    paramMode: mode,
    paramValue: value,
    multiplier: target === 'GRV' && mode === 'multiplier' ? value : undefined,
    data,
    units: source.units,
    volumeGroups: source.volumeGroups,
    valueConversions: source.valueConversions,
  };
}

export function saveCase(field, scenario, caseName, caseData) {
  const fs = getFieldStore(field);
  if (!fs.scenarios[scenario]) fs.scenarios[scenario] = { cases: {}, caseOrder: [] };
  fs.scenarios[scenario].cases[caseName] = caseData;
  saveFieldStore(field, fs);
}

export function deleteCase(field, scenario, caseName) {
  const fs = getFieldStore(field);
  const sc = fs.scenarios[scenario];
  if (!sc || !sc.cases[caseName]) return false;
  delete sc.cases[caseName];
  sc.caseOrder = (sc.caseOrder || []).filter(n => n !== caseName);
  // Clean up circle settings
  if (fs.settings.circleSettings) delete fs.settings.circleSettings[caseName];
  saveFieldStore(field, fs);
  return true;
}

export function renameCase(field, scenario, oldName, newName) {
  if (oldName === newName) return true;
  const fs = getFieldStore(field);
  const sc = fs.scenarios[scenario];
  if (!sc || sc.cases[newName] || !sc.cases[oldName]) return false;
  sc.cases[newName] = { ...sc.cases[oldName], title: newName };
  delete sc.cases[oldName];
  sc.caseOrder = (sc.caseOrder || []).map(n => n === oldName ? newName : n);
  // Update any linked cases that reference the old name
  for (const c of Object.values(sc.cases)) {
    if (c && c.linkedFrom === oldName) c.linkedFrom = newName;
  }
  saveFieldStore(field, fs);
  return true;
}

// ─── Case meta (parameter, base case) ───────────────────────

export function setCaseParameter(field, scenario, caseName, parameterName) {
  const fs = getFieldStore(field);
  const sc = fs.scenarios[scenario];
  if (!sc || !sc.cases[caseName]) return false;
  sc.cases[caseName].parameterName = parameterName || '';
  saveFieldStore(field, fs);
  return true;
}

export function updateCaseMeta(field, scenario, caseName, meta) {
  const fs = getFieldStore(field);
  const sc = fs.scenarios[scenario];
  if (!sc || !sc.cases[caseName]) return false;
  const c = sc.cases[caseName];
  if (meta.description !== undefined) c.description = meta.description;
  if (meta.parameterName !== undefined) c.parameterName = meta.parameterName;
  if (c.linkedFrom) {
    if (meta.paramTarget !== undefined && LINK_TARGETS.includes(meta.paramTarget)) {
      c.paramTarget = meta.paramTarget;
    }
    if (meta.paramMode !== undefined) {
      c.paramMode = meta.paramMode === 'value' ? 'value' : 'multiplier';
    }
    if (meta.paramValue !== undefined) {
      const num = parseFloat(meta.paramValue);
      const mode = c.paramMode || (meta.paramMode === 'value' ? 'value' : 'multiplier');
      c.paramValue = Number.isFinite(num) ? num : (mode === 'multiplier' ? 1 : 0);
    }
    // Legacy: keep `multiplier` in sync when target is GRV / multiplier mode
    if (c.paramTarget === 'GRV' && (c.paramMode || 'multiplier') === 'multiplier') {
      c.multiplier = c.paramValue;
    } else {
      delete c.multiplier;
    }
  }
  saveFieldStore(field, fs);
  return true;
}

// ─── Linked cases ───────────────────────────────────────────

export function createLinkedCase(field, scenario, sourceName, override = {}, newName) {
  const fs = getFieldStore(field);
  const sc = fs.scenarios[scenario];
  if (!sc || !sc.cases[sourceName]) return null;
  const source = sc.cases[sourceName];
  if (source.linkedFrom) return null; // don't allow chains for now

  const target = LINK_TARGETS.includes(override.paramTarget) ? override.paramTarget : 'GRV';
  const mode = override.paramMode === 'value' ? 'value' : 'multiplier';
  const valueRaw = parseFloat(override.paramValue);
  const value = Number.isFinite(valueRaw) ? valueRaw : (mode === 'multiplier' ? 1 : 0);

  const base = (newName && newName.trim()) || `${sourceName} (${formatLinkLabel(target, mode, value)})`;
  let candidate = base;
  let n = 2;
  while (sc.cases[candidate]) candidate = `${base} (${n++})`;

  const caseObj = {
    title: candidate,
    description: '',
    parameterName: '',
    timestamp: new Date().toISOString(),
    linkedFrom: sourceName,
    paramTarget: target,
    paramMode: mode,
    paramValue: value,
  };
  if (target === 'GRV' && mode === 'multiplier') caseObj.multiplier = value;

  sc.cases[candidate] = caseObj;
  if (!Array.isArray(sc.caseOrder)) sc.caseOrder = [];
  const idx = sc.caseOrder.indexOf(sourceName);
  if (idx === -1) sc.caseOrder.push(candidate);
  else sc.caseOrder.splice(idx + 1, 0, candidate);
  saveFieldStore(field, fs);
  return candidate;
}

export function formatLinkLabel(target, mode, value) {
  const v = formatMultiplier(value);
  if (mode === 'value') return `${target}=${v}`;
  return target === 'GRV' ? `×${v}` : `${target} ×${v}`;
}

function formatMultiplier(m) {
  const n = Number(m);
  if (!Number.isFinite(n)) return '1';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/\.?0+$/, '');
}

export function getLinkedCasesOf(field, scenario, sourceName) {
  const raw = getRawCasesForScenario(field, scenario);
  const out = [];
  for (const [name, c] of Object.entries(raw)) {
    if (c?.linkedFrom === sourceName) out.push(name);
  }
  return out;
}

export function setBaseCase(field, scenario, caseName) {
  const fs = getFieldStore(field);
  const sc = fs.scenarios[scenario];
  if (!sc) return false;
  for (const [name, c] of Object.entries(sc.cases || {})) {
    c.isBaseCase = (name === caseName);
  }
  saveFieldStore(field, fs);
  return true;
}

export function clearBaseCase(field, scenario) {
  const fs = getFieldStore(field);
  const sc = fs.scenarios[scenario];
  if (!sc) return false;
  for (const c of Object.values(sc.cases || {})) c.isBaseCase = false;
  saveFieldStore(field, fs);
  return true;
}

export function getBaseCaseName(field, scenario) {
  const cases = getCasesForScenario(field, scenario);
  for (const [name, c] of Object.entries(cases)) {
    if (c && c.isBaseCase) return name;
  }
  return null;
}

// ─── Case order ─────────────────────────────────────────────

export function getCaseOrder(field, scenario) {
  const sc = getScenarioStore(field, scenario);
  return sc.caseOrder || [];
}

export function saveCaseOrder(field, scenario, order) {
  const fs = getFieldStore(field);
  if (!fs.scenarios[scenario]) fs.scenarios[scenario] = { cases: {}, caseOrder: [] };
  fs.scenarios[scenario].caseOrder = order;
  saveFieldStore(field, fs);
}

export function addCaseToOrder(field, scenario, caseName) {
  const fs = getFieldStore(field);
  if (!fs.scenarios[scenario]) fs.scenarios[scenario] = { cases: {}, caseOrder: [] };
  const order = fs.scenarios[scenario].caseOrder || [];
  if (!order.includes(caseName)) order.push(caseName);
  fs.scenarios[scenario].caseOrder = order;
  saveFieldStore(field, fs);
}

export function getOrderedCaseNames(field, scenario) {
  const sc = scenario || getActiveScenario();
  if (!sc) return [];
  const cases = getCasesForScenario(field, sc);
  const allNames = Object.keys(cases);
  const savedOrder = getCaseOrder(field, sc);
  if (!savedOrder || savedOrder.length === 0) return allNames;
  const ordered = savedOrder.filter(n => allNames.includes(n));
  const extras = allNames.filter(n => !ordered.includes(n));
  return [...ordered, ...extras];
}

// ─── Scenario data lifecycle ────────────────────────────────

export function deleteScenarioData(field, scenario) {
  const fs = getFieldStore(field);
  delete fs.scenarios[scenario];
  saveFieldStore(field, fs);
}

export function renameScenarioData(field, oldName, newName) {
  const fs = getFieldStore(field);
  if (fs.scenarios[oldName]) {
    fs.scenarios[newName] = fs.scenarios[oldName];
    delete fs.scenarios[oldName];
    saveFieldStore(field, fs);
  }
}

// ─── Field settings ─────────────────────────────────────────

export function saveFieldSettings(field, settings) {
  const fs = getFieldStore(field);
  fs.settings = { ...fs.settings, ...settings };
  saveFieldStore(field, fs);
}

export function loadFieldSettings(field) {
  return getFieldStore(field).settings || {};
}

export function saveCrossPlotSettings(field, settings) {
  const fs = getFieldStore(field);
  fs.settings.crossPlot = settings;
  saveFieldStore(field, fs);
}

export function loadCrossPlotSettings(field) {
  return getFieldStore(field).settings?.crossPlot || {};
}

// ─── Circle settings ────────────────────────────────────────

export function saveCircleSettings(field, caseName, settings) {
  const fs = getFieldStore(field);
  if (!fs.settings.circleSettings) fs.settings.circleSettings = {};
  fs.settings.circleSettings[caseName] = settings;
  saveFieldStore(field, fs);
}

export function loadCircleSettings(field, caseName) {
  return getFieldStore(field).settings?.circleSettings?.[caseName] || null;
}

export function saveFieldCircleSettings(field, settings) {
  const fs = getFieldStore(field);
  fs.settings.fieldCircle = settings;
  saveFieldStore(field, fs);
}

export function loadFieldCircleSettings(field) {
  return getFieldStore(field).settings?.fieldCircle || {};
}

export function saveLegendLayer(field, layer) {
  const fs = getFieldStore(field);
  fs.settings.legendLayer = layer;
  saveFieldStore(field, fs);
}

export function loadLegendLayer(field) {
  return getFieldStore(field).settings?.legendLayer || 1;
}

// ─── Group mappings ─────────────────────────────────────────

export function saveGroupMappings(field, mappings) {
  const fs = getFieldStore(field);
  fs.groupMappings = mappings;
  saveFieldStore(field, fs);
}

export function loadGroupMappings(field) {
  return getFieldStore(field).groupMappings || {};
}

export function applyGroupMappings(data, field) {
  const mappings = loadGroupMappings(field);
  if (!mappings || Object.keys(mappings).length === 0) return data;

  const lookup = {};
  for (const [column, stacks] of Object.entries(mappings)) {
    if (column.startsWith('__')) continue; // Skip __groupOrder, __order_*, etc.
    if (!Array.isArray(stacks)) continue;
    lookup[column] = {};
    for (const stack of stacks) {
      if (!stack || !Array.isArray(stack.values)) continue;
      for (const val of stack.values) lookup[column][val] = stack.name;
    }
  }

  return data.map(row => {
    const newRow = { ...row };
    for (const [column, map] of Object.entries(lookup)) {
      if (newRow[column] !== undefined && map[newRow[column]] !== undefined) {
        newRow[column] = map[newRow[column]];
      }
    }
    return newRow;
  });
}

/**
 * Get the display order for group values in a column.
 * Returns an array of display names in the user-defined order.
 * Stack names come first, then bare values.
 * If no order is defined, returns null (use default sort).
 */
export function getGroupValueOrder(field, column) {
  const mappings = loadGroupMappings(field);
  if (!mappings) return null;

  const order = mappings[`__order_${column}`];
  const stacks = mappings[column];

  if (!order && !stacks) return null;

  // Build ordered list of display names
  const result = [];
  const seen = new Set();

  if (order) {
    for (const entry of order) {
      if (entry.type === 'stack' && entry.name && !seen.has(entry.name)) {
        result.push(entry.name);
        seen.add(entry.name);
      } else if (entry.type === 'pill' && entry.value && !seen.has(entry.value)) {
        result.push(entry.value);
        seen.add(entry.value);
      }
    }
  } else if (stacks && Array.isArray(stacks)) {
    // No explicit order — stacks first, then remaining values are unsorted
    for (const s of stacks) {
      if (s.name && !seen.has(s.name)) { result.push(s.name); seen.add(s.name); }
    }
  }

  return result.length > 0 ? result : null;
}

/**
 * Get the group type hierarchy order (which column is parent).
 * Returns an ordered array of column names, or null for default.
 */
export function getGroupTypeOrder(field) {
  const mappings = loadGroupMappings(field);
  if (!mappings || !mappings.__groupOrder) return null;
  return mappings.__groupOrder;
}

export function collectUniqueGroupValues(field) {
  const state = getState();
  const scenarios = state.scenarios[field] || [];
  const result = {};

  for (const sc of scenarios) {
    const cases = getCasesForScenario(field, sc);
    for (const caseData of Object.values(cases)) {
      if (!caseData?.data || !caseData.volumeGroups?.columns) continue;
      for (const col of caseData.volumeGroups.columns) {
        if (!result[col]) result[col] = new Set();
        for (const row of caseData.data) {
          if (row[col] !== undefined && row[col] !== '') result[col].add(String(row[col]));
        }
      }
    }
  }

  const out = {};
  for (const [col, vals] of Object.entries(result)) out[col] = [...vals].sort();
  return out;
}

/**
 * Compute deterministic color assignments for all values in a column.
 * Explicit colors (stack.color, __colors_*) are reserved first.
 * Remaining values auto-assigned sequentially from PALETTES.vibrant.
 */
export function computeColumnColors(field, column) {
  const mappings = loadGroupMappings(field);
  const palette = PALETTES.vibrant;
  const map = {};
  const reserved = new Set();

  // 1. Explicit from stacks
  for (const s of (mappings[column] || [])) {
    if (s.color) { map[s.name] = s.color; reserved.add(s.color); }
  }
  // 2. Explicit from pill palette
  for (const [val, col] of Object.entries(mappings[`__colors_${column}`] || {})) {
    map[val] = col; reserved.add(col);
  }
  // 3. Auto-assign remaining values
  const uniqueVals = collectUniqueGroupValues(field);
  const vals = uniqueVals[column] || [];
  const inStack = new Set();
  for (const s of (mappings[column] || [])) for (const v of s.values) inStack.add(v);

  let idx = 0;
  for (const val of vals) {
    if (map[val] || inStack.has(val)) continue;
    let color = null;
    for (let i = 0; i < palette.length; i++) {
      const c = palette[(idx + i) % palette.length];
      if (!reserved.has(c)) { color = c; idx = idx + i + 1; reserved.add(c); break; }
    }
    if (!color) { color = palette[idx % palette.length]; idx++; }
    map[val] = color;
  }
  return map;
}

// ─── Plot filter (one per field, shared by Tornado + Distribution) ──

export function loadPlotFilter(field) {
  const fs = getFieldStore(field);
  return fs.plotFilter || { prefix: null, exclude: {} };
}

export function savePlotFilter(field, filter) {
  const fs = getFieldStore(field);
  fs.plotFilter = filter;
  saveFieldStore(field, fs);
}

// Returns a new array containing only rows where every column's value (after
// resolving through group mappings, e.g. "Sand 5" → "Channel") is NOT in the
// filter's exclude set. Excluding by value (rather than including) means rows
// with newly added zone/facies values are kept by default.
export function applyPlotFilter(rows, filter, field) {
  if (!Array.isArray(rows) || !filter || !filter.exclude) return rows;
  const ex = filter.exclude;
  const cols = Object.keys(ex);
  if (cols.length === 0) return rows;
  // For each filtered column, build raw-value → stack-name lookup so the
  // filter compares against the same standardized names shown in the pills.
  const mappings = field ? loadGroupMappings(field) : null;
  const stackLookup = {};
  if (mappings) {
    for (const c of cols) {
      stackLookup[c] = {};
      const stacks = mappings[c];
      if (!Array.isArray(stacks)) continue;
      for (const stack of stacks) {
        if (!stack || !Array.isArray(stack.values)) continue;
        for (const v of stack.values) stackLookup[c][String(v)] = stack.name;
      }
    }
  }
  return rows.filter((row) => {
    for (const c of cols) {
      const list = ex[c];
      if (!Array.isArray(list) || list.length === 0) continue;
      const raw = row[c];
      const displayName = (stackLookup[c] && stackLookup[c][String(raw)]) || raw;
      if (list.includes(String(displayName))) return false;
    }
    return true;
  });
}

// ─── Monte Carlo simulation (in memory only — discarded on reload) ──

const _simCache = new Map();

export function saveSimulation(field, sim) {
  _simCache.set(field, sim);
  // Defensive: prior versions persisted simulation results in the field store.
  // Strip on next touch so localStorage doesn't carry stale data forever.
  const fs = getFieldStore(field);
  if (fs.simulation !== undefined) {
    delete fs.simulation;
    saveFieldStore(field, fs);
  }
}

export function loadSimulation(field) {
  return _simCache.get(field) || null;
}

export function clearSimulation(field) {
  _simCache.delete(field);
}

// ─── Default author ─────────────────────────────────────────

export function saveDefaultAuthor(author) {
  localStorage.setItem('caseviewer_defaultAuthor', author);
}

export function loadDefaultAuthor() {
  return localStorage.getItem('caseviewer_defaultAuthor') || '';
}

// ─── Field data lifecycle ───────────────────────────────────

export function saveFields(fields) {
  saveAppState();
}

export function deleteFieldData(field) {
  localStorage.removeItem(FIELD_KEY(field));
}

export function renameFieldData(oldName, newName) {
  const data = localStorage.getItem(FIELD_KEY(oldName));
  if (data) {
    localStorage.setItem(FIELD_KEY(newName), data);
    localStorage.removeItem(FIELD_KEY(oldName));
  }
}
