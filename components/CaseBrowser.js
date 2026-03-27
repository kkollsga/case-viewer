// components/CaseBrowser.js — Opening screen case selection component
// Apple-like: clean, minimal, progressive disclosure.
// Inline import flow with paste area + QC checks (no modal).

import {
  getActiveField, getActiveScenario, getActiveCase, getSelectedCases, getScenariosForField,
  setActiveField, setActiveScenario, setActiveCase, setSelectedCases,
  toggleCaseSelection, openBrowser, addScenario, addField, getFields, getState,
  renameField, deleteField, renameScenario, deleteScenario, store,
} from '../core/state.js';
import {
  getCasesForScenario, getOrderedCaseNames, saveAppState,
  hasLegacyData, clearLegacyData,
  saveCase, addCaseToOrder, loadDefaultAuthor, saveDefaultAuthor,
  applyGroupMappings,
  deleteFieldData, renameFieldData, deleteScenarioData, renameScenarioData,
} from '../core/storage.js';
import { parseOutputSheet, FORMAT } from '../core/parser.js';
import * as FieldSettings from './FieldSettings.js';
// events.js removed — using store.dispatch for signals
import { formatNumber, formatDateShort, formatDateTime } from '../utils/format.js';
import { PALETTES } from '../utils/color.js';
import { el, clear, createToggle, $ } from '../utils/dom.js';

let containerEl = null;
let lastClickTime = {};

// ─── Import section state (module-level) ─────────────────────
let importVisible = false;
let parseResult = null;
let importDivideBy1000 = true;
let importRawText = '';
// Standard table: single case metadata
let importCaseName = '';
let importCaseDescription = '';
let importTimestamp = null;
// Single-row: per-case metadata
let importCases = []; // [{ checked, originalName, name, description, row }]
// Removed group columns (by index)
let importRemovedGroups = new Set();
// Debounce timer
let pasteDebounceTimer = null;

// ─── Public API ──────────────────────────────────────────────

export function init() {
  containerEl = document.getElementById('case-browser');
}

export function render() {
  if (!containerEl) return;
  clear(containerEl);

  const field = getActiveField();
  const scenario = getActiveScenario();
  const activeCase = getActiveCase();
  const selected = getSelectedCases();

  // ── Always render full browser (section toggle handles collapse) ──
  const root = el('div', {});

  const inner = el('div', {});

  // Legacy data banner
  if (hasLegacyData()) {
    inner.appendChild(renderLegacyBanner());
  }

  // Field + Scenario selectors (replaces H1 title)
  inner.appendChild(renderSelectors(field, scenario));

  // Field settings panel
  if (field) {
    const settingsPanel = el('div', { class: 'mt-3', id: 'field-settings-panel' });
    inner.appendChild(settingsPanel);
    if (FieldSettings.isVisible()) {
      FieldSettings.toggle(settingsPanel);
    }
  }

  // Main content area
  if (!field && getFields().length === 0) {
    inner.appendChild(renderEmptyStateWithInput(
      'Create your first field',
      'A field represents a geographical area or project (e.g. a licence or prospect).',
      (name) => {
        addField(name);
        saveAppState();
        render();
      },
    ));
  } else if (!scenario) {
    const scenarios = getScenariosForField(field);
    if (scenarios.length === 0) {
      inner.appendChild(renderEmptyStateWithInput(
        'Create a scenario',
        'A scenario organises related case revisions together.',
        (name) => {
          addScenario(field, name);
          setActiveScenario(name);
          saveAppState();
          render();
        },
      ));
    } else {
      inner.appendChild(renderEmptyState(
        'Select a scenario',
        'Choose a scenario above to see its cases.',
      ));
    }
  } else {
    // Case cards
    const caseNames = getOrderedCaseNames(field, scenario);
    const casesData = getCasesForScenario(field, scenario);

    if (caseNames.length === 0 && !importVisible) {
      // No cases — show a welcoming empty state with import button
      const emptyDiv = el('div', { class: 'flex flex-col items-center justify-center py-20 text-center' });
      emptyDiv.appendChild(el('div', { class: 'text-lg font-medium text-gray-400 mb-2', textContent: 'No cases yet' }));
      emptyDiv.appendChild(el('div', { class: 'text-sm text-gray-400 mb-6', textContent: 'Import volumetric data from Petrel to create your first case.' }));
      emptyDiv.appendChild(el('button', {
        class: 'inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition-colors shadow-sm',
        onClick: () => { importVisible = true; render(); },
      }, [
        el('i', { class: 'fas fa-plus text-xs' }),
        el('span', { textContent: 'Import Case' }),
      ]));
      inner.appendChild(emptyDiv);
    } else if (importVisible) {
      // Import mode — show paste area and QC
      if (caseNames.length > 0) {
        inner.appendChild(el('div', { class: 'mt-8' }));
        inner.appendChild(renderCaseGrid(caseNames, casesData, selected));
      }
      inner.appendChild(el('div', { class: 'mt-8' }));
      inner.appendChild(renderImportSection(field, scenario));
    } else {
      // Normal mode — case cards + import button at bottom
      inner.appendChild(el('div', { class: 'mt-8' }));
      inner.appendChild(renderCaseGrid(caseNames, casesData, selected));
    }
  }

  // Bottom action bar or import button
  if (field && scenario && selected.length > 0) {
    root.appendChild(inner);
    root.appendChild(renderActionBar(selected, field, scenario));
  } else {
    // Import button (visible when we have a scenario, cases exist, and import is collapsed)
    if (field && scenario && !importVisible) {
      const caseNames = getOrderedCaseNames(field, scenario);
      if (caseNames.length > 0) {
        const importRow = el('div', {
          class: 'mt-10 flex justify-end',
        });
        importRow.appendChild(el('button', {
          class: 'inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition-colors shadow-sm',
          onClick: () => {
            importVisible = true;
            render();
          },
        }, [
          el('span', { textContent: '+' }),
          el('span', { textContent: 'Import' }),
        ]));
        inner.appendChild(importRow);
      }
    }
    root.appendChild(inner);
  }

  containerEl.appendChild(root);
}

/**
 * Refresh just the case card grid (called by FieldSettings after mapping changes).
 * Avoids full re-render which would reset the settings panel.
 */
export function renderCaseCardsOnly() {
  const grid = containerEl?.querySelector('.gs-case-grid');
  if (!grid) return;

  const field = getActiveField();
  const scenario = getActiveScenario();
  if (!field || !scenario) return;

  const caseNames = getOrderedCaseNames(field, scenario);
  const casesData = getCasesForScenario(field, scenario);
  const selected = getSelectedCases();

  const newGrid = renderCaseGrid(caseNames, casesData, selected);
  grid.replaceWith(newGrid);
}

export function setupEvents() {
  // Single subscription replaces 9 separate event listeners
  store.subscribe(
    s => [s.activeField, s.activeScenario, s.activeCase, s.selectedCases, s.fields, s.scenarios],
    () => render()
  );
}

// ─── Minimized Bar (case active) ─────────────────────────────

function renderMinimizedBar(field, scenario, activeCase) {
  const bar = el('div', {
    class: 'flex items-center gap-3',
  });

  // Field → Scenario (clickable to go back to browser)
  const breadcrumb = el('div', {
    class: 'flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer hover:text-indigo-500 transition-colors',
    onClick: () => openBrowser(),
  });
  breadcrumb.appendChild(el('span', { textContent: field }));
  breadcrumb.appendChild(el('span', { textContent: '›', class: 'text-gray-300 mx-0.5' }));
  breadcrumb.appendChild(el('span', { textContent: scenario }));
  bar.appendChild(breadcrumb);

  // Separator
  bar.appendChild(el('span', { class: 'text-gray-200 text-sm', textContent: '|' }));

  // Prev button
  bar.appendChild(el('button', {
    class: 'w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-all',
    innerHTML: '<i class="fas fa-chevron-left text-[10px]"></i>',
    onClick: () => navigateCase('prev'),
  }));

  // Active case name
  bar.appendChild(el('span', {
    class: 'text-sm font-semibold text-gray-800',
    textContent: activeCase,
  }));

  // Next button
  bar.appendChild(el('button', {
    class: 'w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-all',
    innerHTML: '<i class="fas fa-chevron-right text-[10px]"></i>',
    onClick: () => navigateCase('next'),
  }));

  return bar;
}

function navigateCase(direction) {
  const field = getActiveField();
  const scenario = getActiveScenario();
  if (!field || !scenario) return;
  const names = getOrderedCaseNames(field, scenario);
  const activeCase = getActiveCase();
  const idx = names.indexOf(activeCase);
  const newIdx = direction === 'prev' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= names.length) return;
  setActiveCase(names[newIdx]);
  saveAppState();
  render();
}

// ─── Legacy Banner ───────────────────────────────────────────

function renderLegacyBanner() {
  const banner = el('div', {
    class: 'mb-6 px-4 py-3 bg-amber-50 text-amber-800 text-sm rounded-xl flex items-center justify-between',
  });

  banner.appendChild(el('span', {
    textContent: 'Old data detected from a previous version.',
  }));

  const clearBtn = el('button', {
    class: 'ml-4 text-amber-700 underline hover:text-amber-900 text-sm font-medium',
    textContent: 'Clear old data',
    onClick: () => {
      clearLegacyData();
      banner.remove();
    },
  });
  banner.appendChild(clearBtn);

  return banner;
}

// ─── Field Tabs ──────────────────────────────────────────────

// ─── Field + Scenario Dropdowns (single row) ────────────────

function renderSelectors(activeField, activeScenario) {
  const row = el('div', { class: 'flex items-center gap-2 text-sm' });

  // Field dropdown
  row.appendChild(renderDropdown({
    value: activeField,
    items: getFields(),
    placeholder: 'Select field',
    onSelect: (name) => { FieldSettings.hide(); setActiveField(name); saveAppState(); },
    onAdd: (name) => { addField(name); saveAppState(); render(); },
    addLabel: '+ New field',
    onSettings: activeField ? () => {
      const panel = document.getElementById('field-settings-panel');
      if (panel) FieldSettings.toggle(panel);
    } : null,
  }));

  row.appendChild(el('span', { class: 'text-gray-300 text-xs', textContent: '›' }));

  // Scenario dropdown
  if (activeField) {
    row.appendChild(renderDropdown({
      value: activeScenario,
      items: getScenariosForField(activeField),
      placeholder: 'Select scenario',
      onSelect: (name) => { setActiveScenario(name); saveAppState(); },
      onAdd: (name) => { addScenario(activeField, name); setActiveScenario(name); saveAppState(); render(); },
      addLabel: '+ New scenario',
    }));
  }

  return row;
}

function renderDropdown({ value, items, placeholder, onSelect, onAdd, addLabel, onSettings }) {
  const wrapper = el('div', { class: 'relative' });

  const trigger = el('button', {
    class: 'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors ' +
           (value ? 'text-gray-800' : 'text-gray-400'),
    textContent: value || placeholder,
  });

  if (value) {
    trigger.appendChild(el('i', { class: 'fas fa-chevron-down text-[8px] text-gray-400 ml-1' }));
  }

  const menu = el('div', {
    class: 'absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[180px] py-1 hidden',
  });

  // Items
  for (const item of items) {
    const isActive = item === value;
    menu.appendChild(el('button', {
      class: `w-full text-left px-3 py-1.5 text-sm transition-colors ${isActive ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`,
      textContent: item,
      onClick: () => { menu.classList.add('hidden'); onSelect(item); },
    }));
  }

  // Settings button (for field)
  if (onSettings) {
    menu.appendChild(el('div', { class: 'border-t border-gray-100 my-1' }));
    menu.appendChild(el('button', {
      class: 'w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-indigo-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5',
      innerHTML: '<i class="fas fa-cog text-[10px]"></i> Group settings',
      onClick: () => { menu.classList.add('hidden'); onSettings(); },
    }));
  }

  // Add new
  if (onAdd) {
    menu.appendChild(el('div', { class: 'border-t border-gray-100 my-1' }));

    const addRow = el('div', { class: 'px-2 py-1' });
    const addBtn = el('button', {
      class: 'w-full text-left px-2 py-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors',
      textContent: addLabel,
    });

    const addInput = el('input', {
      type: 'text',
      class: 'w-full px-2 py-1 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-indigo-400 focus:outline-none hidden',
      placeholder: 'Name...',
    });

    addBtn.addEventListener('click', () => {
      addBtn.classList.add('hidden');
      addInput.classList.remove('hidden');
      addInput.focus();
    });

    const submitAdd = () => {
      const name = addInput.value.trim();
      if (name) { menu.classList.add('hidden'); onAdd(name); }
      addInput.classList.add('hidden');
      addBtn.classList.remove('hidden');
      addInput.value = '';
    };

    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitAdd();
      if (e.key === 'Escape') { addInput.classList.add('hidden'); addBtn.classList.remove('hidden'); addInput.value = ''; }
    });
    addInput.addEventListener('blur', () => {
      setTimeout(() => { addInput.classList.add('hidden'); addBtn.classList.remove('hidden'); addInput.value = ''; }, 150);
    });

    addRow.append(addBtn, addInput);
    menu.appendChild(addRow);
  }

  // Toggle menu
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });

  // Close on outside click
  document.addEventListener('click', () => menu.classList.add('hidden'));

  wrapper.append(trigger, menu);
  return wrapper;
}

// ─── Old functions kept for compatibility ────────────────────
function renderFieldTabs(activeField) {
  const row = el('div', { class: 'flex items-center gap-2 flex-wrap' });

  for (const field of getFields()) {
    const isActive = field === activeField;
    row.appendChild(renderEditablePill({
      name: field,
      isActive,
      size: 'lg',
      onSelect: () => {
        if (isActive) {
          // Clicking active field toggles settings panel
          const panel = document.getElementById('field-settings-panel');
          if (panel) FieldSettings.toggle(panel);
        } else {
          FieldSettings.hide();
          setActiveField(field);
          saveAppState();
        }
      },
      onRename: (newName) => {
        if (renameField(field, newName)) {
          renameFieldData(field, newName);
          saveAppState();
          render();
        }
      },
      onDelete: () => {
        deleteFieldData(field);
        deleteField(field);
        saveAppState();
        render();
      },
      deleteWarning: () => {
        const scenarios = getScenariosForField(field);
        let caseCount = 0;
        for (const sc of scenarios) {
          caseCount += getOrderedCaseNames(field, sc).length;
        }
        return caseCount > 0
          ? `Delete "${field}"? ${caseCount} case${caseCount !== 1 ? 's' : ''} across ${scenarios.length} scenario${scenarios.length !== 1 ? 's' : ''} will be lost.`
          : `Delete "${field}"?`;
      },
    }));
  }

  row.appendChild(renderInlineAddButton('Field', (name) => {
    addField(name);
    saveAppState();
    render();
  }));

  return row;
}

// ─── Scenario Pills ─────────────────────────────────────────

function renderScenarioPills(field, activeScenario) {
  const row = el('div', { class: 'flex items-center gap-2 flex-wrap' });
  const scenarios = getScenariosForField(field);

  for (const sc of scenarios) {
    const isActive = sc === activeScenario;
    row.appendChild(renderEditablePill({
      name: sc,
      isActive,
      size: 'sm',
      onSelect: () => { setActiveScenario(sc); saveAppState(); },
      onRename: (newName) => {
        if (renameScenario(field, sc, newName)) {
          renameScenarioData(field, sc, newName);
          saveAppState();
          render();
        }
      },
      onDelete: () => {
        deleteScenarioData(field, sc);
        deleteScenario(field, sc);
        saveAppState();
        render();
      },
      deleteWarning: () => {
        const caseCount = getOrderedCaseNames(field, sc).length;
        return caseCount > 0
          ? `Delete "${sc}"? ${caseCount} case${caseCount !== 1 ? 's' : ''} will be lost.`
          : `Delete "${sc}"?`;
      },
    }));
  }

  row.appendChild(renderInlineAddButton('Scenario', (name) => {
    addScenario(field, name);
    setActiveScenario(name);
    saveAppState();
    render();
  }));

  return row;
}

// ─── Editable Pill (shared by field tabs and scenario pills) ──

function renderEditablePill({ name, isActive, size, onSelect, onRename, onDelete, deleteWarning }) {
  const isLg = size === 'lg';
  const basePill = isLg ? 'px-5 py-2 text-sm' : 'px-4 py-1.5 text-xs';
  const activeClass = isLg
    ? `${basePill} font-medium rounded-full bg-indigo-600 text-white transition-all shadow-sm`
    : `${basePill} font-medium rounded-full bg-indigo-500 text-white transition-all`;
  const inactiveClass = isLg
    ? `${basePill} font-medium rounded-full border border-gray-300 text-gray-600 hover:border-indigo-400 hover:text-indigo-600 transition-all`
    : `${basePill} font-medium rounded-full border border-gray-300 text-gray-500 hover:border-indigo-300 hover:text-indigo-500 transition-all`;

  const wrapper = el('div', { class: 'relative inline-flex items-center group' });

  // Normal state: pill + hover actions
  const normalState = el('div', { class: 'inline-flex items-center' });

  const pill = el('button', {
    class: isActive ? activeClass : inactiveClass,
    textContent: name,
    onClick: onSelect,
  });
  normalState.appendChild(pill);

  // Hover actions (only on active pill)
  if (isActive) {
    const actions = el('div', {
      class: 'hidden group-hover:flex items-center gap-0.5 ml-1',
    });

    const editBtn = el('button', {
      class: 'w-6 h-6 flex items-center justify-center rounded-full text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all',
      innerHTML: '<i class="fas fa-pen text-[10px]"></i>',
      title: `Rename`,
      onClick: (e) => {
        e.stopPropagation();
        normalState.style.display = 'none';
        editState.style.display = 'flex';
        editInput.value = name;
        requestAnimationFrame(() => { editInput.focus(); editInput.select(); });
      },
    });

    const deleteBtn = el('button', {
      class: 'w-6 h-6 flex items-center justify-center rounded-full text-red-300 hover:text-red-500 hover:bg-red-50 transition-all',
      innerHTML: '<i class="fas fa-trash text-[10px]"></i>',
      title: `Delete`,
      onClick: (e) => {
        e.stopPropagation();
        normalState.style.display = 'none';
        confirmState.style.display = 'block';
        const msg = deleteWarning();
        confirmMsg.textContent = msg;
      },
    });

    actions.append(editBtn, deleteBtn);
    normalState.appendChild(actions);
  }

  // Edit state: inline input + ok/cancel
  const editState = el('div', { class: 'items-center gap-1', style: { display: 'none' } });

  const editInput = el('input', {
    type: 'text',
    class: isLg
      ? 'px-4 py-1.5 text-sm font-medium rounded-full bg-transparent border-0 focus:outline-none focus:ring-2 focus:ring-indigo-300 w-40 text-indigo-700'
      : 'px-3 py-1 text-xs font-medium rounded-full bg-transparent border-0 focus:outline-none focus:ring-2 focus:ring-indigo-300 w-32 text-indigo-600',
  });

  const confirmEdit = el('button', {
    class: 'w-6 h-6 flex items-center justify-center rounded-full bg-green-500 text-white text-xs hover:bg-green-600 transition-colors',
    innerHTML: '<i class="fas fa-check text-[10px]"></i>',
    onClick: (e) => {
      e.stopPropagation();
      const newName = editInput.value.trim();
      if (newName && newName !== name) onRename(newName);
      else { editState.style.display = 'none'; normalState.style.display = 'inline-flex'; }
    },
  });

  const cancelEdit = el('button', {
    class: 'w-6 h-6 flex items-center justify-center rounded-full text-red-400 hover:text-red-600 text-xs transition-colors',
    innerHTML: '<i class="fas fa-times text-[10px]"></i>',
    onClick: (e) => {
      e.stopPropagation();
      editState.style.display = 'none';
      normalState.style.display = 'inline-flex';
    },
  });

  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmEdit.click();
    if (e.key === 'Escape') cancelEdit.click();
  });

  editState.append(editInput, confirmEdit, cancelEdit);

  // Delete confirmation state
  const confirmState = el('div', { class: 'absolute left-0 top-full mt-1 z-20', style: { display: 'none' } });
  const confirmCard = el('div', {
    class: 'bg-white border border-red-200 rounded-xl shadow-lg px-4 py-3 text-sm whitespace-nowrap animate-slide-down',
  });
  const confirmMsg = el('div', { class: 'text-red-700 mb-2' });
  const confirmActions = el('div', { class: 'flex items-center gap-2 justify-end' });

  confirmActions.appendChild(el('button', {
    class: 'px-3 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors',
    textContent: 'Cancel',
    onClick: (e) => {
      e.stopPropagation();
      confirmState.style.display = 'none';
      normalState.style.display = 'inline-flex';
    },
  }));

  confirmActions.appendChild(el('button', {
    class: 'px-3 py-1 text-xs font-medium text-white bg-red-500 rounded-full hover:bg-red-600 transition-colors',
    textContent: 'Delete',
    onClick: (e) => {
      e.stopPropagation();
      onDelete();
    },
  }));

  confirmCard.append(confirmMsg, confirmActions);
  confirmState.appendChild(confirmCard);

  wrapper.append(normalState, editState, confirmState);
  return wrapper;
}

// ─── Inline Add Button ──────────────────────────────────────

function renderInlineAddButton(label, onSubmit) {
  const wrapper = el('div', {
    class: 'inline-flex items-center',
  });

  const plusBtn = el('button', {
    class: 'w-8 h-8 flex items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-all text-sm',
    textContent: '+',
    title: `Add ${label}`,
  });

  const inputContainer = el('div', {
    class: 'items-center gap-1',
  });
  inputContainer.style.display = 'none';

  const input = el('input', {
    type: 'text',
    class: 'px-3 py-1.5 text-sm border border-gray-300 rounded-full focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 w-36',
    placeholder: `${label} name`,
  });

  const confirmBtn = el('button', {
    class: 'w-7 h-7 flex items-center justify-center rounded-full bg-indigo-500 text-white text-xs hover:bg-indigo-600 transition-colors',
    textContent: '\u2713',
  });

  const cancelBtn = el('button', {
    class: 'w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 text-xs transition-colors',
    textContent: '\u2715',
  });

  function showInput() {
    plusBtn.style.display = 'none';
    inputContainer.style.display = 'flex';
    input.value = '';
    requestAnimationFrame(() => input.focus());
  }

  function hideInput() {
    plusBtn.style.display = '';
    inputContainer.style.display = 'none';
  }

  function submit() {
    const name = input.value.trim();
    if (name) {
      onSubmit(name);
    }
    hideInput();
  }

  plusBtn.addEventListener('click', showInput);
  cancelBtn.addEventListener('click', hideInput);
  confirmBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') hideInput();
  });

  inputContainer.append(input, confirmBtn, cancelBtn);
  wrapper.append(plusBtn, inputContainer);

  return wrapper;
}

// ─── Inline Import Section ───────────────────────────────────

function resetImportState() {
  importVisible = false;
  parseResult = null;
  importDivideBy1000 = true;
  importRawText = '';
  importCaseName = '';
  importCaseDescription = '';
  importTimestamp = null;
  importCases = [];
  importRemovedGroups = new Set();
  if (pasteDebounceTimer) clearTimeout(pasteDebounceTimer);
  pasteDebounceTimer = null;
}

function runParser() {
  if (!importRawText.trim()) {
    parseResult = null;
    return;
  }
  parseResult = parseOutputSheet(importRawText, { divideBy1000: importDivideBy1000 });

  if (parseResult.error && !parseResult.qc) {
    // Fatal parse error — keep parseResult for display but nothing else
    return;
  }

  // Populate case metadata from QC
  const qc = parseResult.qc;
  const meta = qc?.petrelMeta || {};

  if (parseResult.format === FORMAT.SINGLE_LINE_TOTALS && parseResult.cases) {
    // Multi-case
    importCases = parseResult.cases.map((c) => ({
      checked: true,
      originalName: c.originalName,
      name: c.suggestedName || c.originalName,
      description: c.description || '',
      row: c.row,
    }));
  } else {
    // Standard table — single case
    importCaseName = generateCaseName(meta);
    importCaseDescription = '';
    importTimestamp = parseTimestamp(meta.exportDate);
  }

  importRemovedGroups = new Set();
}

function generateCaseName(meta) {
  if (meta.case) return meta.case;
  if (meta.exportDate) {
    const d = new Date(meta.exportDate);
    if (!isNaN(d.getTime())) {
      return 'Case ' + formatDateCompact(d);
    }
    return 'Case ' + meta.exportDate;
  }
  return 'Case ' + formatDateCompact(new Date());
}

function parseTimestamp(exportDate) {
  if (!exportDate) return Date.now();
  const d = new Date(exportDate);
  return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

function formatDateCompact(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTimestampDisplay(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

function renderImportSection(field, scenario) {
  const section = el('div', {
    class: 'bg-white rounded-2xl border border-gray-200 p-6 space-y-5',
  });

  // ── 1. Paste area ──
  const textarea = el('textarea', {
    class: 'w-full px-4 py-3 text-sm font-mono bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl focus:outline-none focus:border-indigo-400 focus:bg-white transition-colors resize-none',
    placeholder: 'Paste volumetric data from Petrel...',
    rows: '4',
  });
  textarea.value = importRawText;

  textarea.addEventListener('input', (e) => {
    importRawText = e.target.value;
    if (pasteDebounceTimer) clearTimeout(pasteDebounceTimer);
    pasteDebounceTimer = setTimeout(() => {
      runParser();
      render();
    }, 300);
  });

  section.appendChild(textarea);

  // ── 2. Validation ──
  const validation = validateParseResult();

  if (validation.error) {
    // Hard error — can't proceed
    section.appendChild(el('div', {
      class: 'flex items-center gap-2 px-4 py-3 bg-red-50 text-red-600 text-sm rounded-lg',
    }, [
      el('i', { class: 'fas fa-exclamation-circle flex-shrink-0' }),
      el('span', { textContent: validation.error }),
    ]));
  } else if (validation.warning) {
    // Warning — can still proceed
    section.appendChild(el('div', {
      class: 'flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-600 text-xs rounded-lg',
    }, [
      el('i', { class: 'fas fa-exclamation-triangle flex-shrink-0' }),
      el('span', { textContent: validation.warning }),
    ]));
  }

  // ── 3. QC Checks (only if parse produced usable data) ──
  if (parseResult && parseResult.qc && validation.ok) {
    const qc = parseResult.qc;

    section.appendChild(renderQCChecks(qc));

    // ── 4. Divide by 1000 toggle ──
    section.appendChild(renderDivideToggle());

    // ── 5. Volume Groups as pills ──
    if (qc.groupColumns && qc.groupColumns.length > 0) {
      section.appendChild(renderGroupPills(qc.groupColumns));
    }

    // ── 6. Case metadata ──
    if (parseResult.format === FORMAT.SINGLE_LINE_TOTALS && importCases.length > 0) {
      section.appendChild(renderMultiCaseMetadata());
    } else {
      section.appendChild(renderSingleCaseMetadata());
    }

    // ── 7. Parse errors (non-fatal) ──
    if (qc.errors && qc.errors.length > 0) {
      const errBox = el('div', {
        class: 'px-4 py-3 bg-amber-50 text-amber-700 text-xs rounded-lg space-y-1',
      });
      errBox.appendChild(el('div', {
        class: 'font-medium',
        textContent: `${qc.errors.length} parse warning${qc.errors.length !== 1 ? 's' : ''}`,
      }));
      for (const err of qc.errors.slice(0, 5)) {
        errBox.appendChild(el('div', { textContent: err }));
      }
      if (qc.errors.length > 5) {
        errBox.appendChild(el('div', {
          class: 'text-amber-500',
          textContent: `... and ${qc.errors.length - 5} more`,
        }));
      }
      section.appendChild(errBox);
    }

    // ── 8. Action buttons ──
    section.appendChild(renderImportActions(field, scenario));
  } else if (parseResult === null && importRawText.trim() === '') {
    // No data yet — just show the paste area, nothing else
  }

  return section;
}

// ─── QC Checks Grid ──────────────────────────────────────────

// ─── Validation ─────────────────────────────────────────────

function validateParseResult() {
  // Nothing pasted yet
  if (!importRawText || !importRawText.trim()) {
    return { ok: false, error: null, warning: null };
  }

  // Parser returned an error
  if (parseResult && parseResult.error && !parseResult.qc) {
    return { ok: false, error: parseResult.error };
  }

  // No parse result at all (shouldn't happen but guard)
  if (!parseResult) {
    return { ok: false, error: 'Unable to parse the pasted data.' };
  }

  // Parse produced QC but no data rows
  if (!parseResult.data || parseResult.data.length === 0) {
    return { ok: false, error: 'No data rows found. Check that you pasted the full table including headers.' };
  }

  // No volume columns detected
  const qc = parseResult.qc;
  if (!qc || !qc.volumeColumns || qc.volumeColumns.length === 0) {
    return { ok: false, error: 'No volume columns detected (expected Bulk volume, STOIIP, GIIP, etc.). This doesn\u2019t look like a Petrel Output Sheet.' };
  }

  // Has data but no key volumes (STOIIP/GIIP/Bulk volume) — probably wrong data
  const keyVols = ['STOIIP', 'GIIP', 'Bulk volume', 'STOIIP (in oil)', 'GIIP (in gas)'];
  const hasKeyVol = qc.volumeColumns.some(v => keyVols.includes(v.name));
  if (!hasKeyVol) {
    return { ok: true, warning: 'No standard volume columns found (STOIIP, GIIP, Bulk volume). The data may not be a volumetric export.' };
  }

  // Parse warnings/errors from individual rows
  if (parseResult.errors && parseResult.errors.length > 0) {
    return { ok: true, warning: `${parseResult.errors.length} row(s) skipped due to column count mismatch.` };
  }

  return { ok: true, error: null, warning: null };
}

function renderQCChecks(qc) {
  const wrapper = el('div', { class: 'space-y-4' });

  // ── Top: Format + metadata in a subtle card ──
  const infoCard = el('div', {
    class: 'bg-gray-50 rounded-xl px-4 py-3 space-y-1',
  });

  const meta = qc.petrelMeta || {};

  // Format badge
  const formatRow = el('div', { class: 'flex items-center gap-2' });
  formatRow.appendChild(el('span', {
    class: 'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700',
    textContent: qc.formatLabel || qc.format,
  }));
  formatRow.appendChild(el('span', {
    class: 'text-xs text-gray-400',
    textContent: `${qc.rowCount} rows \u00b7 ${qc.columnCount} columns`,
  }));
  if (qc.caseCount > 1) {
    formatRow.appendChild(el('span', {
      class: 'text-xs text-indigo-500 font-medium',
      textContent: `${qc.caseCount} cases detected`,
    }));
  }
  infoCard.appendChild(formatRow);

  // Metadata line (project, grid, model, date — only if detected)
  const metaParts = [];
  if (meta.project) metaParts.push(meta.project);
  if (meta.model) metaParts.push(meta.model);
  if (meta.grid) metaParts.push(meta.grid);
  if (meta.exportDate) metaParts.push(meta.exportDate);
  if (metaParts.length > 0) {
    infoCard.appendChild(el('div', {
      class: 'text-xs text-gray-400',
      textContent: metaParts.join(' \u00b7 '),
    }));
  }

  // Groups
  if (qc.groupColumns && qc.groupColumns.length > 0) {
    const groupRow = el('div', { class: 'flex items-center gap-1.5' });
    groupRow.appendChild(el('span', { class: 'text-xs text-gray-400', textContent: 'Groups:' }));
    for (const g of qc.groupColumns) {
      groupRow.appendChild(el('span', {
        class: 'text-xs font-medium text-gray-600',
        textContent: g,
      }));
      if (g !== qc.groupColumns[qc.groupColumns.length - 1]) {
        groupRow.appendChild(el('span', { class: 'text-xs text-gray-300', textContent: '\u203a' }));
      }
    }
    infoCard.appendChild(groupRow);
  }

  // Volumes (names only, no units)
  if (qc.volumeColumns && qc.volumeColumns.length > 0) {
    const volNames = qc.volumeColumns.map(v => v.name).join(', ');
    infoCard.appendChild(el('div', {
      class: 'text-xs text-gray-400',
      textContent: `Volumes: ${volNames}`,
    }));
  }

  wrapper.appendChild(infoCard);

  // ── Bottom: Volumetric summary (totals from parsed data) ──
  if (parseResult && parseResult.data && parseResult.data.length > 0) {
    const summary = computeVolumeSummary(parseResult.data, parseResult.units || parseResult.rawUnits || {});
    if (summary) {
      wrapper.appendChild(summary);
    }
  }

  return wrapper;
}

/**
 * Compute and render a volumetric summary from parsed data.
 */
function computeVolumeSummary(data, units) {
  // Sum key volumes
  const sums = {};
  const keyCols = ['STOIIP', 'STOIIP (in oil)', 'STOIIP (in gas)', 'GIIP', 'GIIP (in gas)', 'GIIP (in oil)', 'Bulk volume'];

  for (const row of data) {
    for (const col of keyCols) {
      if (row[col] !== undefined) {
        sums[col] = (sums[col] || 0) + (parseFloat(row[col]) || 0);
      }
    }
  }

  // Find best STOIIP and GIIP
  const stoiip = sums['STOIIP'] || sums['STOIIP (in oil)'] || 0;
  const giip = sums['GIIP'] || sums['GIIP (in gas)'] || 0;
  const bulk = sums['Bulk volume'] || 0;

  if (stoiip === 0 && giip === 0 && bulk === 0) return null;

  // Get units
  const stoiipUnit = units['STOIIP'] || units['STOIIP (in oil)'] || '';
  const giipUnit = units['GIIP'] || units['GIIP (in gas)'] || '';
  const bulkUnit = units['Bulk volume'] || '';

  const card = el('div', {
    class: 'flex items-center gap-6 px-4 py-2.5 bg-indigo-50/50 rounded-xl',
  });

  if (bulk > 0) {
    addSummaryItem(card, 'GRV', formatCompactNum(bulk), bulkUnit);
  }
  if (stoiip > 0) {
    addSummaryItem(card, 'STOIIP', formatCompactNum(stoiip), stoiipUnit);
  }
  if (giip > 0) {
    addSummaryItem(card, 'GIIP', formatCompactNum(giip), giipUnit);
  }

  // OE if we have both
  if (stoiip > 0 || giip > 0) {
    // OE = STOIIP (MCM equiv) + GIIP (BCM equiv → MCM)
    // This is approximate — proper conversion depends on actual units
    const oe = stoiip + giip;
    addSummaryItem(card, 'OE', formatCompactNum(oe), 'MCM', true);
  }

  return card;
}

function addSummaryItem(container, label, value, unit, highlight = false) {
  const item = el('div', { class: 'flex flex-col items-center' });
  item.appendChild(el('span', {
    class: `text-sm font-semibold ${highlight ? 'text-indigo-700' : 'text-gray-700'}`,
    textContent: value,
  }));
  const sub = el('span', {
    class: 'text-[10px] text-gray-400 uppercase tracking-wide',
    textContent: unit ? `${label} ${unit}` : label,
  });
  item.appendChild(sub);
  container.appendChild(item);
}

function formatCompactNum(val) {
  const abs = Math.abs(val);
  if (abs >= 1e6) return (val / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (val / 1e3).toFixed(1) + 'k';
  if (abs >= 1) return val.toFixed(1);
  return val.toFixed(2);
}

// ─── Divide by 1000 Toggle ───────────────────────────────────

function renderDivideToggle() {
  const row = el('div', {
    class: 'flex items-center gap-3',
  });

  const toggle = createToggle('import-divide1000', 'Divide by 1000', importDivideBy1000, (checked) => {
    importDivideBy1000 = checked;
    runParser();
    render();
  });

  row.appendChild(toggle);

  return row;
}

// ─── Volume Group Pills ─────────────────────────────────────

function renderGroupPills(groupColumns) {
  const container = el('div', { class: 'space-y-1.5' });

  container.appendChild(el('div', {
    class: 'text-xs font-medium text-gray-500',
    textContent: 'Volume groups',
  }));

  const row = el('div', {
    class: 'flex items-center gap-2 flex-wrap',
  });

  groupColumns.forEach((col, idx) => {
    const isRemoved = importRemovedGroups.has(idx);

    const pill = el('div', {
      class: isRemoved
        ? 'inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-full bg-gray-100 text-gray-400 line-through'
        : 'inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-full bg-indigo-50 text-indigo-700 font-medium',
    });

    pill.appendChild(el('span', { textContent: col }));

    // Remove / restore button
    const actionBtn = el('button', {
      class: isRemoved
        ? 'w-4 h-4 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 text-xs leading-none'
        : 'w-4 h-4 flex items-center justify-center rounded-full text-indigo-400 hover:text-indigo-600 text-xs leading-none',
      textContent: isRemoved ? '+' : '\u00d7',
      title: isRemoved ? `Restore ${col}` : `Remove ${col}`,
      onClick: () => {
        if (isRemoved) {
          importRemovedGroups.delete(idx);
        } else {
          importRemovedGroups.add(idx);
        }
        render();
      },
    });
    pill.appendChild(actionBtn);

    row.appendChild(pill);
  });

  container.appendChild(row);
  return container;
}

// ─── Single Case Metadata ───────────────────────────────────

function renderSingleCaseMetadata() {
  const container = el('div', {
    class: 'space-y-3',
  });

  container.appendChild(el('div', {
    class: 'text-xs font-medium text-gray-500',
    textContent: 'Case details',
  }));

  const row = el('div', {
    class: 'flex items-start gap-4',
  });

  // Timestamp on the left
  const tsLabel = el('div', {
    class: 'text-xs text-gray-400 whitespace-nowrap pt-2',
    textContent: formatTimestampDisplay(importTimestamp),
  });
  row.appendChild(tsLabel);

  // Name + description inputs on the right
  const fields = el('div', {
    class: 'flex-1 space-y-2',
  });

  const nameInput = el('input', {
    type: 'text',
    class: 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200',
    placeholder: 'Case name',
  });
  nameInput.value = importCaseName;
  nameInput.addEventListener('input', (e) => {
    importCaseName = e.target.value;
  });
  fields.appendChild(nameInput);

  const descInput = el('input', {
    type: 'text',
    class: 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200',
    placeholder: 'Optional description',
  });
  descInput.value = importCaseDescription;
  descInput.addEventListener('input', (e) => {
    importCaseDescription = e.target.value;
  });
  fields.appendChild(descInput);

  row.appendChild(fields);
  container.appendChild(row);

  return container;
}

// ─── Multi-Case Metadata (single-row format) ────────────────

function renderMultiCaseMetadata() {
  const container = el('div', {
    class: 'space-y-3',
  });

  const checkedCount = importCases.filter(c => c.checked).length;
  container.appendChild(el('div', {
    class: 'text-xs font-medium text-gray-500',
    textContent: `Detected ${importCases.length} case${importCases.length !== 1 ? 's' : ''}:`,
  }));

  // Compact table
  const table = el('div', {
    class: 'space-y-1',
  });

  importCases.forEach((c, idx) => {
    const row = el('div', {
      class: 'flex items-center gap-3 py-1',
    });

    // Checkbox
    const cb = el('input', {
      type: 'checkbox',
      class: 'w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer',
    });
    cb.checked = c.checked;
    cb.addEventListener('change', (e) => {
      importCases[idx].checked = e.target.checked;
      render();
    });
    row.appendChild(cb);

    // Original name (label)
    row.appendChild(el('span', {
      class: 'text-xs text-gray-400 w-24 truncate flex-shrink-0',
      textContent: c.originalName,
      title: c.originalName,
    }));

    // Editable name
    const nameInput = el('input', {
      type: 'text',
      class: 'flex-1 min-w-0 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-indigo-400',
      placeholder: 'Suggested name',
    });
    nameInput.value = c.name;
    nameInput.addEventListener('input', (e) => {
      importCases[idx].name = e.target.value;
    });
    row.appendChild(nameInput);

    // Editable description
    const descInput = el('input', {
      type: 'text',
      class: 'flex-1 min-w-0 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-indigo-400',
      placeholder: 'Description',
    });
    descInput.value = c.description;
    descInput.addEventListener('input', (e) => {
      importCases[idx].description = e.target.value;
    });
    row.appendChild(descInput);

    table.appendChild(row);
  });

  container.appendChild(table);

  return container;
}

// ─── Import Action Buttons ───────────────────────────────────

function renderImportActions(field, scenario) {
  const row = el('div', {
    class: 'flex items-center justify-between pt-2',
  });

  // Cancel
  const cancelBtn = el('button', {
    class: 'px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors',
    textContent: 'Cancel',
    onClick: () => {
      resetImportState();
      render();
    },
  });
  row.appendChild(cancelBtn);

  // Save button
  const isMulti = parseResult.format === FORMAT.SINGLE_LINE_TOTALS && importCases.length > 0;
  const checkedCount = isMulti ? importCases.filter(c => c.checked).length : 1;
  const saveLabel = isMulti
    ? `Save ${checkedCount} case${checkedCount !== 1 ? 's' : ''} to ${scenario}`
    : `Save to ${scenario}`;

  const v = validateParseResult();
  const canSave = v.ok && parseResult && parseResult.data && parseResult.data.length > 0 &&
    (isMulti ? checkedCount > 0 : true);

  const saveBtn = el('button', {
    class: canSave
      ? 'px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition-colors shadow-sm'
      : 'px-5 py-2 text-sm font-medium text-white bg-gray-300 rounded-full cursor-not-allowed',
    textContent: saveLabel,
    onClick: canSave ? () => handleSave(field, scenario) : null,
  });
  if (!canSave) saveBtn.setAttribute('disabled', 'true');
  row.appendChild(saveBtn);

  return row;
}

// ─── Save Handler ────────────────────────────────────────────

function handleSave(field, scenario) {
  if (!parseResult || !parseResult.data) return;

  const activeGroupColumns = getActiveGroupColumns();

  if (parseResult.format === FORMAT.SINGLE_LINE_TOTALS && importCases.length > 0) {
    // Multi-case save
    const toSave = importCases.filter(c => c.checked);
    for (const c of toSave) {
      const caseName = c.name.trim() || c.originalName;
      const caseData = {
        title: caseName,
        description: c.description || '',
        timestamp: Date.now(),
        data: [c.row],
        headers: parseResult.headers,
        units: parseResult.units,
        rawUnits: parseResult.rawUnits,
        format: parseResult.format,
        volumeGroups: {
          columns: activeGroupColumns,
        },
      };
      saveCase(field, scenario, caseName, caseData);
      addCaseToOrder(field, scenario, caseName);
    }
  } else {
    // Standard table — single case
    const caseName = importCaseName.trim() || generateCaseName(parseResult.qc?.petrelMeta || {});
    const caseData = {
      title: caseName,
      description: importCaseDescription || '',
      timestamp: importTimestamp || Date.now(),
      data: parseResult.data,
      headers: parseResult.headers,
      units: parseResult.units,
      rawUnits: parseResult.rawUnits,
      format: parseResult.format,
      volumeGroups: {
        columns: activeGroupColumns,
      },
    };
    saveCase(field, scenario, caseName, caseData);
    addCaseToOrder(field, scenario, caseName);
  }

  // Reset import state and re-render
  resetImportState();
  store.dispatch('CASE_CREATED', { field, scenario });
}

function getActiveGroupColumns() {
  if (!parseResult || !parseResult.qc) return [];
  const allGroups = parseResult.qc.groupColumns || [];
  return allGroups.filter((_, idx) => !importRemovedGroups.has(idx));
}

// ─── Case Card Grid ──────────────────────────────────────────

function renderCaseGrid(caseNames, casesData, selected) {
  const grid = el('div', {
    class: 'gs-case-grid grid gap-5',
    style: { gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' },
  });

  for (const caseName of caseNames) {
    const caseData = casesData[caseName];
    if (!caseData) continue;
    const isSelected = selected.includes(caseName);
    grid.appendChild(renderCaseCard(caseName, caseData, isSelected));
  }

  return grid;
}

function renderCaseCard(caseName, caseData, isSelected) {
  const card = el('div', {
    class: [
      'relative bg-white rounded-2xl p-5 cursor-pointer transition-all group',
      isSelected
        ? 'border-l-4 border-l-indigo-500 border border-indigo-100 bg-indigo-50/30 shadow-sm'
        : 'border border-transparent hover:shadow-md',
    ].join(' '),
  });

  // Title
  card.appendChild(el('div', {
    class: 'text-base font-semibold text-gray-900 truncate pr-8',
    textContent: caseData.title || caseName,
  }));

  // Timestamp
  if (caseData.timestamp) {
    card.appendChild(el('div', {
      class: 'mt-1 text-xs text-gray-400',
      textContent: formatDateShort(caseData.timestamp),
    }));
  }

  // Description
  if (caseData.description) {
    card.appendChild(el('div', {
      class: 'mt-1.5 text-xs text-gray-400 italic truncate',
      textContent: caseData.description,
    }));
  }

  // Summary stats
  const stats = computeCaseStats(caseData);
  if (stats) {
    card.appendChild(el('div', { class: 'mt-4' }));
    card.appendChild(renderCaseStats(stats, caseData.units));
  }

  // Zone OE breakdown bar
  const zoneBreakdown = computeZoneOEBreakdown(caseData);
  if (zoneBreakdown && zoneBreakdown.length > 0) {
    card.appendChild(el('div', { class: 'mt-4' }));
    card.appendChild(renderZoneBar(zoneBreakdown));
  }

  // Checkbox
  const checkbox = renderCheckbox(isSelected);
  checkbox.classList.add('absolute', 'bottom-4', 'right-4');
  card.appendChild(checkbox);

  // Click → activate case (opens data view)
  card.addEventListener('click', () => {
    setActiveCase(caseName);
    saveAppState();
  });

  return card;
}

// ─── Case Stats ──────────────────────────────────────────────

function computeCaseStats(caseData) {
  if (!caseData.data || caseData.data.length === 0) return null;

  const data = caseData.data;
  const units = caseData.units || {};

  let stoiipTotal = 0;
  let giipTotal = 0;

  for (const row of data) {
    stoiipTotal += parseFloat(row['STOIIP']) || 0;
    giipTotal += parseFloat(row['GIIP']) || 0;
  }

  const stoiipUnit = units['STOIIP'] || '';
  const giipUnit = units['GIIP'] || '';

  // OE calculation: stoiip (MCM-equiv) + giip (BCM-equiv, 1 BCM gas = 1 MCM OE)
  const oeMcm = stoiipTotal + giipTotal;

  return {
    stoiip: stoiipTotal,
    stoiipUnit,
    giip: giipTotal,
    giipUnit,
    oe: oeMcm,
  };
}

function renderCaseStats(stats, units) {
  const container = el('div', { class: 'space-y-1.5' });

  // STOIIP
  container.appendChild(renderStatRow('STOIIP', stats.stoiip, stats.stoiipUnit));

  // GIIP
  container.appendChild(renderStatRow('GIIP', stats.giip, stats.giipUnit));

  // Divider
  container.appendChild(el('div', {
    class: 'border-t border-gray-100 my-2',
  }));

  // OE total
  const oeRow = el('div', { class: 'flex justify-between items-baseline' });
  oeRow.appendChild(el('span', {
    class: 'text-xs font-medium text-gray-700',
    textContent: 'OE',
  }));
  oeRow.appendChild(el('span', {
    class: 'text-sm font-semibold text-gray-900',
    textContent: `${formatNumber(stats.oe)} MCM`,
  }));
  container.appendChild(oeRow);

  return container;
}

function renderStatRow(label, value, unit) {
  const row = el('div', { class: 'flex justify-between items-baseline' });
  row.appendChild(el('span', {
    class: 'text-xs text-gray-500',
    textContent: label,
  }));
  row.appendChild(el('span', {
    class: 'text-sm font-medium text-gray-800',
    textContent: `${formatNumber(value)} ${unit}`,
  }));
  return row;
}

// ─── Zone OE Breakdown Bar ──────────────────────────────────

function computeZoneOEBreakdown(caseData) {
  if (!caseData.data || caseData.data.length === 0) return null;

  const groupCols = caseData.volumeGroups?.columns || [];
  if (groupCols.length === 0) return null;

  const groupCol = groupCols[0];
  const field = getActiveField();

  // Apply group mappings so merged zones are grouped correctly
  const data = field ? applyGroupMappings(caseData.data, field) : caseData.data;
  const zoneMap = {};

  for (const row of data) {
    const zone = row[groupCol];
    if (!zone) continue;
    if (!zoneMap[zone]) zoneMap[zone] = 0;
    const stoiip = parseFloat(row['STOIIP']) || 0;
    const giip = parseFloat(row['GIIP']) || 0;
    zoneMap[zone] += stoiip + giip;
  }

  const zones = Object.entries(zoneMap)
    .map(([name, oe]) => ({ name, oe }))
    .filter(z => z.oe > 0);

  return zones;
}

function renderZoneBar(zones) {
  const totalOE = zones.reduce((s, z) => s + z.oe, 0);
  if (totalOE === 0) return el('div');

  const container = el('div', { class: 'space-y-1.5' });

  // Label
  container.appendChild(el('div', {
    class: 'text-xs text-gray-400 font-medium',
    textContent: 'Zone OE',
  }));

  // Stacked bar
  const bar = el('div', {
    class: 'flex h-2.5 rounded-full overflow-hidden',
  });

  const palette = PALETTES.vibrant;

  zones.forEach((zone, i) => {
    const pct = (zone.oe / totalOE) * 100;
    const segment = el('div', {
      class: 'h-full transition-all',
      title: `${zone.name}: ${formatNumber(zone.oe)} MCM`,
    });
    segment.style.width = `${pct}%`;
    segment.style.backgroundColor = palette[i % palette.length];
    bar.appendChild(segment);
  });

  container.appendChild(bar);

  // Zone labels
  const labels = el('div', { class: 'flex flex-wrap gap-x-3 gap-y-0.5 mt-1' });
  zones.forEach((zone, i) => {
    const label = el('div', { class: 'flex items-center gap-1' });
    const dot = el('div', {
      class: 'w-2 h-2 rounded-full flex-shrink-0',
    });
    dot.style.backgroundColor = palette[i % palette.length];
    label.appendChild(dot);
    label.appendChild(el('span', {
      class: 'text-xs text-gray-500 truncate',
      textContent: zone.name,
    }));
    labels.appendChild(label);
  });
  container.appendChild(labels);

  return container;
}

// ─── Checkbox ────────────────────────────────────────────────

function renderCheckbox(checked) {
  const outer = el('div', {
    class: [
      'w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all',
      checked
        ? 'bg-indigo-600 border-indigo-600'
        : 'border-gray-300 group-hover:border-gray-400',
    ].join(' '),
  });

  if (checked) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('class', 'w-3.5 h-3.5 text-white');
    svg.innerHTML = '<polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
    outer.appendChild(svg);
  }

  return outer;
}

// ─── Action Bar ──────────────────────────────────────────────

function renderActionBar(selected, field, scenario) {
  const bar = el('div', {
    class: 'sticky bottom-0 bg-white/90 backdrop-blur-lg border-t border-gray-200 py-4 px-6',
  });

  const inner = el('div', {
    class: 'max-w-6xl mx-auto flex items-center justify-between',
  });

  // Left: count
  inner.appendChild(el('span', {
    class: 'text-sm text-gray-600',
    textContent: `${selected.length} case${selected.length !== 1 ? 's' : ''} selected`,
  }));

  // Right: actions
  const actions = el('div', { class: 'flex items-center gap-3' });

  // View button
  const viewBtn = el('button', {
    class: 'px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition-colors shadow-sm',
    textContent: selected.length === 1 ? 'View' : `View ${selected.length} Cases`,
    onClick: () => {
      if (selected.length === 1) {
        setActiveCase(selected[0]);
      } else {
        setActiveCase(selected[0]);
      }
      saveAppState();
    },
  });
  actions.appendChild(viewBtn);

  // Import button
  const importBtn = el('button', {
    class: 'inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-full hover:bg-indigo-50 transition-colors',
    onClick: () => {
      importVisible = true;
      render();
    },
  }, [
    el('span', { textContent: '+' }),
    el('span', { textContent: 'Import' }),
  ]);
  actions.appendChild(importBtn);

  inner.appendChild(actions);
  bar.appendChild(inner);

  return bar;
}

// ─── Empty States ────────────────────────────────────────────

function renderEmptyState(title, subtitle) {
  const container = el('div', {
    class: 'mt-20 text-center',
  });

  container.appendChild(el('div', {
    class: 'text-lg font-medium text-gray-500',
    textContent: title,
  }));

  if (subtitle) {
    container.appendChild(el('div', {
      class: 'mt-2 text-sm text-gray-400',
      textContent: subtitle,
    }));
  }

  return container;
}

function renderEmptyStateWithInput(title, subtitle, onSubmit) {
  const container = el('div', {
    class: 'mt-20 text-center',
  });

  container.appendChild(el('div', {
    class: 'text-lg font-medium text-gray-500',
    textContent: title,
  }));

  if (subtitle) {
    container.appendChild(el('div', {
      class: 'mt-2 text-sm text-gray-400',
      textContent: subtitle,
    }));
  }

  const form = el('div', {
    class: 'mt-6 inline-flex items-center gap-2',
  });

  const input = el('input', {
    type: 'text',
    class: 'px-4 py-2 text-sm border border-gray-300 rounded-full focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 w-48',
    placeholder: 'Name',
  });

  const btn = el('button', {
    class: 'px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition-colors',
    textContent: 'Create',
    onClick: () => {
      const name = input.value.trim();
      if (name) onSubmit(name);
    },
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const name = input.value.trim();
      if (name) onSubmit(name);
    }
  });

  form.append(input, btn);
  container.appendChild(form);

  return container;
}
