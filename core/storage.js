// core/storage.js — localStorage read/write with versioned schema
// Handles persistence for app state, case data, field settings, and circle settings.

import {
  getState, getActiveField, getActiveCase, serializeState, hydrateState,
  setDefaultAuthor, getUI,
} from './state.js';
import { SCHEMA_VERSION } from './state.js';

// ─── Key helpers ────────────────────────────────────────────

const KEYS = {
  state: 'caseviewer_v2_state',
  cases: (field) => `volumetricCases_${field}`,
  caseOrder: (field) => `volumetricCasesOrder_${field}`,
  fieldSettings: (field) => `fieldSettings_${field}`,
  crossPlotSettings: (field) => `crossPlotSettings_${field}`,
  circleSettings: (field, caseName) => `circleSettings_${field}_${caseName}`,
  fieldCircleSettings: (field) => `fieldCircleSettings_${field}`,
  legendLayer: (field) => `legendLayer_${field}`,
  defaultAuthor: 'defaultAuthor',
};

// ─── JSON helpers ───────────────────────────────────────────

function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
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
    // Schema migration if needed
    if (saved.schema && saved.schema < SCHEMA_VERSION) {
      migrateState(saved);
    }
    hydrateState(saved);
  }

  // Load default author
  const author = localStorage.getItem(KEYS.defaultAuthor);
  if (author) setDefaultAuthor(author);
}

function migrateState(saved) {
  // Future: add migration logic per version bump
  saved.schema = SCHEMA_VERSION;
}

// ─── Case data persistence ──────────────────────────────────

/**
 * Get all cases for a field.
 * @returns {Object} { caseName: caseData, ... }
 */
export function getCasesForField(field) {
  return readJSON(KEYS.cases(field), {});
}

/**
 * Get a single case's data.
 */
export function getCaseData(field, caseName) {
  const cases = getCasesForField(field);
  return cases[caseName] || null;
}

/**
 * Save a case (create or update).
 */
export function saveCase(field, caseName, caseData) {
  const cases = getCasesForField(field);
  cases[caseName] = caseData;
  writeJSON(KEYS.cases(field), cases);
}

/**
 * Delete a case.
 */
export function deleteCase(field, caseName) {
  const cases = getCasesForField(field);
  if (!cases[caseName]) return false;
  delete cases[caseName];
  writeJSON(KEYS.cases(field), cases);

  // Clean up circle settings
  localStorage.removeItem(KEYS.circleSettings(field, caseName));

  // Remove from case order
  removeCaseFromOrder(field, caseName);
  return true;
}

/**
 * Rename a case (copy data to new key, delete old).
 */
export function renameCase(field, oldName, newName) {
  if (oldName === newName) return true;
  const cases = getCasesForField(field);
  if (cases[newName]) return false; // Name collision
  if (!cases[oldName]) return false;

  cases[newName] = { ...cases[oldName], title: newName };
  delete cases[oldName];
  writeJSON(KEYS.cases(field), cases);

  // Migrate circle settings
  const oldSettings = readJSON(KEYS.circleSettings(field, oldName));
  if (oldSettings) {
    writeJSON(KEYS.circleSettings(field, newName), oldSettings);
    localStorage.removeItem(KEYS.circleSettings(field, oldName));
  }

  // Update case order
  updateCaseOrderOnRename(field, oldName, newName);
  return true;
}

// ─── Case order persistence ─────────────────────────────────

export function getCaseOrder(field) {
  return readJSON(KEYS.caseOrder(field), null);
}

export function saveCaseOrder(field, order) {
  writeJSON(KEYS.caseOrder(field), order);
}

export function addCaseToOrder(field, caseName) {
  let order = getCaseOrder(field) || [];
  if (!order.includes(caseName)) {
    order.push(caseName);
    saveCaseOrder(field, order);
  }
}

function removeCaseFromOrder(field, caseName) {
  const order = getCaseOrder(field);
  if (!order) return;
  const idx = order.indexOf(caseName);
  if (idx !== -1) {
    order.splice(idx, 1);
    saveCaseOrder(field, order);
  }
}

function updateCaseOrderOnRename(field, oldName, newName) {
  const order = getCaseOrder(field);
  if (!order) return;
  const idx = order.indexOf(oldName);
  if (idx !== -1) {
    order[idx] = newName;
    saveCaseOrder(field, order);
  }
}

/**
 * Get ordered case names for a field.
 */
export function getOrderedCaseNames(field) {
  const cases = getCasesForField(field);
  const allNames = Object.keys(cases);
  const savedOrder = getCaseOrder(field);

  if (!savedOrder) return allNames;

  const ordered = savedOrder.filter(name => allNames.includes(name));
  const extras = allNames.filter(name => !ordered.includes(name));
  return [...ordered, ...extras];
}

// ─── Field settings persistence ─────────────────────────────

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

// ─── Circle/ball chart settings persistence ─────────────────

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

// ─── Field lifecycle ────────────────────────────────────────

/**
 * Save the fields list.
 */
export function saveFields(fields) {
  localStorage.setItem('volumetricFields', JSON.stringify(fields));
}

/**
 * Load fields list (for v1 migration compatibility).
 */
export function loadFieldsLegacy() {
  return readJSON('volumetricFields', null);
}

/**
 * Delete all data associated with a field.
 */
export function deleteFieldData(field) {
  localStorage.removeItem(KEYS.cases(field));
  localStorage.removeItem(KEYS.caseOrder(field));
  localStorage.removeItem(KEYS.fieldSettings(field));
  localStorage.removeItem(KEYS.crossPlotSettings(field));
  localStorage.removeItem(KEYS.fieldCircleSettings(field));
  localStorage.removeItem(KEYS.legendLayer(field));

  // Clean up per-case settings
  const cases = getCasesForField(field);
  for (const caseName of Object.keys(cases)) {
    localStorage.removeItem(KEYS.circleSettings(field, caseName));
  }
}

/**
 * Rename all storage keys when a field is renamed.
 */
export function renameFieldData(oldName, newName) {
  const keyPairs = [
    [KEYS.cases(oldName), KEYS.cases(newName)],
    [KEYS.caseOrder(oldName), KEYS.caseOrder(newName)],
    [KEYS.fieldSettings(oldName), KEYS.fieldSettings(newName)],
    [KEYS.crossPlotSettings(oldName), KEYS.crossPlotSettings(newName)],
    [KEYS.fieldCircleSettings(oldName), KEYS.fieldCircleSettings(newName)],
    [KEYS.legendLayer(oldName), KEYS.legendLayer(newName)],
  ];

  for (const [oldKey, newKey] of keyPairs) {
    const val = localStorage.getItem(oldKey);
    if (val !== null) {
      localStorage.setItem(newKey, val);
      localStorage.removeItem(oldKey);
    }
  }

  // Migrate per-case circle settings
  const cases = getCasesForField(newName);
  for (const caseName of Object.keys(cases)) {
    const oldKey = KEYS.circleSettings(oldName, caseName);
    const newKey = KEYS.circleSettings(newName, caseName);
    const val = localStorage.getItem(oldKey);
    if (val !== null) {
      localStorage.setItem(newKey, val);
      localStorage.removeItem(oldKey);
    }
  }
}
