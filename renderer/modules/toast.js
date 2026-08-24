// Transient status messages, bottom right.
//
// Fetch, pull and push can take seconds and often print nothing on success, so
// without this the buttons looked inert — no way to tell a finished fetch from
// a click that missed.

import { $, escapeHtml } from './state.js';
import { icon } from '../icons.js';

const SUCCESS_MS = 4500;
const ERROR_MS = 12000;

function container() {
  return $('#toasts');
}

function build(type, message) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <span class="toast-icon">${type === 'busy' ? '<span class="spinner"></span>' : icon(type === 'success' ? 'check' : 'alert', 15)}</span>
    <span class="toast-text">${escapeHtml(message)}</span>
  `;
  el.addEventListener('click', () => dismiss(el));
  return el;
}

function dismiss(el) {
  if (!el || el.dataset.leaving) return;
  el.dataset.leaving = '1';
  el.classList.add('leaving');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  // A dropped transitionend must not leave the toast on screen forever.
  setTimeout(() => el.remove(), 400);
}

// `prose` is for messages Keep wrote itself rather than relayed from git — the
// monospace default is there to keep git's own formatting, and a sentence in it
// reads as a leak of something internal.
export function toast(message, { type = 'success', prose = false } = {}) {
  const host = container();
  if (!host) return { dismiss() {} };
  const el = build(type, message);
  if (prose) el.classList.add('toast-prose');
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('shown'));
  const life = type === 'error' ? ERROR_MS : SUCCESS_MS;
  const timer = setTimeout(() => dismiss(el), life);
  return { dismiss() { clearTimeout(timer); dismiss(el); } };
}

// A toast that stays up while something runs, then becomes its own result —
// the message swaps in place rather than stacking a second card underneath.
export function busyToast(message) {
  const host = container();
  if (!host) return { done() {}, fail() {}, dismiss() {} };
  const el = build('busy', message);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('shown'));

  function settle(type, text, life) {
    el.className = `toast toast-${type} shown`;
    el.querySelector('.toast-icon').innerHTML = icon(type === 'success' ? 'check' : 'alert', 15);
    el.querySelector('.toast-text').textContent = text;
    setTimeout(() => dismiss(el), life);
  }

  return {
    done: (text) => settle('success', text, SUCCESS_MS),
    fail: (text) => settle('error', text, ERROR_MS),
    dismiss: () => dismiss(el),
  };
}
