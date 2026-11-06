import type { Queryable } from '../db.ts';
import { characterClassLevels, type ClassLevel } from '../../../../packages/domain/character/classes.ts';
import { isPactCaster, multiclassSpellSlots, spellSlotsFor } from '../../../../packages/domain/spells/spell-slots.ts';
import { mixedPact, pactSystem, type PactSystem } from './multiclass.ts';

export async function applyClassSlots(q: Queryable, campaignId: string, characterId: string) {
  const row = (
    await q.query(
      'SELECT level, class_name, sheet_extra, pact_slots_max, pact_slots_current FROM characters WHERE campaign_id=$1 AND id=$2',
      [campaignId, characterId],
    )
  ).rows[0] as any;
  if (!row) return null;
  const { classes, multiclass } = characterClassLevels(row);
  const classId = classes[0]?.id ?? null;
  const multi = multiclass ? multiclassSpellSlots(classes) : null;
  const table = multiclass ? multi?.slots ?? null : spellSlotsFor(classId, row.level);
  if (!table) return null;

  const mixed = multiclass ? mixedPact(classes) : null;
  const system: PactSystem | null = mixed ? await pactSystem(q, campaignId) : null;
  if (system === 'manual') return { classId, slots: null, pact: null, pactSystem: system };

  const maxima = [...table];
  if (multi?.pact && (!mixed || system === 'merged')) maxima[multi.pact.slotLevel - 1]! += multi.pact.count;

  const existing = new Map(
    (
      await q.query('SELECT level, current, max FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 FOR UPDATE', [campaignId, characterId])
    ).rows.map(entry => [entry.level as number, entry as { current: number; max: number }]),
  );
  const slots: Array<{ level: number; current: number; max: number }> = [];
  for (let level = 1; level <= 9; level++) {
    const max = maxima[level - 1] ?? 0;
    const before = existing.get(level) ?? { current: 0, max: 0 };
    const current = Math.max(0, Math.min(max, before.current + Math.max(0, max - before.max)));
    if (max > 0 || existing.has(level)) {
      await q.query(
        `INSERT INTO character_spell_slots (campaign_id, character_id, level, current, max) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (campaign_id, character_id, level) DO UPDATE SET current=$4, max=$5`,
        [campaignId, characterId, level, current, max],
      );
    }
    slots.push({ level, current, max });
  }

  let pact: { current: number; max: number; slotLevel: number } | null = null;
  if (mixed && system === 'separate') {
    const max = mixed.pact.count;
    const current = Math.max(0, Math.min(max, (row.pact_slots_current ?? 0) + Math.max(0, max - (row.pact_slots_max ?? 0))));
    pact = { current, max, slotLevel: mixed.pact.slotLevel };
    await q.query(
      'UPDATE characters SET pact_slots_max=$3, pact_slots_current=$4, pact_slot_level=$5 WHERE campaign_id=$1 AND id=$2',
      [campaignId, characterId, max, current, mixed.pact.slotLevel],
    );
  } else if (row.pact_slots_max !== null) {
    await q.query('UPDATE characters SET pact_slots_max=NULL, pact_slots_current=NULL, pact_slot_level=NULL WHERE campaign_id=$1 AND id=$2', [campaignId, characterId]);
  }
  return { classId, slots, pact, pactSystem: system };
}

export async function restorePactSlots(q: Queryable, campaignId: string, characterId: string, classes: ClassLevel[]): Promise<number> {
  const mixed = mixedPact(classes);
  if (!mixed) {
    if (!classes.some(entry => isPactCaster(entry.id))) return 0;
    return (
      await q.query(
        `UPDATE character_spell_slots SET current=max WHERE campaign_id=$1 AND character_id=$2 AND current < max RETURNING level`,
        [campaignId, characterId],
      )
    ).rows.length;
  }
  const system = await pactSystem(q, campaignId);
  if (system === 'merged') {
    return (
      await q.query(
        `UPDATE character_spell_slots SET current=LEAST(max, current + $4)
         WHERE campaign_id=$1 AND character_id=$2 AND level=$3 AND current < max RETURNING level`,
        [campaignId, characterId, mixed.pact.slotLevel, mixed.pact.count],
      )
    ).rows.length;
  }
  if (system === 'separate') {
    return (
      await q.query(
        `UPDATE characters SET pact_slots_current=pact_slots_max
         WHERE campaign_id=$1 AND id=$2 AND pact_slots_current < pact_slots_max RETURNING id`,
        [campaignId, characterId],
      )
    ).rows.length;
  }
  return 0;
}

export async function pactSlotsSpent(q: Queryable, campaignId: string, characterId: string, classes: ClassLevel[]): Promise<number> {
  const mixed = mixedPact(classes);
  if (!mixed) {
    if (!classes.some(entry => isPactCaster(entry.id))) return 0;
    return Number((
      await q.query('SELECT COALESCE(SUM(max - current), 0)::int AS spent FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND current < max', [campaignId, characterId])
    ).rows[0]?.spent ?? 0);
  }
  const system = await pactSystem(q, campaignId);
  if (system === 'merged') {
    const slot = (await q.query('SELECT current, max FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND level=$3', [campaignId, characterId, mixed.pact.slotLevel])).rows[0] as any;
    return slot ? Math.min(mixed.pact.count, Math.max(0, Number(slot.max) - Number(slot.current))) : 0;
  }
  if (system === 'separate') {
    const row = (await q.query('SELECT pact_slots_current, pact_slots_max FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
    return row?.pact_slots_max ? Math.max(0, Number(row.pact_slots_max) - Number(row.pact_slots_current ?? 0)) : 0;
  }
  return 0;
}
