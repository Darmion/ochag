import type { GameIconName } from '../ui/gameIcons';

export const DAMAGE_ICONS: Readonly<Record<string, GameIconName>> = {
  acid: 'dmgAcid', bludgeoning: 'dmgBludgeoning', cold: 'dmgCold', fire: 'flame', force: 'dmgForce', lightning: 'dmgLightning',
  necrotic: 'skull', piercing: 'dmgPiercing', poison: 'poison', psychic: 'dmgPsychic', radiant: 'dmgRadiant', slashing: 'dmgSlashing', thunder: 'dmgThunder',
};

export const DAMAGE_NAMES: Readonly<Record<string, string>> = {
  acid: 'кислота', bludgeoning: 'дробящий', cold: 'холод', fire: 'огонь', force: 'силовое поле', lightning: 'электричество',
  necrotic: 'некротическая энергия', piercing: 'колющий', poison: 'яд', psychic: 'психическая энергия', radiant: 'излучение',
  slashing: 'рубящий', thunder: 'звук', nonmagical: 'немагическое оружие (Д/К/Р)',
};

export const damageIcon = (type: string | null | undefined): GameIconName | null => (type ? DAMAGE_ICONS[type] ?? null : null);
