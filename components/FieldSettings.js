// components/FieldSettings.js — Field-level group name standardization
// Drag-and-drop pill stacking to map verbose Petrel names to short display names.

import { getActiveField } from '../core/state.js';
import { loadGroupMappings, saveGroupMappings, collectUniqueGroupValues } from '../core/storage.js';
import { el, clear } from '../utils/dom.js';
import { PALETTES } from '../utils/color.js';

let containerEl = null;
let visible = false;
let currentMappings = {}; // { column: [{ name, values }] }
let allUniqueValues = {}; // { column: [values] }

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

export function render() {
  if (!containerEl || !visible) return;
  clear(containerEl);

  const field = getActiveField();
  if (!field) return;

  // Load existing mappings and unique values
  currentMappings = loadGroupMappings(field);
  allUniqueValues = collectUniqueGroupValues(field);

  if (Object.keys(allUniqueValues).length === 0) {
    containerEl.appendChild(el('div', {
      class: 'text-sm text-gray-400 py-4 text-center',
      textContent: 'No group values found. Import cases first.',
    }));
    return;
  }

  const wrapper = el('div', { class: 'space-y-6' });

  // Header
  wrapper.appendChild(el('div', {
    class: 'flex items-center justify-between',
  }, [
    el('h3', { class: 'text-sm font-semibold text-gray-700', textContent: 'Group Name Standardization' }),
    el('span', { class: 'text-xs text-gray-400', textContent: 'Drag pills to stack them together' }),
  ]));

  // One section per grouping column
  for (const [column, uniqueValues] of Object.entries(allUniqueValues)) {
    wrapper.appendChild(renderColumnSection(field, column, uniqueValues));
  }

  containerEl.appendChild(wrapper);
}

// ─── Column section ─────────────────────────────────────────

function renderColumnSection(field, column, uniqueValues) {
  const section = el('div', { class: 'space-y-2' });

  // Column header
  section.appendChild(el('div', {
    class: 'text-xs font-medium text-gray-500 uppercase tracking-wider',
    textContent: column,
  }));

  // Get existing stacks for this column
  const stacks = currentMappings[column] || [];
  const assignedValues = new Set();
  for (const stack of stacks) {
    for (const v of stack.values) assignedValues.add(v);
  }

  // Unassigned values
  const unassigned = uniqueValues.filter(v => !assignedValues.has(v));

  // Drop zone container
  const dropZone = el('div', {
    class: 'min-h-[48px] rounded-lg border-2 border-dashed border-gray-200 p-2 flex flex-wrap gap-1.5 transition-colors',
    dataset: { column, zone: 'unassigned' },
  });

  // Make it a drop target
  setupDropZone(dropZone, field, column, null);

  // Render existing stacks
  const stacksContainer = el('div', { class: 'space-y-1.5' });

  for (let i = 0; i < stacks.length; i++) {
    stacksContainer.appendChild(renderStack(field, column, stacks[i], i));
  }

  // Render unassigned pills
  for (const val of unassigned) {
    dropZone.appendChild(renderPill(val, column, field));
  }

  if (unassigned.length === 0 && stacks.length > 0) {
    dropZone.appendChild(el('span', {
      class: 'text-xs text-gray-300 italic py-1',
      textContent: 'All values assigned',
    }));
  }

  section.appendChild(stacksContainer);
  section.appendChild(dropZone);

  return section;
}

// ─── Stack (group of pills with a display name) ─────────────

function renderStack(field, column, stack, index) {
  const row = el('div', {
    class: 'flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 group',
    dataset: { column, stackIndex: String(index) },
  });

  // Stack name (editable)
  const nameContainer = el('div', { class: 'flex items-center gap-1.5 min-w-[100px]' });

  // Color dot (clickable)
  const color = stack.color || PALETTES.vibrant[index % PALETTES.vibrant.length];
  const colorDot = el('input', {
    type: 'color',
    class: 'w-4 h-4 rounded-full border-0 cursor-pointer p-0 appearance-none',
    value: color,
    title: 'Set stack color',
    style: { background: color },
  });
  colorDot.style.WebkitAppearance = 'none';
  colorDot.addEventListener('input', (e) => {
    stack.color = e.target.value;
    saveGroupMappings(field, currentMappings);
  });
  nameContainer.appendChild(colorDot);

  const nameLabel = el('span', {
    class: 'text-xs font-semibold text-indigo-700',
    textContent: stack.name,
  });

  const editBtn = el('button', {
    class: 'w-4 h-4 flex items-center justify-center text-gray-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-all',
    innerHTML: '<i class="fas fa-pen text-[8px]"></i>',
  });

  // Edit mode
  const editInput = el('input', {
    type: 'text',
    class: 'text-xs font-semibold text-indigo-700 bg-transparent border-0 border-b border-indigo-300 focus:outline-none w-24 hidden',
    value: stack.name,
  });

  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    nameLabel.classList.add('hidden');
    editBtn.classList.add('hidden');
    editInput.classList.remove('hidden');
    editInput.value = stack.name;
    editInput.focus();
    editInput.select();
  });

  const commitEdit = () => {
    const newName = editInput.value.trim();
    if (newName && newName !== stack.name) {
      stack.name = newName;
      saveGroupMappings(field, currentMappings);
      nameLabel.textContent = newName;
    }
    editInput.classList.add('hidden');
    nameLabel.classList.remove('hidden');
    editBtn.classList.remove('hidden');
  };

  editInput.addEventListener('blur', commitEdit);
  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') {
      editInput.classList.add('hidden');
      nameLabel.classList.remove('hidden');
      editBtn.classList.remove('hidden');
    }
  });

  nameContainer.append(nameLabel, editBtn, editInput);

  // Arrow separator
  const arrow = el('span', { class: 'text-gray-300 text-xs', textContent: '←' });

  // Pills drop zone
  const pillZone = el('div', {
    class: 'flex flex-wrap gap-1 flex-1 min-h-[28px] rounded px-1 transition-colors',
    dataset: { column, zone: 'stack', stackIndex: String(index) },
  });

  setupDropZone(pillZone, field, column, index);

  for (const val of stack.values) {
    pillZone.appendChild(renderPill(val, column, field));
  }

  // Unstack button (removes stack, puts values back to unassigned)
  const unstackBtn = el('button', {
    class: 'w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all',
    innerHTML: '<i class="fas fa-times text-[9px]"></i>',
    title: 'Unstack all',
    onClick: () => {
      const stacks = currentMappings[column] || [];
      stacks.splice(index, 1);
      saveGroupMappings(field, currentMappings);
      render();
    },
  });

  row.append(nameContainer, arrow, pillZone, unstackBtn);
  return row;
}

// ─── Draggable pill ─────────────────────────────────────────

function renderPill(value, column, field) {
  const pill = el('span', {
    class: 'inline-flex items-center px-2 py-0.5 text-xs rounded-full bg-white border border-gray-200 text-gray-600 cursor-grab hover:border-indigo-300 hover:text-indigo-600 transition-colors select-none',
    textContent: value,
    draggable: 'true',
    dataset: { value, column },
  });

  pill.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ value, column }));
    e.dataTransfer.effectAllowed = 'move';
    pill.classList.add('opacity-50');
  });

  pill.addEventListener('dragend', () => {
    pill.classList.remove('opacity-50');
  });

  return pill;
}

// ─── Drop zone setup ────────────────────────────────────────

function setupDropZone(element, field, column, stackIndex) {
  element.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    element.classList.add('border-indigo-300', 'bg-indigo-50/50');
  });

  element.addEventListener('dragleave', () => {
    element.classList.remove('border-indigo-300', 'bg-indigo-50/50');
  });

  element.addEventListener('drop', (e) => {
    e.preventDefault();
    element.classList.remove('border-indigo-300', 'bg-indigo-50/50');

    let data;
    try { data = JSON.parse(e.dataTransfer.getData('text/plain')); }
    catch { return; }

    if (data.column !== column) return; // Only drop within same column

    const value = data.value;

    // Remove value from any existing stack
    removeValueFromAllStacks(column, value);

    if (stackIndex !== null && stackIndex !== undefined) {
      // Drop onto an existing stack
      const stacks = currentMappings[column] || [];
      if (stacks[stackIndex]) {
        if (!stacks[stackIndex].values.includes(value)) {
          stacks[stackIndex].values.push(value);
        }
      }
    } else {
      // Drop onto unassigned zone — check if another unassigned pill is under the cursor
      // If so, create a new stack with both
      const targetPill = e.target.closest('[data-value]');
      if (targetPill && targetPill.dataset.value !== value) {
        // Create new stack
        const existingVal = targetPill.dataset.value;
        removeValueFromAllStacks(column, existingVal);

        if (!currentMappings[column]) currentMappings[column] = [];
        currentMappings[column].push({
          name: existingVal, // First dropped-on pill defines name
          values: [existingVal, value],
        });
      }
      // If dropped on empty unassigned zone, value stays unassigned (already removed from stacks)
    }

    saveGroupMappings(field, currentMappings);
    render();
  });
}

function removeValueFromAllStacks(column, value) {
  const stacks = currentMappings[column] || [];
  for (let i = stacks.length - 1; i >= 0; i--) {
    const idx = stacks[i].values.indexOf(value);
    if (idx !== -1) {
      stacks[i].values.splice(idx, 1);
      // Remove empty stacks
      if (stacks[i].values.length === 0) {
        stacks.splice(i, 1);
      }
    }
  }
}

export function setupEvents() {}
