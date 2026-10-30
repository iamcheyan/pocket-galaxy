// Shared native-view chrome for every Pocket Galaxy screen.
// 360x240 logical canvas, 12 px type grid: 36 px header, 168 px body, 36 px footer.

import { Text, View } from "@pocketjs/framework/solid/components";

export const ICON = {
  star: "\uF005",
  ship: "\uF135",
  book: "\uF02D",
  cog: "\uF013",
  scan: "\uF002",
  harvest: "\uF0AD",
  back: "\uF060",
  next: "\uF061",
  bolt: "\uF0E7",
  ore: "\uF1B3",
  flask: "\uF0C3",
};

export function Icon(props: { glyph: string; class?: string }) {
  return <Text class={props.class ?? "text-sm text-slate-400"}>{props.glyph}</Text>;
}

export function Header(props: { title: string; jp: string; badge?: string }) {
  return (
    <View class="h-[32] w-full flex-row items-center justify-between px-[10] bg-slate-900">
      <View class="flex-row items-center gap-[8]">
        <Icon glyph={ICON.star} class="text-lg text-emerald-300" />
        <Text class="text-lg font-bold text-white">{props.title}</Text>
        <Text class="text-xs text-slate-400">{props.jp}</Text>
      </View>
      <View class="flex-row items-center gap-[8]">
        <Text class="text-2xs text-slate-500">{"fixture: " + (props.badge ?? "local")}</Text>
        <View class="rounded-[6] px-[6] py-[2] bg-emerald-900">
          <Text class="text-2xs text-emerald-300">{"PJS"}</Text>
        </View>
      </View>
    </View>
  );
}

export function ResourceBar(props: { energy: number; mineral: number; science: number; hull: number }) {
  return (
    <View class="h-[20] w-full flex-row items-center gap-[10] px-[10] bg-slate-900">
      <Icon glyph={ICON.bolt} class="text-xs text-amber-300" />
      <Text class="text-xs text-amber-200">{`E ${props.energy}`}</Text>
      <Icon glyph={ICON.ore} class="text-xs text-sky-300" />
      <Text class="text-xs text-sky-200">{`M ${props.mineral}`}</Text>
      <Icon glyph={ICON.flask} class="text-xs text-fuchsia-300" />
      <Text class="text-xs text-fuchsia-200">{`S ${props.science}`}</Text>
      <View class="flex-1" />
      <Text class="text-xs text-slate-400">{"HULL " + props.hull + "%"}</Text>
      <View class="w-[48] h-[6] rounded-[3] bg-slate-700 overflow-hidden">
        <View class="h-[6] bg-emerald-400" style={{ width: Math.round((props.hull / 100) * 48) }} />
      </View>
    </View>
  );
}

export function Footer(props: { hint: string; page: string }) {
  return (
    <View class="h-[22] w-full flex-row items-center justify-between px-[10] bg-slate-950">
      <Text class="text-2xs text-slate-500">{props.hint}</Text>
      <Text class="text-2xs text-slate-500">{props.page}</Text>
    </View>
  );
}

export function Tab(props: { label: string; jp: string; active: boolean; glyph: string }) {
  return (
    <View class={props.active ? "flex-row items-center gap-[4] px-[8] h-[24] rounded-[6] bg-emerald-800" : "flex-row items-center gap-[4] px-[8] h-[24]"}>
      <Icon glyph={props.glyph} class={props.active ? "text-xs text-white" : "text-xs text-slate-500"} />
      <Text class={props.active ? "text-xs text-white" : "text-xs text-slate-500"}>{props.label}</Text>
    </View>
  );
}

export function Divider() {
  return <View class="h-[1] w-full bg-slate-800" />;
}

export function Toast(props: { message: string }) {
  return (
    <View class="absolute left-[12] right-[12] bottom-[30] rounded-[6] px-[10] py-[5] bg-slate-800">
      <Text class="text-xs text-emerald-200">{props.message}</Text>
    </View>
  );
}
