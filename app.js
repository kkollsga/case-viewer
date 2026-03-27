// app.js — Main application entry point
// Browser-first flow: open → case browser → select case(s) → data view

import { getState, getActiveField, getActiveCase, getActiveScenario,
         setActiveField, setActiveScenario, setActiveCase, setSelectedCases,
         setShowParameters, setHideEmpty, setMetric, setVolumetricData, clearVolumetricData,
         getRuntime, getUI, setAvailableCases, setCompareCase,
         addField, openBrowser, getSelectedCases, getScenariosForField } from './core/state.js';
import { loadAppState, saveAppState, getCaseData, getOrderedCaseNames, getCasesForField,
         loadFieldSettings, saveFieldSettings, loadCrossPlotSettings,
         saveCase, addCaseToOrder, saveCaseOrder, saveFields,
         hasLegacyData, clearLegacyData } from './core/storage.js';
import { on, emit, EVENTS } from './core/events.js';
import { formatDateTime, formatCompact } from './utils/format.js';
import { $ } from './utils/dom.js';

import * as CaseImport from './components/CaseImport.js';
import * as CaseEditor from './components/CaseEditor.js';
import * as FieldManager from './components/FieldManager.js';
import * as PivotTable from './components/PivotTable.js';
import * as DeltaTable from './components/DeltaTable.js';
import * as DriverChart from './components/DriverChart.js';

let BallChart, CrossPlot, RevisionTimeline, CaseBrowser;

// ─── Initialisation ─────────────────────────────────────────

export async function init() {
  loadAppState();

  // Init static components
  CaseImport.init();
  CaseEditor.init();
  FieldManager.init();
  PivotTable.init();
  DeltaTable.init();
  DriverChart.init();

  // Dynamic imports
  try { BallChart = await import('./components/BallChart.js'); BallChart.init(); } catch (e) { console.warn('BallChart:', e.message); }
  try { CrossPlot = await import('./components/CrossPlot.js'); CrossPlot.init(); } catch (e) { console.warn('CrossPlot:', e.message); }
  try { RevisionTimeline = await import('./components/RevisionTimeline.js'); RevisionTimeline.init(); } catch (e) { console.warn('Timeline:', e.message); }
  try { CaseBrowser = await import('./components/CaseBrowser.js'); CaseBrowser.init(); } catch (e) { console.warn('CaseBrowser:', e.message); }

  // Wire events
  setupGlobalEvents();
  CaseImport.setupEvents();
  CaseEditor.setupEvents();
  FieldManager.setupEvents();
  PivotTable.setupEvents();
  DeltaTable.setupEvents();
  DriverChart.setupEvents();
  if (BallChart?.setupEvents) BallChart.setupEvents();
  if (CrossPlot?.setupEvents) CrossPlot.setupEvents();
  if (RevisionTimeline?.setupEvents) RevisionTimeline.setupEvents();
  if (CaseBrowser?.setupEvents) CaseBrowser.setupEvents();

  setupDataViewControls();
  setupKeyboardShortcuts();
  setupExportImport();

  // Start in browser mode
  showBrowser();
}

// ─── View switching ─────────────────────────────────────────

function showBrowser() {
  // Single page — browser is always visible, data view hides
  const dataViewEl = $('#data-view');
  if (dataViewEl) dataViewEl.classList.add('hidden');

  const state = getState();
  if (!state.activeField && state.fields.length > 0) {
    setActiveField(state.fields[0]);
  }
  if (state.activeField && !state.activeScenario) {
    const scenarios = getScenariosForField(state.activeField);
    if (scenarios.length > 0) setActiveScenario(scenarios[0]);
  }

  if (CaseBrowser?.render) CaseBrowser.render();
  document.title = 'Case Viewer';
}

function showDataView() {
  // Show data view below the browser (browser stays visible in minimized mode)
  const dataViewEl = $('#data-view');
  if (dataViewEl) dataViewEl.classList.remove('hidden');

  // Auto-open volumetrics
  const volContainer = $('#volumetrics-container');
  if (volContainer) volContainer.classList.remove('hidden');
  const volToggle = $('#toggle-volumetrics');
  if (volToggle) {
    const icon = volToggle.querySelector('i');
    if (icon) { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-up'); }
  }

  loadCaseData();

  if (CaseBrowser?.render) CaseBrowser.render();
}

// ─── Data loading ───────────────────────────────────────────

function loadCaseData() {
  const field = getActiveField();
  const scenario = getActiveScenario();
  const caseName = getActiveCase();

  if (!field || !scenario || !caseName) {
    clearVolumetricData();
    return;
  }

  const caseData = getCaseData(field, caseName, scenario);
  if (!caseData) { clearVolumetricData(); return; }

  // Apply value conversions
  let data = caseData.data;
  if (caseData.valueConversions) {
    data = applyConversions(data, caseData.valueConversions);
  }

  setVolumetricData({ ...caseData, data });

  // Load field settings
  const fieldSettings = loadFieldSettings(field);
  if (fieldSettings.currentMetric) {
    setMetric(fieldSettings.currentMetric);
    const ms = $('#metric-selector');
    if (ms) ms.value = fieldSettings.currentMetric;
  }

  updateBreadcrumb();
  updateMetadata();
  updateCurrentUnit();
  updateCompareSelector();
  updateNavigationButtons();

  // Browser title
  document.title = `${field} / ${caseName} — Case Viewer`;
}

function applyConversions(data, conversions) {
  if (!conversions || Object.keys(conversions).length === 0) return data;
  const converted = JSON.parse(JSON.stringify(data));
  for (const [col, config] of Object.entries(conversions)) {
    if (config.enabled && config.mappings) {
      for (const row of converted) {
        if (row[col] in config.mappings) row[col] = config.mappings[row[col]];
      }
    }
  }
  return converted;
}

// ─── UI updates ─────────────────────────────────────────────

function updateBreadcrumb() {
  const bf = $('#breadcrumb-field');
  const bs = $('#breadcrumb-scenario');
  const bc = $('#breadcrumb-case');
  const ct = $('#case-title');

  if (bf) bf.textContent = getActiveField() || '';
  if (bs) bs.textContent = getActiveScenario() || '';
  if (bc) bc.textContent = getActiveCase() || '';
  if (ct) ct.textContent = getActiveCase() || '';

  // Ball chart title
  const ballTitle = $('#ball-chart-title');
  const ballSub = $('#ball-chart-subtitle');
  if (ballTitle) ballTitle.textContent = getActiveCase() || '';
  if (ballSub) ballSub.textContent = getActiveField() || '';
}

function updateMetadata() {
  const field = getActiveField();
  const caseName = getActiveCase();
  const scenario = getActiveScenario();

  const authorEl = document.querySelector('.author-name');
  const timestampEl = document.querySelector('.timestamp-value');
  const descEl = $('#case-description');

  if (!field || !caseName || !scenario) {
    if (authorEl) authorEl.textContent = '—';
    if (timestampEl) timestampEl.textContent = '—';
    if (descEl) descEl.textContent = '';
    return;
  }

  const caseData = getCaseData(field, caseName, scenario);
  if (!caseData) return;

  if (authorEl) authorEl.textContent = caseData.author || '—';
  if (timestampEl) timestampEl.textContent = caseData.timestamp ? formatDateTime(caseData.timestamp) : '—';
  if (descEl) descEl.textContent = caseData.description || '';

  // Click metadata to edit
  const card = $('#case-author-timestamp');
  if (card) card.onclick = () => CaseEditor.show(field, caseName, scenario);
}

function updateCurrentUnit() {
  const unitEl = $('#current-unit');
  if (!unitEl) return;
  const runtime = getRuntime();
  const ui = getUI();
  if (!runtime.volumetricData || !ui.metric) { unitEl.textContent = ''; return; }
  const units = runtime.volumetricData.units || {};
  const total = runtime.volumetricData.data.reduce((s, r) => s + (parseFloat(r[ui.metric]) || 0), 0);
  unitEl.textContent = `Total ${ui.metric}: ${formatCompact(total)} ${units[ui.metric] || ''}`;
}

function updateCompareSelector() {
  const selector = $('#compare-case-selector');
  if (!selector) return;
  const field = getActiveField();
  const scenario = getActiveScenario();
  const activeCase = getActiveCase();
  selector.innerHTML = '<option value="">None</option>';
  if (!field || !scenario) return;

  const names = getOrderedCaseNames(field, scenario);
  for (const name of names) {
    if (name === activeCase) continue;
    selector.appendChild(Object.assign(document.createElement('option'), { value: name, textContent: name }));
  }
}

function updateNavigationButtons() {
  const prev = $('#prev-case-btn');
  const next = $('#next-case-btn');
  if (!prev || !next) return;

  const field = getActiveField();
  const scenario = getActiveScenario();
  if (!field || !scenario) { prev.classList.add('opacity-30'); next.classList.add('opacity-30'); return; }

  const names = getOrderedCaseNames(field, scenario);
  const idx = names.indexOf(getActiveCase());
  prev.classList.toggle('opacity-30', idx <= 0);
  next.classList.toggle('opacity-30', idx >= names.length - 1);
}

function navigateCase(dir) {
  const field = getActiveField();
  const scenario = getActiveScenario();
  if (!field || !scenario) return;
  const names = getOrderedCaseNames(field, scenario);
  const idx = names.indexOf(getActiveCase());
  const newIdx = dir === 'prev' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= names.length) return;
  setActiveCase(names[newIdx]);
  saveAppState();
  loadCaseData();
}

// ─── Global events ──────────────────────────────────────────

function setupGlobalEvents() {
  on(EVENTS.FIELD_CHANGED, () => { saveAppState(); if (CaseBrowser?.render) CaseBrowser.render(); });
  on(EVENTS.SCENARIO_CHANGED, () => { saveAppState(); if (CaseBrowser?.render) CaseBrowser.render(); });

  on(EVENTS.CASE_SELECTED, () => {
    showDataView();
    saveAppState();
  });

  on(EVENTS.BROWSER_OPENED, (data) => {
    showBrowser();
    saveAppState();
    // Handle import action from CaseBrowser's import buttons
    if (data?.action === 'import') {
      CaseImport.show();
    }
  });

  on(EVENTS.CASE_CREATED, () => {
    saveAppState();
    if (CaseBrowser?.render) CaseBrowser.render();
  });

  on(EVENTS.CASE_UPDATED, () => {
    loadCaseData();
    if (CaseBrowser?.render) CaseBrowser.render();
  });

  on(EVENTS.CASE_DELETED, () => {
    if (CaseBrowser?.render) CaseBrowser.render();
  });

  on(EVENTS.COMPARE_CHANGED, () => {
    const ui = getUI();
    const driverSection = $('#driver-chart-section');
    if (ui.compareCase) {
      DeltaTable.render() || PivotTable.render();
      if (driverSection) driverSection.classList.remove('hidden');
    } else {
      PivotTable.render();
      if (driverSection) driverSection.classList.add('hidden');
    }
    saveAppState();
  });

  on(EVENTS.METRIC_CHANGED, () => {
    updateCurrentUnit();
    const field = getActiveField();
    if (field) saveFieldSettings(field, { currentMetric: getUI().metric });
  });

  window.addEventListener('resize', () => {
    if (BallChart?.render && getRuntime().volumetricData) BallChart.render();
    if (CrossPlot?.render) CrossPlot.render();
  });
}

// ─── Data view controls ─────────────────────────────────────

function setupDataViewControls() {
  // Collapsible section toggles
  setupCollapsible('toggle-volumetrics', 'volumetrics-container');
  setupCollapsible('toggle-ball-chart', 'ball-chart-outer', () => { if (BallChart?.render) BallChart.render(); });

  // Compare selector
  const compareSel = $('#compare-case-selector');
  if (compareSel) compareSel.addEventListener('change', (e) => setCompareCase(e.target.value || null));

  // Toggles
  const hideEmpty = $('#hide-empty-toggle');
  if (hideEmpty) {
    hideEmpty.checked = getUI().hideEmpty;
    hideEmpty.addEventListener('change', (e) => setHideEmpty(e.target.checked));
  }

  const showParams = $('#show-parameters-toggle');
  if (showParams) {
    showParams.checked = getUI().showParameters;
    showParams.addEventListener('change', (e) => setShowParameters(e.target.checked));
  }

  const metricSel = $('#metric-selector');
  if (metricSel) {
    metricSel.value = getUI().metric;
    metricSel.addEventListener('change', (e) => {
      setMetric(e.target.value);
      if (BallChart?.render) BallChart.render();
    });
  }
}

// ─── Keyboard shortcuts ─────────────────────────────────────

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    if (e.key === 'Escape') {
      const overlay = $('#modal-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        overlay.classList.add('hidden');
        overlay.querySelectorAll(':scope > div').forEach(d => d.classList.add('hidden'));
      } else if (!getUI().showBrowser && getActiveCase()) {
        openBrowser();
      }
    }

    if (e.key === 'ArrowLeft') { e.preventDefault(); navigateCase('prev'); }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigateCase('next'); }

    if (e.key === 'd' || e.key === 'D') {
      if (getUI().compareCase) {
        setCompareCase(null);
        const sel = $('#compare-case-selector');
        if (sel) sel.value = '';
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      CaseImport.show();
    }
  });
}

// ─── Export / Import ────────────────────────────────────────

function setupExportImport() {
  const exportBtn = $('#export-json-btn');
  const importBtn = $('#import-json-btn');
  const importInput = $('#import-json-input');

  if (exportBtn) exportBtn.addEventListener('click', exportFieldJSON);
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', importFieldJSON);
  }
}

function exportFieldJSON() {
  const field = getActiveField();
  const scenario = getActiveScenario();
  if (!field || !scenario) { alert('Select a field and scenario first.'); return; }

  const cases = getCasesForField(field);
  const caseOrder = getOrderedCaseNames(field, scenario);
  const blob = new Blob([JSON.stringify({
    version: 3, exportDate: new Date().toISOString(),
    field, scenario, caseOrder, cases,
  }, null, 2)], { type: 'application/json' });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${field}_${scenario}_cases.json`.replace(/\s+/g, '_');
  a.click();
  URL.revokeObjectURL(a.href);
}

function importFieldJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (!data.field || !data.cases) { alert('Invalid export file.'); return; }

      const field = data.field;
      const scenario = data.scenario || 'Default';
      const state = getState();
      if (!state.fields.includes(field)) { addField(field); }

      const { addScenario } = require_state();
      addScenario(field, scenario);

      const existing = getCasesForField(field);
      const merged = { ...existing, ...data.cases };
      localStorage.setItem(`cv3_cases_${field}_${scenario}`, JSON.stringify(merged));

      if (data.caseOrder) saveCaseOrder(field, scenario, data.caseOrder);

      setActiveField(field);
      setActiveScenario(scenario);
      saveAppState();
      if (CaseBrowser?.render) CaseBrowser.render();

      alert(`Imported ${Object.keys(data.cases).length} cases.`);
    } catch (err) { alert('Import failed: ' + err.message); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// Workaround for circular import
function require_state() {
  return { addScenario: (f, s) => {
    const state = getState();
    if (!state.scenarios[f]) state.scenarios[f] = [];
    if (!state.scenarios[f].includes(s)) state.scenarios[f].push(s);
  }};
}

// ─── Collapsible section helper ──────────────────────────────

function setupCollapsible(toggleId, containerId, onExpand) {
  const btn = $(`#${toggleId}`);
  const container = $(`#${containerId}`);
  if (!btn || !container) return;

  btn.addEventListener('click', () => {
    const isHidden = container.classList.contains('hidden');
    container.classList.toggle('hidden');
    const icon = btn.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-chevron-down', !isHidden);
      icon.classList.toggle('fa-chevron-up', isHidden);
    }
    if (isHidden && onExpand) onExpand();
  });
}

// ─── Case duplication ───────────────────────────────────────

export function duplicateCase(field, scenario, caseName) {
  const caseData = getCaseData(field, caseName, scenario);
  if (!caseData) return;

  let newName = caseName + ' (copy)';
  let counter = 1;
  const existing = getCasesForField(field);
  while (existing[newName]) { counter++; newName = `${caseName} (copy ${counter})`; }

  const dup = JSON.parse(JSON.stringify(caseData));
  dup.title = newName;
  dup.timestamp = new Date().toISOString();

  saveCase(field, scenario, newName, dup);
  addCaseToOrder(field, scenario, newName);
  saveAppState();
  emit(EVENTS.CASE_CREATED, { field, scenario, caseName: newName });
}
