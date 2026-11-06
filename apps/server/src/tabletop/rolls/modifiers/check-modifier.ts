import type { Queryable } from '../../../db.ts';
import { hasFeat } from '../../../../../../packages/domain/character/feats.ts';
import { featureSaveProficiency, halfProficiency } from '../../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../../packages/domain/character/classes.ts';
import { d20Ruling } from '../../../../../../packages/domain/combat/conditions.ts';
import { abilityModifier, proficiencyOf, type Advantage } from '../../../../../../packages/domain/dice/dice.ts';
import { findSrdSkill } from '../../../rules/srd-data.ts';
import { type WeaponEnchant, weaponEnchantment } from '../../combat/attack.ts';
import { reject, uuidPattern } from '../../shared.ts';

export const CHECK_ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;

export type CheckAbility = typeof CHECK_ABILITIES[number];

export const CHECK_ABILITY_LABELS_RU: Record<CheckAbility, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение',
  intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};

export const ABILITY_BY_SRD_ABBREVIATION: Record<string, CheckAbility> = {
  str: 'strength', dex: 'dexterity', con: 'constitution',
  int: 'intelligence', wis: 'wisdom', cha: 'charisma',
};

export const CHECK_KINDS = ['save', 'skill', 'ability', 'attack'] as const;

export type CheckKind = typeof CHECK_KINDS[number];

export async function checkModifier(q: Queryable, campaignId: string, character: any, kind: CheckKind, key: string) {
  let enchant: WeaponEnchant = { shillelagh: null, bonus: 0 };
  const enchantNotes: string[] = [];
  let ability: CheckAbility;
  let proficient = false;
  let expertiseMultiplier = 1;
  let savedBonus = 0;
  let label: string;

  if (kind === 'skill') {
    const skill = findSrdSkill(key);
    if (!skill) reject(400, 'Неизвестный навык.');

    ability = ABILITY_BY_SRD_ABBREVIATION[skill.ability];
    const row = (
      await q.query(
        `SELECT proficient, expertise FROM character_skills
           WHERE campaign_id=$1 AND character_id=$2 AND skill_index=$3`,
        [campaignId, character.id, key],
      )
    ).rows[0];
    proficient = row?.proficient ?? false;
    expertiseMultiplier = row?.expertise ? 2 : 1;
    label = `Навык: ${skill.nameRu} — ${character.name}`;
  } else if (kind === 'attack') {
    // Checked explicitly, otherwise a non-uuid string fails in SQL with a 500 instead of a 404.
    if (!uuidPattern.test(key)) reject(404, 'Оружие не найдено у этого персонажа.');

    const weapon = (
      await q.query(
        `SELECT name, ability, proficient, attack_bonus FROM character_weapons
           WHERE campaign_id=$1 AND character_id=$2 AND id=$3`,
        [campaignId, character.id, key],
      )
    ).rows[0];
    if (!weapon) reject(404, 'Оружие не найдено у этого персонажа.');

    ability = weapon.ability === 'finesse'
      ? (abilityModifier(character.strength) > abilityModifier(character.dexterity) ? 'strength' : 'dexterity')
      : weapon.ability as CheckAbility;
    proficient = weapon.proficient;
    savedBonus = Number(weapon.attack_bonus ?? 0);
    label = `Атака: ${weapon.name} — ${character.name}`;
    if (character.id) {
      enchant = await weaponEnchantment(q, campaignId, character.id, key);
      if (enchant.shillelagh && abilityModifier(character[enchant.shillelagh]) > abilityModifier(character[ability])) {
        ability = enchant.shillelagh as CheckAbility;
        enchantNotes.push(`дубинка: ${CHECK_ABILITY_LABELS_RU[ability]}`);
      }
      if (enchant.bonus) {
        savedBonus += enchant.bonus;
        enchantNotes.push(`магическое оружие +${enchant.bonus}`);
      }
    }
  } else {
    if (!(CHECK_ABILITIES as readonly string[]).includes(key)) {
      reject(400, 'Неизвестная характеристика.');
    }
    ability = key as CheckAbility;

    if (kind === 'save') {
      const row = (
        await q.query(
          `SELECT proficient, custom_bonus FROM character_saves
             WHERE campaign_id=$1 AND character_id=$2 AND ability=$3`,
          [campaignId, character.id, ability],
        )
      ).rows[0];
      proficient = row?.proficient ?? false;
      savedBonus = row?.custom_bonus ?? 0;
      label = `Спасбросок: ${CHECK_ABILITY_LABELS_RU[ability]} — ${character.name}`;
    } else {
      label = `Проверка: ${CHECK_ABILITY_LABELS_RU[ability]} — ${character.name}`;
    }
  }

  const proficiencyBonus = proficiencyOf(character);
  const notes: string[] = [...enchantNotes];
  const classes = characterClassLevels(character).classes;
  if (kind === 'save' && !proficient && proficiencyBonus !== null) {
    const by = featureSaveProficiency(classes, ability) ?? (hasFeat(character.sheet_extra, `resilient-${ability}`) ? 'устойчивый' : null);
    if (by) {
      proficient = true;
      notes.push(`владение: ${by}`);
    }
  }

  if (proficient && proficiencyBonus === null) {
    reject(400, 'Нужен бонус мастерства для этой проверки — укажите уровень персонажа (или, для уже импортированных листов, поле proficiency в «Сырых данных» внизу «Правки листа»).');
  }

  let modifier = abilityModifier(character[ability]) + savedBonus;
  if (proficient) modifier += proficiencyBonus! * expertiseMultiplier;
  if ((kind === 'skill' || kind === 'ability') && !proficient && proficiencyBonus !== null) {
    const half = halfProficiency(classes, ability, proficiencyBonus);
    if (half) {
      modifier += half.value;
      notes.push(half.reason);
    }
  }
  if (kind === 'skill' && key === 'stealth' && character.id) {
    const camouflaged = (
      await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='camouflaged' AND active`, [campaignId, character.id])
    ).rows[0];
    if (camouflaged) {
      modifier += 10;
      notes.push('маскировка +10');
    }
  }

  return { modifier, label, proficiencyBonus, ability, proficient, notes, enchant };
}

export function d20Formula(modifier: number, advantage: Advantage) {
  const signed = `${modifier >= 0 ? '+' : ''}${modifier}`;
  return advantage === 'none' ? `1d20${signed}` : advantage === 'adv' ? `2d20adv${signed}` : `2d20dis${signed}`;
}

export function rulingOutcome(kind: string, ruling: ReturnType<typeof d20Ruling>, extra: Record<string, unknown> = {}) {
  return {
    kind,
    advantage: ruling.advantage,
    ...(ruling.reasons.length ? { reasons: ruling.reasons } : {}),
    ...(ruling.notes.length ? { notes: ruling.notes } : {}),
    ...(ruling.autoFail ? { autoFail: true } : {}),
    ...extra,
  };
}
