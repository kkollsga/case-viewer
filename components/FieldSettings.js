// components/FieldSettings.js — Field-level group name standardization
// Drag-and-drop pill stacking with Sortable.js.
// Sort order = plot order (leftmost/topmost = first in pivot table).

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

// ─── Colour helpers ─────────────────────────────────────────

function persistMappings(field) {
  persistMappings(field);
  emit(EVENTS.FIELD_CHANGED, { field });
}

function contrastColor(hex) {
  if (!hex || hex.length < 7) return '#374151';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Relative luminance
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#374151' : '#ffffff';
}

function defaultColor(index) {
  return PALETTES.vibrant[index % PALETTES.vibrant.length];
}

// ─── Sortable CSS classes ───────────────────────────────────
// Injected once into <head> for drag styling

let styleInjected = false;
function injectDragStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .sortable-drag { opacity: 0.3 !important; filter: grayscale(1) !important; }
    .sortable-ghost {
      opacity: 0 !important;
      height: 2px !important;
      max-height: 2px !important;
      overflow: hidden !important;
      padding: 0 !important;
      margin: 0 !important;
      border: none !important;
      background: #6366f1 !important;
      border-radius: 1px !important;
    }
    .sortable-ghost > * { display: none !important; }
  `;
  document.head.appendChild(style);
}

// ─── Main render ────────────────────────────────────────────

export function render() {
  if (!containerEl || !visible) return;
  clear(containerEl);
  injectDragStyles();

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
    el('span', { class: 'text-[10px] text-gray-400', textContent: 'Drag to reorder \u00b7 Order = plot sort order' }),
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

  // Group sections sortable
  setTimeout(() => {
    if (typeof Sortable === 'undefined') return;
    Sortable.create(sectionsContainer, {
      animation: 150,
      handle: '.group-section-handle',
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
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

  // Sortable setup
  setTimeout(() => {
    if (typeof Sortable === 'undefined') return;

    // Items level: stacks and bare pills within THIS column only
    Sortable.create(itemsContainer, {
      animation: 0,
      group: { name: `items-${column}`, pull: false, put: false },
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      onEnd: () => rebuildMappingsFromDOM(field, column, itemsContainer),
    });

    // Pills within stacks: can move between stacks of SAME column
    for (const pillZone of itemsContainer.querySelectorAll('.stack-pills')) {
      Sortable.create(pillZone, {
        animation: 0,
        group: { name: `pills-${column}`, pull: true, put: true },
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        onAdd: () => rebuildMappingsFromDOM(field, column, itemsContainer),
        onSort: () => rebuildMappingsFromDOM(field, column, itemsContainer),
      });
    }
  }, 50);

  return section;
}

// ─── Stack row ──────────────────────────────────────────────

function renderStackRow(field, column, stack, index) {
  const color = stack.color || defaultColor(index);
  const textColor = contrastColor(color);

  // Wrapper: bg color on the full pill, text inherits
  const row = el('div', {
    class: 'inline-flex items-center gap-1.5 rounded-full pl-3 pr-1.5 py-0.5 group transition-colors',
    dataset: { type: 'stack', stackName: stack.name },
    style: { backgroundColor: color },
  });

  // Hidden color picker (double-click wrapper to open)
  const colorInput = el('input', { type: 'color', class: 'absolute w-0 h-0 opacity-0', value: color });
  colorInput.addEventListener('input', (e) => {
    stack.color = e.target.value;
    row.style.backgroundColor = e.target.value;
    persistMappings(field);
  });
  row.addEventListener('dblclick', (e) => { if (e.target === row) colorInput.click(); });
  row.appendChild(colorInput);

  // ── Normal mode: title text ──
  const titleLabel = el('span', {
    class: 'text-xs font-semibold whitespace-nowrap cursor-default',
    textContent: stack.name,
    style: { color: textColor },
  });

  // ── Edit mode: input + ok + cancel (all before pills) ──
  const editInput = el('input', {
    type: 'text',
    class: 'text-xs font-semibold bg-transparent focus:outline-none border-b hidden',
    value: stack.name,
    style: { color: textColor, borderColor: textColor + '66', width: '5rem' },
  });

  const okBtn = el('button', {
    class: 'w-5 h-5 flex items-center justify-center rounded-full bg-green-500 text-white text-[9px] hover:bg-green-600 transition-colors hidden flex-shrink-0',
    innerHTML: '<i class="fas fa-check"></i>',
  });

  const cancelEditBtn = el('button', {
    class: 'w-5 h-5 flex items-center justify-center rounded-full text-red-400 hover:text-red-600 text-[9px] transition-colors hidden flex-shrink-0',
    innerHTML: '<i class="fas fa-times"></i>',
  });

  function showEdit() {
    titleLabel.classList.add('hidden');
    editInput.classList.remove('hidden');
    okBtn.classList.remove('hidden');
    cancelEditBtn.classList.remove('hidden');
    editInput.value = stack.name;
    requestAnimationFrame(() => { editInput.focus(); editInput.select(); });
  }

  function hideEdit() {
    editInput.classList.add('hidden');
    okBtn.classList.add('hidden');
    cancelEditBtn.classList.add('hidden');
    titleLabel.classList.remove('hidden');
  }

  function commitEdit() {
    const name = editInput.value.trim();
    if (name) {
      stack.name = name;
      titleLabel.textContent = name;
      row.dataset.stackName = name;
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

  // Append: title OR (edit + ok + cancel), then pills, then actions
  row.append(titleLabel, editInput, okBtn, cancelEditBtn);

  // Child pills zone
  const pillZone = el('div', {
    class: 'stack-pills flex flex-wrap gap-1 min-h-[24px]',
    dataset: { column, stackName: stack.name },
  });
  for (const val of stack.values) pillZone.appendChild(makePill(val));
  row.appendChild(pillZone);

  // Right-side hover actions (pen + ×)
  const actions = el('div', {
    class: 'flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0',
  });

  actions.appendChild(el('button', {
    class: 'w-4 h-4 flex items-center justify-center hover:text-indigo-500 transition-all',
    innerHTML: '<i class="fas fa-pen text-[7px]"></i>',
    title: 'Rename',
    style: { color: textColor + '88' },
    onClick: (e) => { e.stopPropagation(); showEdit(); },
  }));

  actions.appendChild(el('button', {
    class: 'w-4 h-4 flex items-center justify-center hover:text-red-400 transition-all',
    innerHTML: '<i class="fas fa-times text-[8px]"></i>',
    title: 'Dissolve',
    style: { color: textColor + '88' },
    onClick: () => {
      const s = currentMappings[column] || [];
      const idx = s.indexOf(stack);
      if (idx !== -1) s.splice(idx, 1);
      persistMappings(field);
      render();
    },
  }));

  row.appendChild(actions);
  return row;
}

// ─── Bare pill ──────────────────────────────────────────────

function renderBarePill(field, column, value) {
  const wrapper = el('div', {
    class: 'group/bare inline-flex items-center gap-0.5',
    dataset: { type: 'bare', column },
  });

  wrapper.appendChild(makePill(value));

  // Pen on hover → create named stack
  wrapper.appendChild(el('button', {
    class: 'w-4 h-4 flex items-center justify-center text-indigo-400 hover:text-indigo-600 opacity-0 group-hover/bare:opacity-100 transition-all flex-shrink-0',
    innerHTML: '<i class="fas fa-pen text-[7px]"></i>',
    title: 'Create named group',
    onClick: (e) => {
      e.stopPropagation();
      const editRow = el('div', {
        class: 'inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-gray-50 pl-0.5 pr-1.5 py-0.5',
      });

      const color = defaultColor((currentMappings[column] || []).length);
      const textColor = contrastColor(color);

      const nameInput = el('input', {
        type: 'text',
        class: 'px-2.5 py-1 text-xs font-semibold rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-300',
        value: value,
        style: { backgroundColor: color, color: textColor, width: '6rem' },
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

  return wrapper;
}

// ─── Pill element ───────────────────────────────────────────

function makePill(value) {
  return el('span', {
    class: 'inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-white border border-gray-200 text-gray-600 cursor-grab hover:border-indigo-300 hover:text-indigo-600 transition-colors select-none whitespace-nowrap',
    textContent: value,
    dataset: { value },
  });
}

// ─── Rebuild from DOM ───────────────────────────────────────

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
