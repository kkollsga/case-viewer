// core/storage.js — localStorage read/write with versioned schema
// Supports Field → Scenario → Case hierarchy.

import {
  getState, getActiveField, getActiveCase, getActiveScenario,
  serializeState, hydrateState, setDefaultAuthor,
} from './state.js';
import { SCHEMA_VERSION } from './state.js';

// ─── Key helpers ────────────────────────────────────────────

const KEYS = {
  state: 'caseviewer_v3_state',
  cases: (field, scenario) => `cv3_cases_${field}_${scenario}`,
  caseOrder: (field, scenario) => `cv3_order_${field}_${scenario}`,
  fieldSettings: (field) => `cv3_fieldSettings_${field}`,
  crossPlotSettings: (field) => `cv3_crossPlot_${field}`,
  circleSettings: (field, caseName) => `cv3_circle_${field}_${caseName}`,
  fieldCircleSettings: (field) => `cv3_fieldCircle_${field}`,
  legendLayer: (field) => `cv3_legend_${field}`,
  defaultAuthor: 'cv3_defaultAuthor',
};

// ─── JSON helpers ───────────────────────────────────────────

function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ─── App state persistence ──────────────────────────────────

export function saveAppState() {
  writeJSON(KEYS.state, serializeState());
}

export function loadAppState() {
  const saved = readJSON(KEYS.state);
  if (saved) {
    if (saved.schema && saved.schema < SCHEMA_VERSION) migrateState(saved);
    hydrateState(saved);
  }
  const author = localStorage.getItem(KEYS.defaultAuthor);
  if (author) setDefaultAuthor(author);
}

function migrateState(saved) {
  saved.schema = SCHEMA_VERSION;
  if (!saved.scenarios) saved.scenarios = {};
  if (!saved.activeScenario) saved.activeScenario = null;
}

// ─── Legacy data detection ──────────────────────────────────

/**
 * Check if old v2 data exists in localStorage.
 */
export function hasLegacyData() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('volumetricCases_') || key === 'caseviewer_v2_state') {
      return true;
    }
  }
  return false;
}

/**
 * Delete all old v2 localStorage data.
 */
export function clearLegacyData() {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('volumetricCases_') || key.startsWith('volumetricCasesOrder_') ||
        key.startsWith('volumetricFields') || key.startsWith('volumetricSessionState') ||
        key.startsWith('fieldSettings_') || key.startsWith('crossPlotSettings_') ||
        key.startsWith('circleSettings_') || key.startsWith('fieldCircleSettings_') ||
        key.startsWith('legendLayer_') || key === 'caseviewer_v2_state' ||
        key === 'defaultAuthor' || key === 'caseviewer_v2_settings') {
      toRemove.push(key);
    }
  }
  toRemove.forEach(k => localStorage.removeItem(k));
  return toRemove.length;
}

// ─── Case data persistence ──────────────────────────────────

export function getCasesForScenario(field, scenario) {
  return readJSON(KEYS.cases(field, scenario), {});
}

// Alias for compatibility
export function getCasesForField(field) {
  const scenario = getActiveScenario();
  return scenario ? getCasesForScenario(field, scenario) : {};
}

export function getCaseData(field, caseName, scenario) {
  const sc = scenario || getActiveScenario();
  if (!sc) return null;
  const cases = getCasesForScenario(field, sc);
  return cases[caseName] || null;
}

export function saveCase(field, scenario, caseName, caseData) {
  const cases = getCasesForScenario(field, scenario);
  cases[caseName] = caseData;
  writeJSON(KEYS.cases(field, scenario), cases);
}

export function deleteCase(field, scenario, caseName) {
  const cases = getCasesForScenario(field, scenario);
  if (!cases[caseName]) return false;
  delete cases[caseName];
  writeJSON(KEYS.cases(field, scenario), cases);
  removeCaseFromOrder(field, scenario, caseName);
  return true;
}

export function renameCase(field, scenario, oldName, newName) {
  if (oldName === newName) return true;
  const cases = getCasesForScenario(field, scenario);
  if (cases[newName] || !cases[oldName]) return false;
  cases[newName] = { ...cases[oldName], title: newName };
  delete cases[oldName];
  writeJSON(KEYS.cases(field, scenario), cases);
  updateCaseOrderOnRename(field, scenario, oldName, newName);
  return true;
}

// ─── Case order ─────────────────────────────────────────────

export function getCaseOrder(field, scenario) {
  return readJSON(KEYS.caseOrder(field, scenario), null);
}

export function saveCaseOrder(field, scenario, order) {
  writeJSON(KEYS.caseOrder(field, scenario), order);
}

export function addCaseToOrder(field, scenario, caseName) {
  let order = getCaseOrder(field, scenario) || [];
  if (!order.includes(caseName)) {
    order.push(caseName);
    saveCaseOrder(field, scenario, order);
  }
}

function removeCaseFromOrder(field, scenario, caseName) {
  const order = getCaseOrder(field, scenario);
  if (!order) return;
  const idx = order.indexOf(caseName);
  if (idx !== -1) { order.splice(idx, 1); saveCaseOrder(field, scenario, order); }
}

function updateCaseOrderOnRename(field, scenario, oldName, newName) {
  const order = getCaseOrder(field, scenario);
  if (!order) return;
  const idx = order.indexOf(oldName);
  if (idx !== -1) { order[idx] = newName; saveCaseOrder(field, scenario, order); }
}

export function getOrderedCaseNames(field, scenario) {
  const sc = scenario || getActiveScenario();
  if (!sc) return [];
  const cases = getCasesForScenario(field, sc);
  const allNames = Object.keys(cases);
  const savedOrder = getCaseOrder(field, sc);
  if (!savedOrder) return allNames;
  const ordered = savedOrder.filter(n => allNames.includes(n));
  const extras = allNames.filter(n => !ordered.includes(n));
  return [...ordered, ...extras];
}

// ─── Scenario data lifecycle ────────────────────────────────

export function deleteScenarioData(field, scenario) {
  localStorage.removeItem(KEYS.cases(field, scenario));
  localStorage.removeItem(KEYS.caseOrder(field, scenario));
}

export function renameScenarioData(field, oldName, newName) {
  const pairs = [
    [KEYS.cases(field, oldName), KEYS.cases(field, newName)],
    [KEYS.caseOrder(field, oldName), KEYS.caseOrder(field, newName)],
  ];
  for (const [oldKey, newKey] of pairs) {
    const val = localStorage.getItem(oldKey);
    if (val !== null) { localStorage.setItem(newKey, val); localStorage.removeItem(oldKey); }
  }
}

// ─── Field settings ─────────────────────────────────────────

export function saveFieldSettings(field, settings) {
  const existing = readJSON(KEYS.fieldSettings(field), {});
  writeJSON(KEYS.fieldSettings(field), { ...existing, ...settings });
}

export function loadFieldSettings(field) {
  return readJSON(KEYS.fieldSettings(field), {});
}

export function saveCrossPlotSettings(field, settings) {
  writeJSON(KEYS.crossPlotSettings(field), settings);
}

export function loadCrossPlotSettings(field) {
  return readJSON(KEYS.crossPlotSettings(field), {});
}

// ─── Circle settings ────────────────────────────────────────

export function saveCircleSettings(field, caseName, settings) {
  writeJSON(KEYS.circleSettings(field, caseName), settings);
}

export function loadCircleSettings(field, caseName) {
  return readJSON(KEYS.circleSettings(field, caseName), null);
}

export function saveFieldCircleSettings(field, settings) {
  writeJSON(KEYS.fieldCircleSettings(field), settings);
}

export function loadFieldCircleSettings(field) {
  return readJSON(KEYS.fieldCircleSettings(field), {});
}

export function saveLegendLayer(field, layer) {
  localStorage.setItem(KEYS.legendLayer(field), String(layer));
}

export function loadLegendLayer(field) {
  const val = localStorage.getItem(KEYS.legendLayer(field));
  return val ? parseInt(val, 10) : 1;
}

// ─── Default author ─────────────────────────────────────────

export function saveDefaultAuthor(author) {
  localStorage.setItem(KEYS.defaultAuthor, author);
}

export function loadDefaultAuthor() {
  return localStorage.getItem(KEYS.defaultAuthor) || '';
}

// ─── Field data lifecycle ───────────────────────────────────

export function saveFields(fields) {
  // Fields are saved as part of app state
  saveAppState();
}

export function deleteFieldData(field) {
  const state = getState();
  const scenarios = state.scenarios[field] || [];
  for (const sc of scenarios) {
    deleteScenarioData(field, sc);
  }
  localStorage.removeItem(KEYS.fieldSettings(field));
  localStorage.removeItem(KEYS.crossPlotSettings(field));
  localStorage.removeItem(KEYS.fieldCircleSettings(field));
  localStorage.removeItem(KEYS.legendLayer(field));
}

export function renameFieldData(oldName, newName) {
  const state = getState();
  const scenarios = state.scenarios[newName] || [];
  for (const sc of scenarios) {
    renameScenarioData(oldName, sc, sc); // scenarios stay same name, field changes
    // Actually we need to rename the field part of the key
    const oldCasesKey = `cv3_cases_${oldName}_${sc}`;
    const newCasesKey = `cv3_cases_${newName}_${sc}`;
    const val = localStorage.getItem(oldCasesKey);
    if (val) { localStorage.setItem(newCasesKey, val); localStorage.removeItem(oldCasesKey); }

    const oldOrderKey = `cv3_order_${oldName}_${sc}`;
    const newOrderKey = `cv3_order_${newName}_${sc}`;
    const val2 = localStorage.getItem(oldOrderKey);
    if (val2) { localStorage.setItem(newOrderKey, val2); localStorage.removeItem(oldOrderKey); }
  }

  // Field-level settings
  const fieldKeys = [
    [KEYS.fieldSettings(oldName), KEYS.fieldSettings(newName)],
    [KEYS.crossPlotSettings(oldName), KEYS.crossPlotSettings(newName)],
    [KEYS.fieldCircleSettings(oldName), KEYS.fieldCircleSettings(newName)],
    [KEYS.legendLayer(oldName), KEYS.legendLayer(newName)],
  ];
  for (const [ok, nk] of fieldKeys) {
    const v = localStorage.getItem(ok);
    if (v !== null) { localStorage.setItem(nk, v); localStorage.removeItem(ok); }
  }
}
