import { multiattackGuard, guardAfterHit, applyHpChange } from '../combat/hp.ts';
import { factionBonusOf } from '../../campaign/factions.ts';
import { shieldBonus, tryAutoShield, cuttingWords, deflectMissiles, parryBlow, uncannyDodge } from '../combat/reactions.ts';
import { critRange, superiorityDie, classLevelOf, classFeaturesFor, knownManeuvers, sneakAttackRuling, sneakAttackDice, brutalCriticalDice, knownHuntersPrey } from '../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { attackOutcome } from '../../../../../packages/domain/combat/conditions.ts';
import { mirrorStrike, allyNearTarget, weaponDamageText, foeSlayerBonus, divineStrikeFor } from '../combat/attack.ts';
import { classResourceOf, spendClassResource, darkOnesBlessing } from '../../rules/class-features.ts';
import { rollDie, campaignFlag, insertRoll } from './dice.ts';
import { spendLuckPoint, luckyDefense, markTurnFlags, savageAttackerFor } from './modifiers.ts';
import { notifyCampaign } from '../live/notify.ts';
import { isMeleeWeapon, FLAG_GREAT_WEAPON } from '../../../../../packages/domain/combat/attack-economy.ts';
import { hasFeat, greatWeaponReroll } from '../../../../../packages/domain/character/feats.ts';
import { addCondition } from '../../rules/conditions.ts';
import { sheetContext } from '../scene/placements.ts';
import { resolveFormula } from '../../../../../packages/domain/dice/formula.ts';
import { rollDice, abilityModifier, parseFormula } from '../../../../../packages/domain/dice/dice.ts';
import { hasRaceTrait, characterRace } from '../../../../../packages/domain/character/races.ts';
import { DAMAGE_TYPE_RU } from '../scene/scene-triggers.ts';
import { ownExtraDamage } from '../../../../../packages/domain/spells/spell-mods.ts';
import { spellModsFor } from '../spells/rules.ts';
import { engineFormula } from '../../../../../packages/domain/spells/spell-template-engine.ts';
import type { TableContext } from '../context.ts';
import type { Queryable } from '../../db.ts';
import type { ActionUse } from '../../rules/action-economy.ts';
import type { Opportunity } from '../combat/opportunity.ts';
import type { CheckBody, CheckInternal } from './roll-check.ts';
import type { CheckPrep } from './check-prepare.ts';
import type { CheckRoll } from './check-roll.ts';

export type CheckRun = {
  ctx: TableContext;
  q: Queryable;
  member: any;
  userId: string;
  campaignId: string;
  body: CheckBody;
  internal: CheckInternal;
  using: ActionUse | undefined;
  opportunityEntry: Opportunity | undefined;
  prep: CheckPrep;
  roll: CheckRoll;
};

export type HitState = {
  hitResult: { hit: boolean; critical: boolean } | null;
  kept: number;
  total: number;
  modifier: number;
  results: number[];
  cutWords: { name: string; value: number; id: string } | null;
  riposteFrom: string | null;
  tideFrom: string | null;
  sneak: { dice: number; reason: string } | null;
};

export async function resolveHit(run: CheckRun, state: HitState) {
  const { q, campaignId, ctx, userId, internal, opportunityEntry } = run;
  const { characterId, precision, lucky, strokeOfLuck, sceneId, key } = run.body;
  const { target, situation, character, styleWeapon } = run.prep;
  const { ruling, attackWeapon, extra, riders, melee } = run.roll;
  const { modifier } = state;
  let { hitResult, kept, total, results, cutWords, riposteFrom, tideFrom, sneak } = state;
  if (!target) return { hitResult, kept, total, results, cutWords, riposteFrom, tideFrom, sneak };
  const guardAc = await multiattackGuard(q, campaignId, target.id, characterId);
  if (guardAc) ruling.reasons.push(`защита от мультиатаки: КД +${guardAc}`);
  const targetFaction = await factionBonusOf(q, campaignId, target.id, 'ac');
  if (targetFaction.value) ruling.reasons.push(...targetFaction.reasons.map(reason => `КД цели: ${reason}`));
  const targetAc = target.armor_class + (situation?.acBonus ?? 0) + await shieldBonus(q, campaignId, target.id) + guardAc + targetFaction.value;
  const critAt = attackWeapon ? critRange(characterClassLevels(character).classes) : 20;
  if (critAt < 20) extra.critAt = critAt;
  hitResult = attackOutcome(kept, total, targetAc, ruling.autoCritOnHit, critAt);
  const mirrored = target.id !== characterId ? await mirrorStrike(q, campaignId, target.id, characterId, kept, total, critAt) : null;
  if (mirrored) {
    ruling.reasons.push(mirrored.reason);
    if (mirrored.redirected) {
      hitResult = { hit: false, critical: false };
      extra.mirrorImage = mirrored.view;
    }
  }
  const intoImage = Boolean(mirrored?.redirected);
  if (precision && attackWeapon && !hitResult.hit && kept !== 1 && !intoImage) {
    const classes = characterClassLevels(character).classes;
    const die = superiorityDie(classLevelOf(classes, 'fighter', character.level));
    const knows = classFeaturesFor(classes).some(feature => feature.id === 'combat-superiority') && knownManeuvers(character.sheet_extra).includes('precision');
    const dice = knows && total + die >= targetAc ? await classResourceOf(q, campaignId, character, 'Кости превосходства', false) : null;
    if (dice && Number(dice.current) > 0) {
      await spendClassResource(q, campaignId, character, 'Кости превосходства');
      const value = rollDie(die);
      total += value;
      ruling.reasons.push(`точная атака +${value}`);
      hitResult = attackOutcome(kept, total, targetAc, ruling.autoCritOnHit, critAt);
      extra.precision = { value, hit: hitResult.hit };
    }
  }
  if (lucky && attackWeapon && !hitResult.hit && !intoImage) {
    const left = await spendLuckPoint(ctx, q, campaignId, character);
    if (left !== null) {
      const die = rollDie(20);
      const next = die + modifier + riders.value;
      const luckyHit = attackOutcome(die, next, targetAc, ruling.autoCritOnHit, critAt);
      ruling.reasons.push(`везунчик (очко удачи, осталось ${left}): ещё к20 — ${die}, ${luckyHit.hit ? 'попадание' : 'промах'}`);
      extra.lucky = { die, hit: luckyHit.hit };
      if (luckyHit.hit) {
        results = [...results, die];
        kept = die;
        total = next;
        hitResult = luckyHit;
      }
    }
  }
  if (strokeOfLuck && !hitResult.hit && !intoImage && classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'stroke-of-luck')) {
    const luck = await classResourceOf(q, campaignId, character, 'Удача', true);
    if (luck && Number(luck.current) > 0) {
      await q.query('UPDATE character_resources SET current=current-1 WHERE id=$1', [luck.id]);
      hitResult = { hit: true, critical: false };
      ruling.reasons.push('удача: промах → попадание');
      extra.strokeOfLuck = true;
      void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
    }
  }
  if (hitResult.hit) {
    const luck = await luckyDefense(ctx, q, campaignId, target.id);
    if (luck) {
      const lower = luck.die < kept;
      if (lower) {
        total = total - kept + luck.die;
        kept = luck.die;
        results = [...results, luck.die];
        hitResult = attackOutcome(kept, total, targetAc, ruling.autoCritOnHit, critAt);
      }
      ruling.reasons.push(`везунчик цели (${target.name}, осталось ${luck.left}): к20 — ${luck.die}${lower ? `, берётся: ${hitResult.hit ? 'всё равно попадание' : 'промах'}` : ' — не меньше'}`);
      extra.luckyDefense = { name: target.name, die: luck.die, hit: hitResult.hit };
    }
  }
  if (hitResult.hit && kept < critAt) {
    const shield = await tryAutoShield(ctx, q, campaignId, userId, sceneId ?? null, target, total, targetAc);
    if (shield?.counteredBy) {
      extra.shieldCountered = { name: target.name, by: shield.counteredBy };
      void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${target.name}: «Щит» прерван`, detail: `${shield.counteredBy} — «Контрзаклинание» наготове; ${shield.spent} потрачена, удар проходит.`, tone: 'info' });
    } else if (shield) {
      hitResult = attackOutcome(kept, total, targetAc + 5, ruling.autoCritOnHit, critAt);
      extra.shield = { name: target.name, ac: targetAc + 5, spent: shield.spent };
      void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${target.name}: «Щит»`, detail: `Реакцией — КД ${targetAc + 5} до начала своего хода (${shield.spent}): ${total} не попадает.`, tone: 'info' });
    }
  }
  if (hitResult.hit && kept < critAt && sceneId) {
    const ac = targetAc + (extra.shield ? 5 : 0);
    const words = await cuttingWords(q, campaignId, userId, sceneId, characterId, target.id, total, ac);
    if (words) {
      total -= words.value;
      ruling.reasons.push(`острое словцо (${words.name}) −${words.value}`);
      hitResult = attackOutcome(kept, total, ac, ruling.autoCritOnHit, critAt);
      extra.cuttingWords = { name: words.name, value: words.value };
      cutWords = { name: words.name, value: words.value, id: words.id };
    }
  }
  if (!hitResult.hit && melee && sceneId && !internal.riposte) riposteFrom = target.id;
  if (!hitResult.hit && melee && sceneId && !internal.tide) tideFrom = target.id;
  if (hitResult.hit) await guardAfterHit(q, campaignId, sceneId ?? null, target.id, characterId);
  if (hitResult.critical && melee && styleWeapon && isMeleeWeapon({ id: key, ...styleWeapon }) && hasFeat(character.sheet_extra, 'great-weapon-master')) {
    await markTurnFlags(q, campaignId, characterId, [FLAG_GREAT_WEAPON]);
  }
  if (melee && hasFeat(character.sheet_extra, 'mobile')) {
    await q.query(
      `UPDATE initiative_entries SET turn_flags = array_append(turn_flags, $3) WHERE campaign_id=$1 AND character_id=$2 AND is_current AND NOT ($3 = ANY(turn_flags))`,
      [campaignId, characterId, `mobile:${target.id}`],
    );
  }
  if (hitResult.hit && opportunityEntry?.reason === 'leave' && hasFeat(character.sheet_extra, 'sentinel')) {
    await addCondition(q, campaignId, target.id, 'slowed', {
      source: 'feature', sourceCharacterId: characterId, sourceName: 'Часовой', feet: 1000, expires: { at: 'end', of: target.id },
    });
    ruling.reasons.push('часовой: скорость цели 0 до конца её хода');
    extra.sentinel = true;
  }
  Object.assign(extra, {
    target: { id: target.id, name: target.name }, hit: hitResult.hit, critical: hitResult.critical, melee,
    ...(attackWeapon?.name === 'Безоружный удар' ? { unarmed: true } : {}),
    ...(situation ? { distance: situation.distance, ranged: situation.ranged } : {}),
    ...(situation && situation.cover !== 'none' ? { cover: situation.cover } : {}),
  });
  const attackerClasses = characterClassLevels(character).classes;
  if (hitResult.hit && attackWeapon && classFeaturesFor(attackerClasses).some(feature => feature.id === 'sneak-attack')) {
    const entry = (
      await q.query(
        `SELECT id, sneak_attack_used FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 AND ($3::uuid IS NULL OR scene_id=$3)
               ORDER BY is_current DESC, created_at LIMIT 1 FOR UPDATE`,
        [campaignId, characterId, sceneId ?? null],
      )
    ).rows[0] as any;
    const sneakRuling = sneakAttackRuling({
      finesse: attackWeapon.ability === 'finesse', ranged: !melee, advantage: ruling.advantage,
      allyNearTarget: sceneId ? await allyNearTarget(q, campaignId, sceneId, characterId, target.id) : false,
      usedThisTurn: entry?.sneak_attack_used === true,
    });
    if (sneakRuling.ok) {
      sneak = { dice: sneakAttackDice(classLevelOf(attackerClasses, 'rogue', character.level)), reason: sneakRuling.reason };
      if (entry) await q.query('UPDATE initiative_entries SET sneak_attack_used=true WHERE id=$1', [entry.id]);
      extra.sneakAttack = { dice: `${sneak.dice}d6`, reason: sneak.reason };
    }
  }
  return { hitResult, kept, total, results, cutWords, riposteFrom, tideFrom, sneak };
}

export type HitDamageState = {
  damageMissing: string | null;
  hitResult: { hit: boolean; critical: boolean } | null;
  blessings: Array<{ characterId: string; name: string; value: number }>;
  sneak: { dice: number; reason: string } | null;
  dodged: { name: string; id: string } | null;
  deflected: { name: string; value: number; id: string } | null;
  parried: { name: string; value: number; id: string } | null;
  damage: any;
  extraDamage: any;
  divineDamage: any;
  improvedSmite: any;
};

export async function applyHitDamage(run: CheckRun, state: HitDamageState) {
  const { q, campaignId, ctx, userId, internal } = run;
  const { characterId, key, twoHanded, hidden, sceneId } = run.body;
  const { character, proficiencyBonus, check, target, styleWeapon, styles, own, riposteDie } = run.prep;
  const { melee } = run.roll;
  const { hitResult, blessings, sneak } = state;
  let { damageMissing, dodged, deflected, parried, damage, extraDamage, divineDamage, improvedSmite } = state;
  if (!target || !hitResult?.hit) return { damageMissing, dodged, deflected, parried, damage, extraDamage, divineDamage, improvedSmite };
  const weapon = (
    await q.query(
      'SELECT name, damage_formula, damage_type, versatile_formula, extra_damage_formula, extra_damage_type FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND id=$3',
      [campaignId, characterId, key],
    )
  ).rows[0] as any;
  const damageText = twoHanded && weapon?.versatile_formula ? weapon.versatile_formula : weapon?.damage_formula;
  if (weapon && !damageText) damageMissing = weapon.name;
  if (damageText && (await campaignFlag(q, campaignId, 'auto_damage')) !== false) {
    const context = sheetContext(character, proficiencyBonus);
    const doubles = hitResult.critical && (await campaignFlag(q, campaignId, 'crit_doubles_dice')) !== false;
    const rollDamage = (text: string) => {
      const resolved = resolveFormula(weaponDamageText(text, check), context);
      if (!resolved.ok) return null;
      const base = rollDice(resolved.parsed, rollDie);
      let dice = base.results;
      let total = base.total;
      let formula = resolved.formula;
      if (doubles) {
        const extraDice = rollDice({ count: resolved.parsed.count, sides: resolved.parsed.sides, modifier: 0 }, rollDie);
        dice = [...dice, ...extraDice.results];
        total += extraDice.total;
        const mod = resolved.parsed.modifier;
        formula = `${resolved.parsed.count * 2}d${resolved.parsed.sides}${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ''}`;
      }
      return { dice, total: Math.max(0, total), formula, modifier: resolved.parsed.modifier, sides: resolved.parsed.sides };
    };
    const strike = async (rolled: NonNullable<ReturnType<typeof rollDamage>>, damageType: string | null, label: string) => {
      const change = await applyHpChange(ctx, q, campaignId, userId, target!.id, {
        mode: 'damage', amount: rolled.total, damageType, critical: hitResult!.critical, sourceId: characterId,
        magical: Boolean(check.enchant.shillelagh || check.enchant.bonus || check.enchant.die),
      });
      if (change.dropped) {
        const blessing = await darkOnesBlessing(q, campaignId, characterId, target!.id);
        if (blessing) blessings.push(blessing);
        if (styleWeapon && styleWeapon.weapon_kind !== 'ranged' && hasFeat(character.sheet_extra, 'great-weapon-master')) {
          await markTurnFlags(q, campaignId, characterId, [FLAG_GREAT_WEAPON]);
        }
      }
      const damageRoll = await insertRoll(
        q, campaignId, userId, characterId, `${label} → ${target!.name}`.slice(0, 100),
        rolled.formula, rolled.dice, rolled.modifier, rolled.total, hidden ?? false, null,
        {
          kind: 'damage', target: { id: target!.id, name: target!.name }, critical: hitResult!.critical,
          damageType, applied: change.applied, blocked: change.blocked, modified: change.modified, dropped: change.dropped,
        },
      );
      return {
        roll: damageRoll, applied: change.applied, blocked: change.blocked, modified: change.modified, hp: change.row,
        notices: change.notices, targetId: target!.id, critical: hitResult!.critical, experience: change.experience,
      };
    };
    const offhandStripped = Boolean(styles?.offhandNoMod && /@mod\b/.test(damageText)
      && abilityModifier(character[check.ability === 'strength' ? 'strength' : 'dexterity']) > 0);
    const main = rollDamage(styles?.butt ? '1d4+@mod' : offhandStripped ? damageText.replace(/@mod\b/g, '0') : damageText);
    let greatRerolled = 0;
    if (main && styles?.greatWeapon) {
      const again = greatWeaponReroll(main.dice, () => rollDie(main.sides));
      if (again.rerolled) {
        main.total += again.dice.reduce((sum, value) => sum + value, 0) - main.dice.reduce((sum, value) => sum + value, 0);
        main.dice = again.dice;
        greatRerolled = again.rerolled;
      }
    }
    let savage = false;
    if (main && melee && await savageAttackerFor(q, campaignId, character, sceneId ?? null)) {
      const again = rollDice({ count: main.dice.length, sides: main.sides, modifier: 0 }, rollDie);
      const before = main.dice.reduce((sum, value) => sum + value, 0);
      savage = true;
      if (again.total > before) {
        main.total += again.total - before;
        main.dice = again.results;
      }
    }
    if (main && styles?.damage) {
      main.total += styles.damage;
      main.modifier += styles.damage;
      main.formula = `${main.formula}+${styles.damage}`.slice(0, 20);
    }
    const attackerFeatures = classFeaturesFor(characterClassLevels(character).classes);
    const brutal = main && hitResult.critical && melee
      ? (attackerFeatures.some(feature => feature.id === 'brutal-critical') ? brutalCriticalDice(classLevelOf(characterClassLevels(character).classes, 'barbarian', character.level)) : 0)
        + (hasRaceTrait(characterRace(character), 'savage-attacks') ? 1 : 0)
      : 0;
    if (main && brutal > 0) {
      const savage = rollDice({ count: brutal, sides: main.sides, modifier: 0 }, rollDie);
      main.dice = [...main.dice, ...savage.results];
      main.total += savage.total;
      main.formula = `${main.formula}+${brutal}d${main.sides}`.slice(0, 20);
    }
    const rage = melee && check.ability === 'strength' && own.codes.has('raging')
      ? Number((await q.query(`SELECT parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='raging' AND active`, [campaignId, characterId])).rows[0]?.parameters?.damageBonus ?? 2)
      : 0;
    if (main && rage) {
      main.total += rage;
      main.modifier += rage;
      main.formula = `${main.formula}+${rage}`.slice(0, 20);
    }
    const factionDamage = main ? await factionBonusOf(q, campaignId, characterId, 'damage') : null;
    if (main && factionDamage?.value) {
      main.total = Math.max(0, main.total + factionDamage.value);
      main.modifier += factionDamage.value;
      main.formula = `${main.formula}${factionDamage.value > 0 ? '+' : ''}${factionDamage.value}`.slice(0, 20);
    }
    const foeSlayer = main ? await foeSlayerBonus(q, campaignId, character, target.id) : 0;
    if (main && foeSlayer) {
      main.total += foeSlayer;
      main.modifier += foeSlayer;
      main.formula = `${main.formula}+${foeSlayer}`.slice(0, 20);
    }
    if (main && sneak) {
      const count = sneak.dice * (doubles ? 2 : 1);
      const sneakDice = rollDice({ count, sides: 6, modifier: 0 }, rollDie);
      main.dice = [...main.dice, ...sneakDice.results];
      main.total += sneakDice.total;
      main.formula = `${main.formula}+${count}d6`.slice(0, 20);
    }
    const mark = main ? (
      await q.query(
        `SELECT parameters->>'dice' AS dice FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='marked' AND active AND parameters->>'sourceCharacterId' = $3`,
        [campaignId, target.id, characterId],
      )
    ).rows[0] : null;
    const markDice = mark ? parseFormula(String(mark.dice ?? '1d6')) : null;
    if (main && markDice) {
      const count = markDice.count * (doubles ? 2 : 1);
      const markRoll = rollDice({ count, sides: markDice.sides, modifier: 0 }, rollDie);
      main.dice = [...main.dice, ...markRoll.results];
      main.total += markRoll.total;
      main.formula = `${main.formula}+${count}d${markDice.sides}`.slice(0, 20);
    }
    let colossus = false;
    if (main && classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'hunters-prey')
      && knownHuntersPrey(character.sheet_extra).includes('colossus-slayer')) {
      const prey = (await q.query('SELECT hp_current, hp_max FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, target.id])).rows[0] as any;
      const turn = (
        await q.query(
          `SELECT id, colossus_used FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 AND ($3::uuid IS NULL OR scene_id=$3)
                 ORDER BY is_current DESC, created_at LIMIT 1 FOR UPDATE`,
          [campaignId, characterId, sceneId ?? null],
        )
      ).rows[0] as any;
      if (prey && Number(prey.hp_current) < Number(prey.hp_max) && !turn?.colossus_used) {
        const count = doubles ? 2 : 1;
        const slayer = rollDice({ count, sides: 8, modifier: 0 }, rollDie);
        main.dice = [...main.dice, ...slayer.results];
        main.total += slayer.total;
        main.formula = `${main.formula}+${count}d8`.slice(0, 20);
        if (turn) await q.query('UPDATE initiative_entries SET colossus_used=true WHERE id=$1', [turn.id]);
        colossus = true;
      }
    }
    if (main && internal.riposte && riposteDie) {
      const count = doubles ? 2 : 1;
      const ripost = rollDice({ count, sides: riposteDie, modifier: 0 }, rollDie);
      main.dice = [...main.dice, ...ripost.results];
      main.total += ripost.total;
      main.formula = `${main.formula}+${count}d${riposteDie}`.slice(0, 20);
    }
    const deflect = main && !melee ? await deflectMissiles(q, campaignId, sceneId ?? null, target.id) : null;
    const parry = main && melee ? await parryBlow(q, campaignId, sceneId ?? null, target.id) : null;
    const dodge = main && !deflect && !parry ? await uncannyDodge(q, campaignId, sceneId ?? null, characterId, target.id) : null;
    if (dodge) dodged = { name: dodge.name, id: target.id };
    let deflectLeft = (deflect?.value ?? 0) + (parry?.value ?? 0);
    if (main && (deflect || parry)) {
      const cut = Math.min(main.total, deflectLeft);
      main.total -= cut;
      deflectLeft -= cut;
      if (deflect) deflected = { name: deflect.name, value: deflect.value, id: target.id };
      if (parry) parried = { name: parry.name, value: parry.value, id: target.id };
    }
    if (main && dodge) main.total = Math.floor(main.total / 2);
    if (main) {
      const extras = [
        sneak ? 'скрытая атака' : '', rage ? 'ярость' : '', factionDamage?.value ? factionDamage.reasons.join(', ') : '', foeSlayer ? `убийца врагов +${foeSlayer}` : '', brutal ? 'сокрушительный крит' : '', markDice ? 'метка охотника' : '', colossus ? 'убийца колоссов' : '',
        greatRerolled ? `большое оружие: переброс ${greatRerolled}` : '', savage ? 'дикарь: лучший из двух бросков' : '', styles?.dueling ? 'дуэлянт' : '', styles?.powerBy ? `${styles.powerBy} +10` : '',
        offhandStripped ? 'второе оружие — без модификатора' : '',
        deflect ? `отражено ${deflect.value}` : '', parry ? `парировано ${parry.value}` : '', dodge ? 'уклонение: вдвое' : '', internal.riposte ? 'ответный удар' : '',
      ].filter(Boolean).join(', ');
      damage = await strike(main, styles?.butt ? 'bludgeoning' : weapon.damage_type, `Урон: ${weapon.name}${styles?.butt ? ' древком' : ''}${extras ? ` (${extras})` : ''}`);
      const extraRolled = weapon.extra_damage_formula ? rollDamage(weapon.extra_damage_formula) : null;
      if (extraRolled && deflectLeft > 0) {
        const cut = Math.min(extraRolled.total, deflectLeft);
        extraRolled.total -= cut;
        deflectLeft -= cut;
      }
      if (extraRolled && dodge) extraRolled.total = Math.floor(extraRolled.total / 2);
      if (extraRolled && Number(damage.hp?.hp_current ?? 0) > 0) {
        extraDamage = await strike(extraRolled, weapon.extra_damage_type, `Урон: ${weapon.name} (${DAMAGE_TYPE_RU[weapon.extra_damage_type] ?? 'доп.'})`);
      }
      if (Number((extraDamage ?? damage).hp?.hp_current ?? 0) > 0) {
        const divineDice = await divineStrikeFor(q, campaignId, character, sceneId ?? null);
        if (divineDice) {
          const count = divineDice * (doubles ? 2 : 1);
          const holy = rollDice({ count, sides: 8, modifier: 0 }, rollDie);
          const rolledHoly = { dice: holy.results, total: holy.total, formula: `${count}d8`, modifier: 0, sides: 8 };
          if (deflectLeft > 0) rolledHoly.total = Math.max(0, rolledHoly.total - deflectLeft);
          if (dodge) rolledHoly.total = Math.floor(rolledHoly.total / 2);
          divineDamage = await strike(rolledHoly, 'radiant', `Урон: ${weapon.name} (божественный удар)`);
        }
      }
      for (const extraHit of ownExtraDamage(await spellModsFor(q, campaignId, characterId), 'weapon')) {
        if (Number((divineDamage ?? extraDamage ?? damage).hp?.hp_current ?? 0) <= 0) break;
        const resolved = engineFormula(extraHit.formula, { slotLevel: 1, characterLevel: Number(character.level ?? 1) });
        const rolledExtra = resolved ? rollDamage(resolved.formula) : null;
        if (!rolledExtra) continue;
        const extraType = extraHit.damageType === 'weapon' || extraHit.damageType === 'param' ? weapon.damage_type : extraHit.damageType;
        await strike(rolledExtra, extraType, `Урон: ${weapon.name} («${extraHit.label}»)`);
      }
      if (melee && attackerFeatures.some(feature => feature.id === 'improved-divine-smite')
        && Number((divineDamage ?? extraDamage ?? damage).hp?.hp_current ?? 0) > 0) {
        const count = doubles ? 2 : 1;
        const holy = rollDice({ count, sides: 8, modifier: 0 }, rollDie);
        const rolledHoly = { dice: holy.results, total: holy.total, formula: `${count}d8`, modifier: 0, sides: 8 };
        if (deflectLeft > 0) rolledHoly.total = Math.max(0, rolledHoly.total - deflectLeft);
        if (dodge) rolledHoly.total = Math.floor(rolledHoly.total / 2);
        improvedSmite = await strike(rolledHoly, 'radiant', `Урон: ${weapon.name} (улучшенная кара)`);
      }
    }
  }
  return { damageMissing, dodged, deflected, parried, damage, extraDamage, divineDamage, improvedSmite };
}
