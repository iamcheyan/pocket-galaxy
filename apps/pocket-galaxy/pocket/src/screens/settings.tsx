// Settings: input hints, scale and save identity. Native focus list.
import { For, Show } from "solid-js";
import { FocusGrid, FocusScope, Focusable, Text, View } from "@pocketjs/framework/solid/components";
import type { GalaxyState } from "../client";
import { Header, ResourceBar, Footer, Divider, ICON, Tab, Toast } from "../ui";

export interface SettingRow {
  id: string;
  label: string;
  jp: string;
  value: string;
  options: string[];
}

export function SettingsScreen(props: {
  state: GalaxyState;
  tab: number;
  rows: SettingRow[];
  toast: string;
  onToggle: (id: string) => void;
}) {
  return (
    <View class="w-full h-full flex-col bg-slate-950">
      <Header title="SETTINGS" jp="設定" />
      <ResourceBar energy={props.state.energy} mineral={props.state.mineral} science={props.state.science} hull={props.state.hull} />
      <View class="h-[20] w-full flex-row items-center gap-[4] px-[6] bg-slate-900">
        <Tab label="星図" jp="MAP" active={props.tab === 0} glyph={ICON.star} />
        <Tab label="船体" jp="SHIP" active={props.tab === 1} glyph={ICON.ship} />
        <Tab label="日誌" jp="LOG" active={props.tab === 2} glyph={ICON.book} />
        <Tab label="設定" jp="SET" active={props.tab === 3} glyph={ICON.cog} />
        <View class="flex-1" />
        <Text class="text-2xs text-slate-500">{"SAVE 保存"}</Text>
      </View>
      <View class="w-full flex-1 flex-row px-[8] py-[4] gap-[6]">
        <FocusScope autoFocus>
          <FocusGrid columns={1} wrap class="w-[196] flex-col gap-[4]">
            <For each={props.rows}>{(row) => (
              <Focusable
                class="w-[196] h-[30] flex-row items-center justify-between px-[8] rounded-[6] bg-slate-900 border-slate-700 focus:bg-slate-800 focus:border-emerald-300"
                onPress={() => props.onToggle(row.id)}
              >
                <View class="flex-col">
                  <Text class="text-xs text-white">{row.label}</Text>
                  <Text class="text-2xs text-slate-500">{row.jp}</Text>
                </View>
                <Text class="text-xs text-emerald-300">{row.value}</Text>
              </Focusable>
            )}</For>
          </FocusGrid>
        </FocusScope>
        <View class="flex-1 h-full flex-col rounded-[6] px-[8] py-[5] bg-slate-900">
          <Text class="text-xs font-bold text-white">{"CONTROLS 操作"}</Text>
          <Divider />
          <Text class="text-2xs text-slate-400">{"D-PAD / 十字キー"}</Text>
          <Text class="text-2xs text-slate-500">{"select target / tab"}</Text>
          <Text class="text-2xs text-slate-400" style={{ marginT: 3 }}>{"● harvest / buy"}</Text>
          <Text class="text-2xs text-slate-500">{"✕ scan / back"}</Text>
          <Text class="text-2xs text-slate-400" style={{ marginT: 3 }}>{"L/R tab"}</Text>
          <View class="flex-1" />
          <Text class="text-2xs text-slate-500">{"SAVE SEED"}</Text>
          <Text class="text-sm font-mono text-emerald-200">{props.state.seed}</Text>
          <Text class="text-2xs text-slate-500" style={{ marginT: 2 }}>{"fixture · no device save"}</Text>
          <Show when={props.toast}>
            <Text class="text-2xs text-amber-300" style={{ marginT: 2 }}>{props.toast}</Text>
          </Show>
        </View>
      </View>
      <Footer hint="D-PAD select · O toggle · L/R tab · B back" page="SETTINGS" />
    </View>
  );
}
