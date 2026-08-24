// Tests for renderer/modules/relative-time.js — the timestamp on a comment.
//
// `now` is a parameter precisely so this can be pinned down without freezing a
// clock, and the boundaries are where it goes wrong: the minute that is not yet
// a minute, the twenty-fifth hour, the point where a distance stops being
// useful and should go back to being a date.
import test from 'node:test';
import assert from 'node:assert';

import { loadEsm } from './helpers/esm.mjs';

const { relativeTime } = await loadEsm('renderer/modules/relative-time.js');

const NOW = Date.parse('2026-08-24T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test('seconds are "just now"', () => {
  assert.strictEqual(relativeTime(ago(0), NOW), 'just now');
  assert.strictEqual(relativeTime(ago(59 * SECOND), NOW), 'just now');
});

test('minutes and hours read singular at one', () => {
  assert.strictEqual(relativeTime(ago(MINUTE), NOW), 'a minute ago');
  assert.strictEqual(relativeTime(ago(2 * MINUTE), NOW), '2 minutes ago');
  assert.strictEqual(relativeTime(ago(59 * MINUTE), NOW), '59 minutes ago');
  assert.strictEqual(relativeTime(ago(HOUR), NOW), 'an hour ago');
  assert.strictEqual(relativeTime(ago(5 * HOUR), NOW), '5 hours ago');
  assert.strictEqual(relativeTime(ago(23 * HOUR), NOW), '23 hours ago');
});

test('a day back is yesterday, and then it counts days', () => {
  assert.strictEqual(relativeTime(ago(DAY), NOW), 'yesterday');
  assert.strictEqual(relativeTime(ago(3 * DAY), NOW), '3 days ago');
  assert.strictEqual(relativeTime(ago(29 * DAY), NOW), '29 days ago');
});

// Past a month the distance stops being a fact anyone wants: nobody converts
// "417 days ago" back into a date in their head.
test('beyond a month it becomes a date again', () => {
  assert.strictEqual(relativeTime(ago(31 * DAY), NOW), 'on 24 Jul');
});

test('a different year says which year', () => {
  assert.strictEqual(relativeTime('2024-03-09T12:00:00Z', NOW), 'on 9 Mar 2024');
});

// The server's clock and this machine's need not agree, and a comment written
// "in 3 seconds" is a worse answer than a slightly early "just now".
test('a timestamp slightly in the future does not count forwards', () => {
  assert.strictEqual(relativeTime(new Date(NOW + 4 * SECOND).toISOString(), NOW), 'just now');
});

test('nothing, or nonsense, renders as nothing', () => {
  assert.strictEqual(relativeTime(null, NOW), '');
  assert.strictEqual(relativeTime('', NOW), '');
  assert.strictEqual(relativeTime('not a date', NOW), '');
});
