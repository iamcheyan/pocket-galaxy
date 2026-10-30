// Data boundary for the PocketJS Galaxy port.
//
// The UI calls list()/get()/action() only. Three adapters share this surface:
//   fixture — JSON baked into the package (development and this port's default)
//   http    — @pocketjs/framework/net-api fetch, host dev profile only
//   bridge  — runtime host bridge: host.__pvc(json), forwarded to the daemon/device
//
// Galaxy has no daemon, so the http and bridge adapters expose the same read
// surface but report unavailable for mutations.

import { fetch as netFetch, netHost } from "@pocketjs/framework/net-api";

export type BodyKind = "star" | "planet" | "asteroid" | "comet" | "nebula";

export interface Body {
  id: string;
  name: string;
  catalog: string;
  kind: BodyKind;
  discovered: boolean;
  scanned: boolean;
  x: number;
  y: number;
  energy: number;
  mineral: number;
  science: number;
}

export interface Upgrade {
  id: string;
  title: string;
  detail: string;
  level: number;
  maxLevel: number;
  energy: number;
  mineral: number;
  science: number;
  effect: string;
}

export interface Achievement {
  id: string;
  title: string;
  detail: string;
  unlocked: boolean;
}

export interface GalaxyState {
  rating: number;
  ratingLabel: string;
  hull: number;
  energy: number;
  mineral: number;
  science: number;
  discovered: number;
  scanned: number;
  scale: string;
  seed: string;
}

export interface ActionReport {
  ok: boolean;
  message: string;
  data?: unknown;
}

export interface GalaxyClient {
  readonly source: "fixture" | "http" | "bridge";
  list(): Promise<Body[]>;
  get(id: string): Promise<Body | null>;
  state(): Promise<GalaxyState>;
  upgrades(): Promise<Upgrade[]>;
  achievements(): Promise<Achievement[]>;
  action(name: string, payload?: Record<string, unknown>): Promise<ActionReport>;
}

const FIXTURE_BODIES: Body[] = [
  { id: "b1", name: "Aster", catalog: "AG-001", kind: "star", discovered: true, scanned: true, x: 64, y: 44, energy: 42, mineral: 8, science: 12 },
  { id: "b2", name: "Kepro", catalog: "AG-014", kind: "planet", discovered: true, scanned: false, x: 148, y: 28, energy: 26, mineral: 30, science: 5 },
  { id: "b3", name: "Vela", catalog: "AG-027", kind: "nebula", discovered: true, scanned: false, x: 202, y: 62, energy: 12, mineral: 4, science: 38 },
  { id: "b4", name: "Rook", catalog: "AG-039", kind: "asteroid", discovered: false, scanned: false, x: 104, y: 28, energy: 4, mineral: 24, science: 2 },
  { id: "b5", name: "Ixo", catalog: "AG-051", kind: "comet", discovered: false, scanned: false, x: 58, y: 76, energy: 18, mineral: 6, science: 20 },
  { id: "b6", name: "Mira", catalog: "AG-066", kind: "planet", discovered: false, scanned: false, x: 220, y: 84, energy: 9, mineral: 12, science: 9 },
];

const FIXTURE_STATE: GalaxyState = {
  rating: 72,
  ratingLabel: "Notable",
  hull: 84,
  energy: 1240,
  mineral: 860,
  science: 415,
  discovered: 3,
  scanned: 1,
  scale: "small",
  seed: "AG-7F2A",
};

const FIXTURE_UPGRADES: Upgrade[] = [
  { id: "scanner", title: "Scanner", detail: "Reveals deeper bodies", level: 2, maxLevel: 8, energy: 220, mineral: 40, science: 60, effect: "reach +18%" },
  { id: "mining", title: "Mining", detail: "Raises harvest yield", level: 3, maxLevel: 8, energy: 180, mineral: 70, science: 30, effect: "yield x2.35" },
  { id: "engine", title: "Engine", detail: "Faster survey travel", level: 1, maxLevel: 8, energy: 140, mineral: 30, science: 20, effect: "reach +9%" },
  { id: "cargo", title: "Cargo", detail: "More per-resource hold", level: 2, maxLevel: 8, energy: 200, mineral: 50, science: 25, effect: "cap 140" },
  { id: "shield", title: "Shield", detail: "Softens risk events", level: 1, maxLevel: 8, energy: 260, mineral: 60, science: 45, effect: "mitigation 7%" },
  { id: "speed", title: "Harvester", detail: "Shorter cooldown", level: 2, maxLevel: 8, energy: 160, mineral: 35, science: 35, effect: "720 ms" },
];

const FIXTURE_ACHIEVEMENTS: Achievement[] = [
  { id: "first-light", title: "First light", detail: "Discover the first body", unlocked: true },
  { id: "surveyor", title: "Surveyor", detail: "Scan three bodies", unlocked: true },
  { id: "deep-field", title: "Deep field", detail: "Reach a medium galaxy", unlocked: false },
  { id: "full-hold", title: "Full hold", detail: "Fill every cargo hold", unlocked: false },
  { id: "unbroken", title: "Unbroken", detail: "Finish a run above 80% hull", unlocked: true },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const fixture = {
  bodies: clone(FIXTURE_BODIES),
  state: clone(FIXTURE_STATE),
  upgrades: clone(FIXTURE_UPGRADES),
  achievements: clone(FIXTURE_ACHIEVEMENTS),
};

function fixtureClient(): GalaxyClient {
  return {
    source: "fixture",
    async list() {
      return clone(fixture.bodies);
    },
    async get(id) {
      return clone(fixture.bodies.find((body) => body.id === id) ?? null);
    },
    async state() {
      return clone(fixture.state);
    },
    async upgrades() {
      return clone(fixture.upgrades);
    },
    async achievements() {
      return clone(fixture.achievements);
    },
    async action(name, payload) {
      const bodyId = typeof payload?.id === "string" ? payload.id : "";
      const body = fixture.bodies.find((item) => item.id === bodyId);
      if (name === "scan" && body) {
        body.scanned = true;
        body.discovered = true;
        fixture.state.scanned = fixture.bodies.filter((item) => item.scanned).length;
        fixture.state.discovered = fixture.bodies.filter((item) => item.discovered).length;
        fixture.state.science += body.science;
        return { ok: true, message: `${body.name} scanned · +${body.science} science` };
      }
      if (name === "harvest" && body) {
        body.discovered = true;
        fixture.state.energy += body.energy;
        fixture.state.mineral += body.mineral;
        fixture.state.science += body.science;
        return { ok: true, message: `${body.name} harvested` };
      }
      if (name === "buy" && typeof payload?.id === "string") {
        const upgrade = fixture.upgrades.find((item) => item.id === payload.id);
        if (!upgrade) return { ok: false, message: "unknown upgrade" };
        if (upgrade.level >= upgrade.maxLevel) return { ok: false, message: `${upgrade.title} is maxed` };
        if (fixture.state.energy < upgrade.energy || fixture.state.mineral < upgrade.mineral) {
          return { ok: false, message: `not enough resources for ${upgrade.title}` };
        }
        fixture.state.energy -= upgrade.energy;
        fixture.state.mineral -= upgrade.mineral;
        fixture.state.science -= upgrade.science;
        upgrade.level += 1;
        return { ok: true, message: `${upgrade.title} → L${upgrade.level}` };
      }
      if (name === "repair") {
        const cost = Math.ceil((100 - fixture.state.hull) * 0.8);
        if (fixture.state.hull >= 100) return { ok: false, message: "hull already intact" };
        if (fixture.state.mineral < cost) return { ok: false, message: `need ${cost} mineral` };
        fixture.state.mineral -= cost;
        fixture.state.hull = 100;
        return { ok: true, message: "hull repaired" };
      }
      if (name === "expand" && typeof payload?.scale === "string") {
        fixture.state.scale = payload.scale;
        return { ok: true, message: `expanded to ${payload.scale}` };
      }
      return { ok: false, message: `${name} is not available in this build` };
    },
  };
}

function httpClient(): GalaxyClient {
  const base = "/api";
  const read = async <T>(path: string): Promise<T> => {
    const response = await netFetch(`${base}${path}`, { timeoutMs: 4000 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json<T>();
  };
  return {
    source: "http",
    list: () => read<Body[]>("/galaxy/bodies"),
    get: (id) => read<Body | null>(`/galaxy/bodies/${encodeURIComponent(id)}`),
    state: () => read<GalaxyState>("/galaxy/state"),
    upgrades: () => read<Upgrade[]>("/galaxy/upgrades"),
    achievements: () => read<Achievement[]>("/galaxy/achievements"),
    async action(name, payload) {
      const response = await netFetch(`${base}/galaxy/actions/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload ?? {}),
        timeoutMs: 4000,
      });
      const report = await response.json<ActionReport>();
      return report;
    },
  };
}

interface BridgeHost {
  __pvc?: (request: string) => unknown;
}

function bridgeClient(): GalaxyClient {
  const host = (globalThis as { host?: BridgeHost }).host;
  const call = async (request: Record<string, unknown>): Promise<unknown> => {
    const raw = await host?.__pvc?.(JSON.stringify(request));
    if (typeof raw === "string") return JSON.parse(raw);
    return raw;
  };
  const read = async <T>(request: Record<string, unknown>): Promise<T> => {
    const value = await call(request);
    return value as T;
  };
  return {
    source: "bridge",
    list: () => read<Body[]>({ op: "list", resource: "galaxy.bodies" }),
    get: (id) => read<Body | null>({ op: "get", resource: "galaxy.bodies", id }),
    state: () => read<GalaxyState>({ op: "get", resource: "galaxy.state" }),
    upgrades: () => read<Upgrade[]>({ op: "list", resource: "galaxy.upgrades" }),
    achievements: () => read<Achievement[]>({ op: "list", resource: "galaxy.achievements" }),
    async action(name, payload) {
      const value = await call({ op: "action", resource: "galaxy", action: name, payload });
      return (value as ActionReport) ?? { ok: false, message: "bridge returned no report" };
    },
  };
}

function selectClient(): GalaxyClient {
  const host = (globalThis as { host?: BridgeHost }).host;
  if (typeof host?.__pvc === "function") return bridgeClient();
  if (netHost() && (globalThis as { __PJS_HTTP?: boolean }).__PJS_HTTP) return httpClient();
  return fixtureClient();
}

export const client: GalaxyClient = selectClient();
