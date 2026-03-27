// components/CaseBrowser.js — Opening screen case selection component
// Apple-like: clean, minimal, progressive disclosure.
// Inline import flow with paste area + QC checks (no modal).

import {
  getActiveField, getActiveScenario, getSelectedCases, getScenariosForField,
  setActiveField, setActiveScenario, setActiveCase, setSelectedCases,
  toggleCaseSelection, openBrowser, addScenario, addField, getFields, getState,
} from '../core/state.js';
import {
  getCasesForScenario, getOrderedCaseNames, saveAppState,
  hasLegacyData, clearLegacyData,
  saveCase, addCaseToOrder, loadDefaultAuthor, saveDefaultAuthor,
} from '../core/storage.js';
import { parseOutputSheet, FORMAT } from '../core/parser.js';
import { on, emit, EVENTS } from '../core/events.js';
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
  const selected = getSelectedCases();

  // Root wrapper
  const root = el('div', {
    class: 'min-h-screen bg-gray-50/80',
  });

  // Inner content with max width and padding
  const inner = el('div', {
    class: 'max-w-6xl mx-auto px-6 py-10',
  });

  // Legacy data banner
  if (hasLegacyData()) {
    inner.appendChild(renderLegacyBanner());
  }

  // Title
  inner.appendChild(el('h1', {
    class: 'text-3xl font-semibold text-gray-900 tracking-tight',
    textContent: 'Case Viewer',
  }));

  // Spacer
  inner.appendChild(el('div', { class: 'mt-8' }));

  // Field tabs
  inner.appendChild(renderFieldTabs(field));

  // Scenario pills (only if field is selected)
  if (field) {
    inner.appendChild(el('div', { class: 'mt-4' }));
    inner.appendChild(renderScenarioPills(field, scenario));
  }

  // Main content area
  if (!field) {
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
      // No cases yet — show the paste area as the main content
      importVisible = true;
    }

    if (caseNames.length === 0 && importVisible) {
      // Empty state label + inline import section
      inner.appendChild(el('div', { class: 'mt-12' }));
      inner.appendChild(el('div', {
        class: 'text-lg font-medium text-gray-500 mb-2',
        textContent: 'Import your first case',
      }));
      inner.appendChild(el('div', {
        class: 'text-sm text-gray-400 mb-6',
        textContent: 'Paste volumetric data from Petrel to get started.',
      }));
      inner.appendChild(renderImportSection(field, scenario));
    } else if (caseNames.length > 0) {
      inner.appendChild(el('div', { class: 'mt-8' }));
      inner.appendChild(renderCaseGrid(caseNames, casesData, selected));

      // Import section below case cards (expanded or collapsed)
      if (importVisible) {
        inner.appendChild(el('div', { class: 'mt-8' }));
        inner.appendChild(renderImportSection(field, scenario));
      }
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

export function setupEvents() {
  on(EVENTS.FIELD_CHANGED, () => render());
  on(EVENTS.SCENARIO_CHANGED, () => render());
  on(EVENTS.SCENARIO_CREATED, () => render());
  on(EVENTS.SELECTION_CHANGED, () => render());
  on(EVENTS.CASE_CREATED, () => render());
  on(EVENTS.CASE_UPDATED, () => render());
  on(EVENTS.CASE_DELETED, () => render());
  on(EVENTS.BROWSER_OPENED, () => render());
  on(EVENTS.STATE_LOADED, () => render());
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

function renderFieldTabs(activeField) {
  const row = el('div', {
    class: 'flex items-center gap-2 flex-wrap',
  });

  for (const field of getFields()) {
    const isActive = field === activeField;
    const pill = el('button', {
      class: isActive
        ? 'px-5 py-2 text-sm font-medium rounded-full bg-indigo-600 text-white transition-all shadow-sm'
        : 'px-5 py-2 text-sm font-medium rounded-full border border-gray-300 text-gray-600 hover:border-indigo-400 hover:text-indigo-600 transition-all',
      textContent: field,
      onClick: () => {
        setActiveField(field);
        saveAppState();
      },
    });
    row.appendChild(pill);
  }

  // Add field button / inline input
  row.appendChild(renderInlineAddButton('Field', (name) => {
    addField(name);
    setActiveField(name);
    saveAppState();
    render();
  }));

  return row;
}

// ─── Scenario Pills ─────────────────────────────────────────

function renderScenarioPills(field, activeScenario) {
  const row = el('div', {
    class: 'flex items-center gap-2 flex-wrap',
  });

  const scenarios = getScenariosForField(field);

  for (const sc of scenarios) {
    const isActive = sc === activeScenario;
    const pill = el('button', {
      class: isActive
        ? 'px-4 py-1.5 text-xs font-medium rounded-full bg-indigo-500 text-white transition-all'
        : 'px-4 py-1.5 text-xs font-medium rounded-full border border-gray-300 text-gray-500 hover:border-indigo-300 hover:text-indigo-500 transition-all',
      textContent: sc,
      onClick: () => {
        setActiveScenario(sc);
        saveAppState();
      },
    });
    row.appendChild(pill);
  }

  // Add scenario inline
  row.appendChild(renderInlineAddButton('Scenario', (name) => {
    addScenario(field, name);
    setActiveScenario(name);
    saveAppState();
    render();
  }));

  return row;
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

  // ── 2. Parse error ──
  if (parseResult && parseResult.error && !parseResult.qc) {
    section.appendChild(el('div', {
      class: 'px-4 py-3 bg-red-50 text-red-700 text-sm rounded-lg',
      textContent: parseResult.error,
    }));
  }

  // ── 3. QC Checks (after successful parse) ──
  if (parseResult && parseResult.qc) {
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

function renderQCChecks(qc) {
  const grid = el('div', {
    class: 'grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1.5 text-sm items-baseline',
  });

  const meta = qc.petrelMeta || {};

  // Format
  addQCRow(grid, 'Format', qc.formatLabel || qc.format, true);

  // Rows / Columns
  addQCRow(grid, 'Rows', `${qc.rowCount} data row${qc.rowCount !== 1 ? 's' : ''}, ${qc.columnCount} column${qc.columnCount !== 1 ? 's' : ''}`, qc.rowCount > 0);

  // Groups
  if (qc.groupColumns && qc.groupColumns.length > 0) {
    addQCRow(grid, 'Groups', qc.groupColumns.join(', '), null);
  }

  // Volumes
  if (qc.volumeColumns && qc.volumeColumns.length > 0) {
    const volStr = qc.volumeColumns.map(v => v.unit ? `${v.name} (${v.unit})` : v.name).join(', ');
    addQCRow(grid, 'Volumes', volStr, null);
  }

  // Petrel metadata
  addQCRow(grid, 'Project', meta.project || null, null);
  addQCRow(grid, 'Grid', meta.grid || null, null);

  // Cases (for single-row)
  if (qc.caseCount && qc.caseCount > 1) {
    addQCRow(grid, 'Cases', `${qc.caseCount} detected`, true);
  }

  return grid;
}

function addQCRow(grid, label, value, showCheck) {
  // Label
  grid.appendChild(el('span', {
    class: 'text-xs font-medium text-gray-500 whitespace-nowrap',
    textContent: label,
  }));

  // Value
  if (value === null || value === undefined) {
    grid.appendChild(el('span', {
      class: 'text-xs text-gray-300 italic',
      textContent: 'Not detected',
    }));
  } else {
    grid.appendChild(el('span', {
      class: 'text-xs text-gray-700',
      textContent: value,
    }));
  }

  // Checkmark
  if (showCheck === true) {
    grid.appendChild(el('span', {
      class: 'text-green-500 text-sm',
      textContent: '\u2713',
    }));
  } else {
    grid.appendChild(el('span', { textContent: '' }));
  }
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

  const canSave = parseResult && parseResult.data && parseResult.data.length > 0 &&
    (isMulti ? checkedCount > 0 : importCaseName.trim() !== '');

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
  emit(EVENTS.CASE_CREATED);
}

function getActiveGroupColumns() {
  if (!parseResult || !parseResult.qc) return [];
  const allGroups = parseResult.qc.groupColumns || [];
  return allGroups.filter((_, idx) => !importRemovedGroups.has(idx));
}

// ─── Case Card Grid ──────────────────────────────────────────

function renderCaseGrid(caseNames, casesData, selected) {
  const grid = el('div', {
    class: 'grid gap-5',
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

  // Click -> toggle selection
  card.addEventListener('click', (e) => {
    if (e.detail === 1) {
      const now = Date.now();
      const last = lastClickTime[caseName] || 0;
      lastClickTime[caseName] = now;

      if (now - last < 350) {
        setSelectedCases([caseName]);
        setActiveCase(caseName);
        saveAppState();
        return;
      }

      setTimeout(() => {
        if (lastClickTime[caseName] !== now) return;
        toggleCaseSelection(caseName);
        saveAppState();
      }, 250);
    }
  });

  // Prevent text selection on double-click
  card.addEventListener('dblclick', (e) => {
    e.preventDefault();
    setSelectedCases([caseName]);
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

  // Use the first grouping column
  const groupCols = caseData.volumeGroups?.columns || [];
  if (groupCols.length === 0) return null;

  const groupCol = groupCols[0];
  const zoneMap = {};

  for (const row of caseData.data) {
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
    placeholder: 'Scenario name',
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
