// Shipyard: six upgrade tracks, hull repair and galaxy expansion.
import { For } from "solid-js";
import { FocusGrid, FocusScope, Focusable, Text, View } from "@pocketjs/framework/solid/components";
import type { GalaxyState, Upgrade } from "../client";
import { Header, ResourceBar, Footer, Divider, ICON, Icon, Tab, Toast } from "../ui";

export function ShipyardScreen(props: {
  state: GalaxyState;
  upgrades: Upgrade[];
  tab: number;
  toast: string;
  selected: number;
  onBuy: (id: string) => void;
  onFocus: (index: number) => void;
}) {
  return (
    <View class="w-full h-full flex-col bg-slate-950">
      <Header title="SHIPYARD" jp="船体施設" />
      <ResourceBar energy={props.state.energy} mineral={props.state.mineral} science={props.state.science} hull={props.state.hull} />
      <View class="h-[20] w-full flex-row items-center gap-[4] px-[6] bg-slate-900">
        <Tab label="星図" jp="MAP" active={props.tab === 0} glyph={ICON.star} />
        <Tab label="船体" jp="SHIP" active={props.tab === 1} glyph={ICON.ship} />
        <Tab label="日誌" jp="LOG" active={props.tab === 2} glyph={ICON.book} />
        <Tab label="設定" jp="SET" active={props.tab === 3} glyph={ICON.cog} />
        <View class="flex-1" />
        <Text class="text-2xs text-slate-500">{"修理 REPAIR"}</Text>
      </View>
      <View class="w-full flex-1 flex-col px-[8] py-[4]">
        <View class="flex-row items-center justify-between">
          <Text class="text-xs text-slate-300">{"HULL INTEGRITY 船体"}</Text>
          <Text class="text-xs text-emerald-300">{`${props.state.hull}%`}</Text>
        </View>
        <View class="w-full h-[6] rounded-[3] bg-slate-800 overflow-hidden" style={{ marginT: 3 }}>
          <View class="h-[6] bg-emerald-400" style={{ width: Math.round((props.state.hull / 100) * 320) }} />
        </View>
        <Divider />
        <FocusScope autoFocus>
          <FocusGrid columns={3} wrap class="w-full flex-row flex-wrap gap-[4]">
            <Focusable
              class="w-[108] h-[40] flex-col rounded-[6] px-[6] py-[2] bg-slate-900 border-slate-700 focus:bg-slate-800 focus:border-emerald-300"
              onPress={() => props.onBuy("repair")}
            >
              <View class="flex-row items-center justify-between">
                <Text class="text-xs font-bold text-white">{"Repair hull"}</Text>
                <Text class="text-2xs text-emerald-300">{"修理"}</Text>
              </View>
              <Text class="text-2xs text-slate-400">{"Restore hull to 100%"}</Text>
              <Text class="text-2xs text-amber-200">{`${Math.ceil((100 - props.state.hull) * 0.8)} mineral`}</Text>
            </Focusable>
            <For each={props.upgrades}>{(item, index) => (
              <Focusable
                class="w-[108] h-[40] flex-col rounded-[6] px-[6] py-[2] bg-slate-900 border-slate-700 focus:bg-slate-800 focus:border-emerald-300"
                onPress={() => { props.onFocus(index()); props.onBuy(item.id); }}
              >
                <View class="flex-row items-center justify-between">
                  <Text class="text-xs font-bold text-white">{`${item.title} L${item.level}`}</Text>
                  <Text class="text-2xs text-emerald-300">{`→ L${Math.min(item.maxLevel, item.level + 1)}`}</Text>
                </View>
                <Text class="text-2xs text-slate-400">{item.effect}</Text>
                <Text class="text-2xs text-amber-200">{`${item.energy}E · ${item.mineral}M · ${item.science}S`}</Text>
              </Focusable>
            )}</For>
          </FocusGrid>
        </FocusScope>
      </View>
      {props.toast ? <Toast message={props.toast} /> : null}
      <Footer hint="D-PAD grid · O buy · L/R tab · B back" page="SHIPYARD" />
    </View>
  );
}
