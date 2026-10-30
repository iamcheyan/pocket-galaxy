// Pocket Galaxy — native PocketJS port of the showcase game.
// 360x240 logical canvas, all views from @pocketjs/framework/solid/components.
import { createEffect, createSignal, onMount, Show } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/solid/components";
import { animate } from "@pocketjs/framework/animation";
import { virtualFrame } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { onButtonPress, onFrame } from "@pocketjs/framework/lifecycle";
import { client, type Achievement, type Body, type GalaxyState, type Upgrade } from "./client";
import { GalaxyScreen } from "./screens/galaxy";
import { ShipyardScreen } from "./screens/shipyard";
import { LogbookScreen } from "./screens/logbook";
import { SettingsScreen, type SettingRow } from "./screens/settings";
import { Header, ResourceBar, Footer } from "./ui";

const EMPTY_STATE: GalaxyState = {
  rating: 0, ratingLabel: "-", hull: 100, energy: 0, mineral: 0, science: 0,
  discovered: 0, scanned: 0, scale: "small", seed: "-",
};

export default function App() {
  const [tab, setTab] = createSignal(0);
  const [bodies, setBodies] = createSignal<Body[]>([]);
  const [state, setState] = createSignal<GalaxyState>(EMPTY_STATE);
  const [upgrades, setUpgrades] = createSignal<Upgrade[]>([]);
  const [achievements, setAchievements] = createSignal<Achievement[]>([]);
  const [selected, setSelected] = createSignal(0);
  const [toast, setToast] = createSignal("");
  const [ready, setReady] = createSignal(false);
  const [rows, setRows] = createSignal<SettingRow[]>([
    { id: "motion", label: "Motion", jp: "動き", value: "FULL", options: ["FULL", "REDUCED"] },
    { id: "scale", label: "Galaxy scale", jp: "規模", value: "SMALL", options: ["SMALL", "MEDIUM", "LARGE"] },
    { id: "captions", label: "Japanese labels", jp: "日本語表記", value: "ON", options: ["ON", "OFF"] },
    { id: "scan", label: "Auto scan", jp: "自動探査", value: "OFF", options: ["OFF", "ON"] },
  ]);
  let toastUntil = 0;
  let root: NodeMirror | undefined;

  const say = (message: string) => {
    setToast(message);
    toastUntil = virtualFrame() + 55;
  };

  const refresh = async () => {
    const [nextBodies, nextState, nextUpgrades, nextAchievements] = await Promise.all([
      client.list(), client.state(), client.upgrades(), client.achievements(),
    ]);
    setBodies(nextBodies);
    setState(nextState);
    setUpgrades(nextUpgrades);
    setAchievements(nextAchievements);
  };

  onMount(() => {
    void refresh().then(() => setReady(true));
  });

  createEffect(() => {
    const next = tab();
    if (!root) return;
    animate(root, "opacity", 1, { dur: 120, easing: "out" });
    void next;
  });

  onFrame(() => {
    if (toast() && virtualFrame() > toastUntil) setToast("");
  });

  onButtonPress(BTN.LTRIGGER, () => { setToast(""); setTab((tab() + 3) % 4); });
  onButtonPress(BTN.RTRIGGER, () => { setToast(""); setTab((tab() + 1) % 4); });
  onButtonPress(BTN.CROSS, () => { if (tab() !== 0) setTab(0); });
  onButtonPress(BTN.UP, () => { if (tab() === 0) setSelected((selected() + 5) % 6); });
  onButtonPress(BTN.DOWN, () => { if (tab() === 0) setSelected((selected() + 1) % 6); });
  onButtonPress(BTN.LEFT, () => { if (tab() === 0) setSelected((selected() + 5) % 6); });
  onButtonPress(BTN.RIGHT, () => { if (tab() === 0) setSelected((selected() + 1) % 6); });

  onButtonPress(BTN.CIRCLE, () => {
    const body = bodies()[selected()];
    if (tab() !== 0 || !body) return;
    void client.action("harvest", { id: body.id }).then(async (report) => {
      say(report.message);
      await refresh();
    });
  });

  onButtonPress(BTN.SQUARE, () => {
    const body = bodies()[selected()];
    if (tab() !== 0 || !body) return;
    void client.action("scan", { id: body.id }).then(async (report) => {
      say(report.message);
      await refresh();
    });
  });

  const buy = (id: string) => {
    void client.action("buy", { id }).then(async (report) => {
      say(report.message);
      await refresh();
    });
  };

  const toggleRow = (id: string) => {
    setRows((current) => current.map((row) => {
      if (row.id !== id) return row;
      const at = row.options.indexOf(row.value);
      const value = row.options[(at + 1) % row.options.length]!;
      say(`${row.label}: ${value}`);
      if (id === "scale") setState((s) => ({ ...s, scale: value.toLowerCase() }));
      return { ...row, value };
    }));
  };

  return (
    <View ref={(node) => { root = node; }} class="w-full h-full">
      <Show when={ready()} fallback={
        <View class="w-full h-full flex-col bg-slate-950">
          <Header title="GALAXY" jp="銀河星図" />
          <ResourceBar energy={0} mineral={0} science={0} hull={100} />
          <View class="w-full flex-1 items-center justify-center">
            <Text class="text-sm text-slate-400">{"loading survey…"}</Text>
          </View>
          <Footer hint="reading client adapter" page="BOOT" />
        </View>
      }>
        <Show when={tab() === 0}>
          <GalaxyScreen bodies={bodies()} state={state()} selected={selected()} tab={tab()} toast={toast()} />
        </Show>
        <Show when={tab() === 1}>
          <ShipyardScreen
            state={state()}
            upgrades={upgrades()}
            tab={tab()}
            toast={toast()}
            selected={selected()}
            onBuy={buy}
            onFocus={setSelected}
          />
        </Show>
        <Show when={tab() === 2}>
          <LogbookScreen state={state()} achievements={achievements()} tab={tab()} toast={toast()} />
        </Show>
        <Show when={tab() === 3}>
          <SettingsScreen state={state()} tab={tab()} rows={rows()} toast={toast()} onToggle={toggleRow} />
        </Show>
      </Show>
    </View>
  );
}

