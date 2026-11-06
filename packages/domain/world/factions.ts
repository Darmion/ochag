export type FactionRelation = 'ally' | 'neutral' | 'enemy';
export type CreatureRelation = 'self' | FactionRelation;
export type SystemFaction = 'party' | 'enemies';

export const FACTION_RIGHTS = [
  { id: 'shared-vision', label: 'Общий обзор', text: 'Видеть то, что видят свои по фракции (если в кампании обзор отряда или общее зрение включены).' },
  { id: 'see-hp', label: 'Хиты своих', text: 'Видеть точные хиты и временные хиты своих по фракции (скрытое владельцем — по-прежнему скрыто).' },
  { id: 'control', label: 'Управлять своими', text: 'Двигать фигуры своих по фракции и действовать ими — как своими.' },
] as const;
export type FactionRight = (typeof FACTION_RIGHTS)[number]['id'];

export const FACTION_RESTRICTIONS = [
  { id: 'block-passage', label: 'Не пропускают сквозь себя', text: 'Сквозь существо другой фракции не пройти, даже если вы не враги.' },
  { id: 'no-opportunity', label: 'Без атак при уходе', text: 'Друг по другу не бьют атакой при уходе (учебный бой, перемирие).' },
  { id: 'no-auto-attack', label: '«Авто-ход» не нападает', text: 'НПС одной фракции в «Авто-ходе» не выбирают целью существ другой.' },
  { id: 'no-trade', label: 'Не торгуют', text: 'Торговец одной фракции не торгует с существами другой.' },
] as const;
export type FactionRestriction = (typeof FACTION_RESTRICTIONS)[number]['id'];

export const FACTION_BONUS_KINDS = [
  { id: 'attack', label: 'к атаке' },
  { id: 'save', label: 'к спасброскам' },
  { id: 'ac', label: 'к КД' },
  { id: 'damage', label: 'к урону' },
] as const;
export type FactionBonusKind = (typeof FACTION_BONUS_KINDS)[number]['id'];
export type FactionBonus = { kind: FactionBonusKind; value: number };
export const FACTION_BONUS_LIMIT = 10;

export const FACTION_NAME_MAX = 60;
export const FACTION_COLORS = ['#5ea764', '#cf4a3d', '#4f86cf', '#e0aa3e', '#9b6bd1', '#3fb5b0', '#d97a2b', '#a8a8a8'] as const;

export type FactionInfo = { id: string; name: string; system: SystemFaction | null; rights: string[]; bonuses: FactionBonus[] };
export type FactionPair = { relation: FactionRelation; restrictions: string[] };

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function effectiveFactions(
  own: string[],
  creature: { kind: string | null | undefined; disposition: string | null | undefined },
  system: { party: string | null; enemies: string | null },
  explicit = own.length > 0,
): string[] {
  if (explicit) return own;
  if (creature.kind === 'character' || (creature.kind === 'npc' && creature.disposition === 'friendly')) return system.party ? [system.party] : [];
  if (creature.kind === 'npc' && creature.disposition === 'hostile') return system.enemies ? [system.enemies] : [];
  return [];
}

export function relationBetween(a: string[], b: string[], pairs: ReadonlyMap<string, FactionPair>): FactionRelation {
  if (!a.length || !b.length) return 'neutral';
  if (a.some(id => b.includes(id))) return 'ally';
  let allied = false;
  for (const x of a) {
    for (const y of b) {
      const pair = pairs.get(pairKey(x, y));
      if (pair?.relation === 'enemy') return 'enemy';
      if (pair?.relation === 'ally') allied = true;
    }
  }
  return allied ? 'ally' : 'neutral';
}

export function restrictedBetween(a: string[], b: string[], pairs: ReadonlyMap<string, FactionPair>, restriction: FactionRestriction): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x !== y && pairs.get(pairKey(x, y))?.restrictions.includes(restriction)) return true;
    }
  }
  return false;
}

export function sharedRight(a: string[], b: string[], factions: ReadonlyMap<string, FactionInfo>, right: FactionRight): boolean {
  return a.some(id => b.includes(id) && factions.get(id)?.rights.includes(right));
}

export function factionBonus(ids: string[], factions: ReadonlyMap<string, FactionInfo>, kind: FactionBonusKind): { value: number; reasons: string[] } {
  let value = 0;
  const reasons: string[] = [];
  for (const id of ids) {
    const faction = factions.get(id);
    for (const bonus of faction?.bonuses ?? []) {
      if (bonus.kind !== kind || !bonus.value) continue;
      value += bonus.value;
      reasons.push(`фракция «${faction!.name}» ${bonus.value > 0 ? '+' : ''}${bonus.value}`);
    }
  }
  return { value, reasons };
}

export function cleanBonuses(raw: unknown): FactionBonus[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: FactionBonus[] = [];
  for (const entry of raw) {
    const kind = (entry as any)?.kind;
    const value = Math.round(Number((entry as any)?.value));
    if (!FACTION_BONUS_KINDS.some(item => item.id === kind) || !Number.isFinite(value) || value === 0 || seen.has(kind)) continue;
    seen.add(kind);
    out.push({ kind, value: Math.max(-FACTION_BONUS_LIMIT, Math.min(FACTION_BONUS_LIMIT, value)) });
  }
  return out;
}

export function cleanRights(raw: unknown): FactionRight[] {
  return Array.isArray(raw) ? FACTION_RIGHTS.map(item => item.id).filter(id => raw.includes(id)) : [];
}

export function cleanRestrictions(raw: unknown): FactionRestriction[] {
  return Array.isArray(raw) ? FACTION_RESTRICTIONS.map(item => item.id).filter(id => raw.includes(id)) : [];
}
