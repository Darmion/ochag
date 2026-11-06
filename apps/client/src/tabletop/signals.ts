export const PULL_INTERVAL_MS = 33;
export const PING_DURATION_MS = 2400;
export const MEASURE_LINGER_MS = 5000;
export const REMOTE_MEASURE_TTL_MS = 30000;

export const SIGNAL_COLORS = ['#f5c469', '#e8835a', '#8fcf9c', '#b49cf0', '#f2a7c3', '#7cc6de', '#e3e07a', '#d9a066'];

export function signalColor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SIGNAL_COLORS[hash % SIGNAL_COLORS.length]!;
}
