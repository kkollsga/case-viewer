// app.js — Main application entry point
// Browser-first flow: open → case browser → select case(s) → data view

import { getState, getActiveField, getActiveCase, getActiveScenario,
         setActiveField, setActiveScenario, setActiveCase, setSelectedCases,
         setShowParameters, setHideEmpty, setMetric, setVolumetricData, clearVolumetricData,
         getRuntime, getUI, setAvailableCases, setCompareCase,
         addField, addScenario, openBrowser, getSelectedCases, getScenariosForField, store } from './core/state.js';
import { loadAppState, saveAppState, getCaseData, getOrderedCaseNames, getCasesForField,
         loadFieldSettings, saveFieldSettings, loadCrossPlotSettings,
         saveCase, addCaseToOrder, saveCaseOrder, saveFields,
         hasLegacyData, clearLegacyData, applyGroupMappings, getGroupTypeOrder } from './core/storage.js';
// events.js kept for bridge in state.js (will be removed in final cleanup)
import { formatDateTime, formatCompact } from './utils/format.js';
import { $ } from './utils/dom.js';

import * as CaseImport from './components/CaseImport.js';
import * as CaseEditor from './components/CaseEditor.js';
import * as FieldManager from './components/FieldManager.js';
import * as PivotTable from './components/PivotTable.js';
import * as DeltaTable from './components/DeltaTable.js';
import * as DriverChart from './components/DriverChart.js';
import * as TornadoPlot from './components/TornadoPlot.js';

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
  TornadoPlot.init();

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
  TornadoPlot.setupEvents();
  if (BallChart?.setupEvents) BallChart.setupEvents();
  if (CrossPlot?.setupEvents) CrossPlot.setupEvents();
  if (RevisionTimeline?.setupEvents) RevisionTimeline.setupEvents();
  if (CaseBrowser?.setupEvents) CaseBrowser.setupEvents();

  setupDataViewControls();
  setupKeyboardShortcuts();
  setupExportImport();

  // Seed demo data if nothing exists
  seedDemoData();

  // Start in browser mode
  showBrowser();
}

// ─── View switching ─────────────────────────────────────────

function showBrowser() {
  const state = getState();
  if (!state.activeField && state.fields.length > 0) setActiveField(state.fields[0]);
  if (state.activeField && !state.activeScenario) {
    const scenarios = getScenariosForField(state.activeField);
    if (scenarios.length > 0) setActiveScenario(scenarios[0]);
  }

  // Expand case selector
  expandSection('case-section-header', 'case-browser');

  // Hide data view if no active case
  if (!getActiveCase()) {
    const dv = $('#data-view');
    if (dv) dv.classList.add('hidden');
  }

  updateCaseSectionSummary();
  if (CaseBrowser?.render) CaseBrowser.render();
  document.title = 'Case Viewer';
}

function updateCaseSectionSummary() {
  const context = $('#case-section-context');
  const label = $('#case-section-label');
  const nav = $('#header-case-nav');

  const field = getActiveField();
  const scenario = getActiveScenario();
  const caseName = getActiveCase();

  // Render field → scenario as H1-style dropdowns
  if (context) {
    context.innerHTML = '';
    if (CaseBrowser?.renderHeaderSelectors) {
      context.appendChild(CaseBrowser.renderHeaderSelectors(field, scenario));
    }
  }

  // Case nav
  if (caseName) {
    if (label) label.textContent = caseName;
    if (nav) nav.style.display = '';
  } else {
    if (label) label.textContent = '';
    if (nav) nav.style.display = 'none';
  }
}

function showDataView() {
  const dataViewEl = $('#data-view');
  if (dataViewEl) dataViewEl.classList.remove('hidden');

  // Update collapsed header summary (visible when user manually collapses)
  updateCaseSectionSummary();

  // Auto-expand volumetrics
  expandSection('toggle-volumetrics', 'volumetrics-container');

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

  // Apply value conversions then field-level group mappings
  let data = caseData.data;
  if (caseData.valueConversions) {
    data = applyConversions(data, caseData.valueConversions);
  }
  data = applyGroupMappings(data, field);

  setVolumetricData({ ...caseData, data });

  // Render pivot table
  PivotTable.render();

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
  const nameEl = $('#vol-case-name');

  if (!field || !caseName || !scenario) {
    if (authorEl) authorEl.textContent = '—';
    if (timestampEl) timestampEl.textContent = '—';
    if (descEl) descEl.textContent = '';
    if (nameEl) nameEl.textContent = '';
    return;
  }

  const caseData = getCaseData(field, caseName, scenario);
  if (!caseData) return;

  if (nameEl) nameEl.textContent = caseName;
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
  // ── Store subscriptions (replaces 11 on(EVENTS.*) handlers) ──

  // Case selection → show data view
  store.subscribe('activeCase', (caseName) => {
    if (caseName) showDataView();
    updateCaseSectionSummary();
  });

  // Field/scenario changes → update summary
  store.subscribe(s => [s.activeField, s.activeScenario], () => updateCaseSectionSummary());

  // Browser opened (activeCase cleared)
  store.subscribe(s => s.ui.showBrowser, (showBrowser) => {
    if (showBrowser && !getActiveCase()) showBrowser_fn();
  });

  // Compare case → toggle delta/driver views
  store.subscribe('ui.compareCase', (compareCase) => {
    const driverSection = $('#driver-chart-section');
    if (compareCase) {
      DeltaTable.render() || PivotTable.render();
      if (driverSection) driverSection.classList.remove('hidden');
    } else {
      if (driverSection) driverSection.classList.add('hidden');
      // Delay to ensure DeltaTable's subscription has cleared its content first
      setTimeout(() => PivotTable.render(), 0);
    }
  });

  // Metric change → update unit display + persist
  store.subscribe('ui.metric', () => {
    updateCurrentUnit();
    const field = getActiveField();
    if (field) saveFieldSettings(field, { currentMetric: getUI().metric });
  });

  // ── Signal subscriptions (replace old event handlers) ──

  store.subscribe(s => s._sig?.caseCreated, () => {
    if (CaseBrowser?.render) CaseBrowser.render();
  });

  store.subscribe(s => s._sig?.caseUpdated, () => {
    if (getActiveCase()) loadCaseData();
    if (CaseBrowser?.render) CaseBrowser.render();
  });

  store.subscribe(s => s._sig?.caseDeleted, () => {
    if (CaseBrowser?.render) CaseBrowser.render();
  });

  store.subscribe(s => s._sig?.mappingsChanged, () => {
    if (getActiveCase()) loadCaseData();
    if (CaseBrowser?.renderCaseCardsOnly) CaseBrowser.renderCaseCardsOnly();
  });

  // Responsive resize
  window.addEventListener('resize', () => {
    if (BallChart?.render && store.select('data.volumetricData')) BallChart.render();
    if (CrossPlot?.render) CrossPlot.render();
  });
}

// Renamed to avoid conflict with state function
function showBrowser_fn() { showBrowser(); }

// ─── Data view controls ─────────────────────────────────────

function setupDataViewControls() {
  // Collapsible section toggles
  // Settings section — toggle via FieldSettings which manages render/clear
  const settingsHeader = $('#settings-section-header');
  if (settingsHeader) {
    settingsHeader.addEventListener('click', () => {
      import('./components/FieldSettings.js').then(m => m.toggle());
    });
  }
  setupCollapsible('case-section-header', 'case-browser');
  setupCollapsible('toggle-volumetrics', 'volumetrics-container');

  // Prev/next case navigation (in collapsed header)
  const prevBtn = $('#prev-case-btn');
  const nextBtn = $('#next-case-btn');
  if (prevBtn) prevBtn.addEventListener('click', (e) => { e.stopPropagation(); navigateCase('prev'); });
  if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); navigateCase('next'); });
  setupCollapsible('toggle-tornado', 'tornado-container', () => TornadoPlot.render());
  setupCollapsible('toggle-drivers', 'driver-chart-outer');
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

  setupCopyTableButton();
}

// ─── Copy visible pivot table ───────────────────────────────

function setupCopyTableButton() {
  const btn = $('#copy-table-btn');
  if (!btn) return;
  const labelEl = btn.querySelector('.copy-table-label');
  const defaultLabel = labelEl ? labelEl.textContent : '';
  let resetTimer = null;

  btn.addEventListener('click', async () => {
    const table = document.getElementById('pivot-table');
    if (!table) return;
    const { tsv, html } = serializeTableForClipboard(table);
    if (!tsv) return;

    let copied = false;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })]);
        copied = true;
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tsv);
        copied = true;
      }
    } catch (err) {
      console.error('Copy table failed', err);
    }

    if (copied && labelEl) {
      labelEl.textContent = 'Copied';
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { labelEl.textContent = defaultLabel; }, 1500);
    }
  });
}

function serializeTableForClipboard(table) {
  // Collect visible rows + detect nesting level from .pivot-label-inner padding
  const rows = [];
  let maxLevel = 0;
  let hasNestedLabels = false;
  for (const tr of table.querySelectorAll('tr')) {
    if (!isElementVisible(tr)) continue;
    const cells = Array.from(tr.children).filter(isElementVisible);
    if (cells.length === 0) continue;
    const labelInner = tr.querySelector('.pivot-label-inner');
    let level = 0;
    if (labelInner) {
      const pl = parseInt(labelInner.style.paddingLeft, 10) || 0;
      level = Math.round(pl / 20);
      if (level > 0) hasNestedLabels = true;
    }
    if (level > maxLevel) maxLevel = level;
    rows.push({ tr, cells, labelInner, level });
  }
  if (rows.length === 0) return { tsv: '', html: '' };

  const labelCols = hasNestedLabels ? maxLevel + 1 : 1;
  const groupNames = labelCols > 1 ? getGroupColumnNames(labelCols) : null;

  const labelStack = new Array(labelCols).fill('');
  const tsvRows = [];
  const htmlRows = [];

  for (const { tr, cells, labelInner, level } of rows) {
    const isHeaderRow = cells.every((c) => c.tagName === 'TH');
    const isTotal = tr.classList.contains('pivot-total-row');

    let labelTexts;
    let valueCells;

    if (isHeaderRow) {
      labelTexts = labelCols > 1 && groupNames
        ? groupNames.slice(0, labelCols)
        : [cleanCellText(cells[0])];
      valueCells = cells.slice(1);
    } else if (isTotal) {
      labelTexts = ['Total', ...new Array(labelCols - 1).fill('')];
      valueCells = cells.slice(1);
    } else if (labelInner && labelCols > 1) {
      labelStack[level] = extractLabelText(labelInner);
      for (let i = level + 1; i < labelCols; i++) labelStack[i] = '';
      labelTexts = labelStack.slice();
      // Aggregate rows: deeper label columns become "Sum" so they're filterable
      for (let i = level + 1; i < labelCols; i++) labelTexts[i] = 'Sum';
      valueCells = cells.slice(1);
    } else {
      labelTexts = [cleanCellText(cells[0])];
      valueCells = cells.slice(1);
    }

    const tsvCells = [
      ...labelTexts.map((t) => t.replace(/[\t\r\n]/g, ' ')),
      ...valueCells.map((c) => cleanCellText(c).replace(/[\t\r\n]/g, ' ')),
    ];
    tsvRows.push(tsvCells.join('\t'));

    const tag = isHeaderRow ? 'th' : 'td';
    const labelHtml = labelTexts
      .map((t) => `<${tag}>${escapeForHtml(t)}</${tag}>`)
      .join('');
    const valueHtml = valueCells
      .map((c) => {
        const text = cleanCellText(c);
        const t2 = c.tagName.toLowerCase() === 'th' ? 'th' : 'td';
        const colspan = c.colSpan > 1 ? ` colspan="${c.colSpan}"` : '';
        const rowspan = c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : '';
        return `<${t2}${colspan}${rowspan}>${escapeForHtml(text)}</${t2}>`;
      })
      .join('');
    htmlRows.push(`<tr>${labelHtml}${valueHtml}</tr>`);
  }

  return {
    tsv: tsvRows.join('\n'),
    html: `<table>${htmlRows.join('')}</table>`,
  };
}

function getGroupColumnNames(count) {
  const runtime = getRuntime();
  const cols = runtime?.volumetricData?.volumeGroups?.columns || [];
  let ordered = cols.slice();
  const field = getActiveField();
  const typeOrder = field ? getGroupTypeOrder(field) : null;
  if (typeOrder) {
    const head = typeOrder.filter((c) => cols.includes(c));
    const tail = cols.filter((c) => !head.includes(c));
    ordered = [...head, ...tail];
  }
  const out = ordered.slice(0, count);
  while (out.length < count) out.push(`Group ${out.length + 1}`);
  return out;
}

function extractLabelText(labelInner) {
  const spans = labelInner.querySelectorAll('span');
  if (spans.length > 0) {
    return cleanCellText(spans[spans.length - 1]);
  }
  return cleanCellText(labelInner);
}

function cleanCellText(elem) {
  return (elem.innerText || elem.textContent || '').replace(/\s+/g, ' ').trim();
}

function isElementVisible(elem) {
  if (!elem) return false;
  if (elem.hidden) return false;
  if (elem.classList && elem.classList.contains('hidden')) return false;
  const style = window.getComputedStyle(elem);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function escapeForHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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

/**
 * Standard section toggle. Uses data-expanded attribute and .collapsed class.
 */
function setupCollapsible(toggleId, containerId, onExpand) {
  const header = $(`#${toggleId}`);
  const body = $(`#${containerId}`);
  if (!header || !body) return;

  header.addEventListener('click', () => {
    const isExpanded = header.dataset.expanded === 'true';
    header.dataset.expanded = isExpanded ? 'false' : 'true';
    body.classList.toggle('collapsed', isExpanded);
    if (!isExpanded && onExpand) onExpand();
  });
}

function expandSection(toggleId, containerId) {
  const header = $(`#${toggleId}`);
  const body = $(`#${containerId}`);
  if (header) header.dataset.expanded = 'true';
  if (body) body.classList.remove('collapsed');
}

function collapseSection(toggleId, containerId) {
  const header = $(`#${toggleId}`);
  const body = $(`#${containerId}`);
  if (header) header.dataset.expanded = 'false';
  if (body) body.classList.add('collapsed');
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
  store.dispatch('CASE_CREATED', { field, scenario, caseName: newName });
}

// ─── Demo data seeding ──────────────────────────────────────

function seedDemoData() {
  const state = getState();
  // Only seed if completely empty (no fields)
  if (state.fields.length > 0) return;

  const field = 'Demo Field';
  const scenario = 'Base Case';

  // Create field + scenario
  addField(field);
  addScenario(field, scenario);
  setActiveField(field);
  setActiveScenario(scenario);

  // Case 1: Rev1
  const case1 = {
    title: 'Rev1 - Initial', description: 'Initial volumetric estimate', author: 'Demo',
    timestamp: '2026-01-15T10:00:00Z',
    data: [
      { Zones:'Sand 5', Facies:'Channel Sand', Region:'R1', 'Bulk volume':12500, 'Net volume':8750, 'Pore volume':2100, 'HCPV oil':1680, 'STOIIP':11720, 'GIIP':890 },
      { Zones:'Sand 5', Facies:'Channel Sand', Region:'R2', 'Bulk volume':8200, 'Net volume':4920, 'Pore volume':1180, 'HCPV oil':944, 'STOIIP':6600, 'GIIP':510 },
      { Zones:'Sand 5', Facies:'LowQ Sand', Region:'R1', 'Bulk volume':2853, 'Net volume':1560, 'Pore volume':208, 'HCPV oil':91, 'STOIIP':70, 'GIIP':9 },
      { Zones:'Sand 3', Facies:'Channel Sand', Region:'R1', 'Bulk volume':12395, 'Net volume':12102, 'Pore volume':2497, 'HCPV oil':1008, 'STOIIP':774, 'GIIP':56 },
      { Zones:'Sand 3', Facies:'Channel Sand', Region:'R2', 'Bulk volume':9247, 'Net volume':8989, 'Pore volume':1864, 'HCPV oil':542, 'STOIIP':421, 'GIIP':107 },
      { Zones:'Sand 2', Facies:'Channel Sand', Region:'R3', 'Bulk volume':11947, 'Net volume':11719, 'Pore volume':2509, 'HCPV oil':1075, 'STOIIP':824, 'GIIP':41 },
      { Zones:'Sand 2', Facies:'Channel Sand', Region:'R4', 'Bulk volume':40982, 'Net volume':40274, 'Pore volume':8690, 'HCPV oil':3762, 'STOIIP':2886, 'GIIP':171 },
      { Zones:'Sand 2', Facies:'LowQ Sand', Region:'R3', 'Bulk volume':1662, 'Net volume':1346, 'Pore volume':177, 'HCPV oil':41, 'STOIIP':31, 'GIIP':3 },
    ],
    units: { 'Bulk volume':'MCM','Net volume':'MCM','Pore volume':'MCM','HCPV oil':'MCM','STOIIP':'MCM','GIIP':'BCM' },
    format: 'standard_table',
    volumeGroups: { columns: ['Zones','Facies','Region'] },
    valueConversions: {},
  };

  // Case 2: Rev2
  const case2 = {
    title: 'Rev2 - Updated OWC', description: 'OWC shifted -5m', author: 'Demo',
    timestamp: '2026-02-20T14:30:00Z',
    data: [
      { Zones:'Sand 5', Facies:'Channel Sand', Region:'R1', 'Bulk volume':12500, 'Net volume':9100, 'Pore volume':2280, 'HCPV oil':1824, 'STOIIP':12500, 'GIIP':920 },
      { Zones:'Sand 5', Facies:'Channel Sand', Region:'R2', 'Bulk volume':8200, 'Net volume':5100, 'Pore volume':1250, 'HCPV oil':1000, 'STOIIP':7000, 'GIIP':540 },
      { Zones:'Sand 5', Facies:'LowQ Sand', Region:'R1', 'Bulk volume':2853, 'Net volume':1600, 'Pore volume':220, 'HCPV oil':100, 'STOIIP':80, 'GIIP':10 },
      { Zones:'Sand 3', Facies:'Channel Sand', Region:'R1', 'Bulk volume':12395, 'Net volume':12200, 'Pore volume':2550, 'HCPV oil':1050, 'STOIIP':810, 'GIIP':60 },
      { Zones:'Sand 3', Facies:'Channel Sand', Region:'R2', 'Bulk volume':9247, 'Net volume':9000, 'Pore volume':1900, 'HCPV oil':560, 'STOIIP':440, 'GIIP':112 },
      { Zones:'Sand 2', Facies:'Channel Sand', Region:'R3', 'Bulk volume':11947, 'Net volume':11800, 'Pore volume':2600, 'HCPV oil':1120, 'STOIIP':870, 'GIIP':44 },
      { Zones:'Sand 2', Facies:'Channel Sand', Region:'R4', 'Bulk volume':40982, 'Net volume':40500, 'Pore volume':8800, 'HCPV oil':3850, 'STOIIP':2950, 'GIIP':178 },
      { Zones:'Sand 2', Facies:'LowQ Sand', Region:'R3', 'Bulk volume':1662, 'Net volume':1380, 'Pore volume':185, 'HCPV oil':45, 'STOIIP':35, 'GIIP':4 },
    ],
    units: { 'Bulk volume':'MCM','Net volume':'MCM','Pore volume':'MCM','HCPV oil':'MCM','STOIIP':'MCM','GIIP':'BCM' },
    format: 'standard_table',
    volumeGroups: { columns: ['Zones','Facies','Region'] },
    valueConversions: {},
  };

  // Case 3: Rev3
  const case3 = {
    title: 'Rev3 - New porosity', description: 'CPI porosity update', author: 'Demo',
    timestamp: '2026-03-10T09:00:00Z',
    data: [
      { Zones:'Sand 5', Facies:'Channel Sand', Region:'R1', 'Bulk volume':12500, 'Net volume':9100, 'Pore volume':2400, 'HCPV oil':1920, 'STOIIP':13200, 'GIIP':950 },
      { Zones:'Sand 5', Facies:'Channel Sand', Region:'R2', 'Bulk volume':8200, 'Net volume':5100, 'Pore volume':1320, 'HCPV oil':1056, 'STOIIP':7400, 'GIIP':560 },
      { Zones:'Sand 5', Facies:'LowQ Sand', Region:'R1', 'Bulk volume':2853, 'Net volume':1600, 'Pore volume':240, 'HCPV oil':108, 'STOIIP':86, 'GIIP':11 },
      { Zones:'Sand 3', Facies:'Channel Sand', Region:'R1', 'Bulk volume':12395, 'Net volume':12200, 'Pore volume':2700, 'HCPV oil':1100, 'STOIIP':850, 'GIIP':63 },
      { Zones:'Sand 3', Facies:'Channel Sand', Region:'R2', 'Bulk volume':9247, 'Net volume':9000, 'Pore volume':2000, 'HCPV oil':590, 'STOIIP':460, 'GIIP':118 },
      { Zones:'Sand 2', Facies:'Channel Sand', Region:'R3', 'Bulk volume':11947, 'Net volume':11800, 'Pore volume':2750, 'HCPV oil':1180, 'STOIIP':920, 'GIIP':47 },
      { Zones:'Sand 2', Facies:'Channel Sand', Region:'R4', 'Bulk volume':40982, 'Net volume':40500, 'Pore volume':9200, 'HCPV oil':4050, 'STOIIP':3100, 'GIIP':185 },
      { Zones:'Sand 2', Facies:'LowQ Sand', Region:'R3', 'Bulk volume':1662, 'Net volume':1380, 'Pore volume':200, 'HCPV oil':50, 'STOIIP':40, 'GIIP':4 },
    ],
    units: { 'Bulk volume':'MCM','Net volume':'MCM','Pore volume':'MCM','HCPV oil':'MCM','STOIIP':'MCM','GIIP':'BCM' },
    format: 'standard_table',
    volumeGroups: { columns: ['Zones','Facies','Region'] },
    valueConversions: {},
  };

  saveCase(field, scenario, 'Rev1 - Initial', case1);
  saveCase(field, scenario, 'Rev2 - Updated OWC', case2);
  saveCase(field, scenario, 'Rev3 - New porosity', case3);
  addCaseToOrder(field, scenario, 'Rev1 - Initial');
  addCaseToOrder(field, scenario, 'Rev2 - Updated OWC');
  addCaseToOrder(field, scenario, 'Rev3 - New porosity');
  saveAppState();
}
