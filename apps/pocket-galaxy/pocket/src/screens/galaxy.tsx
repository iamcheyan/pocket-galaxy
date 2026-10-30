// Galaxy map: a native star field, six survey targets, and the selected body.
import { createEffect } from "solid-js";
import { Text, View, type NodeMirror } from "@pocketjs/framework/solid/components";
import { animate } from "@pocketjs/framework/animation";
import type { Body, GalaxyState } from "../client";
import { Header, ResourceBar, Footer, Divider, ICON, Icon, Tab, Toast } from "../ui";

const STARS = [
  [12, 18], [38, 8], [72, 26], [96, 12], [128, 30], [166, 9], [198, 22], [226, 14],
  [18, 66], [52, 74], [86, 58], [118, 78], [154, 62], [186, 84], [218, 56], [236, 92],
  [8, 112], [44, 118], [78, 102], [112, 122], [146, 108], [178, 126], [206, 104],
  [26, 150], [64, 142], [98, 154], [134, 146], [170, 156], [204, 148], [232, 136],
] as const;

const KIND_LABEL: Record<string, string> = {
  star: "恒星",
  planet: "惑星",
  asteroid: "小惑星",
  comet: "彗星",
  nebula: "星雲",
};

function dotClass(kind: string): string {
  switch (kind) {
    case "star": return "w-[10] h-[10] rounded-full bg-amber-400";
    case "planet": return "w-[10] h-[10] rounded-full bg-sky-400";
    case "asteroid": return "w-[10] h-[10] rounded-full bg-slate-400";
    case "comet": return "w-[10] h-[10] rounded-full bg-cyan-300";
    default: return "w-[10] h-[10] rounded-full bg-fuchsia-400";
  }
}

function miniDotClass(kind: string): string {
  switch (kind) {
    case "star": return "w-[5] h-[5] rounded-full bg-amber-400";
    case "planet": return "w-[5] h-[5] rounded-full bg-sky-400";
    case "asteroid": return "w-[5] h-[5] rounded-full bg-slate-400";
    case "comet": return "w-[5] h-[5] rounded-full bg-cyan-300";
    default: return "w-[5] h-[5] rounded-full bg-fuchsia-400";
  }
}

export function GalaxyScreen(props: {
  bodies: Body[];
  state: GalaxyState;
  selected: number;
  tab: number;
  toast: string;
}) {
  const body = () => props.bodies[props.selected] ?? props.bodies[0];
  let ring: NodeMirror | undefined;
  createEffect(() => {
    const target = body();
    if (!ring || !target) return;
    animate(ring, "translateX", target.x - 8, { dur: 140, easing: "out" });
    animate(ring, "translateY", target.y - 8, { dur: 140, easing: "out" });
  });
  return (
    <View class="w-full h-full flex-col bg-slate-950">
      <Header title="GALAXY" jp="銀河星図" />
      <ResourceBar energy={props.state.energy} mineral={props.state.mineral} science={props.state.science} hull={props.state.hull} />
      <View class="h-[20] w-full flex-row items-center gap-[4] px-[6] bg-slate-900">
        <Tab label="星図" jp="MAP" active={props.tab === 0} glyph={ICON.star} />
        <Tab label="船体" jp="SHIP" active={props.tab === 1} glyph={ICON.ship} />
        <Tab label="日誌" jp="LOG" active={props.tab === 2} glyph={ICON.book} />
        <Tab label="設定" jp="SET" active={props.tab === 3} glyph={ICON.cog} />
        <View class="flex-1" />
        <Text class="text-2xs text-slate-500">{"1/4"}</Text>
      </View>
      <View class="w-full h-[100] flex-row">
        <View class="w-[232] h-[100] relative bg-slate-950 overflow-hidden">
          {STARS.map(([x, y]) => (
            <View class="absolute w-[2] h-[2] rounded-[1] bg-slate-600" style={{ insetL: x, insetT: y }} />
          ))}
          <View class="absolute w-[2] h-[2] rounded-[1] bg-slate-500" style={{ insetL: 170, insetT: 40 }} />
          <View class="absolute w-[1] h-[1] rounded-[1] bg-slate-400" style={{ insetL: 62, insetT: 96 }} />
          <View class="absolute w-[1] h-[1] rounded-[1] bg-slate-400" style={{ insetL: 212, insetT: 74 }} />
          {props.bodies.map((item, index) => (
            <View class="absolute" style={{ insetL: item.x - 5, insetT: item.y - 5 }}>
              <View class={dotClass(item.kind)} style={{ opacity: item.discovered ? 1 : 0.55 }} />
            </View>
          ))}
          <View ref={(node) => { ring = node; }} class="absolute w-[16] h-[16] rounded-full border-[2] border-emerald-300" style={{ insetL: (body()?.x ?? 0) - 8, insetT: (body()?.y ?? 0) - 8 }} />
          <View class="absolute left-[8] top-[6] rounded-[4] px-[5] py-[1] bg-slate-900">
            <Text class="text-2xs text-slate-400">{"SEED " + props.state.seed}</Text>
          </View>
          <Text class="absolute left-[8] bottom-[4] text-2xs text-slate-500">{`規模 ${props.state.scale} · 発見 ${props.state.discovered}/6 · 探査 ${props.state.scanned}/6`}</Text>
        </View>
        <View class="w-[128] h-[100] flex-col px-[7] py-[2] bg-slate-900">
          <Text class="text-2xs text-slate-500">TARGET 目標</Text>
          <Text class="text-base font-bold text-white" style={{ marginT: 2 }}>{body()?.name ?? "-"}</Text>
          <Text class="text-2xs text-slate-400">{body() ? `${body()!.catalog} · ${KIND_LABEL[body()!.kind]}` : ""}</Text>
          <Divider />
          <Text class="text-2xs text-emerald-300">{body()?.discovered ? "発見済み" : "未発見"}</Text>
          <Text class="text-2xs text-sky-300">{body()?.scanned ? "探査済み" : "未探査"}</Text>
          <Text class="text-2xs text-amber-200" style={{ marginT: 2 }}>{body() ? `E+${body()!.energy} M+${body()!.mineral}` : ""}</Text>
          <Text class="text-2xs text-fuchsia-200">{body() ? `S+${body()!.science}` : ""}</Text>
        </View>
      </View>
      <View class="w-full h-[16] flex-row items-center px-[10] bg-slate-950">
        <Text class="text-2xs text-slate-500">SURVEY 調査対象</Text>
        <View class="flex-1" />
        <Text class="text-2xs text-slate-600">{`${props.selected + 1} / ${props.bodies.length}`}</Text>
      </View>
      <View class="w-full flex-1 flex-row items-center px-[10] gap-[6] bg-slate-950 overflow-hidden">
        {props.bodies.map((item, index) => (
          <View class={index === props.selected ? "rounded-[5] px-[6] py-[3] bg-slate-800" : "rounded-[5] px-[6] py-[3]"}>
            <View class="flex-row items-center gap-[4]">
              <View class={miniDotClass(item.kind)} />
              <Text class={index === props.selected ? "text-2xs text-white" : "text-2xs text-slate-500"}>
                {item.discovered ? item.name : "???"}
              </Text>
            </View>
          </View>
        ))}
      </View>
      {props.toast ? <Toast message={props.toast} /> : null}
      <Footer hint="D-PAD select · O harvest · X scan · L/R tab · B back" page="GALAXY" />
    </View>
  );
}
