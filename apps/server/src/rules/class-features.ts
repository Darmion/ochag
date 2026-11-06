import type { Queryable } from '../db.ts';
import type { ActionEconomy } from './action-economy.ts';
import { loadEffects, type Notice } from './conditions.ts';
import { restoreOwnForm } from './shape-forms.ts';
import { reject, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { characterClassLevels } from '../../../../packages/domain/character/classes.ts';
import { classFeaturesFor, classLevelOf, HIT_MANEUVERS, MANEUVERS, darkBlessingHp, kiSaveDc, knownManeuvers, phaseThreshold, phasesCrossed, superiorityDie, wildShapeLimit, QUIVERING_PALM_KI, knownSuperiorDefense, type BossPhase, type LegendaryOption } from '../../../../packages/domain/character/class-features.ts';
import { hasFeat } from '../../../../packages/domain/character/feats.ts';
import { SRD_GEAR_BY_INDEX } from '../../../../packages/domain/srd/gear.ts';
import { abilityModifier, proficiencyBonusForLevel } from '../../../../packages/domain/dice/dice.ts';
import { conditionState, incapacitatedReason } from '../../../../packages/domain/combat/conditions.ts';
import { mergedClassResources } from '../../../../packages/domain/srd/progression.ts';
import { SRD_MONSTERS } from '../../../../packages/domain/srd/monsters.ts';
import { relationsFor } from '../campaign/factions.ts';
import { registerBossRoutes } from './class-features/boss.ts';
import { registerChoiceRoutes } from './class-features/choices.ts';
import { fallOn, registerFallRoutes } from './class-features/fall.ts';
import { registerFeatureListRoutes } from './class-features/list.ts';
import { hurlBack, registerStrikeRoutes } from './class-features/strikes.ts';
import { registerFeatureUseRoutes } from './class-features/use.ts';

export const ANCESTRY_DAMAGE_RU: Record<string, string> = { acid: 'кислота', lightning: 'электричество', fire: 'огонь', poison: 'яд', cold: 'холод' };

type HpChange = { mode: 'damage' | 'heal'; amount: number; damageType: string | null; critical: boolean; ignoreResistance?: boolean; ignoreImmunity?: boolean; sourceId?: string | null };
export type HpResult = { row: any; applied: number; blocked: string | null; modified: string | null; notices: Notice[]; name: string; experience: any; dropped: boolean };

export type ClassFeatureContext = SceneFeatureContext & {
  rollDie: (sides: number) => number;
  insertRoll: (
    q: Queryable, campaignId: string, userId: string, characterId: string | null, label: string | null, formula: string,
    results: number[], modifier: number, total: number, hidden: boolean, breakdown?: unknown[] | null, outcome?: Record<string, unknown> | null,
  ) => Promise<any>;
  canManageCharacter: (q: Queryable, member: any, userId: string, ownerUserId: string | null, characterId?: string | null) => Promise<boolean>;
  isCharacterManager: (q: Queryable, member: any, userId: string) => Promise<boolean>;
  actionEconomy: ActionEconomy;
  applyHpChange: (q: Queryable, campaignId: string, userId: string, characterId: string, change: HpChange) => Promise<HpResult>;
  announceHpChange: (campaignId: string, characterId: string, mode: 'damage' | 'heal', change: HpResult & { critical?: boolean }) => void;
  campaignFlag: (q: Queryable, campaignId: string, key: string) => Promise<boolean | null>;
  creaturesNear?: (q: Queryable, campaignId: string, sceneId: string, characterId: string, feet: number) => Promise<Array<{ id: string; name: string }>>;
  feetApart?: (q: Queryable, campaignId: string, sceneId: string | null, a: string, b: string) => Promise<number | null>;
  isUndead?: (q: Queryable, campaignId: string, characterId: string) => Promise<boolean>;
  rollSaveAgainst?: (
    q: Queryable, campaignId: string, userId: string, characterId: string, ability: string, dc: number, label: string, hidden: boolean,
    against?: { condition?: string | null; magic?: boolean; damageType?: string | null } | null,
  ) => Promise<{ total: number; success: boolean; autoFail: boolean }>;
  unarmedStrike?: (campaignId: string, sceneId: string | null, characterId: string, targetId: string, userId: string, die: number) => Promise<any>;
  creatureType?: (q: Queryable, campaignId: string, characterId: string) => Promise<string | null>;
  weaponAttack?: (campaignId: string, sceneId: string | null, characterId: string, weaponId: string | null, targetId: string, userId: string) => Promise<any>;
  pushAway?: (q: Queryable, campaignId: string, sceneId: string, fromId: string, targetId: string, feet: number) => Promise<number>;
  legendaryStrike?: (
    campaignId: string, sceneId: string, bossId: string, option: LegendaryOption, preferred: string[],
  ) => Promise<{ summary: string; attacks?: any[]; targets?: any[]; moved?: unknown } | null>;
};

export const CHARACTER_COLUMNS = `id, name, kind, disposition, owner_user_id, level, class_name, sheet_extra, hp_current, hp_max, hp_temp, armor_class,
  speed_feet::float8 AS speed_feet, size, strength, dexterity, constitution, intelligence, wisdom, charisma, spell_save_dc_override, auto_reactions`;

export const HARMFUL_SPELL_EFFECTS = new Set([
  'blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'paralyzed', 'petrified', 'poisoned', 'prone',
  'restrained', 'stunned', 'unconscious', 'turned', 'slowed', 'no_reactions', 'no_healing', 'mocked', 'baned', 'marked', 'outlined',
]);

export function wildShapeBeasts(druidLevel: number) {
  const limit = wildShapeLimit(druidLevel);
  return SRD_MONSTERS
    .filter(monster => /зверь/.test(monster.type) && monster.cr <= limit.cr)
    .filter(monster => (limit.fly || !/лета/.test(monster.speedNote ?? '')) && (limit.swim || !/плава/.test(monster.speedNote ?? '')));
}

export async function revertWildShape(q: Queryable, campaignId: string, characterId: string, overflow = 0) {
  const effect = (
    await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='wild_shape' AND active RETURNING parameters`, [campaignId, characterId])
  ).rows[0] as { parameters: any } | undefined;
  if (!effect) return null;
  return restoreOwnForm(q, campaignId, characterId, effect.parameters, overflow);
}
export const RECHARGE_TEXT: Record<string, string> = { short: 'короткого', long: 'долгого' };

export async function classResourceOf(q: Queryable, campaignId: string, row: any, name: string, lock: boolean) {
  const found = (
    await q.query(`SELECT id, name, current, max, recharge FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3${lock ? ' FOR UPDATE' : ''}`, [campaignId, row.id, name])
  ).rows[0] as any;
  if (found) return found;
  const rule = mergedClassResources(characterClassLevels(row).classes, { charisma: abilityModifier(row.charisma) })
    .find(entry => entry.name === name) ?? null;
  if (!rule) return null;
  if (!lock) return { id: null, name, current: rule.max, max: rule.max, recharge: rule.recharge };
  return (
    await q.query(
      `INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,$3,$4,$4,$5)
       RETURNING id, name, current, max, recharge`,
      [campaignId, row.id, name, rule.max, rule.recharge],
    )
  ).rows[0];
}

export async function spendClassResource(q: Queryable, campaignId: string, row: any, name: string, amount = 1) {
  const resource = await classResourceOf(q, campaignId, row, name, true);
  if (!resource) reject(400, `В листе «${row.name}» нет ресурса «${name}».`);
  if (resource.current <= 0) reject(400, `«${name}» потрачено — восстановится после ${RECHARGE_TEXT[resource.recharge] ?? 'долгого'} отдыха.`);
  if (resource.current < amount) reject(400, `«${name}»: осталось ${resource.current}, нужно ${amount}.`);
  await q.query('UPDATE character_resources SET current=current-$2 WHERE id=$1', [resource.id, amount]);
  return { ...resource, current: resource.current - amount };
}

export const LEGENDARY_RESISTANCE = 'Легендарное сопротивление';
export async function syncLegendaryResistance(q: Queryable, campaignId: string, characterId: string, perDay: number) {
  if (perDay <= 0) {
    await q.query('DELETE FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3', [campaignId, characterId, LEGENDARY_RESISTANCE]);
    return;
  }
  const updated = await q.query(
    `UPDATE character_resources SET current = CASE WHEN max <> $4 THEN $4 ELSE LEAST(current, $4) END, max=$4, recharge='long'
     WHERE campaign_id=$1 AND character_id=$2 AND name=$3 RETURNING id`,
    [campaignId, characterId, LEGENDARY_RESISTANCE, perDay],
  );
  if (!updated.rows.length) {
    await q.query(
      `INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,$3,$4,$4,'long')`,
      [campaignId, characterId, LEGENDARY_RESISTANCE, perDay],
    );
  }
}

export function creatureTypeText(sheetExtra: any): string {
  const index = sheetExtra?.srdMonster;
  const monster = index ? SRD_MONSTERS.find(entry => entry.index === index) : null;
  if (monster) return monster.type;
  const about = sheetExtra?.text?.about?.value;
  return typeof sheetExtra?.creatureType === 'string' ? sheetExtra.creatureType : typeof about === 'string' ? about.split('\n')[0] ?? '' : '';
}

export async function smiteOffer(q: Queryable, campaignId: string, attacker: { id: string; level: number | null; class_name?: string | null; sheet_extra?: unknown }) {
  if (!classFeaturesFor(characterClassLevels(attacker as any).classes).some(feature => feature.id === 'divine-smite')) return null;
  const slots = (
    await q.query('SELECT level, current FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND current > 0 ORDER BY level', [campaignId, attacker.id])
  ).rows as Array<{ level: number; current: number }>;
  return slots.length ? { slots } : null;
}

export async function hasEvasion(q: Queryable, campaignId: string, characterId: string) {
  const row = (await q.query('SELECT id, level, class_name, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
  if (!row) return false;
  const features = classFeaturesFor(characterClassLevels(row).classes);
  const hunter = features.some(feature => feature.id === 'superior-hunters-defense') && knownSuperiorDefense(row.sheet_extra).includes('evasion');
  if (!hunter && !features.some(feature => feature.id === 'evasion' || feature.id === 'evasion-monk')) return false;
  const state = conditionState((await loadEffects(q, campaignId, characterId)).map(effect => effect.effect_code));
  return !incapacitatedReason(state);
}

const SHIELD_NAMES = [SRD_GEAR_BY_INDEX.get('shield')?.nameRu.toLowerCase() ?? 'щит', 'shield'];
async function shieldMasterReady(q: Queryable, campaignId: string, characterId: string): Promise<boolean> {
  const row = (await q.query('SELECT kind, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
  if (!row || row.kind === 'object' || !hasFeat(row.sheet_extra, 'shield-master')) return false;
  if (incapacitatedReason(conditionState((await loadEffects(q, campaignId, characterId)).map(effect => effect.effect_code)))) return false;
  const held = (
    await q.query(`SELECT lower(name) AS name FROM characters WHERE campaign_id=$1 AND container_id=$2 AND kind='object'`, [campaignId, characterId])
  ).rows.map(entry => String(entry.name));
  return held.some(name => SHIELD_NAMES.some(shield => name === shield || name.startsWith(`${shield} `)));
}

export async function shieldMasterBonus(q: Queryable, campaignId: string, characterId: string): Promise<{ value: number; reason: string } | null> {
  return (await shieldMasterReady(q, campaignId, characterId)) ? { value: 2, reason: 'мастер щита (+2 к спасброску ЛОВ)' } : null;
}

export async function shieldMasterDodge(q: Queryable, campaignId: string, characterId: string): Promise<boolean> {
  return (await shieldMasterReady(q, campaignId, characterId)) && useReaction(q, campaignId, characterId);
}

export async function useReaction(q: Queryable, campaignId: string, characterId: string): Promise<boolean> {
  if ((await loadEffects(q, campaignId, characterId)).some(effect => effect.effect_code === 'no_reactions')) return false;
  const entry = (
    await q.query(
      `SELECT ie.id, ie.reaction_used FROM initiative_entries ie JOIN scenes s ON s.id = ie.scene_id
       WHERE ie.campaign_id=$1 AND ie.character_id=$2 AND s.combat_started_at IS NOT NULL LIMIT 1`,
      [campaignId, characterId],
    )
  ).rows[0] as { id: string; reaction_used: boolean } | undefined;
  if (entry) {
    if (entry.reaction_used) return false;
    await q.query('UPDATE initiative_entries SET reaction_used=true WHERE id=$1', [entry.id]);
  }
  return true;
}

export async function stunOffer(q: Queryable, campaignId: string, attacker: any, targetId: string) {
  const classes = characterClassLevels(attacker).classes;
  if (!classFeaturesFor(classes).some(feature => feature.id === 'stunning-strike')) return null;
  const ki = (await q.query(`SELECT current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name='Ци'`, [campaignId, attacker.id])).rows[0];
  const monk = classLevelOf(classes, 'monk', attacker.level);
  const left = ki ? Number(ki.current) : monk;
  if (left <= 0) return null;
  const stunned = (await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='stunned' AND active`, [campaignId, targetId])).rows[0];
  if (stunned) return null;
  return { ki: left, dc: kiSaveDc(proficiencyBonusForLevel(Math.max(1, attacker.level ?? monk)), abilityModifier(Number(attacker.wisdom ?? 10))) };
}

export async function quiveringOffer(q: Queryable, campaignId: string, attacker: any, unarmed: boolean) {
  if (!unarmed) return null;
  const classes = characterClassLevels(attacker).classes;
  if (!classFeaturesFor(classes).some(feature => feature.id === 'quivering-palm')) return null;
  const ki = (await q.query(`SELECT current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name='Ци'`, [campaignId, attacker.id])).rows[0];
  const left = ki ? Number(ki.current) : classLevelOf(classes, 'monk', attacker.level);
  if (left < QUIVERING_PALM_KI) return null;
  return { ki: left, cost: QUIVERING_PALM_KI };
}

export async function hurlOffer(q: Queryable, campaignId: string, attacker: any) {
  if (!classFeaturesFor(characterClassLevels(attacker).classes).some(feature => feature.id === 'hurl-through-hell')) return null;
  const resource = await classResourceOf(q, campaignId, { ...attacker, charisma: attacker.charisma ?? 10 }, 'Бросок через ад', false);
  return resource && Number(resource.current) > 0 ? { left: Number(resource.current) } : null;
}

export async function maneuverOffer(q: Queryable, campaignId: string, attacker: any) {
  const classes = characterClassLevels(attacker).classes;
  if (!classFeaturesFor(classes).some(feature => feature.id === 'combat-superiority')) return null;
  const known = knownManeuvers(attacker.sheet_extra).filter(id => (HIT_MANEUVERS as string[]).includes(id));
  if (!known.length) return null;
  const resource = await classResourceOf(q, campaignId, { ...attacker, charisma: attacker.charisma ?? 10 }, 'Кости превосходства', false);
  if (!resource || resource.current <= 0) return null;
  return {
    dice: Number(resource.current), die: superiorityDie(classLevelOf(classes, 'fighter', attacker.level)),
    maneuvers: MANEUVERS.filter(entry => known.includes(entry.id)).map(entry => ({ id: entry.id, name: entry.nameRu })),
  };
}

export async function darkOnesBlessing(q: Queryable, campaignId: string, killerId: string | null, victimId: string) {
  if (!killerId || killerId === victimId) return null;
  const rows = (
    await q.query('SELECT id, name, kind, disposition, level, class_name, sheet_extra, charisma FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, [killerId, victimId]])
  ).rows as any[];
  const killer = rows.find(row => row.id === killerId);
  const victim = rows.find(row => row.id === victimId);
  if (!killer || !victim) return null;
  const classes = characterClassLevels(killer).classes;
  if (!classFeaturesFor(classes).some(feature => feature.id === 'dark-ones-blessing')) return null;
  if (!(await relationsFor(q, campaignId, [killerId, victimId])).enemies(killerId, victimId)) return null;
  const value = darkBlessingHp(abilityModifier(Number(killer.charisma ?? 10)), classLevelOf(classes, 'warlock', killer.level));
  await q.query('UPDATE characters SET hp_temp = GREATEST(hp_temp, $3), revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, killerId, value]);
  return { characterId: killerId as string, name: killer.name as string, value };
}

export async function sceneOfCreature(q: Queryable, campaignId: string, characterId: string, sceneId: string | null | undefined) {
  if (sceneId) return sceneId;
  return (
    await q.query(
      `SELECT o.scene_id FROM scene_objects o
       LEFT JOIN initiative_entries i ON i.campaign_id=o.campaign_id AND i.scene_id=o.scene_id AND i.character_id=o.character_id
       WHERE o.campaign_id=$1 AND o.character_id=$2 AND o.parent_object_id IS NULL
       ORDER BY (i.id IS NOT NULL) DESC, o.created_at DESC LIMIT 1`,
      [campaignId, characterId],
    )
  ).rows[0]?.scene_id as string | undefined ?? null;
}

export async function bossPhaseNotices(
  q: Queryable, campaignId: string, boss: { id: string; name: string; kind: string; hp_max: number; boss_phases?: unknown }, before: number, after: number,
): Promise<Notice[]> {
  if (boss.kind !== 'npc' || !Array.isArray(boss.boss_phases) || !boss.boss_phases.length) return [];
  const phases = boss.boss_phases as BossPhase[];
  const crossed = phasesCrossed(phases, boss.hp_max, before, after);
  if (!crossed.length) return [];
  const next = phases.map((phase, index) => (crossed.includes(index) ? { ...phase, done: true } : phase));
  await q.query('UPDATE characters SET boss_phases=$3::jsonb, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, boss.id, JSON.stringify(next)]);
  return crossed.map(index => {
    const phase = phases[index]!;
    return {
      title: `${boss.name}: ${phase.title}`,
      detail: phase.text || `Хиты — ${phaseThreshold(boss.hp_max, phase.atPercent)} и меньше (${phase.atPercent} %).`,
      secret: !phase.public,
      characterId: boss.id,
    };
  });
}

export function withFeatures<A extends unknown[], R>(ctx: ClassFeatureContext, fn: (ctx: ClassFeatureContext, ...args: A) => R): (...args: A) => R {
  return (...args) => fn(ctx, ...args);
}

export function registerClassFeatureRoutes(ctx: ClassFeatureContext) {
  registerFeatureListRoutes(ctx);
  registerFeatureUseRoutes(ctx);
  registerFallRoutes(ctx);
  registerStrikeRoutes(ctx);
  registerChoiceRoutes(ctx);
  registerBossRoutes(ctx);

  return {
    fall: async (q: Queryable, campaignId: string, userId: string, characterId: string, feet: number, hidden: boolean) => {
      const row = (await q.query(`SELECT ${CHARACTER_COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE`, [campaignId, characterId])).rows[0] as any;
      if (!row) return null;
      return fallOn(ctx, q, campaignId, userId, row, feet, hidden);
    },
    hurlBack: withFeatures(ctx, hurlBack),
  };
}
