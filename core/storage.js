// core/storage.js — localStorage read/write with versioned schema
// ONE localStorage key per field. Structure:
// cv3_field_{name} = { scenarios: { name: { cases: {}, caseOrder: [] } }, settings: {}, groupMappings: {} }
// cv3_app = { schema, activeField, activeScenario, defaultAuthor, fields: [names], scenarios: {field:[names]} }

import {
  getState, getActiveField, getActiveCase, getActiveScenario,
  serializeState, hydrateState, setDefaultAuthor,
} from './state.js';
import { SCHEMA_VERSION } from './state.js';

// ─── JSON helpers ───────────────────────────────────────────

function readJSON(key, fallback = null) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ─── Field data access (single key per field) ───────────────

const FIELD_KEY = (field) => `cv3_field_${field}`;
const APP_KEY = 'cv3_app';

function getFieldStore(field) {
  return readJSON(FIELD_KEY(field), {
    scenarios: {},
    settings: {},
    groupMappings: {},
  });
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
  writeJSON(APP_KEY, serializeState());
}

export function loadAppState() {
  const saved = readJSON(APP_KEY);
  if (saved) {
    if (saved.schema && saved.schema < SCHEMA_VERSION) migrateAppState(saved);
    hydrateState(saved);
  }
  const author = readJSON('cv3_defaultAuthor', null);
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
    // v2 keys
    if (key.startsWith('volumetricCases_') || key === 'caseviewer_v2_state') return true;
    // v3 multi-key format (migrated automatically, but leftovers may exist)
    if (key.startsWith('cv3_cases_') || key.startsWith('cv3_order_') ||
        key.startsWith('cv3_fieldSettings_') || key.startsWith('cv3_crossPlot_') ||
        key.startsWith('cv3_circle_') || key.startsWith('cv3_fieldCircle_') ||
        key.startsWith('cv3_legend_') || key.startsWith('cv3_groupMappings_') ||
        key === 'caseviewer_v3_state') return true;
  }
  return false;
}

export function clearLegacyData() {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    // v2
    if (key.startsWith('volumetricCases') || key.startsWith('volumetricFields') ||
        key.startsWith('volumetricSession') || key.startsWith('fieldSettings_') ||
        key.startsWith('crossPlotSettings_') || key.startsWith('circleSettings_') ||
        key.startsWith('fieldCircleSettings_') || key.startsWith('legendLayer_') ||
        key === 'caseviewer_v2_state' || key === 'defaultAuthor' || key === 'caseviewer_v2_settings') {
      toRemove.push(key);
    }
    // v3 multi-key
    if (key.startsWith('cv3_cases_') || key.startsWith('cv3_order_') ||
        key.startsWith('cv3_fieldSettings_') || key.startsWith('cv3_crossPlot_') ||
        key.startsWith('cv3_circle_') || key.startsWith('cv3_fieldCircle_') ||
        key.startsWith('cv3_legend_') || key.startsWith('cv3_groupMappings_') ||
        key === 'caseviewer_v3_state') {
      toRemove.push(key);
    }
  }
  toRemove.forEach(k => localStorage.removeItem(k));
  return toRemove.length;
}

// ─── Case data ──────────────────────────────────────────────

export function getCasesForScenario(field, scenario) {
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
  const cases = getCasesForScenario(field, sc);
  return cases[caseName] || null;
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
  saveFieldStore(field, fs);
  return true;
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
    if (column === '__groupOrder') continue;
    lookup[column] = {};
    for (const stack of stacks) {
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

// ─── Default author ─────────────────────────────────────────

export function saveDefaultAuthor(author) {
  localStorage.setItem('cv3_defaultAuthor', author);
}

export function loadDefaultAuthor() {
  return localStorage.getItem('cv3_defaultAuthor') || '';
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
