// core/state.js — Central application state.
// Delegates to core/store.js internally. Keeps the old API for backward compatibility.
// Bridge: subscribes to store slices and emits old events during migration.

import { createStore } from './store.js';
import { reducers } from './reducers.js';
import { emit, EVENTS } from './events.js';

// ─── Store setup ────────────────────────────────────────────

const SCHEMA_VERSION = 3;

const initialState = {
  schema: SCHEMA_VERSION,
  fields: [],
  scenarios: {},
  activeField: null,
  activeScenario: null,
  activeCase: null,
  selectedCases: [],
  defaultAuthor: '',

  ui: {
    metric: 'STOIIP',
    showParameters: false,
    hideEmpty: true,
    view: 'pivot',
    compareCase: null,
    deltaMode: false,
    showBrowser: true,
    crossPlotX: 'bulkVolume',
    crossPlotY: 'stoiip',
    crossPlotGroupLevel: 1,
  },

  // Runtime (not persisted)
  data: {
    volumetricData: null,
    columns: [],
    availableCases: [],
    expandedZones: {},
    crossPlotVisibility: { groups: {}, cases: {} },
  },
};

export const store = createStore(initialState, reducers, {
  persistKey: 'caseviewer_app',
  persistDebounceMs: 300,
  persistFilter: (state) => ({
    _v: 1,
    schema: state.schema,
    fields: state.fields,
    scenarios: state.scenarios,
    activeField: state.activeField,
    activeScenario: state.activeScenario,
    defaultAuthor: state.defaultAuthor,
    ui: state.ui,
  }),
});

// ─── Bridge: emit old events when store changes ─────────────
// Components still using on(EVENTS.*) will continue to work.

let bridgeActive = true;

store.subscribe('activeField', (val) => { if (bridgeActive) emit(EVENTS.FIELD_CHANGED, { field: val }); });
store.subscribe('activeScenario', (val) => { if (bridgeActive) emit(EVENTS.SCENARIO_CHANGED, { scenario: val }); });
store.subscribe('activeCase', (val) => {
  if (!bridgeActive) return;
  if (val) emit(EVENTS.CASE_SELECTED, { caseName: val });
  else emit(EVENTS.BROWSER_OPENED);
});
store.subscribe('selectedCases', () => { if (bridgeActive) emit(EVENTS.SELECTION_CHANGED, { selectedCases: store.getState().selectedCases }); });
store.subscribe(s => s.data.volumetricData, (val) => {
  if (!bridgeActive) return;
  if (val) emit(EVENTS.DATA_LOADED, { data: val });
  else emit(EVENTS.DATA_CLEARED);
});
store.subscribe('ui.metric', () => { if (bridgeActive) emit(EVENTS.METRIC_CHANGED, { metric: store.select('ui.metric') }); });
store.subscribe('ui.view', () => { if (bridgeActive) emit(EVENTS.VIEW_CHANGED, { view: store.select('ui.view') }); });
store.subscribe('ui.compareCase', () => { if (bridgeActive) emit(EVENTS.COMPARE_CHANGED, { caseName: store.select('ui.compareCase') }); });
store.subscribe('ui.showParameters', () => { if (bridgeActive) emit(EVENTS.TOGGLE_PARAMETERS, { showParameters: store.select('ui.showParameters') }); });
store.subscribe('ui.hideEmpty', () => { if (bridgeActive) emit(EVENTS.TOGGLE_HIDE_EMPTY, { hideEmpty: store.select('ui.hideEmpty') }); });
store.subscribe('ui.deltaMode', () => { if (bridgeActive) emit(EVENTS.TOGGLE_DELTA, { deltaMode: store.select('ui.deltaMode') }); });

// ─── Accessors (read from store) ────────────────────────────

export function getState() { return store.getState(); }
export function getRuntime() { return store.getState().data; }
export function getActiveField() { return store.select('activeField'); }
export function getActiveScenario() { return store.select('activeScenario'); }
export function getActiveCase() { return store.select('activeCase'); }
export function getSelectedCases() { return store.select('selectedCases'); }
export function getUI() { return store.select('ui'); }
export function getFields() { return store.select('fields'); }

export function getScenariosForField(fieldName) {
  const f = fieldName || store.select('activeField');
  return store.getState().scenarios[f] || [];
}

// ─── Mutators (dispatch to store) ───────────────────────────

export function setActiveField(fieldName) {
  if (store.select('activeField') === fieldName) return;
  store.dispatch('SET_ACTIVE_FIELD', { field: fieldName });
}

export function setActiveScenario(scenarioName) {
  if (store.select('activeScenario') === scenarioName) return;
  store.dispatch('SET_ACTIVE_SCENARIO', { scenario: scenarioName });
}

export function setActiveCase(caseName) {
  store.dispatch('SET_ACTIVE_CASE', { caseName });
}

export function setSelectedCases(caseNames) {
  store.dispatch('SET_SELECTED_CASES', { caseNames });
}

export function toggleCaseSelection(caseName) {
  store.dispatch('TOGGLE_CASE_SELECTION', { caseName });
}

export function openBrowser() {
  store.dispatch('OPEN_BROWSER');
}

export function setMetric(metric) {
  store.dispatch('SET_METRIC', { metric });
}

export function setView(view) {
  store.dispatch('SET_VIEW', { view });
}

export function setCompareCase(caseName) {
  store.dispatch('SET_COMPARE_CASE', { caseName });
}

export function setShowParameters(val) {
  store.dispatch('SET_SHOW_PARAMETERS', { value: val });
}

export function setHideEmpty(val) {
  store.dispatch('SET_HIDE_EMPTY', { value: val });
}

export function setDefaultAuthor(author) {
  store.dispatch('SET_DEFAULT_AUTHOR', { author });
}

export function setCrossPlotAxes(x, y) {
  store.dispatch('SET_CROSS_PLOT_AXES', { x, y });
}

export function setCrossPlotGroupLevel(level) {
  store.dispatch('SET_CROSS_PLOT_GROUP_LEVEL', { level });
}

export function setBaseCase() {} // No-op, reserved
export function getBaseCase() { return null; }

export function toggleDeltaMode() {
  store.dispatch('TOGGLE_DELTA_MODE');
}

// ─── Field CRUD ─────────────────────────────────────────────

export function addField(name) {
  if (store.getState().fields.includes(name)) return false;
  store.dispatch('ADD_FIELD', { name });
  emit(EVENTS.FIELD_CREATED, { field: name });
  return true;
}

export function renameField(oldName, newName) {
  if (oldName === newName || store.getState().fields.includes(newName)) return false;
  if (!store.getState().fields.includes(oldName)) return false;
  store.dispatch('RENAME_FIELD', { oldName, newName });
  emit(EVENTS.FIELD_RENAMED, { oldName, newName });
  return true;
}

export function deleteField(name) {
  if (!store.getState().fields.includes(name)) return false;
  store.dispatch('DELETE_FIELD', { name });
  emit(EVENTS.FIELD_DELETED, { field: name });
  return true;
}

// ─── Scenario CRUD ──────────────────────────────────────────

export function addScenario(fieldName, scenarioName) {
  const existing = store.getState().scenarios[fieldName] || [];
  if (existing.includes(scenarioName)) return false;
  store.dispatch('ADD_SCENARIO', { field: fieldName, scenario: scenarioName });
  emit(EVENTS.SCENARIO_CREATED, { field: fieldName, scenario: scenarioName });
  return true;
}

export function renameScenario(fieldName, oldName, newName) {
  store.dispatch('RENAME_SCENARIO', { field: fieldName, oldName, newName });
  emit(EVENTS.SCENARIO_RENAMED, { field: fieldName, oldName, newName });
  return true;
}

export function deleteScenario(fieldName, scenarioName) {
  store.dispatch('DELETE_SCENARIO', { field: fieldName, scenario: scenarioName });
  emit(EVENTS.SCENARIO_DELETED, { field: fieldName, scenario: scenarioName });
  return true;
}

// ─── Runtime data ───────────────────────────────────────────

export function setVolumetricData(data) {
  store.dispatch('SET_VOLUMETRIC_DATA', { data });
}

export function clearVolumetricData() {
  store.dispatch('CLEAR_VOLUMETRIC_DATA');
}

export function setAvailableCases(cases) {
  store.dispatch('SET_AVAILABLE_CASES', { cases });
}

export function getExpandedZones(caseKey) {
  const ez = store.getState().data.expandedZones;
  return ez[caseKey] || {};
}

export function toggleZoneExpanded(caseKey, groupKey) {
  store.dispatch('TOGGLE_ZONE_EXPANDED', { caseKey, groupKey });
}

// ─── Hydration ──────────────────────────────────────────────

export function hydrateState(saved) {
  if (!saved) return;
  bridgeActive = false; // Don't emit old events during hydration
  store.dispatch('HYDRATE_STATE', saved);
  bridgeActive = true;
  emit(EVENTS.STATE_LOADED, store.getState());
}

export function serializeState() {
  const s = store.getState();
  return {
    schema: s.schema,
    fields: s.fields,
    activeField: s.activeField,
    activeScenario: s.activeScenario,
    defaultAuthor: s.defaultAuthor,
    scenarios: { ...s.scenarios },
    ui: { ...s.ui },
  };
}

export { SCHEMA_VERSION };
