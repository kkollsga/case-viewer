// utils/dom.js — Shared DOM helpers

/**
 * Create an element with attributes and children.
 * @param {string} tag
 * @param {Object} attrs - { class, id, textContent, innerHTML, ... }
 * @param {Array} children - child elements
 */
export function el(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class' || key === 'className') {
      element.className = value;
    } else if (key === 'textContent') {
      element.textContent = value;
    } else if (key === 'innerHTML') {
      element.innerHTML = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(element.dataset, value);
    } else {
      element.setAttribute(key, value);
    }
  }

  for (const child of children) {
    if (typeof child === 'string') {
      element.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      element.appendChild(child);
    }
  }

  return element;
}

/**
 * Create a Tailwind toggle switch.
 * @param {string} id
 * @param {string} label
 * @param {boolean} checked
 * @param {function} onChange
 */
export function createToggle(id, label, checked, onChange) {
  const container = el('label', {
    class: 'inline-flex items-center cursor-pointer text-sm text-gray-700',
  });

  const input = el('input', {
    type: 'checkbox',
    id,
    class: 'sr-only peer',
  });
  input.checked = checked;
  input.addEventListener('change', (e) => onChange(e.target.checked));

  const slider = el('div', {
    class: 'relative w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-gray-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500',
  });

  const labelSpan = el('span', { class: 'ml-2', textContent: label });

  container.append(input, slider, labelSpan);
  return container;
}

/**
 * Show an element (remove 'hidden' class).
 */
export function show(element) {
  if (element) element.classList.remove('hidden');
}

/**
 * Hide an element (add 'hidden' class).
 */
export function hide(element) {
  if (element) element.classList.add('hidden');
}

/**
 * Toggle an element's visibility.
 */
export function toggle(element) {
  if (element) element.classList.toggle('hidden');
}

/**
 * Clear all children of an element.
 */
export function clear(element) {
  if (element) element.innerHTML = '';
}

/**
 * Query selector shorthand.
 */
export function $(selector, parent = document) {
  return parent.querySelector(selector);
}

/**
 * Query selector all shorthand.
 */
export function $$(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}
