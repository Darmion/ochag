import type { GameIconName } from '../ui/gameIcons';

const MINUTES_PER_DAY = 24 * 60;
export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';
export type Weather = 'clear' | 'rain' | 'storm' | 'snow' | 'fog';

export function dayPhase(minutes: number): DayPhase {
  const hour = (((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) / 60;
  if (hour >= 7 && hour < 18) return 'day';
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 18 && hour < 20) return 'dusk';
  return 'night';
}

export function clockText(minutes: number): string {
  const day = Math.floor(minutes / MINUTES_PER_DAY) + 1;
  const inDay = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `День ${day}, ${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`;
}

export const PHASE_INFO: Record<DayPhase, { icon: GameIconName; label: string }> = {
  dawn: { icon: 'sunrise', label: 'рассвет' },
  day: { icon: 'sun', label: 'день' },
  dusk: { icon: 'sunset', label: 'сумерки' },
  night: { icon: 'moon', label: 'ночь' },
};

export const WEATHER_INFO: Record<Weather, { icon: GameIconName | null; label: string; hint: string }> = {
  clear: { icon: null, label: 'Ясно', hint: 'Погода не мешает.' },
  rain: { icon: 'cloudRain', label: 'Дождь', hint: 'Только вид: правила не меняются.' },
  storm: { icon: 'cloudBolt', label: 'Ливень', hint: 'Всё в полумраке, помеха на Восприятие; открытый огонь гаснет и не зажигается.' },
  snow: { icon: 'snowflake', label: 'Снегопад', hint: 'Всё в полумраке, помеха на Восприятие.' },
  fog: { icon: 'fog', label: 'Туман', hint: 'Всё в полумраке, видно не дальше 60 футов, помеха на Восприятие.' },
};

export function nextHour(minutes: number, hour: number): number {
  const dayStart = Math.floor(minutes / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  const target = dayStart + hour * 60;
  return target > minutes ? target : target + MINUTES_PER_DAY;
}
