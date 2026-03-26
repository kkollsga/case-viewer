// components/CaseEditor.js — Post-import metadata editing modal

import { getActiveField, getActiveCase } from '../core/state.js';
import { getCaseData, saveCase, renameCase as storageRenameCase, saveAppState } from '../core/storage.js';
import { emit, EVENTS } from '../core/events.js';
import { formatDateTimeForInput } from '../utils/format.js';
import { el, clear, $, $$ } from '../utils/dom.js';

let modalEl = null;
let editingField = null;
let editingCase = null;

const STANDARD_COLUMNS = [
  'Bulk volume', 'Net volume', 'Pore volume',
  'HCPV oil', 'HCPV gas', 'STOIIP', 'GIIP',
];

export function init() {
  modalEl = document.getElementById('rename-case-modal');
}

export function show(field, caseName) {
  editingField = field || getActiveField();
  editingCase = caseName || getActiveCase();
  if (!editingField || !editingCase) return;

  const caseData = getCaseData(editingField, editingCase);
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

  // Timestamp
  const ts = caseData.timestamp ? new Date(caseData.timestamp) : new Date();
  $('#edit-timestamp', modalEl).value = formatDateTimeForInput(ts);

  // Volume groups
  const columns = caseData.data && caseData.data[0]
    ? Object.keys(caseData.data[0]).filter(c =>
        !STANDARD_COLUMNS.includes(c) && c.trim() !== '' && !c.startsWith('__'))
    : [];

  const groupColumns = caseData.volumeGroups?.columns || [];
  const container = $('#edit-volume-group-container', modalEl);
  clear(container);

  if (groupColumns.length > 0) {
    for (const col of groupColumns) {
      addGroupLevel(container, columns, col);
    }
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
  select.className = 'flex-1 pl-3 pr-10 py-2 text-sm border-gray-300 rounded-md border focus:outline-none focus:ring-blue-500 focus:border-blue-500';

  const placeholder = el('option', { value: '', textContent: `-- Select Level ${levelCount + 1} group --` });
  select.appendChild(placeholder);

  for (const col of columns) {
    select.appendChild(el('option', { value: col, textContent: col }));
  }

  if (selectedValue && columns.includes(selectedValue)) select.value = selectedValue;

  const removeBtn = el('button', {
    type: 'button',
    class: 'text-red-500 hover:text-red-700 text-sm p-1',
    innerHTML: '<i class="fas fa-times"></i>',
    onClick: () => wrapper.remove(),
  });

  wrapper.append(select, removeBtn);
  container.appendChild(wrapper);
}

function getVolumeGroupsFromUI(container) {
  return Array.from(container.querySelectorAll('.group-level select'))
    .map(s => s.value)
    .filter(Boolean);
}

// ─── Value Conversions UI ───────────────────────────────────

function createValueConversionUI(container, columnName, data, existingConversion) {
  const convDiv = el('div', {
    class: 'mb-4 border border-gray-200 rounded-lg p-3',
    dataset: { column: columnName },
  });

  // Header with toggle
  const header = el('div', { class: 'flex items-center justify-between mb-2' });
  const leftSection = el('div', { class: 'flex items-center gap-2' });

  const label = el('label', { class: 'inline-flex items-center cursor-pointer text-sm text-gray-700' });
  const toggle = el('input', { type: 'checkbox', class: 'sr-only peer', id: `conversion-toggle-${columnName}` });
  toggle.checked = existingConversion?.enabled || false;

  const sliderDiv = el('div', {
    class: 'relative w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-gray-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500',
  });

  const labelText = el('span', { class: 'ml-2', textContent: `Convert "${columnName}"` });
  label.append(toggle, sliderDiv, labelText);

  const collapseBtn = el('button', {
    type: 'button',
    class: 'p-1 hover:bg-gray-100 rounded transition-all duration-200',
    innerHTML: '<i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200"></i>',
    style: { display: toggle.checked ? 'block' : 'none' },
  });

  leftSection.append(label, collapseBtn);

  // Copy/Paste buttons
  const buttonsDiv = el('div', { class: 'flex gap-1' });
  const isCollapsed = existingConversion?.collapsed || false;

  const copyBtn = el('button', {
    type: 'button',
    class: 'text-blue-600 hover:text-blue-800 transition-colors p-1',
    title: 'Copy conversion table',
    innerHTML: '<i class="fas fa-copy"></i>',
    style: { display: toggle.checked && !isCollapsed ? 'block' : 'none' },
  });

  const pasteBtn = el('button', {
    type: 'button',
    class: 'text-blue-600 hover:text-blue-800 transition-colors p-1',
    title: 'Paste conversion values',
    innerHTML: '<i class="far fa-paste"></i>',
    style: { display: toggle.checked && !isCollapsed ? 'block' : 'none' },
  });

  buttonsDiv.append(copyBtn, pasteBtn);
  header.append(leftSection, buttonsDiv);
  convDiv.appendChild(header);

  // Content area
  const content = el('div', {
    class: 'value-conversion-content overflow-hidden transition-all duration-300',
    style: { maxHeight: toggle.checked && !isCollapsed ? '400px' : '0' },
  });

  if (toggle.checked && isCollapsed) {
    collapseBtn.querySelector('i').classList.add('-rotate-90');
  }

  // Build table
  const uniqueValues = [...new Set(data.map(row => row[columnName]))].sort();
  const table = el('table', { class: 'w-full text-sm' });
  const thead = el('thead', { class: 'sticky top-0 bg-white' });
  thead.innerHTML = '<tr class="border-b"><th class="text-left py-1 px-2 bg-white">Original</th><th class="text-left py-1 px-2 bg-white">Converted</th></tr>';
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const value of uniqueValues) {
    const row = el('tr', { class: 'border-b' });
    const origCell = el('td', { class: 'py-1 px-2', textContent: value || '(empty)' });

    const input = el('input', {
      type: 'text',
      class: 'w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500',
      placeholder: value || '(empty)',
      dataset: { originalValue: value },
    });
    input.value = existingConversion?.mappings?.[value] || '';

    const convertCell = el('td', { class: 'py-1 px-2' }, [input]);
    row.append(origCell, convertCell);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  const scroll = el('div', { class: 'overflow-y-auto max-h-[380px]' }, [table]);
  content.appendChild(scroll);
  convDiv.appendChild(content);

  // Events
  toggle.addEventListener('change', () => {
    collapseBtn.style.display = toggle.checked ? 'block' : 'none';
    content.style.maxHeight = toggle.checked ? '400px' : '0';
    copyBtn.style.display = toggle.checked ? 'block' : 'none';
    pasteBtn.style.display = toggle.checked ? 'block' : 'none';
    collapseBtn.querySelector('i').classList.remove('-rotate-90');
  });

  collapseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const chevron = collapseBtn.querySelector('i');
    const collapsed = content.style.maxHeight === '0px';
    content.style.maxHeight = collapsed ? '400px' : '0';
    chevron.classList.toggle('-rotate-90', !collapsed);
    copyBtn.style.display = collapsed ? 'block' : 'none';
    pasteBtn.style.display = collapsed ? 'block' : 'none';
  });

  copyBtn.addEventListener('click', (e) => {
    e.preventDefault();
    let tsv = 'Original Value\tConverted Value\n';
    for (const row of tbody.querySelectorAll('tr')) {
      const orig = row.querySelector('td:first-child').textContent;
      const val = row.querySelector('input').value || '';
      tsv += `${orig === '(empty)' ? '' : orig}\t${val}\n`;
    }
    navigator.clipboard.writeText(tsv).then(() => {
      copyBtn.classList.replace('text-blue-600', 'text-green-600');
      setTimeout(() => copyBtn.classList.replace('text-green-600', 'text-blue-600'), 1000);
    });
  });

  pasteBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      const lines = text.trim().split('\n');
      const inputs = convDiv.querySelectorAll('input[type="text"]');
      const isTab = lines[0].includes('\t');
      let startIdx = 0;

      // Detect header row
      if (isTab) {
        const cells = lines[0].split('\t');
        if (cells[0].toLowerCase().includes('original') || cells[0].toLowerCase().includes('value')) {
          startIdx = 1;
        }
      }

      if (isTab) {
        const inputMap = new Map();
        inputs.forEach(inp => inputMap.set(inp.dataset.originalValue, inp));
        for (let i = startIdx; i < lines.length; i++) {
          const parts = lines[i].split('\t');
          if (parts.length >= 2) {
            const inp = inputMap.get(parts[0]);
            if (inp) inp.value = parts[1];
          }
        }
      } else {
        const dataLines = lines.slice(startIdx);
        dataLines.forEach((line, idx) => {
          if (idx < inputs.length) inputs[idx].value = line.trim();
        });
      }

      pasteBtn.classList.replace('text-blue-600', 'text-green-600');
      setTimeout(() => pasteBtn.classList.replace('text-green-600', 'text-blue-600'), 1000);
    } catch (err) {
      console.error('Paste failed:', err);
    }
  });

  container.appendChild(convDiv);
}

function getValueConversionsFromUI() {
  const conversions = {};
  const container = $('#edit-value-conversions-container', modalEl);

  for (const div of container.querySelectorAll('[data-column]')) {
    const columnName = div.dataset.column;
    const enabled = div.querySelector('input[type="checkbox"]').checked;
    const content = div.querySelector('.value-conversion-content');
    const isCollapsed = content.style.maxHeight === '0px' && enabled;

    const mappings = {};
    for (const input of div.querySelectorAll('input[type="text"]')) {
      if (input.value.trim()) {
        mappings[input.dataset.originalValue] = input.value.trim();
      }
    }

    if (Object.keys(mappings).length > 0 || enabled) {
      conversions[columnName] = { enabled, collapsed: isCollapsed, mappings };
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

  const caseData = getCaseData(editingField, editingCase);
  if (!caseData) return;

  // Handle rename
  if (newTitle !== editingCase) {
    if (!storageRenameCase(editingField, editingCase, newTitle)) {
      alert(`Case "${newTitle}" already exists.`);
      return;
    }
    editingCase = newTitle;
  }

  // Update metadata
  const updatedData = getCaseData(editingField, editingCase);
  updatedData.description = description;
  updatedData.author = author;
  updatedData.timestamp = timestamp;
  updatedData.volumeGroups = { columns: volumeGroupColumns };
  updatedData.valueConversions = valueConversions;

  saveCase(editingField, editingCase, updatedData);
  saveAppState();
  hide();

  emit(EVENTS.CASE_UPDATED, { field: editingField, caseName: editingCase });
}

// ─── Event wiring ───────────────────────────────────────────

export function setupEvents() {
  // Add group level button
  $('#edit-add-group-level', modalEl).addEventListener('click', () => {
    const caseData = getCaseData(editingField, editingCase);
    const columns = caseData?.data?.[0]
      ? Object.keys(caseData.data[0]).filter(c =>
          !STANDARD_COLUMNS.includes(c) && c.trim() !== '' && !c.startsWith('__'))
      : [];
    addGroupLevel($('#edit-volume-group-container', modalEl), columns);
  });

  $('#cancel-rename-case', modalEl).addEventListener('click', hide);
  $('#confirm-rename-case', modalEl).addEventListener('click', submit);
}
