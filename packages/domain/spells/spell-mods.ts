export type SpellMod = { id: string; kind: string; values: Record<string, unknown>; sourceName: string };

export function spellModsOf(rows: Array<{ id: string; parameters: any }>): SpellMod[] {
  return rows
    .filter(row => row.parameters && typeof row.parameters.kind === 'string')
    .map(row => ({ id: row.id, kind: String(row.parameters.kind), values: (row.parameters.values ?? {}) as Record<string, unknown>, sourceName: String(row.parameters.sourceName ?? 'заклинание') }));
}

const str = (mod: SpellMod, key: string) => String(mod.values[key] ?? '');
const num = (mod: SpellMod, key: string) => Number(mod.values[key] ?? 0);
const list = (mod: SpellMod, key: string) => (Array.isArray(mod.values[key]) ? (mod.values[key] as unknown[]).map(String) : []);

export function acDelta(mods: SpellMod[], armorClass: number, dexterityModifier: number): { delta: number; reasons: string[] } {
  let plus = 0;
  let floor = -Infinity;
  const reasons: string[] = [];
  for (const mod of mods.filter(entry => entry.kind === 'ac')) {
    const value = num(mod, 'value');
    if (str(mod, 'mode') === 'plus') { plus += value; reasons.push(`КД ${value >= 0 ? '+' : ''}${value}: «${mod.sourceName}»`); }
    else if (str(mod, 'mode') === 'floor') { floor = Math.max(floor, value); reasons.push(`КД не ниже ${value}: «${mod.sourceName}»`); }
    else if (str(mod, 'mode') === 'base') { floor = Math.max(floor, value + dexterityModifier); reasons.push(`КД ${value} + ЛОВ: «${mod.sourceName}»`); }
  }
  const withPlus = armorClass + plus;
  return { delta: Math.max(withPlus, floor) - armorClass, reasons };
}

export function speedFrom(mods: SpellMod[], base: number): { feet: number; fly: number | null; reasons: string[] } {
  const own = mods.filter(entry => entry.kind === 'speed');
  const reasons: string[] = [];
  let feet = base;
  for (const mod of own) {
    if (str(mod, 'mode') === 'plus') { feet += num(mod, 'feet'); reasons.push(`скорость +${num(mod, 'feet')} фт.: «${mod.sourceName}»`); }
    if (str(mod, 'mode') === 'minus') { feet -= num(mod, 'feet'); reasons.push(`скорость −${num(mod, 'feet')} фт.: «${mod.sourceName}»`); }
  }
  const double = own.some(mod => str(mod, 'mode') === 'double');
  const half = own.some(mod => str(mod, 'mode') === 'half');
  if (double && !half) { feet *= 2; reasons.push('скорость вдвое'); }
  if (half && !double) { feet = Math.floor(feet / 2); reasons.push('скорость вдвое меньше'); }
  const stopped = own.find(mod => str(mod, 'mode') === 'zero') ?? mods.find(mod => mod.kind === 'restrict' && list(mod, 'what').includes('no-move-or-act'));
  if (stopped) { feet = 0; reasons.push(`скорость 0: «${stopped.sourceName}»`); }
  const flying = own.filter(mod => str(mod, 'mode') === 'fly').map(mod => num(mod, 'feet'));
  return { feet: Math.max(0, feet), fly: flying.length ? Math.max(...flying) : null, reasons };
}

export type RollKind = 'attack' | 'save' | 'check';

export function rollMods(
  mods: SpellMod[], kind: RollKind, ability: string | null, skill: string | null, against = false,
): { flat: number; dice: Array<{ sides: number; sign: 1 | -1; label: string }>; advantages: string[]; disadvantages: string[]; spentRuling: string[]; spentDice: string[] } {
  const result = { flat: 0, dice: [] as Array<{ sides: number; sign: 1 | -1; label: string }>, advantages: [] as string[], disadvantages: [] as string[], spentRuling: [] as string[], spentDice: [] as string[] };
  for (const mod of mods) {
    if (kind === 'attack') {
      if (mod.kind !== 'attack-rolls' || str(mod, 'whose') !== (against ? 'against' : 'own')) continue;
    } else {
      if (mod.kind !== 'checks') continue;
      const roll = str(mod, 'roll');
      if (roll !== 'both' && roll !== kind) continue;
      const wantedSkill = str(mod, 'skill');
      if (kind === 'check' && wantedSkill && wantedSkill !== 'none') {
        if (wantedSkill !== skill) continue;
      } else if (str(mod, 'ability') !== 'all' && str(mod, 'ability') !== ability) continue;
    }
    const label = mod.sourceName.toLowerCase();
    const mode = str(mod, 'mode');
    if (mode === 'die' || mode === 'minus-die') result.dice.push({ sides: Number(str(mod, 'die') || 4), sign: mode === 'die' ? 1 : -1, label });
    else if (mode === 'plus') result.flat += num(mod, 'value');
    else if (mode === 'minus') result.flat -= num(mod, 'value');
    else if (mode === 'advantage') result.advantages.push(label);
    else if (mode === 'disadvantage') result.disadvantages.push(label);
    if (mod.values.once === true || str(mod, 'scope') === 'first') (mode === 'advantage' || mode === 'disadvantage' ? result.spentRuling : result.spentDice).push(mod.id);
  }
  return result;
}

export function damageDefense(mods: SpellMod[], damageType: string | null, magical: boolean): { resisted: boolean; immune: boolean; vulnerable: boolean } {
  const matches = (mod: SpellMod) => {
    const types = list(mod, 'types');
    if (types.includes('all')) return true;
    if (!damageType) return false;
    if (types.includes(damageType)) return true;
    if (types.includes('param') && str(mod, 'paramValue') === damageType) return true;
    return types.includes('nonmagical-physical') && !magical && ['bludgeoning', 'piercing', 'slashing'].includes(damageType);
  };
  const of = (mode: string) => mods.some(mod => mod.kind === 'defense' && str(mod, 'mode') === mode && matches(mod));
  return { resisted: of('resistance'), immune: of('immunity'), vulnerable: of('vulnerability') };
}

export function conditionGuard(mods: SpellMod[], code: string): string | null {
  const mod = mods.find(entry => entry.kind === 'defense' && str(entry, 'mode') === 'condition-immunity' && list(entry, 'conditions').includes(code));
  return mod ? mod.sourceName : null;
}

export function restrictionsOf(mods: SpellMod[]): Set<string> {
  return new Set(mods.filter(mod => mod.kind === 'restrict').flatMap(mod => list(mod, 'what')));
}

export function extraActionsOf(mods: SpellMod[]): Set<string> {
  return new Set(mods.filter(mod => mod.kind === 'extra-action').flatMap(mod => list(mod, 'allowed')));
}

export function ownExtraDamage(mods: SpellMod[], on: 'weapon' | 'spell'): Array<{ formula: string; damageType: string; label: string; once: boolean; id: string }> {
  return mods
    .filter(mod => mod.kind === 'extra-damage' && str(mod, 'against') === 'all' && (str(mod, 'on') === 'any' || str(mod, 'on') === on))
    .map(mod => ({ formula: str(mod, 'formula'), damageType: str(mod, 'damageType'), label: mod.sourceName, once: mod.values.oncePerTurn === true, id: mod.id }));
}

export function senseFeet(mods: SpellMod[], sense: 'darkvision' | 'blindsight' | 'truesight'): number {
  return Math.max(0, ...mods.filter(mod => mod.kind === 'senses' && str(mod, 'sense') === sense).map(mod => num(mod, 'feet')));
}
