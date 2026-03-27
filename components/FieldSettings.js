// components/FieldSettings.js — Field-level group name standardization
// Visual: stacks are horizontal containers with pills inside. Bare pills are unstacked.
// Everything is drag-sortable via Sortable.js. Order = plot sort order.

import { getActiveField } from '../core/state.js';
import { loadGroupMappings, saveGroupMappings, collectUniqueGroupValues } from '../core/storage.js';
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

export function render() {
  if (!containerEl || !visible) return;
  clear(containerEl);

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

  // Header
  wrapper.appendChild(el('div', { class: 'flex items-center justify-between' }, [
    el('span', { class: 'text-xs font-semibold text-gray-600 uppercase tracking-wider', textContent: 'Group Standardization' }),
    el('span', { class: 'text-[10px] text-gray-400', textContent: 'Drag pills to stack \u00b7 Drag to reorder' }),
  ]));

  // Group type sections (sortable between each other)
  const groupOrder = currentMappings.__groupOrder || Object.keys(allUniqueValues);
  // Ensure all columns are present
  const allCols = Object.keys(allUniqueValues);
  const orderedCols = [...groupOrder.filter(c => allCols.includes(c)), ...allCols.filter(c => !groupOrder.includes(c))];

  const sectionsContainer = el('div', { class: 'space-y-4', id: 'group-sections-container' });

  for (const column of orderedCols) {
    sectionsContainer.appendChild(renderGroupSection(field, column, allUniqueValues[column]));
  }

  wrapper.appendChild(sectionsContainer);

  // Make group sections sortable (reorder group types)
  setTimeout(() => {
    if (typeof Sortable !== 'undefined') {
      Sortable.create(sectionsContainer, {
        animation: 150,
        handle: '.group-section-handle',
        ghostClass: 'opacity-30',
        onEnd: () => {
          const newOrder = Array.from(sectionsContainer.children).map(s => s.dataset.column);
          currentMappings.__groupOrder = newOrder;
          saveGroupMappings(field, currentMappings);
        },
      });
    }
  }, 50);

  containerEl.appendChild(wrapper);
}

// ─── Group section (one per column type) ─────────────────────

function renderGroupSection(field, column, uniqueValues) {
  const section = el('div', {
    class: 'space-y-1.5',
    dataset: { column },
  });

  // Section header (draggable handle)
  const header = el('div', {
    class: 'group-section-handle flex items-center gap-2 cursor-grab py-1',
  });
  header.appendChild(el('i', { class: 'fas fa-grip-vertical text-[10px] text-gray-300' }));
  header.appendChild(el('span', {
    class: 'text-xs font-medium text-gray-500 uppercase tracking-wider',
    textContent: column,
  }));
  const countBadge = el('span', {
    class: 'text-[10px] text-gray-300',
    textContent: `${uniqueValues.length} values`,
  });
  header.appendChild(countBadge);
  section.appendChild(header);

  // Items container (stacks + bare pills, all sortable)
  const itemsContainer = el('div', {
    class: 'space-y-1',
    id: `group-items-${column}`,
  });

  const stacks = (currentMappings[column] || []);
  const assignedValues = new Set();
  for (const stack of stacks) {
    for (const v of stack.values) assignedValues.add(v);
  }
  const unassigned = uniqueValues.filter(v => !assignedValues.has(v));

  // Render stacks (in order)
  for (let i = 0; i < stacks.length; i++) {
    itemsContainer.appendChild(renderStackRow(field, column, stacks[i], i));
  }

  // Render unassigned as bare pills
  for (const val of unassigned) {
    itemsContainer.appendChild(renderBarePill(field, column, val));
  }

  section.appendChild(itemsContainer);

  // Make items sortable (reorder stacks and bare pills, drag pills between them)
  setTimeout(() => {
    if (typeof Sortable === 'undefined') return;

    Sortable.create(itemsContainer, {
      animation: 150,
      group: { name: column, pull: true, put: true },
      ghostClass: 'opacity-30',
      onEnd: (evt) => {
        rebuildMappingsFromDOM(field, column, itemsContainer);
      },
    });

    // Also make pill containers inside stacks sortable
    for (const pillZone of itemsContainer.querySelectorAll('.stack-pills')) {
      Sortable.create(pillZone, {
        animation: 150,
        group: { name: `${column}-pills`, pull: true, put: true },
        ghostClass: 'opacity-30',
        onAdd: (evt) => rebuildMappingsFromDOM(field, column, itemsContainer),
        onSort: (evt) => rebuildMappingsFromDOM(field, column, itemsContainer),
      });
    }
  }, 50);

  return section;
}

// ─── Stack row (horizontal container with pills) ─────────────

function renderStackRow(field, column, stack, index) {
  const row = el('div', {
    class: 'flex items-center gap-2 bg-gray-50 rounded-lg border border-gray-200 px-3 py-1.5 group',
    dataset: { type: 'stack', stackName: stack.name },
  });

  // Color dot
  const color = stack.color || PALETTES.vibrant[index % PALETTES.vibrant.length];
  const colorInput = el('input', {
    type: 'color',
    class: 'w-4 h-4 rounded-full border-0 cursor-pointer p-0 flex-shrink-0',
    value: color,
    title: 'Stack color',
  });
  colorInput.style.WebkitAppearance = 'none';
  colorInput.style.minWidth = '16px';
  colorInput.style.minHeight = '16px';
  colorInput.addEventListener('input', (e) => {
    stack.color = e.target.value;
    saveGroupMappings(field, currentMappings);
  });
  row.appendChild(colorInput);

  // Stack name (editable on pen click)
  const nameLabel = el('span', {
    class: 'text-xs font-semibold text-gray-700 min-w-[60px] cursor-default',
    textContent: stack.name,
  });

  const nameInput = el('input', {
    type: 'text',
    class: 'text-xs font-semibold text-indigo-700 bg-transparent border-b border-indigo-300 focus:outline-none w-20 hidden',
    value: stack.name,
  });

  const editBtn = el('button', {
    class: 'w-4 h-4 flex items-center justify-center text-gray-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0',
    innerHTML: '<i class="fas fa-pen text-[8px]"></i>',
    onClick: (e) => {
      e.stopPropagation();
      nameLabel.classList.add('hidden');
      editBtn.classList.add('hidden');
      nameInput.classList.remove('hidden');
      nameInput.value = stack.name;
      nameInput.focus();
      nameInput.select();
    },
  });

  const commitEdit = () => {
    const newName = nameInput.value.trim();
    if (newName) {
      stack.name = newName;
      nameLabel.textContent = newName;
      row.dataset.stackName = newName;
      saveGroupMappings(field, currentMappings);
    }
    nameInput.classList.add('hidden');
    nameLabel.classList.remove('hidden');
    editBtn.classList.remove('hidden');
  };

  nameInput.addEventListener('blur', commitEdit);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') { nameInput.classList.add('hidden'); nameLabel.classList.remove('hidden'); editBtn.classList.remove('hidden'); }
  });

  row.append(nameLabel, editBtn, nameInput);

  // Pill zone (horizontal, sortable within)
  const pillZone = el('div', {
    class: 'stack-pills flex flex-wrap gap-1 flex-1 min-h-[24px]',
    dataset: { column, stackName: stack.name },
  });

  for (const val of stack.values) {
    pillZone.appendChild(makePill(val));
  }

  row.appendChild(pillZone);

  // × button to dissolve stack
  const dissolveBtn = el('button', {
    class: 'w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0',
    innerHTML: '<i class="fas fa-times text-[9px]"></i>',
    title: 'Dissolve stack',
    onClick: () => {
      const stacks = currentMappings[column] || [];
      const idx = stacks.indexOf(stack);
      if (idx !== -1) stacks.splice(idx, 1);
      saveGroupMappings(field, currentMappings);
      render();
    },
  });
  row.appendChild(dissolveBtn);

  return row;
}

// ─── Bare pill (unstacked, appears as a single item in the list) ──

function renderBarePill(field, column, value) {
  const wrapper = el('div', {
    class: 'stack-pills flex items-center',
    dataset: { type: 'bare', column },
  });
  wrapper.appendChild(makePill(value));
  return wrapper;
}

// ─── Pill element ────────────────────────────────────────────

function makePill(value) {
  return el('span', {
    class: 'inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-white border border-gray-200 text-gray-600 cursor-grab hover:border-indigo-300 hover:text-indigo-600 transition-colors select-none whitespace-nowrap',
    textContent: value,
    dataset: { value },
  });
}

// ─── Rebuild mappings from DOM after drag ────────────────────

function rebuildMappingsFromDOM(field, column, container) {
  const stacks = [];

  for (const child of container.children) {
    const pills = Array.from(child.querySelectorAll('[data-value]')).map(p => p.dataset.value);
    if (pills.length === 0) continue;

    if (child.dataset.type === 'stack') {
      // Existing stack — keep name and color
      const existingName = child.dataset.stackName;
      const existing = (currentMappings[column] || []).find(s => s.name === existingName);
      stacks.push({
        name: existing?.name || pills[0],
        color: existing?.color || undefined,
        values: pills,
      });
    } else if (pills.length > 1) {
      // Bare pill zone that now has multiple pills — auto-create a stack
      stacks.push({
        name: pills[0],
        values: pills,
      });
    }
    // If bare with 1 pill, it stays unassigned (no stack needed)
  }

  currentMappings[column] = stacks;
  saveGroupMappings(field, currentMappings);

  // Re-render to clean up DOM state
  render();
}

export function setupEvents() {}
