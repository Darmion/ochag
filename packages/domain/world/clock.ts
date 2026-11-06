import type { SceneLighting } from '../map/light.ts';

export const MINUTES_PER_DAY = 24 * 60;
export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';
export const WEATHERS = ['clear', 'rain', 'storm', 'snow', 'fog'] as const;
export type Weather = typeof WEATHERS[number];

export function dayPhase(minutes: number): DayPhase {
  const hour = (((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) / 60;
  if (hour >= 7 && hour < 18) return 'day';
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 18 && hour < 20) return 'dusk';
  return 'night';
}

export function lightingAt(minutes: number): SceneLighting {
  const phase = dayPhase(minutes);
  return phase === 'day' ? 'bright' : phase === 'night' ? 'dark' : 'dim';
}

export function clockText(minutes: number): string {
  const day = Math.floor(minutes / MINUTES_PER_DAY) + 1;
  const inDay = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hh = String(Math.floor(inDay / 60)).padStart(2, '0');
  const mm = String(inDay % 60).padStart(2, '0');
  return `День ${day}, ${hh}:${mm}`;
}

export type WeatherRules = {
  obscured: boolean;
  perceptionDisadvantage: boolean;
  dousesFlames: boolean;
  sightFeet: number | null;
};

export function weatherRules(weather: string | null | undefined): WeatherRules {
  switch (weather) {
    case 'storm': return { obscured: true, perceptionDisadvantage: true, dousesFlames: true, sightFeet: null };
    case 'snow': return { obscured: true, perceptionDisadvantage: true, dousesFlames: false, sightFeet: null };
    case 'fog': return { obscured: true, perceptionDisadvantage: true, dousesFlames: false, sightFeet: 60 };
    default: return { obscured: false, perceptionDisadvantage: false, dousesFlames: false, sightFeet: null };
  }
}

export function effectiveLighting(scene: { sky?: string | null; lighting?: string | null }, minutes: number): SceneLighting {
  if (scene.sky === 'clock') return lightingAt(minutes);
  return scene.lighting === 'dim' || scene.lighting === 'dark' ? scene.lighting : 'bright';
}
