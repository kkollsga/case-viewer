// core/state.js — Central application state
// Single source of truth. Hierarchy: Field → Scenario → Case.

import { emit, EVENTS } from './events.js';

const SCHEMA_VERSION = 3;

function createDefaultState() {
  return {
    schema: SCHEMA_VERSION,
    fields: [],
    activeField: null,
    activeScenario: null,
    activeCase: null,        // primary case for viewing
    selectedCases: [],       // multi-select for comparison
    defaultAuthor: '',

    // Per-field scenarios: { fieldName: ['Default', 'High Case', ...] }
    scenarios: {},

    ui: {
      metric: 'STOIIP',
      showParameters: false,
      hideEmpty: true,
      view: 'pivot',
      compareCase: null,
      deltaMode: false,
      showBrowser: true,     // show case browser on load
      crossPlotX: 'bulkVolume',
      crossPlotY: 'stoiip',
      crossPlotGroupLevel: 1,
    },
  };
}

const state = createDefaultState();

// In-memory runtime state (not persisted)
const runtime = {
  volumetricData: null,
  columns: [],
  availableCases: [],
  expandedZones: {},
  crossPlotVisibility: { groups: {}, cases: {} },
};

// ─── Accessors ──────────────────────────────────────────────

export function getState() { return state; }
export function getRuntime() { return runtime; }
export function getActiveField() { return state.activeField; }
export function getActiveScenario() { return state.activeScenario; }
export function getActiveCase() { return state.activeCase; }
export function getSelectedCases() { return state.selectedCases; }
export function getUI() { return state.ui; }
export function getFields() { return state.fields; }

export function getScenariosForField(fieldName) {
  const f = fieldName || state.activeField;
  return state.scenarios[f] || [];
}

// ─── Mutators ───────────────────────────────────────────────

export function setActiveField(fieldName) {
  if (state.activeField === fieldName) return;
  state.activeField = fieldName;
  state.activeScenario = null;
  state.activeCase = null;
  state.selectedCases = [];
  state.ui.showBrowser = true;
  emit(EVENTS.FIELD_CHANGED, { field: fieldName });
}

export function setActiveScenario(scenarioName) {
  if (state.activeScenario === scenarioName) return;
  state.activeScenario = scenarioName;
  state.activeCase = null;
  state.selectedCases = [];
  state.ui.showBrowser = true;
  emit(EVENTS.SCENARIO_CHANGED, { scenario: scenarioName });
}

export function setActiveCase(caseName) {
  state.activeCase = caseName;
  state.ui.showBrowser = false;
  emit(EVENTS.CASE_SELECTED, { caseName });
}

export function setSelectedCases(caseNames) {
  state.selectedCases = [...caseNames];
  emit(EVENTS.SELECTION_CHANGED, { selectedCases: state.selectedCases });
}

export function toggleCaseSelection(caseName) {
  const idx = state.selectedCases.indexOf(caseName);
  if (idx === -1) {
    state.selectedCases.push(caseName);
  } else {
    state.selectedCases.splice(idx, 1);
  }
  emit(EVENTS.SELECTION_CHANGED, { selectedCases: state.selectedCases });
}

export function openBrowser() {
  state.ui.showBrowser = true;
  state.activeCase = null;
  state.ui.compareCase = null;
  state.ui.deltaMode = false;
  emit(EVENTS.BROWSER_OPENED);
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

export function setBaseCase(fieldName, caseName) {
  // No-op for now, reserved for future use
}

export function getBaseCase(fieldName) {
  return null;
}

export function toggleDeltaMode() {
  state.ui.deltaMode = !state.ui.deltaMode;
  emit(EVENTS.TOGGLE_DELTA, { deltaMode: state.ui.deltaMode });
}

// ─── Field CRUD ─────────────────────────────────────────────

export function addField(name) {
  if (state.fields.includes(name)) return false;
  state.fields.push(name);
  state.scenarios[name] = ['Default'];
  emit(EVENTS.FIELD_CREATED, { field: name });
  return true;
}

export function renameField(oldName, newName) {
  if (oldName === newName || state.fields.includes(newName)) return false;
  const idx = state.fields.indexOf(oldName);
  if (idx === -1) return false;
  state.fields[idx] = newName;
  // Move scenarios
  if (state.scenarios[oldName]) {
    state.scenarios[newName] = state.scenarios[oldName];
    delete state.scenarios[oldName];
  }
  if (state.activeField === oldName) state.activeField = newName;
  emit(EVENTS.FIELD_RENAMED, { oldName, newName });
  return true;
}

export function deleteField(name) {
  const idx = state.fields.indexOf(name);
  if (idx === -1) return false;
  state.fields.splice(idx, 1);
  delete state.scenarios[name];
  if (state.activeField === name) {
    state.activeField = state.fields.length > 0 ? state.fields[0] : null;
    state.activeScenario = null;
    state.activeCase = null;
    state.selectedCases = [];
  }
  emit(EVENTS.FIELD_DELETED, { field: name });
  return true;
}

// ─── Scenario CRUD ──────────────────────────────────────────

export function addScenario(fieldName, scenarioName) {
  if (!state.scenarios[fieldName]) state.scenarios[fieldName] = [];
  if (state.scenarios[fieldName].includes(scenarioName)) return false;
  state.scenarios[fieldName].push(scenarioName);
  emit(EVENTS.SCENARIO_CREATED, { field: fieldName, scenario: scenarioName });
  return true;
}

export function renameScenario(fieldName, oldName, newName) {
  const scenarios = state.scenarios[fieldName];
  if (!scenarios) return false;
  const idx = scenarios.indexOf(oldName);
  if (idx === -1 || scenarios.includes(newName)) return false;
  scenarios[idx] = newName;
  if (state.activeScenario === oldName) state.activeScenario = newName;
  emit(EVENTS.SCENARIO_RENAMED, { field: fieldName, oldName, newName });
  return true;
}

export function deleteScenario(fieldName, scenarioName) {
  const scenarios = state.scenarios[fieldName];
  if (!scenarios) return false;
  const idx = scenarios.indexOf(scenarioName);
  if (idx === -1) return false;
  scenarios.splice(idx, 1);
  if (state.activeScenario === scenarioName) {
    state.activeScenario = scenarios.length > 0 ? scenarios[0] : null;
    state.activeCase = null;
    state.selectedCases = [];
  }
  emit(EVENTS.SCENARIO_DELETED, { field: fieldName, scenario: scenarioName });
  return true;
}

// ─── Runtime data ───────────────────────────────────────────

export function setVolumetricData(data) {
  runtime.volumetricData = data;
  runtime.columns = (data?.data?.length > 0) ? Object.keys(data.data[0]) : [];
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
  if (!runtime.expandedZones[caseKey]) runtime.expandedZones[caseKey] = {};
  return runtime.expandedZones[caseKey];
}

export function toggleZoneExpanded(caseKey, groupKey) {
  const zones = getExpandedZones(caseKey);
  zones[groupKey] = !zones[groupKey];
}

// ─── Hydration ──────────────────────────────────────────────

export function hydrateState(saved) {
  if (!saved) return;
  if (saved.fields) state.fields = saved.fields;
  if (saved.activeField) state.activeField = saved.activeField;
  if (saved.activeScenario) state.activeScenario = saved.activeScenario;
  if (saved.defaultAuthor) state.defaultAuthor = saved.defaultAuthor;
  if (saved.scenarios) state.scenarios = saved.scenarios;
  if (saved.ui) Object.assign(state.ui, saved.ui);
  // Always start with browser open, no case selected
  state.activeCase = null;
  state.selectedCases = [];
  state.ui.showBrowser = true;
  state.ui.compareCase = null;
  state.ui.deltaMode = false;
  emit(EVENTS.STATE_LOADED, state);
}

export function serializeState() {
  return {
    schema: state.schema,
    fields: state.fields,
    activeField: state.activeField,
    activeScenario: state.activeScenario,
    defaultAuthor: state.defaultAuthor,
    scenarios: { ...state.scenarios },
    ui: { ...state.ui },
  };
}

export { SCHEMA_VERSION };
