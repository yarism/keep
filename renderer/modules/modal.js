import { $ } from './state.js';

export function showModal(title, placeholder, defaultValue = '') {
  return new Promise(resolve => {
    const overlay = $('#modal-overlay');
    const input = $('#modal-input');
    $('#modal-title').textContent = title;
    input.placeholder = placeholder || '';
    input.value = defaultValue;
    overlay.hidden = false;
    input.focus();
    input.select();
    function cleanup() { overlay.hidden = true; $('#modal-ok').removeEventListener('click', onOk); $('#modal-cancel').removeEventListener('click', onCancel); input.removeEventListener('keydown', onKey); }
    function onOk() { cleanup(); resolve(input.value.trim() || null); }
    function onCancel() { cleanup(); resolve(null); }
    function onKey(e) { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); }
    $('#modal-ok').addEventListener('click', onOk);
    $('#modal-cancel').addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}
