import type { Weapon } from './attackTypes.ts';

export function weaponLimit(weapon: Weapon) {
  const reach = weapon.range_feet ?? 5;
  if (weapon.weapon_kind === 'ranged') return weapon.long_range_feet ?? reach;
  return weapon.thrown_range_feet ? weapon.long_range_feet ?? weapon.thrown_range_feet : reach;
}
export function weaponNormal(weapon: Weapon) {
  return weapon.weapon_kind === 'ranged' ? weapon.range_feet ?? 80 : weapon.thrown_range_feet ?? weapon.range_feet ?? 5;
}
export function weaponRangeText(weapon: Weapon) {
  if (weapon.weapon_kind === 'ranged') return `${weapon.range_feet ?? 80}${weapon.long_range_feet ? `/${weapon.long_range_feet}` : ''} фут.`;
  return `${weapon.range_feet ?? 5} фут.${weapon.thrown_range_feet ? `, бросок ${weapon.thrown_range_feet}/${weapon.long_range_feet ?? weapon.thrown_range_feet}` : ''}`;
}

export type WeaponCard = {
  weapon: Weapon;
  blocked: boolean;
  outOfRange: boolean;
  title: string;
  range: string;
  preview: string;
  bonusNote: string | null;
};

export type WeaponCardInput = {
  distance: number | null;
  option: { bonusLabel: string | null; bonusReason: string | null } | null;
  blocked: boolean;
  preview: string;
  bonus: boolean;
};

export function weaponCard(weapon: Weapon, { distance, option, blocked, preview, bonus }: WeaponCardInput): WeaponCard {
  const beyond = (feet: number) => distance !== null && distance > feet;
  const limit = weaponLimit(weapon);
  const normal = weaponNormal(weapon);
  const far = beyond(limit);
  const thrownFar = beyond(weapon.range_feet ?? 5) && Boolean(weapon.thrown_range_feet) && beyond(normal);
  const disadvantage = (beyond(normal) && weapon.weapon_kind === 'ranged') || thrownFar;
  return {
    weapon, blocked, preview,
    outOfRange: far,
    title: blocked ? option?.bonusReason ?? '' : far ? `Цель дальше ${limit} фут. — подойдите ближе` : '',
    range: weaponRangeText(weapon) + (far ? ' · далеко' : disadvantage ? ' · с помехой' : ''),
    bonusNote: bonus && option?.bonusLabel ? `бонусным: ${option.bonusLabel}` : blocked ? 'бонусным — нельзя' : null,
  };
}
