// core/state.js — Central application state
// Single source of truth for all app data and UI state.

import { emit, EVENTS } from './events.js';

const SCHEMA_VERSION = 2;

/**
 * Default state structure.
 */
function createDefaultState() {
  return {
    schema: SCHEMA_VERSION,
    fields: ['Cerisa', 'Gjøa Nord'],
    activeField: null,
    activeCase: null,
    defaultAuthor: '',

    // Per-field base cases: { fieldName: caseName }
    baseCases: {},

    ui: {
      metric: 'STOIIP',
      showParameters: false,
      hideEmpty: true,
      view: 'pivot',
      compareCase: null,
      deltaMode: false,
      crossPlotX: 'bulkVolume',
      crossPlotY: 'stoiip',
      crossPlotGroupLevel: 1,
    },
  };
}

// The app state — module-level singleton
const state = createDefaultState();

// In-memory runtime state (not persisted)
const runtime = {
  // Current case's parsed data
  volumetricData: null,
  // All columns for current case
  columns: [],
  // Available cases for current field (ordered)
  availableCases: [],
  // Expanded zones in pivot table { caseKey: { groupKey: boolean } }
  expandedZones: {},
  // Colour map (see color.js — managed there, referenced here)
  // Cross-plot visibility state
  crossPlotVisibility: { groups: {}, cases: {} },
};

// ─── Accessors ──────────────────────────────────────────────

export function getState() {
  return state;
}

export function getRuntime() {
  return runtime;
}

export function getActiveField() {
  return state.activeField;
}

export function getActiveCase() {
  return state.activeCase;
}

export function getUI() {
  return state.ui;
}

export function getFields() {
  return state.fields;
}

// ─── Mutators ───────────────────────────────────────────────

export function setActiveField(fieldName) {
  if (state.activeField === fieldName) return;
  state.activeField = fieldName;
  emit(EVENTS.FIELD_CHANGED, { field: fieldName });
}

export function setActiveCase(caseName) {
  if (state.activeCase === caseName) return;
  state.activeCase = caseName;
  emit(EVENTS.CASE_SELECTED, { caseName });
}

export function setMetric(metric) {
  state.ui.metric = metric;
  emit(EVENTS.METRIC_CHANGED, { metric });
}

export function setView(view) {
  state.ui.view = view;
  emit(EVENTS.VIEW_CHANGED, { view });
}

export function setCompareCase(caseName) {
  state.ui.compareCase = caseName;
  state.ui.deltaMode = !!caseName;
  emit(EVENTS.COMPARE_CHANGED, { caseName });
}

export function setBaseCase(fieldName, caseName) {
  state.baseCases[fieldName] = caseName;
}

export function getBaseCase(fieldName) {
  return state.baseCases[fieldName || state.activeField] || null;
}

export function toggleDeltaMode() {
  state.ui.deltaMode = !state.ui.deltaMode;
  emit(EVENTS.TOGGLE_DELTA, { deltaMode: state.ui.deltaMode });
}

export function setShowParameters(val) {
  state.ui.showParameters = val;
  emit(EVENTS.TOGGLE_PARAMETERS, { showParameters: val });
}

export function setHideEmpty(val) {
  state.ui.hideEmpty = val;
  emit(EVENTS.TOGGLE_HIDE_EMPTY, { hideEmpty: val });
}

export function setDefaultAuthor(author) {
  state.defaultAuthor = author;
}

export function setCrossPlotAxes(x, y) {
  if (x !== undefined) state.ui.crossPlotX = x;
  if (y !== undefined) state.ui.crossPlotY = y;
}

export function setCrossPlotGroupLevel(level) {
  state.ui.crossPlotGroupLevel = level;
}

// ─── Field CRUD ─────────────────────────────────────────────

export function addField(name) {
  if (state.fields.includes(name)) return false;
  state.fields.push(name);
  emit(EVENTS.FIELD_CREATED, { field: name });
  return true;
}

export function renameField(oldName, newName) {
  if (oldName === newName) return false;
  if (state.fields.includes(newName)) return false;
  const idx = state.fields.indexOf(oldName);
  if (idx === -1) return false;
  state.fields[idx] = newName;
  if (state.activeField === oldName) state.activeField = newName;
  emit(EVENTS.FIELD_RENAMED, { oldName, newName });
  return true;
}

export function deleteField(name) {
  const idx = state.fields.indexOf(name);
  if (idx === -1) return false;
  state.fields.splice(idx, 1);
  if (state.activeField === name) {
    state.activeField = state.fields.length > 0 ? state.fields[0] : null;
    state.activeCase = null;
  }
  emit(EVENTS.FIELD_DELETED, { field: name });
  return true;
}

// ─── Runtime data ───────────────────────────────────────────

export function setVolumetricData(data) {
  runtime.volumetricData = data;
  if (data && data.data && data.data.length > 0) {
    runtime.columns = Object.keys(data.data[0]);
  } else {
    runtime.columns = [];
  }
  emit(EVENTS.DATA_LOADED, { data });
}

export function clearVolumetricData() {
  runtime.volumetricData = null;
  runtime.columns = [];
  emit(EVENTS.DATA_CLEARED);
}

export function setAvailableCases(cases) {
  runtime.availableCases = cases;
}

export function getExpandedZones(caseKey) {
  if (!runtime.expandedZones[caseKey]) {
    runtime.expandedZones[caseKey] = {};
  }
  return runtime.expandedZones[caseKey];
}

export function toggleZoneExpanded(caseKey, groupKey) {
  const zones = getExpandedZones(caseKey);
  zones[groupKey] = !zones[groupKey];
}

// ─── Hydration ──────────────────────────────────────────────

/**
 * Load state from a plain object (e.g. from localStorage).
 */
export function hydrateState(saved) {
  if (!saved) return;
  if (saved.fields) state.fields = saved.fields;
  if (saved.activeField) state.activeField = saved.activeField;
  if (saved.activeCase) state.activeCase = saved.activeCase;
  if (saved.defaultAuthor) state.defaultAuthor = saved.defaultAuthor;
  if (saved.baseCases) state.baseCases = saved.baseCases;
  if (saved.ui) Object.assign(state.ui, saved.ui);
  emit(EVENTS.STATE_LOADED, state);
}

/**
 * Serialize state for persistence.
 */
export function serializeState() {
  return {
    schema: state.schema,
    fields: state.fields,
    activeField: state.activeField,
    activeCase: state.activeCase,
    defaultAuthor: state.defaultAuthor,
    baseCases: { ...state.baseCases },
    ui: { ...state.ui },
  };
}

export { SCHEMA_VERSION };
