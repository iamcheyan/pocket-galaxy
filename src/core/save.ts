// Persistence. Two-tier: localStorage (sync, small) with an IndexedDB mirror
// (async, larger histories). Both are optional so Node tests and the benchmark
// harness can run without a browser storage global.

import { SAVE_VERSION } from './game.ts';
import { catalogCode } from './galaxy.ts';
import type { GameState, SaveEnvelope, Settings } from './types.ts';

export const SAVE_KEY = 'pocket-galaxy.save.v3';
export const SETTINGS_KEY = 'pocket-galaxy.settings.v1';
export const HISTORY_KEY = 'pocket-galaxy.history.v1';
const DB_NAME = 'pocket-galaxy';
const DB_STORE = 'saves';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  layout: 'auto',
  quality: 'auto',
  animations: true,
  particles: true,
  showPerf: false,
  gamepadMap: {
    confirm: 0,
    back: 1,
    scan: 2,
    details: 3,
    zoomIn: 5,
    zoomOut: 4,
    pause: 9,
    perf: 8,
  },
  audio: false,
};

export function defaultSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    gamepadMap: { ...DEFAULT_SETTINGS.gamepadMap },
  };
}

/**
 * Resolves localStorage, distinguishing "there is no storage" from "storage is
 * full". The old write-probe conflated the two: once the quota filled, the probe
 * itself threw and every subsequent save reported `unavailable`, silently
 * hiding a quota problem that the player needs to know about.
 */
function browserStorage(): { storage: StorageLike | null; blockedWrite: boolean } {
  let candidate: Storage | undefined;
  try {
    candidate = globalThis.localStorage;
  } catch {
    // Access itself throws when storage is blocked by policy.
    return { storage: null, blockedWrite: false };
  }
  if (!candidate) return { storage: null, blockedWrite: false };
  try {
    const probe = '__pocket_galaxy_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return { storage: candidate, blockedWrite: false };
  } catch {
    // Present and readable, but at capacity (or write-blocked in private mode).
    return { storage: candidate, blockedWrite: true };
  }
}

export function encodeSave(state: GameState, settings: Settings): string {
  const envelope: SaveEnvelope = {
    schema: 'pocket-galaxy',
    version: SAVE_VERSION,
    savedAt: Date.now(),
    state,
    settings,
  };
  return JSON.stringify(envelope);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validates a decoded envelope. Rejects rather than silently repairing, so a
 * corrupt save cannot masquerade as progress.
 */
export function decodeSave(raw: string): SaveEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const envelope = parsed as Partial<SaveEnvelope>;
  if (envelope.schema !== 'pocket-galaxy') return null;
  if (!isFiniteNumber(envelope.version) || envelope.version > SAVE_VERSION) return null;
  const state = envelope.state as Partial<GameState> | undefined;
  if (!state || !state.galaxy || !Array.isArray(state.galaxy.bodies)) return null;
  if (!state.resources || !state.upgrades || !state.stats) return null;
  for (const key of ['energy', 'mineral', 'science'] as const) {
    if (!isFiniteNumber(state.resources[key]) || state.resources[key] < 0) return null;
  }
  if (!isFiniteNumber(state.hull) || state.hull < 0 || state.hull > 100) return null;
  const settings = { ...defaultSettings(), ...(envelope.settings ?? {}) };
  const migrated = migrateState(state as GameState, envelope.version ?? SAVE_VERSION);
  return { ...(envelope as SaveEnvelope), version: SAVE_VERSION, state: migrated, settings };
}

/**
 * Upgrades an older envelope to the current schema. Only additive changes are
 * migrated; anything that would require guessing is rejected by the validator
 * above instead.
 */
function migrateState(state: GameState, version: number): GameState {
  if (version >= 4) return state;
  // v4 added unique catalog designations to every body.
  const used = new Set<string>();
  const bodies = state.galaxy.bodies.map((body) => {
    if (body.catalog) {
      used.add(body.catalog);
      return body;
    }
    let catalog = catalogCode(body.seed);
    for (let attempt = 1; used.has(catalog); attempt++) catalog = catalogCode(body.seed, attempt);
    used.add(catalog);
    return { ...body, catalog };
  });
  return { ...state, version: SAVE_VERSION, galaxy: { ...state.galaxy, bodies } };
}

export type SaveStatus = 'saved' | 'quota' | 'unavailable';

export interface SaveOutcome {
  status: SaveStatus;
  bytes: number;
  at: number;
}

export function writeSave(state: GameState, settings: Settings): SaveOutcome {
  const payload = encodeSave(state, settings);
  const { storage } = browserStorage();
  if (!storage) return { status: 'unavailable', bytes: 0, at: Date.now() };
  try {
    storage.setItem(SAVE_KEY, payload);
    return { status: 'saved', bytes: payload.length, at: Date.now() };
  } catch {
    // Out of space: sacrifice the history mirror, then retry.
    try {
      storage.removeItem(HISTORY_KEY);
      storage.setItem(SAVE_KEY, payload);
      return { status: 'saved', bytes: payload.length, at: Date.now() };
    } catch {
      return { status: 'quota', bytes: payload.length, at: Date.now() };
    }
  }
}

export function readSave(): SaveEnvelope | null {
  const { storage } = browserStorage();
  if (!storage) return null;
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return null;
  return decodeSave(raw);
}

export function clearSave(): void {
  const { storage } = browserStorage();
  storage?.removeItem(SAVE_KEY);
}

export function readSettings(): Settings {
  const { storage } = browserStorage();
  if (!storage) return defaultSettings();
  const raw = storage.getItem(SETTINGS_KEY);
  if (!raw) return defaultSettings();
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...defaultSettings(), ...parsed, gamepadMap: { ...defaultSettings().gamepadMap, ...(parsed.gamepadMap ?? {}) } };
  } catch {
    return defaultSettings();
  }
}

export function writeSettings(settings: Settings): boolean {
  const { storage } = browserStorage();
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export interface HistoryEntry {
  at: number;
  score: number;
  fps: number;
  bodies: number;
}

export function readHistory(): HistoryEntry[] {
  const { storage } = browserStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(HISTORY_KEY) ?? '[]') as HistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(-20) : [];
  } catch {
    return [];
  }
}

export function appendHistory(entry: HistoryEntry): void {
  const { storage } = browserStorage();
  if (!storage) return;
  const history = [...readHistory(), entry].slice(-20);
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* history is best-effort; the save itself already succeeded */
  }
}

/* ------------------------------- IndexedDB ------------------------------- */

function openDb(): Promise<IDBDatabase | null> {
  if (typeof globalThis.indexedDB === 'undefined') return Promise.resolve(null);
  const { promise, resolve } = Promise.withResolvers<IDBDatabase | null>();
  let request: IDBOpenDBRequest;
  try {
    request = globalThis.indexedDB.open(DB_NAME, 1);
  } catch {
    return Promise.resolve(null);
  }
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => resolve(null);
  request.onblocked = () => resolve(null);
  return promise;
}

/** Mirrors the save into IndexedDB. Failure is non-fatal by design. */
export async function mirrorSave(state: GameState, settings: Settings): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  const { promise, resolve } = Promise.withResolvers<boolean>();
  try {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(encodeSave(state, settings), 'latest');
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      resolve(false);
    };
  } catch {
    db.close();
    resolve(false);
  }
  return promise;
}

export async function readMirror(): Promise<SaveEnvelope | null> {
  const db = await openDb();
  if (!db) return null;
  const { promise, resolve } = Promise.withResolvers<SaveEnvelope | null>();
  try {
    const tx = db.transaction(DB_STORE, 'readonly');
    const request = tx.objectStore(DB_STORE).get('latest');
    request.onsuccess = () => {
      db.close();
      const value: unknown = request.result;
      resolve(typeof value === 'string' ? decodeSave(value) : null);
    };
    request.onerror = () => {
      db.close();
      resolve(null);
    };
  } catch {
    db.close();
    resolve(null);
  }
  return promise;
}
