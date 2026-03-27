// components/CaseEditor.js — Post-import metadata editing modal
// Updated for Field → Scenario → Case hierarchy.

import { getActiveField, getActiveCase, getActiveScenario } from '../core/state.js';
import { getCaseData, saveCase, renameCase as storageRenameCase, saveAppState } from '../core/storage.js';
import { emit, EVENTS } from '../core/events.js';
import { formatDateTimeForInput } from '../utils/format.js';
import { el, clear, $, $$ } from '../utils/dom.js';

let modalEl = null;
let editingField = null;
let editingScenario = null;
let editingCase = null;

const STANDARD_COLUMNS = [
  'Bulk volume', 'Net volume', 'Pore volume',
  'HCPV oil', 'HCPV gas', 'STOIIP', 'GIIP',
];

export function init() {
  modalEl = document.getElementById('rename-case-modal');
}

export function show(field, caseName, scenario) {
  editingField = field || getActiveField();
  editingScenario = scenario || getActiveScenario();
  editingCase = caseName || getActiveCase();
  if (!editingField || !editingScenario || !editingCase) return;

  const caseData = getCaseData(editingField, editingCase, editingScenario);
  if (!caseData) return;

  populateForm(caseData);
  document.getElementById('modal-overlay').classList.remove('hidden');
  modalEl.classList.remove('hidden');
}

function hide() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalEl.classList.add('hidden');
}

function populateForm(caseData) {
  $('#rename-case-title', modalEl).value = editingCase;
  $('#edit-case-description', modalEl).value = caseData.description || '';
  $('#edit-case-author', modalEl).value = caseData.author || '';

  const ts = caseData.timestamp ? new Date(caseData.timestamp) : new Date();
  $('#edit-timestamp', modalEl).value = formatDateTimeForInput(ts);

  const columns = caseData.data?.[0]
    ? Object.keys(caseData.data[0]).filter(c =>
        !STANDARD_COLUMNS.includes(c) && c.trim() !== '' && !c.startsWith('__'))
    : [];

  const groupColumns = caseData.volumeGroups?.columns || [];
  const container = $('#edit-volume-group-container', modalEl);
  clear(container);

  if (groupColumns.length > 0) {
    for (const col of groupColumns) addGroupLevel(container, columns, col);
  } else if (columns.length >= 2) {
    addGroupLevel(container, columns);
    addGroupLevel(container, columns);
  } else if (columns.length === 1) {
    addGroupLevel(container, columns);
  }

  // Value conversions
  const convContainer = $('#edit-value-conversions-container', modalEl);
  clear(convContainer);
  const existingConversions = caseData.valueConversions || {};
  for (const column of columns) {
    createValueConversionUI(convContainer, column, caseData.data, existingConversions[column]);
  }
}

// ─── Volume Groups UI ───────────────────────────────────────

function addGroupLevel(container, columns, selectedValue = null) {
  const levelCount = container.querySelectorAll('.group-level').length;
  const wrapper = el('div', { class: 'group-level flex items-center gap-2' });

  const select = document.createElement('select');
  select.className = 'flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-indigo-500';

  select.appendChild(el('option', { value: '', textContent: `Level ${levelCount + 1}...` }));
  for (const col of columns) select.appendChild(el('option', { value: col, textContent: col }));
  if (selectedValue && columns.includes(selectedValue)) select.value = selectedValue;

  const removeBtn = el('button', {
    type: 'button',
    class: 'text-gray-400 hover:text-red-500 text-sm p-1 transition-colors',
    innerHTML: '<i class="fas fa-times"></i>',
    onClick: () => wrapper.remove(),
  });

  wrapper.append(select, removeBtn);
  container.appendChild(wrapper);
}

function getVolumeGroupsFromUI(container) {
  return Array.from(container.querySelectorAll('.group-level select'))
    .map(s => s.value).filter(Boolean);
}

// ─── Value Conversions UI ───────────────────────────────────

function createValueConversionUI(container, columnName, data, existingConversion) {
  const convDiv = el('div', {
    class: 'mb-3 border border-gray-100 rounded-lg p-3',
    dataset: { column: columnName },
  });

  const header = el('div', { class: 'flex items-center justify-between mb-2' });
  const label = el('label', { class: 'inline-flex items-center cursor-pointer text-xs text-gray-600' });
  const toggle = el('input', { type: 'checkbox', class: 'sr-only peer', id: `conv-${columnName}` });
  toggle.checked = existingConversion?.enabled || false;

  const sliderDiv = el('div', {
    class: 'relative w-8 h-4 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-500',
  });
  const labelText = el('span', { class: 'ml-1.5', textContent: columnName });
  label.append(toggle, sliderDiv, labelText);
  header.appendChild(label);
  convDiv.appendChild(header);

  const content = el('div', {
    class: 'overflow-hidden transition-all duration-300',
    style: { maxHeight: toggle.checked ? '400px' : '0' },
  });

  const uniqueValues = [...new Set(data.map(row => row[columnName]))].sort();
  const table = el('table', { class: 'w-full text-xs' });
  const thead = el('thead', { class: 'sticky top-0 bg-white' });
  thead.innerHTML = '<tr class="border-b border-gray-100"><th class="text-left py-1 px-2">Original</th><th class="text-left py-1 px-2">Converted</th></tr>';
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const value of uniqueValues) {
    const row = el('tr', { class: 'border-b border-gray-50' });
    row.appendChild(el('td', { class: 'py-1 px-2 text-gray-500', textContent: value || '(empty)' }));
    const input = el('input', {
      type: 'text',
      class: 'w-full px-2 py-0.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-indigo-500',
      placeholder: value || '(empty)',
      dataset: { originalValue: value },
    });
    input.value = existingConversion?.mappings?.[value] || '';
    row.appendChild(el('td', { class: 'py-1 px-2' }, [input]));
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  content.appendChild(el('div', { class: 'overflow-y-auto max-h-[300px]' }, [table]));
  convDiv.appendChild(content);

  toggle.addEventListener('change', () => {
    content.style.maxHeight = toggle.checked ? '400px' : '0';
  });

  container.appendChild(convDiv);
}

function getValueConversionsFromUI() {
  const conversions = {};
  const container = $('#edit-value-conversions-container', modalEl);

  for (const div of container.querySelectorAll('[data-column]')) {
    const columnName = div.dataset.column;
    const enabled = div.querySelector('input[type="checkbox"]').checked;
    const mappings = {};
    for (const input of div.querySelectorAll('input[type="text"]')) {
      if (input.value.trim()) mappings[input.dataset.originalValue] = input.value.trim();
    }
    if (Object.keys(mappings).length > 0 || enabled) {
      conversions[columnName] = { enabled, mappings };
    }
  }
  return conversions;
}

// ─── Submit ─────────────────────────────────────────────────

function submit() {
  const newTitle = $('#rename-case-title', modalEl).value.trim();
  const description = $('#edit-case-description', modalEl).value.trim();
  const author = $('#edit-case-author', modalEl).value.trim();
  const timestamp = new Date($('#edit-timestamp', modalEl).value).toISOString();
  const volumeGroupColumns = getVolumeGroupsFromUI($('#edit-volume-group-container', modalEl));
  const valueConversions = getValueConversionsFromUI();

  if (!newTitle) return;

  // Handle rename
  if (newTitle !== editingCase) {
    if (!storageRenameCase(editingField, editingScenario, editingCase, newTitle)) {
      alert(`Case "${newTitle}" already exists.`);
      return;
    }
    editingCase = newTitle;
  }

  const caseData = getCaseData(editingField, editingCase, editingScenario);
  if (!caseData) return;

  caseData.description = description;
  caseData.author = author;
  caseData.timestamp = timestamp;
  caseData.volumeGroups = { columns: volumeGroupColumns };
  caseData.valueConversions = valueConversions;

  saveCase(editingField, editingScenario, editingCase, caseData);
  saveAppState();
  hide();

  emit(EVENTS.CASE_UPDATED, { field: editingField, scenario: editingScenario, caseName: editingCase });
}

// ─── Event wiring ───────────────────────────────────────────

export function setupEvents() {
  const addGroupBtn = $('#edit-add-group-level', modalEl);
  if (addGroupBtn) {
    addGroupBtn.addEventListener('click', () => {
      const caseData = getCaseData(editingField, editingCase, editingScenario);
      const columns = caseData?.data?.[0]
        ? Object.keys(caseData.data[0]).filter(c =>
            !STANDARD_COLUMNS.includes(c) && c.trim() !== '' && !c.startsWith('__'))
        : [];
      addGroupLevel($('#edit-volume-group-container', modalEl), columns);
    });
  }

  const cancelBtn = $('#cancel-rename-case', modalEl);
  if (cancelBtn) cancelBtn.addEventListener('click', hide);

  const confirmBtn = $('#confirm-rename-case', modalEl);
  if (confirmBtn) confirmBtn.addEventListener('click', submit);
}
