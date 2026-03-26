// app.js — Main application entry point
// Initialises all modules, wires events, and loads persisted state.

import { getState, getActiveField, getActiveCase, setActiveField, setActiveCase,
         setShowParameters, setHideEmpty, setMetric, setVolumetricData, clearVolumetricData,
         getRuntime, getUI, setAvailableCases, setCompareCase, setBaseCase, getBaseCase } from './core/state.js';
import { loadAppState, saveAppState, getCaseData, getOrderedCaseNames,
         loadFieldSettings, saveFieldSettings, loadCrossPlotSettings } from './core/storage.js';
import { on, emit, EVENTS } from './core/events.js';
import { formatDateTime, formatCompact } from './utils/format.js';
import { $ } from './utils/dom.js';

import * as CaseList from './components/CaseList.js';
import * as CaseImport from './components/CaseImport.js';
import * as CaseEditor from './components/CaseEditor.js';
import * as FieldManager from './components/FieldManager.js';
import * as PivotTable from './components/PivotTable.js';

import * as DeltaTable from './components/DeltaTable.js';
import * as DriverChart from './components/DriverChart.js';

// These may load asynchronously
let BallChart, CrossPlot;

// ─── Initialisation ─────────────────────────────────────────

export async function init() {
  // Load persisted state
  loadAppState();

  // Init components
  CaseList.init();
  CaseImport.init();
  CaseEditor.init();
  FieldManager.init();
  PivotTable.init();
  DeltaTable.init();
  DriverChart.init();

  // Dynamically import chart components
  try {
    BallChart = await import('./components/BallChart.js');
    BallChart.init();
  } catch (e) {
    console.warn('BallChart not loaded:', e.message);
  }

  try {
    CrossPlot = await import('./components/CrossPlot.js');
    CrossPlot.init();
  } catch (e) {
    console.warn('CrossPlot not loaded:', e.message);
  }

  // Wire up events
  setupGlobalEvents();
  CaseList.setupEvents();
  CaseImport.setupEvents();
  CaseEditor.setupEvents();
  FieldManager.setupEvents();
  PivotTable.setupEvents();
  DeltaTable.setupEvents();
  DriverChart.setupEvents();
  if (BallChart?.setupEvents) BallChart.setupEvents();
  if (CrossPlot?.setupEvents) CrossPlot.setupEvents();

  // Setup UI controls
  setupToggles();
  setupCompareSelector();
  setupFieldSelector();
  setupSettingsPanel();

  // Initial load
  const state = getState();
  if (!state.activeField && state.fields.length > 0) {
    setActiveField(state.fields[0]);
  }

  if (state.activeField) {
    loadFieldData(state.activeField);
  }

  // Ensure selection is highlighted after load
  setTimeout(() => CaseList.render(), 100);
}

// ─── Data loading pipeline ──────────────────────────────────

function loadFieldData(field) {
  // Load field-level settings
  const fieldSettings = loadFieldSettings(field);
  if (fieldSettings.currentMetric) {
    setMetric(fieldSettings.currentMetric);
    const metricSelector = $('#metric-selector');
    if (metricSelector) metricSelector.value = fieldSettings.currentMetric;
  }

  // Load cross-plot settings
  const crossSettings = loadCrossPlotSettings(field);
  if (crossSettings.xMetric) {
    const ui = getUI();
    ui.crossPlotX = crossSettings.xMetric;
    ui.crossPlotY = crossSettings.yMetric || ui.crossPlotY;
  }

  // Load case list
  CaseList.render();

  // Load active case data
  loadCaseData();
}

function loadCaseData() {
  const field = getActiveField();
  const caseName = getActiveCase();

  if (!field || !caseName) {
    clearVolumetricData();
    updatePageTitle();
    return;
  }

  const caseData = getCaseData(field, caseName);
  if (!caseData) {
    clearVolumetricData();
    updatePageTitle();
    return;
  }

  // Apply value conversions
  let data = caseData.data;
  if (caseData.valueConversions) {
    data = applyValueConversions(data, caseData.valueConversions);
  }

  // Set volumetric data (triggers DATA_LOADED event)
  setVolumetricData({
    ...caseData,
    data,
  });

  updatePageTitle();
  updateMetadataCard();
  updateCurrentUnit();
}

function applyValueConversions(data, conversions) {
  if (!conversions || Object.keys(conversions).length === 0) return data;

  const converted = JSON.parse(JSON.stringify(data));
  for (const [col, config] of Object.entries(conversions)) {
    if (config.enabled && config.mappings && Object.keys(config.mappings).length > 0) {
      for (const row of converted) {
        if (row[col] in config.mappings) {
          row[col] = config.mappings[row[col]];
        }
      }
    }
  }
  return converted;
}

// ─── UI updates ─────────────────────────────────────────────

function updatePageTitle() {
  const field = getActiveField() || '';
  const caseName = getActiveCase() || '';

  // Header
  const fieldTitle = $('#field-title');
  const separator = $('#separator');
  const caseTitle = $('#case-title');

  if (fieldTitle) {
    fieldTitle.textContent = field || 'No field selected';
    fieldTitle.classList.toggle('text-gray-400', !field);
    fieldTitle.classList.toggle('text-gray-600', !!field);
  }

  if (caseTitle) {
    if (caseName) {
      caseTitle.textContent = caseName;
      caseTitle.classList.remove('text-gray-400');
      caseTitle.classList.add('text-gray-800');
    } else {
      caseTitle.textContent = field ? 'No case selected' : '';
      caseTitle.classList.remove('text-gray-800');
      caseTitle.classList.add('text-gray-400');
    }
  }

  if (separator) {
    separator.style.display = field ? 'inline' : 'none';
  }

  // Browser tab
  const title = field && caseName ? `${field} - ${caseName}` : 'Volumetric Data';
  document.title = title + ' | Volumetric Data Visualization';

  // Ball chart title
  const ballTitle = $('#ball-chart-title');
  const ballSub = $('#ball-chart-subtitle');
  if (ballTitle) ballTitle.textContent = caseName || 'Ball Chart';
  if (ballSub) ballSub.textContent = field || 'No case selected';
}

function updateMetadataCard() {
  const field = getActiveField();
  const caseName = getActiveCase();
  const authorEl = document.querySelector('#case-author-timestamp .author-name');
  const timestampEl = document.querySelector('#case-author-timestamp .timestamp-value');
  const descEl = $('#case-description');

  if (!field || !caseName) {
    if (authorEl) authorEl.textContent = 'Not specified';
    if (timestampEl) timestampEl.textContent = 'No date available';
    if (descEl) descEl.innerHTML = '<span class="text-gray-400">No description available</span>';
    return;
  }

  const caseData = getCaseData(field, caseName);
  if (!caseData) return;

  if (authorEl) authorEl.textContent = caseData.author || 'Not specified';
  if (timestampEl) timestampEl.textContent = caseData.timestamp ? formatDateTime(caseData.timestamp) : 'No date available';
  if (descEl) {
    descEl.textContent = caseData.description || '';
    if (!caseData.description) descEl.innerHTML = '<span class="text-gray-400">No description available</span>';
  }

  // Click metadata card to edit
  const card = $('#case-author-timestamp');
  if (card) {
    card.onclick = () => CaseEditor.show(field, caseName);
  }
}

function updateCurrentUnit() {
  const unitEl = $('#current-unit');
  if (!unitEl) return;

  const runtime = getRuntime();
  const ui = getUI();
  const vData = runtime.volumetricData;

  if (!vData || !ui.metric) {
    unitEl.textContent = '';
    return;
  }

  const units = vData.units || {};
  const currentUnit = units[ui.metric] || '';
  const total = vData.data.reduce((sum, row) => sum + (parseFloat(row[ui.metric]) || 0), 0);

  unitEl.textContent = `Total ${ui.metric}: ${formatCompact(total)} ${currentUnit}`;
}

// ─── Global event handlers ──────────────────────────────────

function setupGlobalEvents() {
  // When field changes, reload everything
  on(EVENTS.FIELD_CHANGED, ({ field }) => {
    setCompareCase(null); // Clear compare when switching fields
    loadFieldData(field);
    updateCompareSelector();
    saveAppState();
  });

  // When case is selected, load its data and update compare selector
  on(EVENTS.CASE_SELECTED, () => {
    loadCaseData();
    updateCompareSelector();
  });

  // When case is created or updated, reload
  on(EVENTS.CASE_CREATED, ({ field }) => {
    loadFieldData(field);
  });

  on(EVENTS.CASE_UPDATED, () => {
    loadCaseData();
    CaseList.render();
  });

  on(EVENTS.CASE_DELETED, ({ field }) => {
    loadCaseData();
  });

  // Metric change
  on(EVENTS.METRIC_CHANGED, () => {
    updateCurrentUnit();
    const field = getActiveField();
    if (field) saveFieldSettings(field, { currentMetric: getUI().metric });
  });

  // Window resize
  window.addEventListener('resize', () => {
    if (BallChart?.render && getRuntime().volumetricData) BallChart.render();
    if (CrossPlot?.render) CrossPlot.render();
  });

  // Compare case changes — render delta table or fall back to normal pivot
  on(EVENTS.COMPARE_CHANGED, () => {
    const ui = getUI();
    const driverSection = $('#driver-chart-section');
    if (ui.compareCase) {
      // Try rendering delta table; if it succeeds, it replaces the pivot
      const rendered = DeltaTable.render();
      if (!rendered) PivotTable.render();
      // Show driver chart section
      if (driverSection) driverSection.classList.remove('hidden');
    } else {
      // No compare — show normal pivot, hide driver section
      PivotTable.render();
      if (driverSection) driverSection.classList.add('hidden');
    }
    saveAppState();
  });

  // Field rename/delete cascades
  on(EVENTS.FIELD_CREATED, () => updateFieldDropdown());
  on(EVENTS.FIELD_RENAMED, () => updateFieldDropdown());
  on(EVENTS.FIELD_DELETED, () => {
    updateFieldDropdown();
    const state = getState();
    if (state.activeField) loadFieldData(state.activeField);
  });
}

// ─── UI control setup ───────────────────────────────────────

function setupToggles() {
  const hideEmptyToggle = $('#hide-empty-toggle');
  if (hideEmptyToggle) {
    hideEmptyToggle.checked = getUI().hideEmpty;
    hideEmptyToggle.addEventListener('change', (e) => setHideEmpty(e.target.checked));
  }

  const showParamsToggle = $('#show-parameters-toggle');
  if (showParamsToggle) {
    showParamsToggle.checked = getUI().showParameters;
    showParamsToggle.addEventListener('change', (e) => setShowParameters(e.target.checked));
  }

  const metricSelector = $('#metric-selector');
  if (metricSelector) {
    metricSelector.value = getUI().metric;
    metricSelector.addEventListener('change', (e) => {
      setMetric(e.target.value);
      if (BallChart?.render) BallChart.render();
    });
  }
}

function setupCompareSelector() {
  const selector = $('#compare-case-selector');
  if (!selector) return;

  selector.addEventListener('change', (e) => {
    setCompareCase(e.target.value || null);
  });
}

function updateCompareSelector() {
  const selector = $('#compare-case-selector');
  if (!selector) return;

  const field = getActiveField();
  const activeCase = getActiveCase();
  const ui = getUI();

  selector.innerHTML = '<option value="">None</option>';

  if (!field) return;

  const caseNames = getOrderedCaseNames(field);
  for (const name of caseNames) {
    if (name === activeCase) continue; // Don't compare to self
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    selector.appendChild(opt);
  }

  // Restore selection if still valid
  if (ui.compareCase && caseNames.includes(ui.compareCase)) {
    selector.value = ui.compareCase;
  } else {
    selector.value = '';
    if (ui.compareCase) setCompareCase(null);
  }
}

function setupFieldSelector() {
  const fieldTitle = $('#field-title');
  let dropdown = $('#field-dropdown');

  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'field-dropdown';
    dropdown.className = 'absolute mt-2 w-56 bg-white rounded-md shadow-lg z-50 border border-gray-200 hidden';
    document.body.appendChild(dropdown);
  }

  if (fieldTitle) {
    fieldTitle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.classList.contains('hidden')) {
        updateFieldDropdown();
        const rect = fieldTitle.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + window.scrollY) + 'px';
        dropdown.style.left = (rect.left + window.scrollX) + 'px';
        dropdown.classList.remove('hidden');
      } else {
        dropdown.classList.add('hidden');
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (dropdown && !dropdown.contains(e.target) && e.target !== fieldTitle) {
      dropdown.classList.add('hidden');
    }
  });

  // Settings panel field selector
  const fieldSelector = $('#field-selector');
  if (fieldSelector) {
    updateFieldSelectorOptions();
    fieldSelector.addEventListener('change', (e) => {
      setActiveField(e.target.value);
      saveAppState();
    });
  }

  // Edit fields button
  const editFieldBtn = $('#edit-field-btn');
  if (editFieldBtn) {
    editFieldBtn.addEventListener('click', () => FieldManager.show());
  }
}

function updateFieldDropdown() {
  const dropdown = $('#field-dropdown');
  if (!dropdown) return;

  dropdown.innerHTML = '';
  const heading = document.createElement('div');
  heading.className = 'px-4 py-2 text-sm text-gray-700 font-medium border-b border-gray-200';
  heading.textContent = 'Select Field';
  dropdown.appendChild(heading);

  const state = getState();
  for (const field of state.fields) {
    const item = document.createElement('div');
    item.className = 'px-4 py-2 text-sm hover:bg-blue-50 cursor-pointer';
    if (field === state.activeField) {
      item.className += ' bg-blue-100 font-medium text-blue-700';
    } else {
      item.className += ' text-gray-700';
    }
    item.textContent = field;
    item.addEventListener('click', () => {
      setActiveField(field);
      saveAppState();
      dropdown.classList.add('hidden');
    });
    dropdown.appendChild(item);
  }

  updateFieldSelectorOptions();
}

function updateFieldSelectorOptions() {
  const selector = $('#field-selector');
  if (!selector) return;
  selector.innerHTML = '';
  for (const field of getState().fields) {
    const opt = document.createElement('option');
    opt.value = field;
    opt.textContent = field;
    selector.appendChild(opt);
  }
  if (getActiveField()) selector.value = getActiveField();
}

function setupSettingsPanel() {
  const settingsBtn = $('#settings-button');
  const contextMenu = $('#context-menu');
  if (!settingsBtn || !contextMenu) return;

  settingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = settingsBtn.getBoundingClientRect();
    contextMenu.style.display = 'block';
    contextMenu.style.left = `${rect.left - contextMenu.offsetWidth + rect.width}px`;
    contextMenu.style.top = `${rect.top - contextMenu.offsetHeight}px`;
  });

  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target) && e.target !== settingsBtn) {
      contextMenu.style.display = 'none';
    }
  });
}
