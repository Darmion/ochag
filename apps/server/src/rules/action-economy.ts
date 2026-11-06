import { extraActionsOf, restrictionsOf, spellModsOf } from '../../../../packages/domain/spells/spell-mods.ts';
import type { Queryable } from '../db.ts';
import { reject } from '../tabletop/scene-feature.ts';

export type ActionUse = 'action' | 'bonus' | 'reaction';
export type ActionSpend = { kind: 'attack' | 'spell' | 'other'; spellLevel?: number; haste?: boolean };

type Context = {
  campaignFlag: (q: Queryable, campaignId: string, key: string) => Promise<boolean | null>;
};

export function createActionEconomy({ campaignFlag }: Context) {
  async function enabled(q: Queryable, campaignId: string) {
    return (await campaignFlag(q, campaignId, 'action_economy')) !== false;
  }

  async function enforceFor(q: Queryable, campaignId: string, manager: boolean) {
    if (!manager) return true;
    return (await campaignFlag(q, campaignId, 'gm_free_move')) !== true;
  }

  async function entryFor(q: Queryable, campaignId: string, characterId: string, sceneId?: string | null) {
    return (
      await q.query(
        `SELECT id, scene_id, name, is_current, action_used, bonus_used, reaction_used, attacks_made,
                disengaged, leveled_action_spell, bonus_spell, turn_flags
         FROM initiative_entries
         WHERE campaign_id=$1 AND character_id=$2 AND ($3::uuid IS NULL OR scene_id=$3)
         ORDER BY is_current DESC, created_at LIMIT 1
         FOR UPDATE`,
        [campaignId, characterId, sceneId ?? null],
      )
    ).rows[0] as any;
  }

  async function spend(
    q: Queryable, campaignId: string, characterId: string, use: ActionUse, what: ActionSpend,
    options: { enforce: boolean; sceneId?: string | null; attacksPerAction?: number },
  ) {
    if (!(await enabled(q, campaignId))) return null;
    const entry = await entryFor(q, campaignId, characterId, options.sceneId);
    if (!entry) return null;
    const { enforce } = options;
    const name = entry.name as string;

    if (use !== 'reaction' && !entry.is_current) {
      if (enforce) reject(400, `Сейчас не ход «${name}»: вне своего хода — только реакция.`);
      return null;
    }

    const sets: string[] = [];
    let attacksMade = entry.attacks_made as number;
    const marks = new Set((await q.query(
      `SELECT effect_code FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('hasted', 'slow_spell', 'lethargic')`,
      [campaignId, characterId],
    )).rows.map(row => row.effect_code as string));
    const templated = spellModsOf((await q.query(
      `SELECT id, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='spell_mod' AND parameters->>'kind' IN ('restrict', 'extra-action')`,
      [campaignId, characterId],
    )).rows as Array<{ id: string; parameters: any }>);
    const restricted = restrictionsOf(templated);
    const extraActions = extraActionsOf(templated);
    if (restricted.has('action-or-bonus')) marks.add('slow_spell');
    if (restricted.has('no-move-or-act')) marks.add('lethargic');
    const perAction = marks.has('slow_spell') || restricted.has('one-attack') ? 1 : Math.max(1, Math.trunc(options.attacksPerAction ?? 1));
    if (use !== 'reaction' && marks.has('lethargic') && enforce) {
      reject(400, `${name} вял после «Ускорения»: до конца следующего хода — ни движения, ни действий.`);
    }

    if (use === 'reaction') {
      const blocked = (
        await q.query(`SELECT effect_code FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('no_reactions', 'turned', 'slow_spell') LIMIT 1`, [campaignId, characterId])
      ).rows[0] ?? (restricted.has('no-reactions') ? { effect_code: 'no_reactions' } : undefined);
      if (blocked) reject(400, `${name} не может реагировать: ${blocked.effect_code === 'turned' ? 'изгнан' : blocked.effect_code === 'slow_spell' ? 'замедлен заклинанием' : 'без реакций до начала своего хода'}.`);
      if (entry.reaction_used && enforce) reject(400, `${name}: реакция уже потрачена — она вернётся в начале его хода.`);
      sets.push('reaction_used=true');
    } else if (use === 'bonus') {
      if (entry.bonus_used && enforce) reject(400, `${name}: бонусное действие в этот ход уже потрачено.`);
      if (marks.has('slow_spell') && entry.action_used && enforce) reject(400, `${name} замедлен: в ход — действие или бонусное действие, не оба.`);
      if (what.kind === 'spell' && entry.leveled_action_spell && enforce) {
        reject(400, 'Заклинание бонусным действием — только если действием в этот ход сотворён не больше чем заговор.');
      }
      sets.push('bonus_used=true');
      if (what.kind === 'spell') sets.push('bonus_spell=true');
    } else {
      const continuing = what.kind === 'attack' && entry.action_used && attacksMade > 0 && attacksMade < perAction;
      if (marks.has('slow_spell') && entry.bonus_used && enforce) reject(400, `${name} замедлен: в ход — действие или бонусное действие, не оба.`);
      const templateExtra = what.kind === 'attack' ? extraActions.has('attack-one') && what.haste !== false
        : what.haste === true && ['dash', 'disengage', 'hide', 'use-object'].some(entry => extraActions.has(entry));
      const haste = entry.action_used && !continuing && ((marks.has('hasted') && (what.haste ?? what.kind === 'attack')) || templateExtra) && !((entry.turn_flags ?? []) as string[]).includes('haste');
      if (haste) {
        sets.push(`turn_flags = array_append(turn_flags, 'haste')`);
        if (what.kind === 'attack') {
          attacksMade = perAction;
          sets.push(`attacks_made=${attacksMade}`);
        }
        await q.query(`UPDATE initiative_entries SET ${sets.join(', ')} WHERE id=$1`, [entry.id]);
        return { entryId: entry.id as string, sceneId: entry.scene_id as string, use, attacksMade, perAction, haste: true };
      }
      if (entry.action_used && !continuing && enforce) {
        reject(400, attacksMade > 0
          ? `${name}: атаки действия «Атака» в этот ход сделаны (${attacksMade} из ${perAction}).`
          : `${name}: действие в этот ход уже потрачено.`);
      }
      if (what.kind === 'spell' && (what.spellLevel ?? 0) > 0 && entry.bonus_spell && enforce) {
        reject(400, 'После заклинания бонусным действием действием можно сотворить только заговор.');
      }
      sets.push('action_used=true');
      if (what.kind === 'attack') {
        attacksMade = Math.min(20, attacksMade + 1);
        sets.push(`attacks_made=${attacksMade}`);
      }
      if (what.kind === 'spell' && (what.spellLevel ?? 0) > 0) sets.push('leveled_action_spell=true');
    }

    await q.query(`UPDATE initiative_entries SET ${sets.join(', ')} WHERE id=$1`, [entry.id]);
    return { entryId: entry.id as string, sceneId: entry.scene_id as string, use, attacksMade, perAction };
  }

  return { enabled, enforceFor, entryFor, spend };
}

export type ActionEconomy = ReturnType<typeof createActionEconomy>;

export async function beginTurn(q: Queryable, campaignId: string, entryId: string) {
  const row = (
    await q.query(
      `UPDATE initiative_entries SET is_current=true, moved_feet=0, moved_diagonals=0, dashes=0,
         action_used=false, bonus_used=false, reaction_used=false, attacks_made=0,
         disengaged=false, leveled_action_spell=false, bonus_spell=false,
         action_surged=false, legendary_used=0
       WHERE campaign_id=$1 AND id=$2 RETURNING character_id, scene_id`,
      [campaignId, entryId],
    )
  ).rows[0] as { character_id: string | null; scene_id: string } | undefined;
  if (row) {
    await q.query("UPDATE initiative_entries SET sneak_attack_used=false, colossus_used=false, turn_flags='{}' WHERE campaign_id=$1 AND scene_id=$2 AND (sneak_attack_used OR colossus_used OR turn_flags <> '{}')", [campaignId, row.scene_id]);
  }
  if (row?.character_id) {
    await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='dodging'`, [campaignId, row.character_id]);
  }
  return row?.character_id ?? null;
}
