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
