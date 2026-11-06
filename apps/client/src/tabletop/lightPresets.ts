import type { GameIconName } from '../ui/gameIcons';

export type LightPreset = { id: string; label: string; bright: number; dim: number; openFlame: boolean; cone?: boolean };

export const LIGHT_PRESETS: LightPreset[] = [
  { id: 'candle', label: 'Свеча', bright: 5, dim: 5, openFlame: true },
  { id: 'torch', label: 'Факел', bright: 20, dim: 20, openFlame: true },
  { id: 'lamp', label: 'Лампа', bright: 15, dim: 30, openFlame: true },
  { id: 'lantern', label: 'Фонарь', bright: 30, dim: 30, openFlame: false },
  { id: 'bullseye', label: 'Фонарь «бычий глаз» (конусом)', bright: 60, dim: 60, openFlame: false, cone: true },
  { id: 'campfire', label: 'Костёр', bright: 20, dim: 40, openFlame: true },
  { id: 'light', label: 'Заклинание «Свет»', bright: 20, dim: 20, openFlame: false },
  { id: 'dancing', label: 'Пляшущие огоньки', bright: 0, dim: 10, openFlame: false },
  { id: 'daylight', label: 'Дневной свет', bright: 60, dim: 60, openFlame: false },
];

export function presetFor(light: { bright: number; dim: number; openFlame?: boolean; cone?: boolean } | null | undefined): LightPreset | null {
  if (!light) return null;
  return LIGHT_PRESETS.find(preset => preset.bright === light.bright && preset.dim === light.dim
    && (light.openFlame === undefined || preset.openFlame === light.openFlame)
    && Boolean(preset.cone) === Boolean(light.cone)) ?? null;
}

export function lightText(light: { bright: number; dim: number; lit?: boolean; cone?: boolean } | null | undefined): string {
  if (!light || light.bright + light.dim <= 0) return 'не светит';
  const preset = presetFor(light);
  const range = light.bright
    ? `ярко ${light.bright} фут.${light.dim ? `, тускло ещё ${light.dim}` : ''}`
    : `тускло ${light.dim} фут.`;
  return `${preset ? `${preset.label}: ` : ''}${range}${light.cone && !preset ? ', конусом' : ''}${light.lit === false ? ' — погашен' : ''}`;
}

export const LIGHTING_INFO: Record<'bright' | 'dim' | 'dark', { icon: GameIconName; label: string; hint: string }> = {
  bright: { icon: 'sun', label: 'Светло', hint: 'Всё в пределах обзора видно ясно.' },
  dim: { icon: 'sunset', label: 'Сумерки', hint: 'Всё видно, но в полумраке: помеха на Мудрость (Восприятие), если она зависит от зрения.' },
  dark: { icon: 'moon', label: 'Темно', hint: 'Видно только освещённое и то, что в пределах тёмного зрения.' },
};
