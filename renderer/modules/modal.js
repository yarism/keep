import { $ } from './state.js';

export function showModal(title, placeholder, defaultValue = '', { allowEmpty = false } = {}) {
  return new Promise(resolve => {
    const overlay = $('#modal-overlay');
    const input = $('#modal-input');
    $('#modal-title').textContent = title;
    input.placeholder = placeholder || '';
    input.value = defaultValue;
    input.style.display = '';
    overlay.hidden = false;
    input.focus();
    input.select();
    function cleanup() { overlay.hidden = true; $('#modal-ok').removeEventListener('click', onOk); $('#modal-cancel').removeEventListener('click', onCancel); input.removeEventListener('keydown', onKey); }
    function onOk() { cleanup(); resolve(allowEmpty ? (input.value.trim()) : (input.value.trim() || null)); }
    function onCancel() { cleanup(); resolve(null); }
    function onKey(e) { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); }
    $('#modal-ok').addEventListener('click', onOk);
    $('#modal-cancel').addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

export function showConfirm(title, message) {
  return new Promise(resolve => {
    const overlay = $('#modal-overlay');
    const input = $('#modal-input');
    const titleEl = $('#modal-title');
    titleEl.textContent = title;
    // Hide the input and show a message instead
    input.style.display = 'none';
    let msgEl = overlay.querySelector('.modal-message');
    if (!msgEl) {
      msgEl = document.createElement('div');
      msgEl.className = 'modal-message';
      input.parentNode.insertBefore(msgEl, input);
    }
    msgEl.textContent = message;
    msgEl.style.display = '';
    overlay.hidden = false;
    function cleanup() {
      overlay.hidden = true;
      input.style.display = '';
      msgEl.style.display = 'none';
      $('#modal-ok').removeEventListener('click', onOk);
      $('#modal-cancel').removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
    }
    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }
    function onKey(e) { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); }
    $('#modal-ok').addEventListener('click', onOk);
    $('#modal-cancel').addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

// A picker built from the same modal chrome as showModal: the text input is
// swapped for a <select> so callers that already know every valid answer do
// not have to ask for one to be typed correctly. Options are
// { value, label, group? }; entries sharing a group land under one optgroup,
// in the order the groups first appear. Resolves to the chosen value, or null.
export function showSelect(title, options, { defaultValue = null } = {}) {
  return new Promise(resolve => {
    const overlay = $('#modal-overlay');
    const input = $('#modal-input');
    $('#modal-title').textContent = title;

    const select = document.createElement('select');
    select.className = 'modal-input modal-select';
    const groups = new Map();
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (!o.group) { select.appendChild(opt); return; }
      let g = groups.get(o.group);
      if (!g) {
        g = document.createElement('optgroup');
        g.label = o.group;
        groups.set(o.group, g);
        select.appendChild(g);
      }
      g.appendChild(opt);
    });
    if (defaultValue !== null && options.some(o => o.value === defaultValue)) {
      select.value = defaultValue;
    }

    input.style.display = 'none';
    input.parentNode.insertBefore(select, input);
    overlay.hidden = false;
    select.focus();

    function cleanup() {
      overlay.hidden = true;
      select.remove();
      input.style.display = '';
      $('#modal-ok').removeEventListener('click', onOk);
      $('#modal-cancel').removeEventListener('click', onCancel);
      select.removeEventListener('keydown', onKey);
    }
    function onOk() { const v = select.value; cleanup(); resolve(v === '' ? null : v); }
    function onCancel() { cleanup(); resolve(null); }
    function onKey(e) { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); }
    $('#modal-ok').addEventListener('click', onOk);
    $('#modal-cancel').addEventListener('click', onCancel);
    select.addEventListener('keydown', onKey);
  });
}
