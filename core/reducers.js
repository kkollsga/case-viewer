// core/reducers.js — Action reducers for the central store.
// Each reducer: (state, payload) => newState
// Returns new object for changed branches, shares references for unchanged.

export const reducers = {

  // ─── Navigation ───────────────────────────────────────────

  SET_ACTIVE_FIELD: (state, { field }) => ({
    ...state,
    activeField: field,
    activeScenario: null,
    activeCase: null,
    selectedCases: [],
    ui: { ...state.ui, showBrowser: true },
  }),

  SET_ACTIVE_SCENARIO: (state, { scenario }) => ({
    ...state,
    activeScenario: scenario,
    activeCase: null,
    selectedCases: [],
    ui: { ...state.ui, showBrowser: true },
  }),

  SET_ACTIVE_CASE: (state, { caseName }) => ({
    ...state,
    activeCase: caseName,
    ui: { ...state.ui, showBrowser: false },
  }),

  SET_SELECTED_CASES: (state, { caseNames }) => ({
    ...state,
    selectedCases: [...caseNames],
  }),

  TOGGLE_CASE_SELECTION: (state, { caseName }) => {
    const idx = state.selectedCases.indexOf(caseName);
    const next = [...state.selectedCases];
    if (idx === -1) next.push(caseName); else next.splice(idx, 1);
    return { ...state, selectedCases: next };
  },

  OPEN_BROWSER: (state) => ({
    ...state,
    activeCase: null,
    ui: { ...state.ui, showBrowser: true, compareCase: null, deltaMode: false },
  }),

  // ─── Field CRUD ───────────────────────────────────────────

  ADD_FIELD: (state, { name }) => {
    if (state.fields.includes(name)) return state;
    return {
      ...state,
      fields: [...state.fields, name],
      scenarios: { ...state.scenarios, [name]: [] },
      activeField: name,
      activeScenario: null,
      activeCase: null,
      selectedCases: [],
      ui: { ...state.ui, showBrowser: true },
    };
  },

  RENAME_FIELD: (state, { oldName, newName }) => {
    if (oldName === newName || state.fields.includes(newName)) return state;
    const idx = state.fields.indexOf(oldName);
    if (idx === -1) return state;
    const fields = [...state.fields];
    fields[idx] = newName;
    const scenarios = { ...state.scenarios };
    if (scenarios[oldName]) { scenarios[newName] = scenarios[oldName]; delete scenarios[oldName]; }
    return {
      ...state, fields, scenarios,
      activeField: state.activeField === oldName ? newName : state.activeField,
    };
  },

  DELETE_FIELD: (state, { name }) => {
    const idx = state.fields.indexOf(name);
    if (idx === -1) return state;
    const fields = state.fields.filter(f => f !== name);
    const scenarios = { ...state.scenarios };
    delete scenarios[name];
    return {
      ...state, fields, scenarios,
      activeField: state.activeField === name ? (fields[0] || null) : state.activeField,
      activeScenario: state.activeField === name ? null : state.activeScenario,
      activeCase: state.activeField === name ? null : state.activeCase,
      selectedCases: state.activeField === name ? [] : state.selectedCases,
    };
  },

  // ─── Scenario CRUD ────────────────────────────────────────

  ADD_SCENARIO: (state, { field, scenario }) => {
    const existing = state.scenarios[field] || [];
    if (existing.includes(scenario)) return state;
    return {
      ...state,
      scenarios: { ...state.scenarios, [field]: [...existing, scenario] },
    };
  },

  RENAME_SCENARIO: (state, { field, oldName, newName }) => {
    const list = state.scenarios[field];
    if (!list) return state;
    const idx = list.indexOf(oldName);
    if (idx === -1 || list.includes(newName)) return state;
    const next = [...list]; next[idx] = newName;
    return {
      ...state,
      scenarios: { ...state.scenarios, [field]: next },
      activeScenario: state.activeScenario === oldName ? newName : state.activeScenario,
    };
  },

  DELETE_SCENARIO: (state, { field, scenario }) => {
    const list = state.scenarios[field];
    if (!list) return state;
    const next = list.filter(s => s !== scenario);
    return {
      ...state,
      scenarios: { ...state.scenarios, [field]: next },
      activeScenario: state.activeScenario === scenario ? (next[0] || null) : state.activeScenario,
      activeCase: state.activeScenario === scenario ? null : state.activeCase,
      selectedCases: state.activeScenario === scenario ? [] : state.selectedCases,
    };
  },

  // ─── UI ───────────────────────────────────────────────────

  SET_METRIC: (state, { metric }) => ({
    ...state, ui: { ...state.ui, metric },
  }),

  SET_VIEW: (state, { view }) => ({
    ...state, ui: { ...state.ui, view },
  }),

  SET_COMPARE_CASE: (state, { caseName }) => ({
    ...state, ui: { ...state.ui, compareCase: caseName, deltaMode: !!caseName },
  }),

  SET_SHOW_PARAMETERS: (state, { value }) => ({
    ...state, ui: { ...state.ui, showParameters: value },
  }),

  SET_HIDE_EMPTY: (state, { value }) => ({
    ...state, ui: { ...state.ui, hideEmpty: value },
  }),

  SET_CROSS_PLOT_AXES: (state, { x, y }) => ({
    ...state, ui: { ...state.ui,
      crossPlotX: x !== undefined ? x : state.ui.crossPlotX,
      crossPlotY: y !== undefined ? y : state.ui.crossPlotY,
    },
  }),

  SET_CROSS_PLOT_GROUP_LEVEL: (state, { level }) => ({
    ...state, ui: { ...state.ui, crossPlotGroupLevel: level },
  }),

  TOGGLE_DELTA_MODE: (state) => ({
    ...state, ui: { ...state.ui, deltaMode: !state.ui.deltaMode },
  }),

  // ─── Data (runtime, not persisted) ────────────────────────

  SET_VOLUMETRIC_DATA: (state, { data }) => ({
    ...state,
    data: {
      ...state.data,
      volumetricData: data,
      columns: data?.data?.length > 0 ? Object.keys(data.data[0]) : [],
    },
  }),

  CLEAR_VOLUMETRIC_DATA: (state) => ({
    ...state,
    data: { ...state.data, volumetricData: null, columns: [] },
  }),

  SET_AVAILABLE_CASES: (state, { cases }) => ({
    ...state,
    data: { ...state.data, availableCases: cases },
  }),

  TOGGLE_ZONE_EXPANDED: (state, { caseKey, groupKey }) => {
    const ez = { ...state.data.expandedZones };
    if (!ez[caseKey]) ez[caseKey] = {};
    ez[caseKey] = { ...ez[caseKey], [groupKey]: !ez[caseKey][groupKey] };
    return { ...state, data: { ...state.data, expandedZones: ez } };
  },

  // ─── Signals (trigger side effects via subscriptions) ──────
  // These don't change state shape but bump a counter so subscribers detect the change.

  CASE_CREATED: (state, payload) => ({
    ...state, _sig: { ...state._sig, caseCreated: (state._sig?.caseCreated || 0) + 1, lastPayload: payload },
  }),

  CASE_UPDATED: (state, payload) => ({
    ...state, _sig: { ...state._sig, caseUpdated: (state._sig?.caseUpdated || 0) + 1, lastPayload: payload },
  }),

  CASE_DELETED: (state, payload) => ({
    ...state, _sig: { ...state._sig, caseDeleted: (state._sig?.caseDeleted || 0) + 1, lastPayload: payload },
  }),

  MAPPINGS_CHANGED: (state, payload) => ({
    ...state, _sig: { ...state._sig, mappingsChanged: (state._sig?.mappingsChanged || 0) + 1, lastPayload: payload },
  }),

  // ─── Misc ─────────────────────────────────────────────────

  SET_DEFAULT_AUTHOR: (state, { author }) => ({
    ...state, defaultAuthor: author,
  }),

  // ─── Hydration ────────────────────────────────────────────

  HYDRATE_STATE: (state, saved) => {
    const next = { ...state };
    if (saved.fields) next.fields = saved.fields;
    if (saved.activeField) next.activeField = saved.activeField;
    if (saved.activeScenario) next.activeScenario = saved.activeScenario;
    if (saved.defaultAuthor) next.defaultAuthor = saved.defaultAuthor;
    if (saved.scenarios) next.scenarios = saved.scenarios;
    if (saved.ui) next.ui = { ...state.ui, ...saved.ui };
    // Always start fresh — no active case, show browser
    next.activeCase = null;
    next.selectedCases = [];
    next.ui = { ...next.ui, showBrowser: true, compareCase: null, deltaMode: false };
    return next;
  },
};
