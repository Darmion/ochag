import { reject, canManage } from '../shared.ts';
import { canManageCharacter } from '../scene/placements.ts';
import { guardFriendlyFire } from '../../campaign/factions.ts';
import { superiorityDie, classLevelOf } from '../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { spendClassResource } from '../../rules/class-features.ts';
import { checkModifier, weaponStyles, ownRollState, markTurnFlags, featSituation, consumeHelp, alertTarget, saveAids, feralSenses } from './modifiers.ts';
import { type FormulaContext, resolveModifier } from '../../../../../packages/domain/dice/formula.ts';
import { abilityModifier } from '../../../../../packages/domain/dice/dice.ts';
import { type BonusBasis, bonusAttackBasis, bonusAttackRefusal, READIED_EFFECT, REACTION_REFUSAL, BONUS_BASIS_LABELS, attackActionFlags } from '../../../../../packages/domain/combat/attack-economy.ts';
import { hasFeat } from '../../../../../packages/domain/character/feats.ts';
import { incapacitatedReason, type Ability as ConditionAbility } from '../../../../../packages/domain/combat/conditions.ts';
import { attacksPerActionFor, attackSituation, weaponRanges, attackMarks } from '../combat/attack.ts';
import { rollSaveAgainst } from './checks.ts';
import { naturesSanctuaryDc } from '../combat/auras.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { withinFeet } from '../scene/movement.ts';
import { obscuredSight, invisibilitySeen } from '../combat/sight.ts';
import { stealthAttack } from '../combat/stealth.ts';
import { protectionStyle } from '../combat/reactions.ts';
import { hunterTactic } from '../combat/hp.ts';
import type { TableContext } from '../context.ts';
import type { Queryable } from '../../db.ts';
import type { ActionUse } from '../../rules/action-economy.ts';
import type { Opportunity } from '../combat/opportunity.ts';
import type { CheckBody, CheckInternal } from './roll-check.ts';

export async function prepareCheck(ctx: TableContext, q: Queryable, member: any, userId: string, campaignId: string, body: CheckBody, internal: CheckInternal, using: ActionUse | undefined, opportunityEntry: Opportunity | undefined) {
  const { actionEconomy } = ctx;
  const { characterId, kind, key, bonusFormula, targetCharacterId, sceneId, power, twoHanded, inspiration, hidden, sense, opportunity } = body;
  let economyScene: string | null = null;
  let ammoSpent = false;
  let extraGuard: { id: string; name: string } | null = null;

  const character = (
    await q.query(
      `SELECT id, name, owner_user_id, level, challenge_rating::float8 AS challenge_rating, sheet_extra, class_name,
                  strength, dexterity, constitution, intelligence, wisdom, charisma
           FROM characters WHERE campaign_id=$1 AND id=$2`,
      [campaignId, characterId],
    )
  ).rows[0];

  if (!character) reject(404, 'Персонаж не найден.');

  if (!(await canManageCharacter(q, member, userId, character.owner_user_id, character.id))) {
    reject(403, 'Бросать за чужого персонажа может только его владелец или мастер.');
  }
  if (body.warnFriendly && kind === 'attack' && targetCharacterId) await guardFriendlyFire(q, campaignId, characterId, [targetCharacterId], true);
  const riposteDie = internal.riposte ? superiorityDie(classLevelOf(characterClassLevels(character).classes, 'fighter', character.level)) : 0;
  if (internal.riposte) await spendClassResource(q, campaignId, character, 'Кости превосходства');

  const check = await checkModifier(q, campaignId, character, kind, key);
  const { label, proficiencyBonus } = check;
  let modifier = check.modifier;

  if (bonusFormula !== undefined) {
    const context: FormulaContext = {
      str: abilityModifier(character.strength),
      dex: abilityModifier(character.dexterity),
      con: abilityModifier(character.constitution),
      int: abilityModifier(character.intelligence),
      wis: abilityModifier(character.wisdom),
      cha: abilityModifier(character.charisma),
      ...(proficiencyBonus !== null ? { prof: proficiencyBonus } : {}),
    };

    const resolved = resolveModifier(bonusFormula, context);
    if (!resolved.ok) {
      const reason =
        resolved.reason === 'unknown-token' ? `неизвестная переменная @${resolved.token}`
        : resolved.reason === 'missing-value' ? `нет значения для @${resolved.token}`
        : 'некорректный формат';
      reject(400, `Личный бонус: ${reason}.`);
    }
    modifier += resolved.modifier;
  }
  const styleWeapon = kind === 'attack'
    ? (await q.query('SELECT name, weapon_kind, properties, srd_index, versatile_formula FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND id=$3', [campaignId, characterId, key])).rows[0] as any
    : null;
  const monk = classLevelOf(characterClassLevels(character).classes, 'monk', character.level) > 0;
  let bonusBasis: BonusBasis | null = null;
  if (kind === 'attack' && !internal.free && (using === 'bonus' || (using === 'reaction' && !opportunity && !internal.riposte && !internal.reacted))) {
    const turn = (
      await q.query(
        `SELECT id, is_current, turn_flags FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 AND ($3::uuid IS NULL OR scene_id=$3)
             ORDER BY is_current DESC, created_at LIMIT 1`,
        [campaignId, characterId, sceneId ?? null],
      )
    ).rows[0] as { id: string; is_current: boolean; turn_flags: string[] } | undefined;
    const enforced = Boolean(turn) && (await actionEconomy.enabled(q, campaignId)) && (await actionEconomy.enforceFor(q, campaignId, await canManage(q, member, userId)));
    if (using === 'bonus' && styleWeapon) {
      const context = { flags: turn?.turn_flags ?? [], hasFeat: (id: string) => hasFeat(character.sheet_extra, id), monk };
      bonusBasis = bonusAttackBasis({ id: key, ...styleWeapon }, context);
      if (!bonusBasis && enforced && turn?.is_current) reject(400, bonusAttackRefusal({ id: key, ...styleWeapon }, context));
    }
    if (using === 'reaction' && turn) {
      const readied = (
        await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code=$3 AND active RETURNING id`, [campaignId, characterId, READIED_EFFECT])
      ).rows[0];
      if (!readied && enforced) reject(400, REACTION_REFUSAL);
    }
  }
  const styles = styleWeapon ? weaponStyles(character, styleWeapon, { power, twoHanded, using: using ?? null, bonusBasis }) : null;
  if (bonusBasis && bonusBasis !== 'polearm' && bonusBasis !== 'crossbow') styles?.reasons.push(`бонусным: ${BONUS_BASIS_LABELS[bonusBasis]}`);
  if (power && !styles?.powerBy) {
    reject(400, kind === 'attack' && styleWeapon?.weapon_kind === 'ranged'
      ? '−5 / +10 дальнобойным — черта «Меткий стрелок».'
      : '−5 / +10 — черта «Мастер большого оружия» (тяжёлым рукопашным) или «Меткий стрелок» (дальнобойным).');
  }
  if (styles) modifier += styles.attack;

  const own = await ownRollState(q, campaignId, characterId);
  if (kind === 'attack') {
    const unable = incapacitatedReason(own);
    if (unable) reject(400, `${character.name} не может атаковать: ${unable}.`);
    if (own.codes.has('turned')) reject(400, `${character.name} изгнан — может только бежать (Рывок) или вырываться.`);
  }
  if (kind === 'attack') {
    const spent = internal.free ? null : await actionEconomy.spend(q, campaignId, characterId, using ?? 'action', { kind: 'attack' }, {
      enforce: await actionEconomy.enforceFor(q, campaignId, await canManage(q, member, userId)), sceneId: sceneId ?? null,
      attacksPerAction: await attacksPerActionFor(q, campaignId, characterId),
    });
    economyScene = spent?.sceneId ?? null;
    if (spent && spent.use === 'action' && styleWeapon) await markTurnFlags(q, campaignId, characterId, attackActionFlags({ id: key, ...styleWeapon }, { monk }));
    const ammo = (
      await q.query(
        `SELECT r.id, r.name, r.current FROM character_weapons w
             JOIN character_resources r ON r.id = w.ammo_resource_id
             WHERE w.campaign_id=$1 AND w.character_id=$2 AND w.id=$3 FOR UPDATE OF r`,
        [campaignId, characterId, key],
      )
    ).rows[0] as any;
    if (ammo) {
      if (ammo.current <= 0) reject(400, `Нет боеприпасов: «${ammo.name}». Пополните их в снаряжении или возьмите другое оружие.`);
      await q.query('UPDATE character_resources SET current=current-1 WHERE id=$1', [ammo.id]);
      ammoSpent = true;
    }
  }
  if (inspiration) {
    const spent = (
      await q.query('UPDATE characters SET inspiration=false, revision=revision+1 WHERE campaign_id=$1 AND id=$2 AND inspiration RETURNING id', [campaignId, characterId])
    ).rows[0];
    if (!spent) reject(400, `У «${character.name}» нет вдохновения.`);
  }

  let target: { id: string; name: string; armor_class: number } | null = null;
  let situation: Awaited<ReturnType<typeof attackSituation>> = null;
  let targetState = null;
  let within5ft: boolean | null = null;
  if (targetCharacterId) {
    target = (
      await q.query('SELECT id, name, kind, armor_class FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetCharacterId])
    ).rows[0] as any ?? null;
    if (!target) reject(404, 'Цель не найдена.');
    if (target.id === characterId) reject(400, 'Нельзя атаковать самого себя — выберите целью другое существо.');
    const charmedBy = (
      await q.query(
        `SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active
               AND effect_code='charmed' AND parameters->>'sourceCharacterId' = $3`,
        [campaignId, characterId, target.id],
      )
    ).rows[0];
    if (charmedBy) reject(400, `${character.name} очарован «${target.name}» и не может его атаковать.`);
    if (kind === 'attack') {
      const ward = (
        await q.query(`SELECT parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='sanctuary' AND active LIMIT 1`, [campaignId, target.id])
      ).rows[0] as { parameters: any } | undefined;
      if (ward && ward.parameters?.sourceCharacterId !== characterId) {
        const save = await rollSaveAgainst(ctx, q, campaignId, userId, characterId, 'wisdom', Number(ward.parameters?.dc ?? 13), `Спасбросок МДР против «Убежища» — ${character.name}`.slice(0, 100), hidden ?? false, null, [], { magic: true });
        if (!save.success) {
          return { done: {
            ...save.roll, damage: null, extraDamage: null, sanctuary: true,
            outcome: { kind: 'attack', target: { id: target.id, name: target.name }, hit: false, sanctuary: true, reasons: ['«Убежище»: спасбросок Мудрости провален — атака потеряна'] },
          }, economyScene, ammoSpent, extraGuard };
        }
      }
      await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='sanctuary' AND active`, [campaignId, characterId]);
      const shrine = await naturesSanctuaryDc(q, campaignId, target.id, characterId);
      if (shrine !== null) {
        const save = await rollSaveAgainst(ctx, q, campaignId, userId, characterId, 'wisdom', shrine, `Спасбросок МДР против «Святилища природы» — ${character.name}`.slice(0, 100), hidden ?? false, null, [], { magic: true });
        if (!save.success) {
          return { done: {
            ...save.roll, damage: null, extraDamage: null, sanctuary: true,
            outcome: { kind: 'attack', target: { id: target.id, name: target.name }, hit: false, sanctuary: true, reasons: ['«Святилище природы»: спасбросок Мудрости провален — атака не состоялась'] },
          }, economyScene, ammoSpent, extraGuard };
        }
      }
    }
    targetState = await loadConditionState(q, campaignId, target.id);
    if (sceneId) within5ft = await withinFeet(q, campaignId, sceneId, characterId, target.id, 5);

    if (kind === 'attack' && sceneId) {
      const weapon = (
        await q.query(
          'SELECT name, range_feet, weapon_kind, long_range_feet, thrown_range_feet FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND id=$3',
          [campaignId, characterId, key],
        )
      ).rows[0] as any;
      if (weapon) {
        situation = await attackSituation(q, campaignId, sceneId, characterId, target.id, {
          kind: 'weapon', name: weapon.name, ranges: weaponRanges(weapon), ignoreRange: Boolean(opportunityEntry),
        });
      }
    }
  }
  const situationNotes = kind === 'attack' ? featSituation(character, styleWeapon, situation) : [];
  const checkHelp = kind === 'skill' || kind === 'ability' ? await consumeHelp(q, campaignId, characterId) : null;
  const alerted = kind === 'attack' && target ? await alertTarget(q, campaignId, target.id) : false;

  const obscured = ((kind === 'skill' && key === 'perception') || sense === 'sight') && sceneId ? await obscuredSight(q, campaignId, sceneId, characterId) : [];
  const sightBlocked = sense === 'sight' && obscured.includes('темнота') ? 'темнота' : null;
  const sightReasons = sightBlocked ? [] : obscured;
  const stealth = kind === 'attack' && target && sceneId ? await stealthAttack(q, campaignId, sceneId, characterId, target.id) : null;
  const seenStates = kind === 'attack' && target ? await invisibilitySeen(q, campaignId, sceneId ?? null, characterId, target.id, own, targetState) : null;
  const marks = kind === 'attack' && target ? await attackMarks(q, campaignId, characterId, target.id, seenStates ? seenStates.target : targetState) : null;
  const guard = kind === 'attack' && target ? await protectionStyle(q, campaignId, sceneId ?? null, characterId, target.id) : null;
  if (guard && marks) marks.disadvantages.push(`«Защита»: ${guard.name}`);
  if (guard) extraGuard = guard;
  const reckless = kind === 'attack' && target && own.codes.has('reckless') && check.ability === 'strength' && !situation?.ranged
    && (await q.query('SELECT weapon_kind FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND id=$3', [campaignId, characterId, key])).rows[0]?.weapon_kind !== 'ranged';
  const aids = kind === 'save' ? await saveAids(q, campaignId, characterId, check.ability as ConditionAbility, own) : null;
  const feral = kind === 'attack' && target ? await feralSenses(q, campaignId, characterId) : false;
  const horde = kind === 'attack' && target && opportunityEntry ? await hunterTactic(q, campaignId, target.id, 'escape-the-horde') : false;

  return {
    done: null, economyScene, ammoSpent, extraGuard, character, riposteDie, check, label, proficiencyBonus,
    modifier, styleWeapon, styles, own, target, situation, targetState, within5ft, situationNotes, checkHelp,
    alerted, sightBlocked, sightReasons, stealth, seenStates, marks, reckless, aids, feral, horde,
  };
}

export type CheckPrep = Extract<Awaited<ReturnType<typeof prepareCheck>>, { done: null }>;
