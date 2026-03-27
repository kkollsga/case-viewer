// components/CaseImport.js — Paste/import modal for adding new cases
// Updated for Field → Scenario → Case hierarchy.

import { getState, getFields, getActiveField, getActiveScenario, getScenariosForField,
         setActiveField, setActiveScenario, setActiveCase, addScenario } from '../core/state.js';
import { parseOutputSheet, detectGroupColumns, FORMAT } from '../core/parser.js';
import { saveCase, addCaseToOrder, saveAppState, loadDefaultAuthor, saveDefaultAuthor } from '../core/storage.js';
import { emit, EVENTS } from '../core/events.js';
import { formatDateTimeForInput, formatDateTime } from '../utils/format.js';
import { el, clear, $, $$ } from '../utils/dom.js';

let modalEl = null;
let detectedHeaders = [];
let headerUnits = {};

export function init() {
  modalEl = document.getElementById('add-case-modal');
}

export function show() {
  clearForm();
  populateFields();
  document.getElementById('modal-overlay').classList.remove('hidden');
  modalEl.classList.remove('hidden');
}

function hide() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalEl.classList.add('hidden');
}

function clearForm() {
  $('#new-case-title', modalEl).value = '';
  $('#new-case-description', modalEl).value = '';
  $('#new-case-data', modalEl).value = '';
  $('#divide-by-1000-toggle', modalEl).checked = true;

  const author = loadDefaultAuthor();
  const authorInput = $('#new-case-author', modalEl);
  const defaultToggle = $('#default-author-toggle', modalEl);
  if (author) {
    authorInput.value = author;
    defaultToggle.checked = true;
    authorInput.disabled = true;
  } else {
    authorInput.value = '';
    defaultToggle.checked = false;
    authorInput.disabled = false;
  }

  const now = new Date();
  $('#timestamp-display', modalEl).textContent = formatDateTime(now);
  $('#custom-timestamp', modalEl).value = formatDateTimeForInput(now);
  $('#timestamp-picker-container', modalEl).classList.add('hidden');

  const container = $('#volume-group-container', modalEl);
  clear(container);
  addGroupLevel(container, []);

  const preview = $('#import-preview', modalEl);
  if (preview) clear(preview);
}

function populateFields() {
  // Field selector
  const fieldSel = $('#new-case-field', modalEl);
  clear(fieldSel);
  for (const field of getFields()) {
    fieldSel.appendChild(el('option', { value: field, textContent: field }));
  }
  const active = getActiveField();
  if (active) fieldSel.value = active;

  // Scenario selector
  updateScenarioSelector();
}

function updateScenarioSelector() {
  const scenarioSel = $('#new-case-scenario', modalEl);
  if (!scenarioSel) return;
  clear(scenarioSel);

  const field = $('#new-case-field', modalEl)?.value;
  if (!field) return;

  const scenarios = getScenariosForField(field);
  for (const sc of scenarios) {
    scenarioSel.appendChild(el('option', { value: sc, textContent: sc }));
  }

  const active = getActiveScenario();
  if (active && scenarios.includes(active)) {
    scenarioSel.value = active;
  } else if (scenarios.length > 0) {
    scenarioSel.value = scenarios[0];
  }
}

// ─── Volume Groups UI ───────────────────────────────────────

function addGroupLevel(container, columns, selectedValue = null) {
  const levelCount = container.querySelectorAll('.group-level').length;
  const wrapper = el('div', { class: 'group-level flex items-center gap-2' });

  const select = document.createElement('select');
  select.className = 'flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-transparent';

  select.appendChild(el('option', { value: '', textContent: `Level ${levelCount + 1} grouping...` }));
  for (const col of columns) {
    select.appendChild(el('option', { value: col, textContent: col }));
  }
  if (selectedValue && columns.includes(selectedValue)) select.value = selectedValue;

  const removeBtn = el('button', {
    type: 'button',
    class: 'text-gray-400 hover:text-red-500 text-sm p-1 transition-colors',
    innerHTML: '<i class="fas fa-times"></i>',
    onClick: () => wrapper.remove(),
  });

  wrapper.append(select, removeBtn);
  container.appendChild(wrapper);
  return wrapper;
}

function getVolumeGroupsFromUI(container) {
  return Array.from(container.querySelectorAll('.group-level select'))
    .map(s => s.value).filter(Boolean);
}

// ─── Data detection on paste ────────────────────────────────

function onDataPaste() {
  const rawData = $('#new-case-data', modalEl).value.trim();
  if (!rawData) return;

  const result = parseOutputSheet(rawData, { divideBy1000: false });
  const preview = $('#import-preview', modalEl);
  if (preview) clear(preview);

  if (result.error) {
    if (preview) {
      preview.innerHTML = `<div class="text-red-500 text-xs p-2 bg-red-50 rounded-lg">${result.error}</div>`;
    }
    return;
  }

  detectedHeaders = result.headers;
  headerUnits = result.units;

  if (preview && result.data) {
    const previewRows = result.data.slice(0, 3);
    let html = `<div class="text-xs text-gray-500 mb-1">${result.data.length} rows, ${result.headers.length} columns`;
    if (result.format === FORMAT.SINGLE_LINE_TOTALS) {
      html += ' <span class="text-amber-500">(totals only)</span>';
    }
    html += '</div><div class="overflow-x-auto max-h-20 text-xs border border-gray-100 rounded-lg">';
    html += '<table class="min-w-full"><thead class="bg-gray-50"><tr>';
    for (const h of result.headers) {
      if (h) html += `<th class="px-2 py-1 text-left text-gray-500">${h}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (const row of previewRows) {
      html += '<tr class="border-t border-gray-50">';
      for (const h of result.headers) {
        if (h) {
          const val = row[h];
          html += `<td class="px-2 py-0.5 text-gray-600">${typeof val === 'number' ? val.toFixed(2) : val}</td>`;
        }
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    preview.innerHTML = html;
  }

  // Auto-populate volume groups
  const groupColumns = result.groupColumns || [];
  const container = $('#volume-group-container', modalEl);
  clear(container);

  if (groupColumns.length >= 2) {
    addGroupLevel(container, groupColumns, groupColumns[0]);
    addGroupLevel(container, groupColumns, groupColumns[1]);
  } else if (groupColumns.length === 1) {
    addGroupLevel(container, groupColumns, groupColumns[0]);
  } else {
    addGroupLevel(container, []);
  }
}

// ─── Submit ─────────────────────────────────────────────────

function submit() {
  const field = $('#new-case-field', modalEl).value;
  const scenario = $('#new-case-scenario', modalEl)?.value || 'Default';
  const title = $('#new-case-title', modalEl).value.trim();
  const description = $('#new-case-description', modalEl).value.trim();
  const author = $('#new-case-author', modalEl).value.trim();
  const rawData = $('#new-case-data', modalEl).value.trim();
  const divideBy1000 = $('#divide-by-1000-toggle', modalEl).checked;

  if (!field || !title) { alert('Please enter both a field and case title.'); return; }
  if (!rawData) { alert('Please enter volumetric data.'); return; }

  // Save default author
  if ($('#default-author-toggle', modalEl).checked && author) {
    saveDefaultAuthor(author);
  }

  // Ensure scenario exists
  addScenario(field, scenario);

  // Timestamp
  let timestamp;
  if ($('#timestamp-picker-container', modalEl).classList.contains('hidden')) {
    timestamp = new Date().toISOString();
  } else {
    timestamp = new Date($('#custom-timestamp', modalEl).value).toISOString();
  }

  // Parse
  const result = parseOutputSheet(rawData, { divideBy1000 });
  if (result.error) { alert(result.error); return; }

  const volumeGroupColumns = getVolumeGroupsFromUI($('#volume-group-container', modalEl));

  const caseData = {
    title, description, author, timestamp,
    data: result.data,
    units: result.units,
    format: result.format,
    volumeGroups: { columns: volumeGroupColumns },
    valueConversions: {},
  };

  // Save with scenario
  saveCase(field, scenario, title, caseData);
  addCaseToOrder(field, scenario, title);

  setActiveField(field);
  setActiveScenario(scenario);
  saveAppState();

  hide();
  emit(EVENTS.CASE_CREATED, { field, scenario, caseName: title, caseData });
}

// ─── Event wiring ───────────────────────────────────────────

export function setupEvents() {
  let pasteTimeout;
  const dataEl = $('#new-case-data', modalEl);
  if (dataEl) {
    dataEl.addEventListener('input', () => {
      clearTimeout(pasteTimeout);
      pasteTimeout = setTimeout(onDataPaste, 300);
    });
  }

  const tsDisplay = $('#timestamp-display', modalEl);
  if (tsDisplay) {
    tsDisplay.addEventListener('click', () => {
      $('#timestamp-picker-container', modalEl).classList.toggle('hidden');
    });
  }

  const defaultToggle = $('#default-author-toggle', modalEl);
  if (defaultToggle) {
    defaultToggle.addEventListener('change', (e) => {
      $('#new-case-author', modalEl).disabled = e.target.checked;
    });
  }

  const addGroupBtn = $('#add-group-level', modalEl);
  if (addGroupBtn) {
    addGroupBtn.addEventListener('click', () => {
      const container = $('#volume-group-container', modalEl);
      const columns = detectedHeaders.length > 0
        ? detectGroupColumns(detectedHeaders, headerUnits) : [];
      addGroupLevel(container, columns);
    });
  }

  // Field change → update scenarios
  const fieldSel = $('#new-case-field', modalEl);
  if (fieldSel) {
    fieldSel.addEventListener('change', updateScenarioSelector);
  }

  const cancelBtn = $('#cancel-add-case', modalEl);
  if (cancelBtn) cancelBtn.addEventListener('click', hide);

  const confirmBtn = $('#confirm-add-case', modalEl);
  if (confirmBtn) confirmBtn.addEventListener('click', submit);
}
