// Logbook: run statistics and achievement rows.
import { For } from "solid-js";
import { Text, View } from "@pocketjs/framework/solid/components";
import type { Achievement, GalaxyState } from "../client";
import { Header, ResourceBar, Footer, Divider, ICON, Tab, Toast } from "../ui";

const STATS = [
  ["探査 bodies", "scanned"],
  ["発見 discovered", "discovered"],
  ["銀河規模 scale", "scale"],
  ["シード seed", "seed"],
] as const;

export function LogbookScreen(props: { state: GalaxyState; achievements: Achievement[]; tab: number; toast: string }) {
  const unlocked = () => props.achievements.filter((entry) => entry.unlocked).length;
  return (
    <View class="w-full h-full flex-col bg-slate-950">
      <Header title="LOGBOOK" jp="航海日誌" />
      <ResourceBar energy={props.state.energy} mineral={props.state.mineral} science={props.state.science} hull={props.state.hull} />
      <View class="h-[20] w-full flex-row items-center gap-[4] px-[6] bg-slate-900">
        <Tab label="星図" jp="MAP" active={props.tab === 0} glyph={ICON.star} />
        <Tab label="船体" jp="SHIP" active={props.tab === 1} glyph={ICON.ship} />
        <Tab label="日誌" jp="LOG" active={props.tab === 2} glyph={ICON.book} />
        <Tab label="設定" jp="SET" active={props.tab === 3} glyph={ICON.cog} />
        <View class="flex-1" />
        <Text class="text-2xs text-emerald-300">{`${unlocked()}/${props.achievements.length} 実績`}</Text>
      </View>
      <View class="w-full flex-1 flex-row px-[8] py-[4] gap-[6]">
        <View class="w-[150] h-full flex-col rounded-[6] px-[7] py-[3] bg-slate-900">
          <Text class="text-xs font-bold text-white">{"RUN STATS"}</Text>
          <Text class="text-2xs text-slate-500">{"航行統計"}</Text>
          <Divider />
          <For each={STATS}>{(row) => (
            <View class="w-full flex-row items-center justify-between" style={{ marginT: 4 }}>
              <Text class="text-2xs text-slate-400">{row[0]}</Text>
              <Text class="text-2xs text-emerald-200">
                {row[1] === "scanned" ? String(props.state.scanned)
                  : row[1] === "discovered" ? String(props.state.discovered)
                  : row[1] === "scale" ? props.state.scale
                  : props.state.seed}
              </Text>
            </View>
          )}</For>
          <View class="flex-1" />
          <Text class="text-2xs text-slate-500">{"RATING 評価"}</Text>
          <Text class="text-lg font-bold text-amber-300">{`${props.state.rating}/100`}</Text>
          <Text class="text-2xs text-slate-400">{props.state.ratingLabel}</Text>
        </View>
        <View class="flex-1 h-full flex-col rounded-[6] px-[7] py-[3] bg-slate-900 overflow-hidden">
          <Text class="text-xs font-bold text-white">{"ACHIEVEMENTS 実績"}</Text>
          <Divider />
          <For each={props.achievements}>{(entry) => (
            <View class="w-full h-[26] flex-row items-center gap-[6]">
              <View class={entry.unlocked ? "w-[16] h-[16] rounded-full items-center justify-center bg-emerald-700" : "w-[16] h-[16] rounded-full items-center justify-center bg-slate-800"}>
                <Text class="text-2xs text-white">{entry.unlocked ? "✓" : "·"}</Text>
              </View>
              <View class="flex-col">
                <Text class={entry.unlocked ? "text-xs text-white" : "text-xs text-slate-500"}>{entry.title}</Text>
                <Text class="text-2xs text-slate-500">{entry.detail}</Text>
              </View>
            </View>
          )}</For>
        </View>
      </View>
      {props.toast ? <Toast message={props.toast} /> : null}
      <Footer hint="L/R tab · B back · achievements persist in the run" page="LOGBOOK" />
    </View>
  );
}
