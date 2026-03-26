// components/CaseImport.js — Paste/import modal for adding new cases

import { getState, getFields, getActiveField, setActiveField, setActiveCase } from '../core/state.js';
import { parseOutputSheet, detectGroupColumns, FORMAT } from '../core/parser.js';
import { getScaledUnit } from '../utils/units.js';
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

  // Default author
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

  // Timestamp
  const now = new Date();
  $('#timestamp-display', modalEl).textContent = formatDateTime(now);
  $('#custom-timestamp', modalEl).value = formatDateTimeForInput(now);
  $('#timestamp-picker-container', modalEl).classList.add('hidden');

  // Volume groups — start with one empty level
  const container = $('#volume-group-container', modalEl);
  clear(container);
  addGroupLevel(container, []);

  // Clear preview
  const preview = $('#import-preview', modalEl);
  if (preview) clear(preview);
}

function populateFields() {
  const selector = $('#new-case-field', modalEl);
  clear(selector);
  for (const field of getFields()) {
    const opt = el('option', { value: field, textContent: field });
    selector.appendChild(opt);
  }
  const active = getActiveField();
  if (active) selector.value = active;
}

// ─── Volume Groups UI ───────────────────────────────────────

function addGroupLevel(container, columns, selectedValue = null) {
  const levelCount = container.querySelectorAll('.group-level').length;
  const wrapper = el('div', { class: 'group-level flex items-center gap-2' });

  const select = document.createElement('select');
  select.className = 'flex-1 pl-3 pr-10 py-2 text-sm border-gray-300 rounded-md border focus:outline-none focus:ring-blue-500 focus:border-blue-500';
  select.required = true;

  // Placeholder
  const placeholder = el('option', { value: '', textContent: `-- Select Level ${levelCount + 1} group --` });
  select.appendChild(placeholder);

  for (const col of columns) {
    const opt = el('option', { value: col, textContent: col });
    select.appendChild(opt);
  }

  if (selectedValue && columns.includes(selectedValue)) {
    select.value = selectedValue;
  }

  const removeBtn = el('button', {
    type: 'button',
    class: 'text-red-500 hover:text-red-700 text-sm p-1',
    innerHTML: '<i class="fas fa-times"></i>',
    onClick: () => wrapper.remove(),
  });

  wrapper.append(select, removeBtn);
  container.appendChild(wrapper);
  return wrapper;
}

function getVolumeGroupsFromUI(container) {
  return Array.from(container.querySelectorAll('.group-level select'))
    .map(s => s.value)
    .filter(Boolean);
}

// ─── Data detection on paste ────────────────────────────────

function onDataPaste() {
  const rawData = $('#new-case-data', modalEl).value.trim();
  if (!rawData) return;

  // Quick parse to detect columns
  const result = parseOutputSheet(rawData, { divideBy1000: false });

  // Show error if format rejected
  const preview = $('#import-preview', modalEl);
  if (preview) clear(preview);

  if (result.error) {
    if (preview) {
      preview.innerHTML = `<div class="text-red-600 text-sm p-2 bg-red-50 rounded">${result.error}</div>`;
    }
    return;
  }

  detectedHeaders = result.headers;
  headerUnits = result.units;

  // Show preview
  if (preview && result.data) {
    const previewRows = result.data.slice(0, 3);
    let html = `<div class="text-sm text-gray-600 mb-1">${result.data.length} rows, ${result.headers.length} columns`;
    if (result.format === FORMAT.SINGLE_LINE_TOTALS) {
      html += ' <span class="text-amber-600">(single line totals)</span>';
    }
    html += '</div>';
    html += '<div class="overflow-x-auto max-h-24 text-xs border rounded">';
    html += '<table class="min-w-full"><thead class="bg-gray-50"><tr>';
    for (const h of result.headers) {
      if (h) html += `<th class="px-2 py-1 text-left">${h}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (const row of previewRows) {
      html += '<tr class="border-t">';
      for (const h of result.headers) {
        if (h) {
          const val = row[h];
          html += `<td class="px-2 py-1">${typeof val === 'number' ? val.toFixed(2) : val}</td>`;
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
  const title = $('#new-case-title', modalEl).value.trim();
  const description = $('#new-case-description', modalEl).value.trim();
  const author = $('#new-case-author', modalEl).value.trim();
  const rawData = $('#new-case-data', modalEl).value.trim();
  const divideBy1000 = $('#divide-by-1000-toggle', modalEl).checked;

  if (!field || !title) {
    alert('Please enter both a field and case title.');
    return;
  }
  if (!rawData) {
    alert('Please enter volumetric data.');
    return;
  }

  // Save default author if toggled
  if ($('#default-author-toggle', modalEl).checked && author) {
    saveDefaultAuthor(author);
  }

  // Get timestamp
  let timestamp;
  if ($('#timestamp-picker-container', modalEl).classList.contains('hidden')) {
    timestamp = new Date().toISOString();
  } else {
    timestamp = new Date($('#custom-timestamp', modalEl).value).toISOString();
  }

  // Parse data
  const result = parseOutputSheet(rawData, { divideBy1000 });
  if (result.error) {
    alert(result.error);
    return;
  }

  // Get volume groups from UI
  const volumeGroupColumns = getVolumeGroupsFromUI($('#volume-group-container', modalEl));

  // Build case object
  const caseData = {
    title,
    description,
    author,
    data: result.data,
    units: result.units,
    timestamp,
    format: result.format,
    volumeGroups: { columns: volumeGroupColumns },
    valueConversions: {},
  };

  // Save
  saveCase(field, title, caseData);
  addCaseToOrder(field, title);

  // Update state
  setActiveField(field);
  setActiveCase(title);
  saveAppState();

  hide();
  emit(EVENTS.CASE_CREATED, { field, caseName: title, caseData });
}

// ─── Event wiring ───────────────────────────────────────────

export function setupEvents() {
  // Paste detection (debounced)
  let pasteTimeout;
  $('#new-case-data', modalEl).addEventListener('input', () => {
    clearTimeout(pasteTimeout);
    pasteTimeout = setTimeout(onDataPaste, 300);
  });

  // Timestamp toggle
  $('#timestamp-display', modalEl).addEventListener('click', () => {
    $('#timestamp-picker-container', modalEl).classList.toggle('hidden');
  });

  // Default author toggle
  $('#default-author-toggle', modalEl).addEventListener('change', (e) => {
    const input = $('#new-case-author', modalEl);
    if (e.target.checked) {
      input.disabled = true;
    } else {
      input.disabled = false;
    }
  });

  // Add group level
  $('#add-group-level', modalEl).addEventListener('click', () => {
    const container = $('#volume-group-container', modalEl);
    const columns = detectedHeaders.length > 0
      ? detectGroupColumns(detectedHeaders, headerUnits)
      : [];
    addGroupLevel(container, columns);
  });

  // Buttons
  $('#cancel-add-case', modalEl).addEventListener('click', hide);
  $('#confirm-add-case', modalEl).addEventListener('click', submit);
}
