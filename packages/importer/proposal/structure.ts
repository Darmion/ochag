import { DAMAGE_WORDS, SKILLS, SLUG, abilityName, damageFormula, idList, integer, object, text } from './internal.ts';

export type ImportedWeapon = {
  name: string;
  ability: 'strength' | 'dexterity' | 'finesse';
  proficient: boolean;
  damageFormula: string | null;
  damageType: string | null;
  attackBonus: number;
};

export type ImportedSpell = { slug: string; nameRu: string | null; nameEn: string | null; level: number | null };

export type ImportedSpellLists = { prepared: string[]; book: string[]; granted: string[]; slotless: string[] };

export type ImportedStructure = {
  className: string | null;
  level: number | null;
  experience: number | null;
  hitDie: number | null;
  spellcastingAbility: string | null;
  skills: Array<{ index: string; proficient: boolean; expertise: boolean }>;
  saves: string[];
  weapons: ImportedWeapon[];
  spellSlots: Array<{ level: number; max: number; current: number }>;
  resources: Array<{ name: string; current: number; max: number }>;
  pactSlots: { level: number; max: number; current: number } | null;
  spellSaveDc: number | null;
  spellAttack: number | null;
  spells: ImportedSpell[];
  lssSpells: ImportedSpellLists;
};

export function normalizeStructure(raw: unknown): ImportedStructure {
  const source = object(raw);
  const skills = (Array.isArray(source.skills) ? source.skills : [])
    .map(entry => object(entry))
    .filter(entry => SKILLS.includes(entry.index))
    .map(entry => ({ index: String(entry.index), proficient: entry.proficient === true || entry.expertise === true, expertise: entry.expertise === true }));
  const weapons = (Array.isArray(source.weapons) ? source.weapons : []).slice(0, 30).map(entry => object(entry)).flatMap(entry => {
    const name = text(entry.name, 100);
    if (!name) return [];
    const ability = ['strength', 'dexterity', 'finesse'].includes(entry.ability) ? entry.ability : 'strength';
    const damageType = DAMAGE_WORDS.some(([, code]) => code === entry.damageType) ? String(entry.damageType) : null;
    return [{
      name, ability, proficient: entry.proficient !== false,
      damageFormula: damageFormula(entry.damageFormula), damageType,
      attackBonus: integer(entry.attackBonus, -10, 20) ?? 0,
    } as ImportedWeapon];
  });
  return {
    className: text(source.className, 100),
    level: integer(source.level, 1, 20),
    experience: integer(source.experience, 0, 10_000_000),
    hitDie: [6, 8, 10, 12].includes(Number(source.hitDie)) ? Number(source.hitDie) : null,
    spellcastingAbility: abilityName(source.spellcastingAbility),
    skills: [...new Map(skills.map(entry => [entry.index, entry])).values()],
    saves: [...new Set((Array.isArray(source.saves) ? source.saves : []).map(abilityName).filter((value): value is string => Boolean(value)))],
    weapons,
    spellSlots: (Array.isArray(source.spellSlots) ? source.spellSlots : []).map(entry => object(entry)).flatMap(entry => {
      const level = integer(entry.level, 1, 9);
      const max = integer(entry.max, 0, 20);
      if (level === null || max === null) return [];
      return [{ level, max, current: Math.min(max, integer(entry.current, 0, 20) ?? max) }];
    }),
    resources: (Array.isArray(source.resources) ? source.resources : []).slice(0, 30).map(entry => object(entry)).flatMap(entry => {
      const name = text(entry.name, 100);
      const max = integer(entry.max, 0, 1000);
      if (!name || max === null) return [];
      return [{ name, max, current: Math.min(max, integer(entry.current, 0, 1000) ?? max) }];
    }),
    pactSlots: (() => {
      const pact = object(source.pactSlots);
      const level = integer(pact.level, 1, 5);
      const max = integer(pact.max, 1, 4);
      return level !== null && max !== null ? { level, max, current: Math.min(max, integer(pact.current, 0, 4) ?? max) } : null;
    })(),
    spellSaveDc: integer(source.spellSaveDc, 1, 40),
    spellAttack: integer(source.spellAttack, -10, 30),
    spells: [...new Map((Array.isArray(source.spells) ? source.spells : []).map(entry => object(entry)).flatMap(entry => {
      const slug = typeof entry.slug === 'string' ? entry.slug.toLowerCase() : '';
      if (!SLUG.test(slug)) return [];
      return [[slug, { slug, nameRu: text(entry.nameRu, 100), nameEn: text(entry.nameEn, 100), level: integer(entry.level, 0, 9) }] as const];
    })).values()].slice(0, 200),
    lssSpells: {
      prepared: idList(object(source.lssSpells).prepared),
      book: idList(object(source.lssSpells).book),
      granted: idList(object(source.lssSpells).granted),
      slotless: idList(object(source.lssSpells).slotless),
    },
  };
}

export function structureSummary(structure: ImportedStructure): string {
  const parts: string[] = [];
  if (structure.className) parts.push(`класс «${structure.className}»${structure.level ? `, ${structure.level}-й уровень` : ''}`);
  else if (structure.level) parts.push(`${structure.level}-й уровень`);
  if (structure.skills.length) parts.push(`навыков: ${structure.skills.length}${structure.skills.some(skill => skill.expertise) ? ' (с компетентностью)' : ''}`);
  if (structure.saves.length) parts.push(`спасбросков: ${structure.saves.length}`);
  if (structure.weapons.length) parts.push(`оружие: ${structure.weapons.map(weapon => weapon.name).join(', ')}`);
  if (structure.spellSlots.length) parts.push(`ячейки ${structure.spellSlots.map(slot => `${slot.level} ур. ×${slot.max}`).join(', ')}`);
  if (structure.pactSlots) parts.push(`ячейки договора ${structure.pactSlots.level} ур. ×${structure.pactSlots.max}`);
  if (structure.spellSaveDc !== null || structure.spellAttack !== null) {
    parts.push([structure.spellSaveDc !== null ? `СЛ заклинаний ${structure.spellSaveDc}` : '', structure.spellAttack !== null ? `атака заклинанием ${structure.spellAttack >= 0 ? '+' : ''}${structure.spellAttack}` : ''].filter(Boolean).join(', '));
  }
  if (structure.spells.length) parts.push(`заклинания по названиям: ${structure.spells.length}`);
  const lssCount = new Set([...structure.lssSpells.prepared, ...structure.lssSpells.book, ...structure.lssSpells.granted, ...structure.lssSpells.slotless]).size;
  if (lssCount) parts.push(`заклинаний без названий: ${lssCount} (сопоставляются в листе, вкладка «Заклинания»)`);
  if (structure.resources.length) parts.push(`ресурсы: ${structure.resources.map(resource => resource.name).join(', ')}`);
  if (structure.hitDie) parts.push(`кость хитов d${structure.hitDie}`);
  return parts.join('; ');
}
