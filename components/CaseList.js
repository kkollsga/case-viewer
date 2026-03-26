// components/CaseList.js — Sidebar case list with drag-to-reorder

import {
  getActiveField, getActiveCase, setActiveCase, getRuntime, setAvailableCases,
} from '../core/state.js';
import {
  getCasesForField, getOrderedCaseNames, saveCaseOrder,
  deleteCase as storageDeleteCase, saveAppState,
} from '../core/storage.js';
import { on, emit, EVENTS } from '../core/events.js';
import { formatDateShort } from '../utils/format.js';
import { el, clear, $ } from '../utils/dom.js';
import * as CaseImport from './CaseImport.js';
import * as CaseEditor from './CaseEditor.js';

let listEl = null;
let sortableInstance = null;

export function init() {
  listEl = document.getElementById('case-list');
}

/**
 * Render the case list for the current field.
 */
export function render() {
  const field = getActiveField();
  clear(listEl);

  if (!field) {
    listEl.innerHTML = '<div class="p-2 text-gray-500 text-sm">No field selected</div>';
    return;
  }

  const caseNames = getOrderedCaseNames(field);
  setAvailableCases(caseNames);

  const casesData = getCasesForField(field);

  if (caseNames.length === 0) {
    listEl.innerHTML = '<div class="p-2 text-gray-500 text-sm">No cases available</div>';
    return;
  }

  const activeCase = getActiveCase();

  for (const caseName of caseNames) {
    const data = casesData[caseName] || {};
    const isActive = caseName === activeCase;

    const item = el('div', {
      class: `case-item${isActive ? ' active' : ''}`,
    });

    // Content
    const content = el('div', { class: 'flex flex-col' });
    const nameSpan = el('span', {
      class: 'case-name truncate text-sm font-medium text-gray-700',
      textContent: caseName,
    });
    if (isActive) {
      nameSpan.style.color = '#0072CE';
      nameSpan.style.fontWeight = '600';
    }
    content.appendChild(nameSpan);

    if (data.timestamp) {
      content.appendChild(el('span', {
        class: 'text-xs text-gray-400 mt-0.5',
        textContent: formatDateShort(data.timestamp),
      }));
    }
    item.appendChild(content);

    // Action buttons (visible on hover via CSS)
    const actions = el('div', { class: 'action-buttons' });

    // Edit button
    actions.appendChild(el('button', {
      class: 'text-blue-600 hover:text-blue-800 p-1',
      title: 'Edit Case',
      innerHTML: '<i class="fas fa-pen"></i>',
      onClick: (e) => {
        e.stopPropagation();
        CaseEditor.show(field, caseName);
      },
    }));

    // Delete button
    actions.appendChild(el('button', {
      class: 'text-red-600 hover:text-red-800 p-1',
      title: 'Delete Case',
      innerHTML: '<i class="fas fa-trash"></i>',
      onClick: (e) => {
        e.stopPropagation();
        showDeleteConfirmation(item, field, caseName);
      },
    }));

    item.appendChild(actions);

    // Click to select
    item.addEventListener('click', (e) => {
      if (e.target.closest('.action-buttons') || e.target.closest('.delete-confirmation')) return;
      setActiveCase(caseName);
      saveAppState();
      render();
      emit(EVENTS.CASE_SELECTED, { caseName });
    });

    listEl.appendChild(item);
  }

  initSortable();
  updateNavigationButtons();
}

function showDeleteConfirmation(item, field, caseName) {
  // Remove any existing confirmations
  for (const existing of document.querySelectorAll('.delete-confirmation')) {
    existing.remove();
  }

  const confirmBar = el('div', {
    class: 'delete-confirmation mt-1 px-3 py-2 bg-red-50 text-sm text-red-700 rounded-md flex items-center justify-between gap-3 animate-slide-down',
  });
  confirmBar.innerHTML = `
    <span>Delete this case?</span>
    <div class="flex items-center gap-2">
      <button class="confirm-delete text-green-600 hover:text-green-800" title="Confirm"><i class="fas fa-check"></i></button>
      <button class="cancel-delete text-gray-500 hover:text-gray-700" title="Cancel"><i class="fas fa-times"></i></button>
    </div>
  `;

  confirmBar.querySelector('.confirm-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    performDelete(field, caseName);
    confirmBar.remove();
  });

  confirmBar.querySelector('.cancel-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    confirmBar.remove();
  });

  item.insertAdjacentElement('afterend', confirmBar);
}

function performDelete(field, caseName) {
  storageDeleteCase(field, caseName);

  const runtime = getRuntime();
  const activeCase = getActiveCase();

  if (activeCase === caseName) {
    const cases = getOrderedCaseNames(field);
    if (cases.length > 0) {
      setActiveCase(cases[0]);
    } else {
      setActiveCase(null);
    }
    saveAppState();
  }

  emit(EVENTS.CASE_DELETED, { field, caseName });
  render();
}

function initSortable() {
  if (sortableInstance) sortableInstance.destroy();
  if (!listEl || listEl.children.length === 0) return;

  sortableInstance = Sortable.create(listEl, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: (evt) => {
      const field = getActiveField();
      if (!field) return;
      const items = Array.from(evt.to.children)
        .map(item => item.querySelector('.case-name')?.textContent)
        .filter(Boolean);
      saveCaseOrder(field, items);
      setAvailableCases(items);
      updateNavigationButtons();
    },
  });
}

// ─── Navigation ─────────────────────────────────────────────

export function navigateCase(direction) {
  const runtime = getRuntime();
  const cases = runtime.availableCases;
  if (!cases || cases.length === 0) return;

  const currentIdx = cases.indexOf(getActiveCase());
  let newIdx;

  if (direction === 'prev') {
    newIdx = currentIdx - 1;
    if (newIdx < 0) return;
  } else {
    newIdx = currentIdx + 1;
    if (newIdx >= cases.length) return;
  }

  setActiveCase(cases[newIdx]);
  saveAppState();
  render();
  emit(EVENTS.CASE_SELECTED, { caseName: cases[newIdx] });
}

function updateNavigationButtons() {
  const prevBtn = document.getElementById('prev-case-btn');
  const nextBtn = document.getElementById('next-case-btn');
  if (!prevBtn || !nextBtn) return;

  const runtime = getRuntime();
  const cases = runtime.availableCases;
  const active = getActiveCase();

  if (!cases || cases.length <= 1 || !active) {
    prevBtn.classList.add('btn-disabled');
    nextBtn.classList.add('btn-disabled');
    return;
  }

  const idx = cases.indexOf(active);
  prevBtn.classList.toggle('btn-disabled', idx <= 0);
  nextBtn.classList.toggle('btn-disabled', idx >= cases.length - 1);
}

// ─── Event subscriptions ────────────────────────────────────

export function setupEvents() {
  // Add case button
  document.getElementById('add-case-btn').addEventListener('click', () => {
    CaseImport.show();
  });

  // Navigation buttons
  document.getElementById('prev-case-btn').addEventListener('click', () => navigateCase('prev'));
  document.getElementById('next-case-btn').addEventListener('click', () => navigateCase('next'));

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigateCase('prev'); }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigateCase('next'); }
  });

  // Re-render on relevant events
  on(EVENTS.FIELD_CHANGED, () => render());
  on(EVENTS.CASE_CREATED, () => render());
  on(EVENTS.CASE_UPDATED, () => render());
  on(EVENTS.CASE_DELETED, () => render());
}
