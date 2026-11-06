import { isHandCrossbow, isPolearm } from '../character/feats.ts';

export type EconomyWeapon = {
  id: string;
  name?: string | null;
  srd_index?: string | null;
  weapon_kind?: string | null;
  properties?: unknown;
};

export type BonusBasis = 'two-weapon' | 'polearm' | 'crossbow' | 'martial-arts' | 'great-weapon';

export const BONUS_BASIS_LABELS: Record<BonusBasis, string> = {
  'two-weapon': 'второе лёгкое оружие',
  polearm: 'другим концом древка («Мастер древкового оружия»)',
  crossbow: 'ручной арбалет («Эксперт по арбалетам»)',
  'martial-arts': 'безоружный удар («Боевые искусства»)',
  'great-weapon': '«Мастер большого оружия»: крит или 0 хитов у цели',
};

export const FLAG_ATTACK_ACTION = 'attack-action';
export const FLAG_ONE_HANDED = 'attack-onehand';
export const FLAG_POLEARM = 'attack-polearm';
export const FLAG_MONK = 'attack-monk';
export const FLAG_GREAT_WEAPON = 'gwm-bonus';
const LIGHT_PREFIX = 'attack-light:';

const MONK_SIMPLE = new Set(['club', 'dagger', 'handaxe', 'javelin', 'light-hammer', 'mace', 'quarterstaff', 'sickle', 'spear', 'shortsword']);

function properties(weapon: EconomyWeapon): string[] {
  return Array.isArray(weapon.properties) ? weapon.properties.map(String) : [];
}
export function isMeleeWeapon(weapon: EconomyWeapon) {
  return weapon.weapon_kind !== 'ranged';
}
export function isLightWeapon(weapon: EconomyWeapon) {
  return properties(weapon).includes('light');
}
export function isTwoHandedWeapon(weapon: EconomyWeapon) {
  return properties(weapon).includes('two-handed');
}
export function isUnarmedStrike(weapon: EconomyWeapon) {
  return weapon.srd_index === 'unarmed-strike' || /^безоружн|^кулак|unarmed/i.test(weapon.name ?? '');
}
function isMonkWeapon(weapon: EconomyWeapon) {
  if (isUnarmedStrike(weapon)) return true;
  if (weapon.srd_index) return MONK_SIMPLE.has(weapon.srd_index);
  return isMeleeWeapon(weapon) && !isTwoHandedWeapon(weapon) && !properties(weapon).includes('heavy');
}

export function attackActionFlags(weapon: EconomyWeapon, options: { monk: boolean }): string[] {
  const flags = [FLAG_ATTACK_ACTION];
  if (isMeleeWeapon(weapon) && isLightWeapon(weapon) && !isTwoHandedWeapon(weapon)) flags.push(`${LIGHT_PREFIX}${weapon.id}`);
  if (!isTwoHandedWeapon(weapon)) flags.push(FLAG_ONE_HANDED);
  if (isMeleeWeapon(weapon) && isPolearm(weapon)) flags.push(FLAG_POLEARM);
  if (options.monk && isMonkWeapon(weapon)) flags.push(FLAG_MONK);
  return flags;
}

export type BonusContext = {
  flags: readonly string[];
  hasFeat: (id: string) => boolean;
  monk: boolean;
};

export function bonusAttackBasis(weapon: EconomyWeapon, context: BonusContext): BonusBasis | null {
  const { flags } = context;
  const melee = isMeleeWeapon(weapon);
  if (melee && isLightWeapon(weapon) && !isTwoHandedWeapon(weapon)
    && flags.some(flag => flag.startsWith(LIGHT_PREFIX) && flag !== `${LIGHT_PREFIX}${weapon.id}`)) return 'two-weapon';
  if (context.hasFeat('polearm-master') && melee && isPolearm(weapon) && flags.includes(FLAG_POLEARM)) return 'polearm';
  if (context.hasFeat('crossbow-expert') && isHandCrossbow(weapon) && flags.includes(FLAG_ONE_HANDED)) return 'crossbow';
  if (context.monk && isUnarmedStrike(weapon) && flags.includes(FLAG_MONK)) return 'martial-arts';
  if (context.hasFeat('great-weapon-master') && melee && flags.includes(FLAG_GREAT_WEAPON)) return 'great-weapon';
  return null;
}

export function bonusAttackRefusal(weapon: EconomyWeapon, context: BonusContext): string {
  const name = weapon.name ? `«${weapon.name}»` : 'Этим оружием';
  const needs: string[] = [];
  if (isMeleeWeapon(weapon) && isLightWeapon(weapon) && !isTwoHandedWeapon(weapon)) {
    needs.push(context.flags.includes(FLAG_ATTACK_ACTION)
      ? 'сначала атака другим лёгким рукопашным оружием (двуручный бой)'
      : 'сначала действие «Атака» другим лёгким рукопашным оружием (двуручный бой)');
  }
  if (context.hasFeat('polearm-master') && isPolearm(weapon)) needs.push('сначала действие «Атака» этим древковым оружием');
  if (context.hasFeat('crossbow-expert') && isHandCrossbow(weapon)) needs.push('сначала действие «Атака» одноручным оружием');
  if (context.monk && isUnarmedStrike(weapon)) needs.push('сначала действие «Атака» безоружным ударом или оружием монаха');
  if (context.hasFeat('great-weapon-master') && isMeleeWeapon(weapon)) needs.push('крит или 0 хитов у цели рукопашной атакой в этот ход');
  if (!needs.length) {
    return `${name} бонусным действием не ударить: это может только второе лёгкое оружие после атаки лёгким или умение (черта, «Боевые искусства», «Бешенство»).`;
  }
  return `${name} бонусным действием — ${needs.join(' или ')}.`;
}

export const READIED_EFFECT = 'readied';
export const REACTION_REFUSAL = 'Атака реакцией — при уходе цели из досягаемости (предложение появится само) или подготовленная действием «Подготовиться».';
