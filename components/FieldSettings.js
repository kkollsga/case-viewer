// components/FieldSettings.js — Field-level group name standardization
// All drag via Sortable.js. Drop indicator = vertical indigo line.

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
export function hide() { visible = false; if (containerEl) clear(containerEl); }
export function setupEvents() {}

function persistMappings(field) { saveGroupMappings(field, currentMappings); }

function contrastColor(hex) {
  if (!hex || hex.length < 7) return '#374151';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#374151' : '#ffffff';
}
function defaultColor(i) { return PALETTES.vibrant[i % PALETTES.vibrant.length]; }

// ─── Styles ─────────────────────────────────────────────────
let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .fs-ghost { width: 2px !important; height: 28px !important; min-height: 28px !important;
      background: #4338ca !important; border-radius: 1px !important; padding: 0 !important;
      margin: 0 2px !important; opacity: 1 !important; overflow: hidden !important;
      border: none !important; box-shadow: 0 0 4px rgba(67,56,202,0.4) !important; }
    .fs-ghost > * { display: none !important; }
    .fs-drag { opacity: 0.3 !important; filter: grayscale(1) !important; }
    .fs-stack-highlight { outline: 2px solid #4338ca !important; outline-offset: 1px !important; }
  `;
  document.head.appendChild(s);
}

// ─── Render ─────────────────────────────────────────────────
export function render() {
  if (!containerEl || !visible) return;
  clear(containerEl);
  injectStyles();

  const field = getActiveField();
  if (!field) return;
  currentMappings = loadGroupMappings(field);
  allUniqueValues = collectUniqueGroupValues(field);

  if (Object.keys(allUniqueValues).length === 0) {
    containerEl.appendChild(el('div', { class: 'text-xs text-gray-400 py-4 text-center', textContent: 'No group values found. Import cases first.' }));
    return;
  }

  const wrapper = el('div', { class: 'bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-5' });
  wrapper.appendChild(el('div', { class: 'flex items-center justify-between' }, [
    el('span', { class: 'text-xs font-semibold text-gray-600 uppercase tracking-wider', textContent: 'Group Standardization' }),
    el('span', { class: 'text-[10px] text-gray-400', textContent: 'Drag pills to stack \u00b7 Drag to reorder' }),
  ]));

  const groupOrder = currentMappings.__groupOrder || Object.keys(allUniqueValues);
  const allCols = Object.keys(allUniqueValues);
  const orderedCols = [...groupOrder.filter(c => allCols.includes(c)), ...allCols.filter(c => !groupOrder.includes(c))];

  const sectionsContainer = el('div', { class: 'space-y-4', id: 'group-sections-container' });
  for (const column of orderedCols) sectionsContainer.appendChild(renderGroupSection(field, column));
  wrapper.appendChild(sectionsContainer);
  containerEl.appendChild(wrapper);

  setTimeout(() => {
    if (typeof Sortable === 'undefined') return;
    Sortable.create(sectionsContainer, {
      animation: 150, handle: '.group-section-handle', ghostClass: 'opacity-30',
      onEnd: () => { currentMappings.__groupOrder = Array.from(sectionsContainer.children).map(s => s.dataset.column); persistMappings(field); },
    });
  }, 50);
}

// ─── Group section ──────────────────────────────────────────
function renderGroupSection(field, column) {
  const uniqueValues = allUniqueValues[column] || [];
  const section = el('div', { class: 'space-y-1.5', dataset: { column } });

  const header = el('div', { class: 'group-section-handle flex items-center gap-2 cursor-grab py-1' });
  header.append(
    el('i', { class: 'fas fa-grip-vertical text-[10px] text-gray-300' }),
    el('span', { class: 'text-xs font-medium text-gray-500 uppercase tracking-wider', textContent: column }),
    el('span', { class: 'text-[10px] text-gray-300', textContent: `${uniqueValues.length}` }),
  );
  section.appendChild(header);

  // All items in one flat sortable container
  const items = el('div', { class: 'flex flex-wrap gap-1.5 items-center fs-items', dataset: { column } });

  const stacks = currentMappings[column] || [];
  const assigned = new Set();
  for (const st of stacks) for (const v of st.values) assigned.add(v);

  // Render stacks
  for (let i = 0; i < stacks.length; i++) items.appendChild(renderStack(field, column, stacks[i], i));
  // Render unassigned bare pills
  for (const val of uniqueValues.filter(v => !assigned.has(v))) items.appendChild(renderPillItem(val));

  section.appendChild(items);

  // Sortable: all items (stacks + pills) sortable within this column
  // When a pill is dropped ON another pill, detect adjacency and create stack
  setTimeout(() => {
    if (typeof Sortable === 'undefined') return;
    Sortable.create(items, {
      animation: 0,
      group: { name: `col-${column}`, pull: false, put: false },
      ghostClass: 'fs-ghost',
      dragClass: 'fs-drag',
      onEnd: (evt) => {
        const dragEl = evt.item;
        const related = evt.items; // not used in single mode

        // Check if dropped directly on another pill (within ~5px overlap)
        const dragRect = dragEl.getBoundingClientRect();
        let droppedOn = null;
        for (const child of items.children) {
          if (child === dragEl) continue;
          const r = child.getBoundingClientRect();
          const overlapX = Math.max(0, Math.min(dragRect.right, r.right) - Math.max(dragRect.left, r.left));
          const overlapY = Math.max(0, Math.min(dragRect.bottom, r.bottom) - Math.max(dragRect.top, r.top));
          if (overlapX > r.width * 0.3 && overlapY > r.height * 0.3) {
            droppedOn = child;
            break;
          }
        }

        if (droppedOn && dragEl.dataset.fsType === 'pill' && droppedOn.dataset.fsType === 'pill') {
          // Pill dropped on pill → create stack
          const dragVal = dragEl.dataset.value;
          const targetVal = droppedOn.dataset.value;
          removeFromStacks(column, dragVal);
          removeFromStacks(column, targetVal);
          if (!currentMappings[column]) currentMappings[column] = [];
          currentMappings[column].push({ name: targetVal, values: [targetVal, dragVal] });
          persistMappings(field);
          render();
        } else if (droppedOn && dragEl.dataset.fsType === 'pill' && droppedOn.dataset.fsType === 'stack') {
          // Pill dropped on stack → add to stack
          const dragVal = dragEl.dataset.value;
          removeFromStacks(column, dragVal);
          const stackName = droppedOn.dataset.stackName;
          const stack = (currentMappings[column] || []).find(s => s.name === stackName);
          if (stack && !stack.values.includes(dragVal)) stack.values.push(dragVal);
          persistMappings(field);
          render();
        } else {
          // Normal reorder
          rebuildFromDOM(field, column, items);
        }
      },
    });
  }, 50);

  return section;
}

// ─── Pill item (bare, top-level) ────────────────────────────
function renderPillItem(value) {
  const item = el('div', {
    class: 'inline-flex items-center gap-0.5 group/pill',
    dataset: { fsType: 'pill', value },
  });
  item.appendChild(el('span', {
    class: 'inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-white border border-gray-200 text-gray-600 cursor-grab hover:border-indigo-300 hover:text-indigo-600 transition-colors select-none whitespace-nowrap',
    textContent: value,
  }));
  // Pen icon on hover → create named stack from this pill
  item.appendChild(el('button', {
    class: 'w-4 h-4 flex items-center justify-center text-indigo-400 hover:text-indigo-600 opacity-0 group-hover/pill:opacity-100 transition-all flex-shrink-0',
    innerHTML: '<i class="fas fa-pen text-[7px]"></i>',
    onClick: (e) => {
      e.stopPropagation();
      const field = getActiveField();
      const column = item.closest('.fs-items')?.dataset.column;
      if (!field || !column) return;
      // Create stack with this value, default name = value
      if (!currentMappings[column]) currentMappings[column] = [];
      const color = defaultColor(currentMappings[column].length);
      currentMappings[column].push({ name: value, color, values: [value] });
      persistMappings(field);
      render();
    },
  }));
  return item;
}

// ─── Stack (wrapper pill) ───────────────────────────────────
function renderStack(field, column, stack, index) {
  const color = stack.color || defaultColor(index);
  const tc = contrastColor(color);

  // Outer: relative for floating actions
  const outer = el('div', {
    class: 'relative inline-flex group',
    dataset: { fsType: 'stack', stackName: stack.name, value: stack.values.join(',') },
  });

  // Floating actions (above top-right)
  const actions = el('div', { class: 'absolute -top-3 -right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all z-10' });
  actions.append(
    el('button', {
      class: 'w-4 h-4 flex items-center justify-center rounded-full bg-white border border-gray-200 text-indigo-400 hover:text-indigo-600 shadow-sm',
      innerHTML: '<i class="fas fa-pen text-[6px]"></i>',
      onClick: (e) => { e.stopPropagation(); showEdit(); },
    }),
    el('button', {
      class: 'w-4 h-4 flex items-center justify-center rounded-full bg-white border border-gray-200 text-red-300 hover:text-red-500 shadow-sm',
      innerHTML: '<i class="fas fa-times text-[6px]"></i>',
      onClick: () => {
        const s = currentMappings[column] || [];
        const idx = s.indexOf(stack);
        if (idx !== -1) s.splice(idx, 1);
        persistMappings(field); render();
      },
    }),
  );
  outer.appendChild(actions);

  // The colored row
  const row = el('div', {
    class: 'inline-flex items-center gap-1.5 rounded-full pl-3 pr-2 py-0.5',
    style: { backgroundColor: color },
  });

  // Color picker on double-click
  const colorInput = el('input', { type: 'color', class: 'absolute w-0 h-0 opacity-0', value: color });
  colorInput.addEventListener('input', (e) => { stack.color = e.target.value; row.style.backgroundColor = e.target.value; persistMappings(field); });
  row.addEventListener('dblclick', (e) => { if (e.target === row) colorInput.click(); });
  row.appendChild(colorInput);

  // Title label
  const titleLabel = el('span', { class: 'text-xs font-semibold whitespace-nowrap', textContent: stack.name, style: { color: tc } });

  // Edit input — same style as title: no bg, no border, same font/size/color
  const editInput = el('input', {
    type: 'text',
    class: 'text-xs font-semibold bg-transparent border-0 focus:outline-none hidden whitespace-nowrap',
    value: stack.name,
    style: { color: tc, width: Math.max(3, stack.name.length * 0.6) + 'rem', caretColor: tc },
  });
  const okBtn = el('button', { class: 'w-4 h-4 flex items-center justify-center rounded-full bg-green-500 text-white text-[7px] hover:bg-green-600 hidden flex-shrink-0', innerHTML: '<i class="fas fa-check"></i>' });
  const cancelBtn = el('button', { class: 'w-4 h-4 flex items-center justify-center rounded-full bg-white text-red-400 hover:text-red-600 text-[7px] hidden flex-shrink-0', innerHTML: '<i class="fas fa-times"></i>' });

  function showEdit() {
    titleLabel.classList.add('hidden'); actions.classList.add('hidden');
    editInput.classList.remove('hidden'); okBtn.classList.remove('hidden'); cancelBtn.classList.remove('hidden');
    editInput.value = stack.name;
    editInput.style.width = Math.max(3, stack.name.length * 0.6) + 'rem';
    requestAnimationFrame(() => { editInput.focus(); editInput.select(); });
  }
  function hideEdit() {
    editInput.classList.add('hidden'); okBtn.classList.add('hidden'); cancelBtn.classList.add('hidden');
    titleLabel.classList.remove('hidden'); actions.classList.remove('hidden');
  }
  function commitEdit() {
    const name = editInput.value.trim();
    if (name) { stack.name = name; titleLabel.textContent = name; outer.dataset.stackName = name; persistMappings(field); }
    hideEdit();
  }
  okBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); commitEdit(); });
  cancelBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); hideEdit(); });
  editInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } if (e.key === 'Escape') hideEdit(); });
  editInput.addEventListener('input', () => { editInput.style.width = Math.max(3, editInput.value.length * 0.6) + 'rem'; });

  row.append(titleLabel, editInput, okBtn, cancelBtn);

  // Child pills (inside the colored wrapper)
  for (const val of stack.values) {
    row.appendChild(el('span', {
      class: 'inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-white/90 text-gray-600 whitespace-nowrap',
      textContent: val,
      dataset: { value: val },
    }));
  }

  outer.appendChild(row);
  return outer;
}

// ─── Helpers ────────────────────────────────────────────────

function removeFromStacks(column, value) {
  const stacks = currentMappings[column] || [];
  for (let i = stacks.length - 1; i >= 0; i--) {
    const idx = stacks[i].values.indexOf(value);
    if (idx !== -1) { stacks[i].values.splice(idx, 1); if (stacks[i].values.length === 0) stacks.splice(i, 1); }
  }
}

function rebuildFromDOM(field, column, container) {
  const newStacks = [];
  for (const child of container.children) {
    if (child.dataset.fsType === 'stack') {
      const pills = Array.from(child.querySelectorAll('[data-value]')).map(p => p.dataset.value);
      if (pills.length === 0) continue;
      const name = child.dataset.stackName;
      const existing = (currentMappings[column] || []).find(s => s.name === name);
      newStacks.push({ name: existing?.name || pills[0], color: existing?.color, values: pills });
    }
  }
  currentMappings[column] = newStacks;
  persistMappings(field);
}
