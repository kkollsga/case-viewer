// components/FieldManager.js — Field CRUD modal

import { getState, addField, renameField, deleteField, getFields } from '../core/state.js';
import { saveFields, deleteFieldData, renameFieldData } from '../core/storage.js';
// events.js removed
import { el, clear } from '../utils/dom.js';

let modalEl = null;

export function init() {
  modalEl = document.getElementById('manage-fields-modal');
}

export function show() {
  render();
  document.getElementById('modal-overlay').classList.remove('hidden');
  modalEl.classList.remove('hidden');
}

function hide() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalEl.classList.add('hidden');
}

function render() {
  const fieldList = modalEl.querySelector('#field-list');
  clear(fieldList);

  for (const field of getFields()) {
    const item = el('li', {
      class: 'flex justify-between items-center p-3 hover:bg-gray-100',
    }, [
      el('span', { textContent: field }),
      el('div', { class: 'flex space-x-2' }, [
        el('button', {
          class: 'text-blue-600 hover:text-blue-800',
          innerHTML: '<i class="fas fa-edit"></i>',
          onClick: () => {
            const newName = prompt('Enter new field name:', field);
            if (newName && newName.trim() !== '' && newName.trim() !== field) {
              if (renameField(field, newName.trim())) {
                renameFieldData(field, newName.trim());
                saveFields(getFields());
                render();
              } else {
                alert(`Field "${newName.trim()}" already exists.`);
              }
            }
          },
        }),
        el('button', {
          class: 'text-red-600 hover:text-red-800',
          innerHTML: '<i class="fas fa-trash"></i>',
          onClick: () => {
            if (confirm(`Delete field "${field}" and all its cases?`)) {
              deleteFieldData(field);
              deleteField(field);
              saveFields(getFields());
              render();
            }
          },
        }),
      ]),
    ]);
    fieldList.appendChild(item);
  }
}

export function setupEvents() {
  modalEl.querySelector('#add-field-btn').addEventListener('click', () => {
    const input = modalEl.querySelector('#new-field-name');
    const name = input.value.trim();
    if (!name) return;
    if (addField(name)) {
      saveFields(getFields());
      input.value = '';
      render();
    } else {
      alert(`Field "${name}" already exists.`);
    }
  });

  modalEl.querySelector('#close-manage-fields').addEventListener('click', hide);
}
