// components/FieldSettings.js — Field-level group name standardization
// Native drag-and-drop for pill stacking. Sortable.js for reordering.

import { getActiveField } from '../core/state.js';
import { loadGroupMappings, saveGroupMappings, collectUniqueGroupValues } from '../core/storage.js';
import { emit, EVENTS } from '../core/events.js';
import { el, clear } from '../utils/dom.js';
import { PALETTES } from '../utils/color.js';

let containerEl = null;
let visible = false;
let currentMappings = {};
let allUniqueValues = {};

export function init() {}

export function toggle(targetEl) {
  containerEl = targetEl;
  visible = !visible;
  if (visible) render();
  else if (containerEl) clear(containerEl);
}

export function isVisible() { return visible; }

export function hide() {
  visible = false;
  if (containerEl) clear(containerEl);
}

function persistMappings(field) {
  saveGroupMappings(field, currentMappings);
}

function contrastColor(hex) {
  if (!hex || hex.length < 7) return '#374151';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#374151' : '#ffffff';
}

function defaultColor(index) {
  return PALETTES.vibrant[index % PALETTES.vibrant.length];
}

// ─── Styles ─────────────────────────────────────────────────

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .fs-drag-over-left { box-shadow: -2px 0 0 0 #4338ca; }
    .fs-drag-over-right { box-shadow: 2px 0 0 0 #4338ca; }
    .fs-drag-over-stack { outline: 2px solid #4338ca; outline-offset: 1px; border-radius: 9999px; }
    .fs-dragging { opacity: 0.3; filter: grayscale(1); }
  `;
  document.head.appendChild(s);
}

// ─── Main render ────────────────────────────────────────────

export function render() {
  if (!containerEl || !visible) return;
  clear(containerEl);
  injectStyles();

  const field = getActiveField();
  if (!field) return;

  currentMappings = loadGroupMappings(field);
  allUniqueValues = collectUniqueGroupValues(field);

  if (Object.keys(allUniqueValues).length === 0) {
    containerEl.appendChild(el('div', {
      class: 'text-xs text-gray-400 py-4 text-center',
      textContent: 'No group values found. Import cases first.',
    }));
    return;
  }

  const wrapper = el('div', {
    class: 'bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-5',
  });

  wrapper.appendChild(el('div', { class: 'flex items-center justify-between' }, [
    el('span', { class: 'text-xs font-semibold text-gray-600 uppercase tracking-wider', textContent: 'Group Standardization' }),
    el('span', { class: 'text-[10px] text-gray-400', textContent: 'Drag pills to stack \u00b7 Drag to reorder' }),
  ]));

  const groupOrder = currentMappings.__groupOrder || Object.keys(allUniqueValues);
  const allCols = Object.keys(allUniqueValues);
  const orderedCols = [...groupOrder.filter(c => allCols.includes(c)), ...allCols.filter(c => !groupOrder.includes(c))];

  const sectionsContainer = el('div', { class: 'space-y-4', id: 'group-sections-container' });

  for (const column of orderedCols) {
    sectionsContainer.appendChild(renderGroupSection(field, column, allUniqueValues[column]));
  }

  wrapper.appendChild(sectionsContainer);
  containerEl.appendChild(wrapper);

  // Group sections reorderable
  setTimeout(() => {
    if (typeof Sortable === 'undefined') return;
    Sortable.create(sectionsContainer, {
      animation: 150,
      handle: '.group-section-handle',
      ghostClass: 'opacity-30',
      onEnd: () => {
        currentMappings.__groupOrder = Array.from(sectionsContainer.children).map(s => s.dataset.column);
        persistMappings(field);
      },
    });
  }, 50);
}

// ─── Group section ──────────────────────────────────────────

function renderGroupSection(field, column, uniqueValues) {
  const section = el('div', { class: 'space-y-1.5', dataset: { column } });

  const header = el('div', { class: 'group-section-handle flex items-center gap-2 cursor-grab py-1' });
  header.appendChild(el('i', { class: 'fas fa-grip-vertical text-[10px] text-gray-300' }));
  header.appendChild(el('span', { class: 'text-xs font-medium text-gray-500 uppercase tracking-wider', textContent: column }));
  header.appendChild(el('span', { class: 'text-[10px] text-gray-300', textContent: `${uniqueValues.length}` }));
  section.appendChild(header);

  const itemsContainer = el('div', {
    class: 'flex flex-wrap gap-1.5 items-start',
    id: `group-items-${column}`,
  });

  const stacks = currentMappings[column] || [];
  const assignedValues = new Set();
  for (const stack of stacks) for (const v of stack.values) assignedValues.add(v);
  const unassigned = uniqueValues.filter(v => !assignedValues.has(v));

  for (let i = 0; i < stacks.length; i++) {
    itemsContainer.appendChild(renderStackRow(field, column, stacks[i], i));
  }
  for (const val of unassigned) {
    itemsContainer.appendChild(renderBarePill(field, column, val));
  }

  section.appendChild(itemsContainer);

  // Sortable for top-level reordering only
  setTimeout(() => {
    if (typeof Sortable === 'undefined') return;
    Sortable.create(itemsContainer, {
      animation: 150,
      group: { name: `items-${column}`, pull: false, put: false },
      ghostClass: 'opacity-0',
      dragClass: 'fs-dragging',
      onEnd: () => rebuildMappingsFromDOM(field, column, itemsContainer),
    });
  }, 50);

  return section;
}

// ─── Stack row ──────────────────────────────────────────────

function renderStackRow(field, column, stack, index) {
  const color = stack.color || defaultColor(index);
  const textColor = contrastColor(color);

  const outer = el('div', {
    class: 'relative inline-flex group',
    dataset: { type: 'stack', stackName: stack.name },
  });

  // Floating actions above top-right
  const actions = el('div', {
    class: 'absolute -top-3 -right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all z-10',
  });
  actions.appendChild(el('button', {
    class: 'w-4 h-4 flex items-center justify-center rounded-full bg-white border border-gray-200 text-indigo-400 hover:text-indigo-600 shadow-sm transition-all',
    innerHTML: '<i class="fas fa-pen text-[6px]"></i>',
    onClick: (e) => { e.stopPropagation(); showEdit(); },
  }));
  actions.appendChild(el('button', {
    class: 'w-4 h-4 flex items-center justify-center rounded-full bg-white border border-gray-200 text-red-300 hover:text-red-500 shadow-sm transition-all',
    innerHTML: '<i class="fas fa-times text-[6px]"></i>',
    onClick: () => {
      const s = currentMappings[column] || [];
      const idx = s.indexOf(stack);
      if (idx !== -1) s.splice(idx, 1);
      persistMappings(field);
      render();
    },
  }));
  outer.appendChild(actions);

  // Colored pill row
  const row = el('div', {
    class: 'inline-flex items-center gap-1.5 rounded-full pl-3 pr-2 py-0.5 transition-colors',
    style: { backgroundColor: color },
  });

  // Color picker
  const colorInput = el('input', { type: 'color', class: 'absolute w-0 h-0 opacity-0', value: color });
  colorInput.addEventListener('input', (e) => {
    stack.color = e.target.value;
    row.style.backgroundColor = e.target.value;
    persistMappings(field);
  });
  row.addEventListener('dblclick', (e) => { if (e.target === row) colorInput.click(); });
  row.appendChild(colorInput);

  // Title label
  const titleLabel = el('span', {
    class: 'text-xs font-semibold whitespace-nowrap cursor-default',
    textContent: stack.name,
    style: { color: textColor },
  });

  // Edit input
  const editInput = el('input', {
    type: 'text',
    class: 'text-xs font-semibold bg-transparent focus:outline-none hidden whitespace-nowrap',
    value: stack.name,
    style: { color: textColor, width: Math.max(3, stack.name.length * 0.55) + 'rem', caretColor: textColor },
  });

  const okBtn = el('button', {
    class: 'w-4 h-4 flex items-center justify-center rounded-full bg-green-500 text-white text-[7px] hover:bg-green-600 hidden flex-shrink-0',
    innerHTML: '<i class="fas fa-check"></i>',
  });
  const cancelEditBtn = el('button', {
    class: 'w-4 h-4 flex items-center justify-center rounded-full bg-white text-red-400 hover:text-red-600 text-[7px] hidden flex-shrink-0',
    innerHTML: '<i class="fas fa-times"></i>',
  });

  function showEdit() {
    titleLabel.classList.add('hidden');
    actions.classList.add('hidden');
    editInput.classList.remove('hidden');
    okBtn.classList.remove('hidden');
    cancelEditBtn.classList.remove('hidden');
    editInput.value = stack.name;
    editInput.style.width = Math.max(3, stack.name.length * 0.55) + 'rem';
    requestAnimationFrame(() => { editInput.focus(); editInput.select(); });
  }
  function hideEdit() {
    editInput.classList.add('hidden');
    okBtn.classList.add('hidden');
    cancelEditBtn.classList.add('hidden');
    titleLabel.classList.remove('hidden');
    actions.classList.remove('hidden');
  }
  function commitEdit() {
    const name = editInput.value.trim();
    if (name) {
      stack.name = name;
      titleLabel.textContent = name;
      outer.dataset.stackName = name;
      persistMappings(field);
    }
    hideEdit();
  }

  okBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); commitEdit(); });
  cancelEditBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); hideEdit(); });
  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') hideEdit();
  });
  editInput.addEventListener('input', () => {
    editInput.style.width = Math.max(3, editInput.value.length * 0.55) + 'rem';
  });

  row.append(titleLabel, editInput, okBtn, cancelEditBtn);

  // Child pills — make this a drop zone for adding pills
  const pillZone = el('div', {
    class: 'stack-pills flex flex-wrap gap-1 min-h-[24px]',
    dataset: { column, stackName: stack.name },
  });
  for (const val of stack.values) pillZone.appendChild(makeDraggablePill(val, column, field));
  row.appendChild(pillZone);

  // Drop zone: accept pills dragged onto the stack
  setupStackDropZone(row, field, column, stack);

  outer.appendChild(row);
  return outer;
}

// ─── Bare pill ──────────────────────────────────────────────

function renderBarePill(field, column, value) {
  const wrapper = el('div', {
    class: 'group/bare inline-flex items-center gap-0.5',
    dataset: { type: 'bare', column, value },
  });

  wrapper.appendChild(makeDraggablePill(value, column, field));

  // Pen on hover → create named stack
  wrapper.appendChild(el('button', {
    class: 'w-4 h-4 flex items-center justify-center text-indigo-400 hover:text-indigo-600 opacity-0 group-hover/bare:opacity-100 transition-all flex-shrink-0',
    innerHTML: '<i class="fas fa-pen text-[7px]"></i>',
    onClick: (e) => {
      e.stopPropagation();
      const editRow = el('div', {
        class: 'inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-gray-50 pl-0.5 pr-1.5 py-0.5',
      });
      const color = defaultColor((currentMappings[column] || []).length);
      const tc = contrastColor(color);
      const nameInput = el('input', {
        type: 'text',
        class: 'px-2.5 py-1 text-xs font-semibold rounded-full focus:outline-none',
        value,
        style: { backgroundColor: color, color: tc, width: '6rem' },
      });
      editRow.append(
        makePill(value),
        nameInput,
        el('button', {
          class: 'w-5 h-5 flex items-center justify-center rounded-full bg-green-500 text-white text-[9px] hover:bg-green-600',
          innerHTML: '<i class="fas fa-check"></i>',
          onClick: () => {
            const name = nameInput.value.trim() || value;
            if (!currentMappings[column]) currentMappings[column] = [];
            currentMappings[column].push({ name, color, values: [value] });
            persistMappings(field);
            render();
          },
        }),
        el('button', {
          class: 'w-5 h-5 flex items-center justify-center rounded-full text-red-400 hover:text-red-600 text-[9px]',
          innerHTML: '<i class="fas fa-times"></i>',
          onClick: () => editRow.replaceWith(wrapper),
        }),
      );
      wrapper.replaceWith(editRow);
      nameInput.focus();
      nameInput.select();
      nameInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') editRow.querySelector('.bg-green-500').click();
        if (ev.key === 'Escape') editRow.querySelector('.text-red-400').click();
      });
    },
  }));

  // Drop zone: dropping a pill onto a bare pill creates a stack
  setupBarePillDropZone(wrapper, field, column, value);

  return wrapper;
}

// ─── Draggable pill (with native drag) ──────────────────────

function makeDraggablePill(value, column, field) {
  const pill = makePill(value);
  pill.setAttribute('draggable', 'true');
  pill.dataset.dragColumn = column;
  pill.dataset.dragValue = value;

  pill.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ column, value }));
    e.dataTransfer.effectAllowed = 'move';
    pill.classList.add('fs-dragging');
  });

  pill.addEventListener('dragend', () => {
    pill.classList.remove('fs-dragging');
    clearAllDropIndicators();
  });

  return pill;
}

function makePill(value) {
  return el('span', {
    class: 'inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-white border border-gray-200 text-gray-600 cursor-grab hover:border-indigo-300 hover:text-indigo-600 transition-colors select-none whitespace-nowrap',
    textContent: value,
    dataset: { value },
  });
}

// ─── Drop zones ─────────────────────────────────────────────

function setupBarePillDropZone(wrapper, field, column, targetValue) {
  wrapper.addEventListener('dragover', (e) => {
    const data = getDragData(e);
    if (!data || data.column !== column || data.value === targetValue) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearAllDropIndicators();
    wrapper.classList.add('fs-drag-over-stack');
  });

  wrapper.addEventListener('dragleave', () => {
    wrapper.classList.remove('fs-drag-over-stack');
  });

  wrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    wrapper.classList.remove('fs-drag-over-stack');
    const data = parseDragData(e);
    if (!data || data.column !== column || data.value === targetValue) return;

    // Remove dragged value from any existing stack
    removeValueFromStacks(column, data.value);
    // Remove target from any stack too
    removeValueFromStacks(column, targetValue);

    // Create new stack: target name, both values
    if (!currentMappings[column]) currentMappings[column] = [];
    currentMappings[column].push({
      name: targetValue,
      values: [targetValue, data.value],
    });
    persistMappings(field);
    render();
  });
}

function setupStackDropZone(row, field, column, stack) {
  row.addEventListener('dragover', (e) => {
    const data = getDragData(e);
    if (!data || data.column !== column) return;
    // Don't allow dropping a pill already in this stack
    if (stack.values.includes(data.value)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearAllDropIndicators();
    row.classList.add('fs-drag-over-stack');
  });

  row.addEventListener('dragleave', () => {
    row.classList.remove('fs-drag-over-stack');
  });

  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('fs-drag-over-stack');
    const data = parseDragData(e);
    if (!data || data.column !== column) return;
    if (stack.values.includes(data.value)) return;

    // Remove from any other stack
    removeValueFromStacks(column, data.value);

    // Add to this stack
    stack.values.push(data.value);
    persistMappings(field);
    render();
  });
}

// ─── Drag helpers ───────────────────────────────────────────

function getDragData(e) {
  // Can't read data during dragover, so check types
  if (!e.dataTransfer.types.includes('application/json')) return null;
  return true; // Signal that it's our drag
}

function parseDragData(e) {
  try { return JSON.parse(e.dataTransfer.getData('application/json')); }
  catch { return null; }
}

function removeValueFromStacks(column, value) {
  const stacks = currentMappings[column] || [];
  for (let i = stacks.length - 1; i >= 0; i--) {
    const idx = stacks[i].values.indexOf(value);
    if (idx !== -1) {
      stacks[i].values.splice(idx, 1);
      if (stacks[i].values.length === 0) stacks.splice(i, 1);
    }
  }
}

function clearAllDropIndicators() {
  document.querySelectorAll('.fs-drag-over-left, .fs-drag-over-right, .fs-drag-over-stack').forEach(el => {
    el.classList.remove('fs-drag-over-left', 'fs-drag-over-right', 'fs-drag-over-stack');
  });
}

// ─── Rebuild from DOM (for Sortable reorder) ────────────────

function rebuildMappingsFromDOM(field, column, container) {
  const stacks = [];
  for (const child of container.children) {
    if (child.dataset.type === 'stack') {
      const pills = Array.from(child.querySelectorAll('[data-value]')).map(p => p.dataset.value);
      if (pills.length === 0) continue;
      const name = child.dataset.stackName;
      const existing = (currentMappings[column] || []).find(s => s.name === name);
      stacks.push({ name: existing?.name || pills[0], color: existing?.color, values: pills });
    }
  }
  currentMappings[column] = stacks;
  persistMappings(field);
}

export function setupEvents() {}
