// Save format: round-trip, schema rejection, quota behavior, and the settings /
// history side tables. A fake Storage proves the real code paths without a DOM.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_KEY,
  SETTINGS_KEY,
  HISTORY_KEY,
  appendHistory,
  clearSave,
  decodeSave,
  defaultSettings,
  encodeSave,
  readHistory,
  readSave,
  readSettings,
  writeSave,
  writeSettings,
} from '../../src/core/save.ts';
import { createNewGame, SAVE_VERSION } from '../../src/core/game.ts';

class FakeStorage {
  map = new Map();
  failNext = false;
  /** Total byte budget across every key, mimicking a real origin quota. */
  quotaAt: number | null = null;
  writes = 0;

  private used(): number {
    let total = 0;
    for (const [key, value] of this.map) total += key.length + value.length;
    return total;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes += 1;
    if (this.failNext) {
      this.failNext = false;
      throw new Error('QuotaExceededError');
    }
    if (this.quotaAt !== null) {
      const usedWithoutKey = this.used() - (this.map.get(key)?.length ?? 0) - (this.map.has(key) ? key.length : 0);
      if (usedWithoutKey + key.length + value.length > this.quotaAt) {
        throw new Error('QuotaExceededError');
      }
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;
});

const NOW = 1_700_000_100_000;

test('encode → decode preserves game and settings exactly', () => {
  const game = createNewGame('medium', 555, NOW);
  const settings = { ...defaultSettings(), theme: 'oled' as const, particles: false };
  const raw = encodeSave(game, settings);
  const decoded = decodeSave(raw);
  assert.ok(decoded);
  assert.equal(decoded.schema, 'pocket-galaxy');
  assert.equal(decoded.version, SAVE_VERSION);
  assert.deepEqual(decoded.state.galaxy.bodies, game.galaxy.bodies);
  assert.equal(decoded.state.galaxy.seed, 555);
  assert.equal(decoded.settings.theme, 'oled');
  assert.equal(decoded.settings.particles, false);
  assert.ok(decoded.savedAt > 0);
});

test('decode rejects corrupt, foreign, and future envelopes', () => {
  assert.equal(decodeSave('not json'), null);
  assert.equal(decodeSave('[]'), null);
  assert.equal(decodeSave('null'), null);
  assert.equal(decodeSave(JSON.stringify({ schema: 'other', version: 1 })), null);
  const game = createNewGame('small', 1, NOW);
  const good = JSON.parse(encodeSave(game, defaultSettings()));
  assert.equal(decodeSave(JSON.stringify({ ...good, version: SAVE_VERSION + 5 })), null);
  assert.equal(decodeSave(JSON.stringify({ ...good, state: { ...good.state, galaxy: null } })), null);
  assert.equal(
    decodeSave(JSON.stringify({ ...good, state: { ...good.state, resources: { energy: -5, mineral: 0, science: 0 } } })),
    null,
  );
  assert.equal(decodeSave(JSON.stringify({ ...good, state: { ...good.state, hull: 900 } })), null);
});

test('missing settings fall back to defaults instead of failing the whole save', () => {
  const game = createNewGame('small', 2, NOW);
  const envelope = JSON.parse(encodeSave(game, defaultSettings()));
  delete envelope.settings;
  const decoded = decodeSave(JSON.stringify(envelope));
  assert.ok(decoded);
  assert.equal(decoded.settings.theme, defaultSettings().theme);
  assert.equal(typeof decoded.settings.gamepadMap.confirm, 'number');
});

test('writeSave reports saved bytes and readSave round-trips through storage', () => {
  const game = createNewGame('medium', 3, NOW);
  const outcome = writeSave(game, defaultSettings());
  assert.equal(outcome.status, 'saved');
  assert.ok(outcome.bytes > 1000);
  const loaded = readSave();
  assert.ok(loaded);
  assert.equal(loaded.state.galaxy.seed, 3);
  assert.ok(storage.getItem(SAVE_KEY)?.startsWith('{"schema"'));
});

test('quota exhaustion is reported, and dropping history recovers', () => {
  const game = createNewGame('medium', 4, NOW);
  appendHistory({ at: 1, score: 10, fps: 60, bodies: 100 });
  // Budget fits the save plus the current history, but not the grown history.
  storage.quotaAt = encodeSave(game, defaultSettings()).length + SAVE_KEY.length + 20;
  const recovered = writeSave(game, defaultSettings());
  assert.equal(recovered.status, 'saved', 'dropping history should rescue the write');
  assert.equal(storage.getItem(HISTORY_KEY), null, 'history is sacrificed for the save');
  assert.ok(storage.getItem(SAVE_KEY));

  // Fresh budget that fits the storage probe but not the save payload itself.
  storage.map.clear();
  storage.quotaAt = 200;
  const hardFail = writeSave(game, defaultSettings());
  assert.equal(hardFail.status, 'quota');
});

test('unavailable storage degrades to a status instead of throwing', () => {
  (globalThis as { localStorage?: unknown }).localStorage = undefined;
  const game = createNewGame('small', 5, NOW);
  const outcome = writeSave(game, defaultSettings());
  assert.equal(outcome.status, 'unavailable');
  assert.equal(readSave(), null);
  assert.deepEqual(readSettings(), defaultSettings());
  assert.deepEqual(readHistory(), []);
});

test('settings and history persist independently of the save', () => {
  const settings = { ...defaultSettings(), premium: undefined };
  settings.theme = 'light';
  assert.equal(writeSettings(settings), true);
  assert.equal(readSettings().theme, 'light');
  assert.equal(JSON.parse(storage.getItem(SETTINGS_KEY)!).theme, 'light');

  for (let index = 0; index < 25; index++) {
    appendHistory({ at: index, score: index, fps: 60, bodies: index });
  }
  const history = readHistory();
  assert.equal(history.length, 20, 'history is capped at 20 entries');
  assert.equal(history.at(-1)?.at, 24);
});

test('corrupt settings JSON falls back to defaults', () => {
  storage.setItem(SETTINGS_KEY, '{not json');
  assert.deepEqual(readSettings(), defaultSettings());
});

test('clearSave removes only the save key', () => {
  writeSave(createNewGame('small', 6, NOW), defaultSettings());
  storage.setItem(SETTINGS_KEY, '{"theme":"light"}');
  clearSave();
  assert.equal(storage.getItem(SAVE_KEY), null);
  assert.ok(storage.getItem(SETTINGS_KEY));
});
