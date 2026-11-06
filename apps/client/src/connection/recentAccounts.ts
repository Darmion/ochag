export const RECENT_KEY = 'ttrpg.recentAccounts';
export type RecentAccount = { username: string; serverUrl: string; usedAt: number };
export type AccountPlace = { serverUrl: string; hostName: string | null };
export type QuickAccount<Saved> = { key: string; username: string; where: string; saved: Saved | null; serverUrl: string };

export function parseRecent(raw: string | null): RecentAccount[] {
  const value = JSON.parse(raw ?? '[]');
  return Array.isArray(value) ? value.filter(entry => entry && typeof entry.username === 'string' && typeof entry.serverUrl === 'string') : [];
}

export function addRecent(list: RecentAccount[], name: string, serverUrl: string, usedAt: number): RecentAccount[] {
  return [{ username: name, serverUrl, usedAt }, ...list.filter(entry => !(entry.username === name && entry.serverUrl === serverUrl))].slice(0, 12);
}

export function mergeAccounts<Saved extends AccountPlace & { username: string }>(saved: Saved[], recent: RecentAccount[], where: (place: AccountPlace) => string) {
  const seen = new Set<string>();
  const list: Array<QuickAccount<Saved>> = [];
  for (const entry of saved) {
    const key = `${entry.serverUrl}|${entry.username}`;
    seen.add(key);
    list.push({ key, username: entry.username, where: where(entry), saved: entry, serverUrl: entry.serverUrl });
  }
  for (const entry of [...recent].sort((a, b) => b.usedAt - a.usedAt)) {
    const key = `${entry.serverUrl}|${entry.username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ key, username: entry.username, where: where({ serverUrl: entry.serverUrl, hostName: null }), saved: null, serverUrl: entry.serverUrl });
  }
  return list;
}
