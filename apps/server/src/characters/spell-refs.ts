import type { Queryable } from '../db.ts';
import { findSrdSpell } from '../rules/srd-data.ts';

export type SpellRefList = 'prepared' | 'book' | 'granted' | 'slotless';
export type CharacterSpellRef = { ref: string; lists: SpellRefList[]; label: string | null; level: number | null };

type Imported = {
  spells?: Array<{ slug: string; nameRu: string | null; nameEn: string | null; level: number | null }>;
  lssSpells?: Partial<Record<SpellRefList, string[]>>;
};

const LISTS: SpellRefList[] = ['prepared', 'book', 'granted', 'slotless'];
export const SPELL_REF = /^([0-9a-f]{24}|dndsu:[a-z0-9_]{1,80})$/;

function imported(sheetExtra: unknown): Imported {
  const value = (sheetExtra as Record<string, unknown> | null)?.importedStructure;
  return value && typeof value === 'object' ? value as Imported : {};
}

function srdIndexForLink(spell: { slug: string; nameEn: string | null }): string | null {
  const candidates = [
    spell.slug.replace(/_/g, '-'),
    spell.nameEn ? spell.nameEn.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '',
  ];
  return candidates.find(index => index && findSrdSpell(index)) ?? null;
}

function characterSpellRefs(sheetExtra: unknown): { named: Array<{ srdIndex: string; level: number | null }>; refs: CharacterSpellRef[] } {
  const source = imported(sheetExtra);
  const named: Array<{ srdIndex: string; level: number | null }> = [];
  const refs = new Map<string, CharacterSpellRef>();
  for (const spell of source.spells ?? []) {
    const srdIndex = srdIndexForLink(spell);
    if (srdIndex) named.push({ srdIndex, level: spell.level });
    else refs.set(`dndsu:${spell.slug}`, { ref: `dndsu:${spell.slug}`, lists: ['prepared'], label: spell.nameRu ?? spell.nameEn ?? spell.slug, level: spell.level });
  }
  for (const list of LISTS) {
    for (const id of source.lssSpells?.[list] ?? []) {
      if (!SPELL_REF.test(id)) continue;
      const entry = refs.get(id) ?? { ref: id, lists: [], label: null, level: null };
      if (!entry.lists.includes(list)) entry.lists.push(list);
      refs.set(id, entry);
    }
  }
  return { named, refs: [...refs.values()] };
}

function flags(lists: SpellRefList[]) {
  const granted = lists.includes('granted');
  const prepared = granted || lists.includes('prepared') || lists.includes('slotless') || !lists.includes('book');
  return { prepared, granted, slotless: lists.includes('slotless') };
}

async function insertSpell(
  q: Queryable, campaignId: string, characterId: string,
  spell: { source: 'srd' | 'custom'; srdIndex: string | null; customSpellId: string | null },
  lists: SpellRefList[],
) {
  const { prepared, granted, slotless } = flags(lists);
  const inserted = await q.query(
    `INSERT INTO character_spells (campaign_id, character_id, source, srd_index, custom_spell_id, prepared, granted, slotless)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [campaignId, characterId, spell.source, spell.srdIndex, spell.customSpellId, prepared, granted, slotless],
  );
  return inserted.rows.length;
}

export async function applySpellRefs(q: Queryable, campaignId: string, characterId: string, sheetExtra: unknown) {
  const { named, refs } = characterSpellRefs(sheetExtra);
  let added = 0;
  for (const spell of named) {
    added += await insertSpell(q, campaignId, characterId, { source: 'srd', srdIndex: spell.srdIndex, customSpellId: null }, ['prepared']);
  }
  if (!refs.length) return added;
  const mapped = (
    await q.query(
      `SELECT ref, source, srd_index, custom_spell_id FROM campaign_spell_refs WHERE campaign_id=$1 AND ref = ANY($2::text[])`,
      [campaignId, refs.map(entry => entry.ref)],
    )
  ).rows;
  for (const row of mapped) {
    if (row.source === 'skip') continue;
    const lists = refs.find(entry => entry.ref === row.ref)!.lists;
    added += await insertSpell(q, campaignId, characterId, { source: row.source, srdIndex: row.srd_index, customSpellId: row.custom_spell_id }, lists);
  }
  return added;
}

export async function pendingSpellRefs(q: Queryable, campaignId: string, sheetExtra: unknown) {
  const { refs } = characterSpellRefs(sheetExtra);
  if (!refs.length) return [];
  const mapped = new Set(
    (await q.query('SELECT ref FROM campaign_spell_refs WHERE campaign_id=$1 AND ref = ANY($2::text[])', [campaignId, refs.map(entry => entry.ref)]))
      .rows.map(row => row.ref as string),
  );
  const pending = refs.filter(entry => !mapped.has(entry.ref));
  if (!pending.length) return [];
  const holders = await charactersWithRefs(q, campaignId);
  return pending.map(entry => ({ ...entry, characters: holders.filter(holder => holder.refs.has(entry.ref)).map(holder => holder.name) }));
}

async function charactersWithRefs(q: Queryable, campaignId: string) {
  const rows = (
    await q.query(
      `SELECT id, name, sheet_extra FROM characters
       WHERE campaign_id=$1 AND sheet_extra ? 'importedStructure'`,
      [campaignId],
    )
  ).rows;
  return rows.map(row => {
    const { refs } = characterSpellRefs(row.sheet_extra);
    return { id: row.id as string, name: row.name as string, refs: new Map(refs.map(entry => [entry.ref, entry.lists])) };
  });
}

export async function applyRefEverywhere(
  q: Queryable, campaignId: string, ref: string,
  spell: { source: 'srd' | 'custom'; srdIndex: string | null; customSpellId: string | null },
) {
  let added = 0;
  for (const holder of await charactersWithRefs(q, campaignId)) {
    const lists = holder.refs.get(ref);
    if (lists) added += await insertSpell(q, campaignId, holder.id, spell, lists);
  }
  return added;
}
