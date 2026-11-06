import type { ClassId } from './classes.ts';
import { SRD_CLASSES } from '../srd/heroes.ts';
import { SRD_WEAPONS } from '../srd/weapons.ts';

export type MulticlassGain = {
  armor: Array<'light' | 'medium' | 'shield'>;
  weapons: Array<'simple' | 'martial'>;
  extraWeapons: string[];
  skills: { count: number; from: string[] | 'any' } | null;
  tools: string | null;
  note: string | null;
};

function classSkills(id: ClassId): string[] | 'any' {
  return SRD_CLASSES.find(entry => entry.id === id)?.skills.from ?? 'any';
}

const NONE: MulticlassGain = { armor: [], weapons: [], extraWeapons: [], skills: null, tools: null, note: null };
const MARTIAL: Pick<MulticlassGain, 'armor' | 'weapons'> = { armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'] };

export const MULTICLASS_GAINS: Record<ClassId, MulticlassGain> = {
  barbarian: { ...NONE, armor: ['shield'], weapons: ['simple', 'martial'] },
  bard: { ...NONE, armor: ['light'], skills: { count: 1, from: 'any' }, tools: 'один музыкальный инструмент на выбор' },
  cleric: { ...NONE, armor: ['light', 'medium', 'shield'] },
  druid: { ...NONE, armor: ['light', 'medium', 'shield'], note: 'друиды не носят металлических доспехов и щитов' },
  fighter: { ...NONE, ...MARTIAL },
  monk: { ...NONE, weapons: ['simple'], extraWeapons: ['shortsword'] },
  paladin: { ...NONE, ...MARTIAL },
  ranger: { ...NONE, ...MARTIAL, skills: { count: 1, from: classSkills('ranger') } },
  rogue: { ...NONE, armor: ['light'], skills: { count: 1, from: classSkills('rogue') }, tools: 'воровские инструменты' },
  sorcerer: NONE,
  warlock: { ...NONE, armor: ['light'], weapons: ['simple'] },
  wizard: NONE,
};

const ARMOR_RU = { light: 'лёгкие доспехи', medium: 'средние доспехи', shield: 'щиты' } as const;
const WEAPONS_RU = { simple: 'простое оружие', martial: 'воинское оружие' } as const;

export function multiclassGainText(classId: ClassId): string {
  const gain = MULTICLASS_GAINS[classId];
  const parts = [
    ...gain.armor.map(group => ARMOR_RU[group]),
    ...gain.weapons.map(group => WEAPONS_RU[group]),
    ...gain.extraWeapons.map(index => SRD_WEAPONS.find(weapon => weapon.index === index)?.nameRu.toLowerCase() ?? index),
    ...(gain.skills ? [`навык на выбор${gain.skills.from === 'any' ? '' : ' из списка класса'}`] : []),
    ...(gain.tools ? [gain.tools] : []),
  ];
  const text = parts.length ? parts.join(', ') : 'новых владений нет';
  return gain.note ? `${text} (${gain.note})` : text;
}

export function weaponGained(classId: ClassId, weaponName: string): boolean {
  const gain = MULTICLASS_GAINS[classId];
  const name = weaponName.trim().toLowerCase();
  const weapon = SRD_WEAPONS.find(entry => entry.nameRu.toLowerCase() === name || entry.name.toLowerCase() === name);
  return Boolean(weapon && (gain.weapons.includes(weapon.category) || gain.extraWeapons.includes(weapon.index)));
}
