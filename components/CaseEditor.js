// components/CaseEditor.js — Post-import metadata editing
// Only allows editing: case name, description. No raw data changes.

import { getActiveField, getActiveCase, getActiveScenario } from '../core/state.js';
import { getCaseData, saveCase, renameCase as storageRenameCase, saveAppState } from '../core/storage.js';
import { emit, EVENTS } from '../core/events.js';
import { formatDateTime } from '../utils/format.js';
import { el, clear, $ } from '../utils/dom.js';

let modalEl = null;
let editingField = null;
let editingScenario = null;
let editingCase = null;

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

  // Show read-only info
  const authorEl = $('#edit-case-author', modalEl);
  if (authorEl) authorEl.value = caseData.author || '';

  const tsEl = $('#edit-timestamp', modalEl);
  if (tsEl) {
    const ts = caseData.timestamp ? new Date(caseData.timestamp) : new Date();
    tsEl.value = formatDateTime(ts);
    tsEl.disabled = true;
  }

  // Hide volume groups and value conversions containers (not editable post-import)
  const vgContainer = $('#edit-volume-group-container', modalEl);
  const vcContainer = $('#edit-value-conversions-container', modalEl);
  const addGroupBtn = $('#edit-add-group-level', modalEl);
  if (vgContainer) vgContainer.parentElement.style.display = 'none';
  if (vcContainer) vcContainer.parentElement.style.display = 'none';
  if (addGroupBtn) addGroupBtn.style.display = 'none';
}

function submit() {
  const newTitle = $('#rename-case-title', modalEl).value.trim();
  const description = $('#edit-case-description', modalEl).value.trim();

  if (!newTitle) return;

  // Handle rename
  if (newTitle !== editingCase) {
    if (!storageRenameCase(editingField, editingScenario, editingCase, newTitle)) {
      alert(`Case "${newTitle}" already exists.`);
      return;
    }
    editingCase = newTitle;
  }

  // Update only metadata (name, description)
  const caseData = getCaseData(editingField, editingCase, editingScenario);
  if (!caseData) return;

  caseData.description = description;
  // Author stays as-is from import

  saveCase(editingField, editingScenario, editingCase, caseData);
  saveAppState();
  hide();

  emit(EVENTS.CASE_UPDATED, { field: editingField, scenario: editingScenario, caseName: editingCase });
}

export function setupEvents() {
  if (!modalEl) return;

  const cancelBtn = $('#cancel-rename-case', modalEl);
  if (cancelBtn) cancelBtn.addEventListener('click', hide);

  const confirmBtn = $('#confirm-rename-case', modalEl);
  if (confirmBtn) confirmBtn.addEventListener('click', submit);
}
