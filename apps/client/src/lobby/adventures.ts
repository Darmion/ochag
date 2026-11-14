export type AdventureCounts = { scenes: number; notes: number; quests: number; handouts: number; rollTables: number; npcs: number };

export type Adventure = {
  id: string; name: string; version: string; description: string; author: string; bundled: boolean;
  translations: Record<string, { name?: string; description?: string; author?: string }>;
  title: string; levels: string; players: string; duration: string; intro: string; cover: string | null;
  counts: AdventureCounts; problems: string[]; error: string | null;
};

export type AdventureCampaign = { campaignId: string; name: string; counts: AdventureCounts; problems: string[] };

const COUNT_WORDS: Array<[keyof AdventureCounts, string]> = [
  ['scenes', 'сцен'], ['notes', 'заметок'], ['quests', 'заданий'], ['handouts', 'раздаточных'], ['rollTables', 'таблиц'], ['npcs', 'существ вне сцен'],
];

export function adventureCountsText(counts: AdventureCounts): string {
  return COUNT_WORDS.filter(([key]) => counts[key] > 0).map(([key, word]) => `${word}: ${counts[key]}`).join(', ');
}

export function adventureFacts(adventure: Pick<Adventure, 'levels' | 'players' | 'duration'>): string[] {
  return [
    adventure.levels ? `уровни ${adventure.levels}` : '',
    adventure.players ? `игроков ${adventure.players}` : '',
    adventure.duration,
  ].filter(Boolean);
}
