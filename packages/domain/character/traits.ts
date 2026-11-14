import { CONDITIONS, DAMAGE_TYPES } from '../spells/template/options.ts';

export const TRAIT_ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
export type TraitAbility = typeof TRAIT_ABILITIES[number];

export const TRAIT_EFFECT_KINDS = ['save-advantage', 'roll-bonus', 'resistance', 'speed', 'passive', 'reroll-ones', 'save-proficiency', 'hp-per-level'] as const;
export type TraitEffectKind = typeof TRAIT_EFFECT_KINDS[number];

export type TraitEffect =
  | { kind: 'save-advantage'; condition?: string; damage?: string; magic?: true; concentration?: true; abilities?: TraitAbility[] }
  | { kind: 'roll-bonus'; rolls: 'attacks' | 'checks' | 'saves' | 'initiative'; value: number; abilities?: TraitAbility[] }
  | { kind: 'resistance'; damage: string }
  | { kind: 'speed'; feet: number }
  | { kind: 'passive'; skill: 'perception'; value: number }
  | { kind: 'reroll-ones' }
  | { kind: 'save-proficiency'; ability: TraitAbility }
  | { kind: 'hp-per-level'; value: number };

export type SourcedEffect = { source: string; effect: TraitEffect };

const ROLL_SETS = ['attacks', 'checks', 'saves', 'initiative'] as const;
const CONDITION_CODE = /^(?:[a-z]{3,20}|mod_[a-z0-9_]{2,40})$/;
const DAMAGE_CODES = new Set(DAMAGE_TYPES.map(([value]) => value));
const CONDITION_CODES = new Set(CONDITIONS.map(([value]) => value));

const isAbility = (value: unknown): value is TraitAbility => typeof value === 'string' && (TRAIT_ABILITIES as readonly string[]).includes(value);
const whole = (value: unknown, min: number, max: number) => (Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : null);

function abilitiesOf(raw: unknown): TraitAbility[] | string | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.length || !raw.every(isAbility)) return 'abilities — список характеристик: strength, dexterity, constitution, intelligence, wisdom, charisma';
  return [...new Set(raw)];
}

export function normalizeTraitEffect(input: unknown): TraitEffect | string {
  if (!input || typeof input !== 'object') return 'эффект — объект с kind';
  const raw = input as Record<string, unknown>;
  switch (raw.kind) {
    case 'save-advantage': {
      const abilities = abilitiesOf(raw.abilities);
      if (typeof abilities === 'string') return abilities;
      const effect: TraitEffect = { kind: 'save-advantage', ...(abilities ? { abilities } : {}) };
      if (raw.condition !== undefined) {
        if (typeof raw.condition !== 'string' || !CONDITION_CODE.test(raw.condition) || (!raw.condition.startsWith('mod_') && !CONDITION_CODES.has(raw.condition))) {
          return `save-advantage: состояние «${String(raw.condition)}» — код SRD (frightened, charmed…) или mod_…`;
        }
        effect.condition = raw.condition;
      }
      if (raw.damage !== undefined) {
        if (typeof raw.damage !== 'string' || !DAMAGE_CODES.has(raw.damage)) return `save-advantage: вид урона «${String(raw.damage)}» не из списка`;
        effect.damage = raw.damage;
      }
      if (raw.magic === true) effect.magic = true;
      if (raw.concentration === true) effect.concentration = true;
      if (!effect.condition && !effect.damage && !effect.magic && !effect.concentration && !effect.abilities) {
        return 'save-advantage: против чего — condition, damage, magic, concentration или abilities';
      }
      return effect;
    }
    case 'roll-bonus': {
      const rolls = ROLL_SETS.find(entry => entry === raw.rolls);
      if (!rolls) return 'roll-bonus: rolls — attacks, checks, saves или initiative';
      const value = whole(raw.value, -10, 10);
      if (!value) return 'roll-bonus: value — целое от −10 до 10, не 0';
      const abilities = abilitiesOf(raw.abilities);
      if (typeof abilities === 'string') return abilities;
      return { kind: 'roll-bonus', rolls, value, ...(abilities && rolls !== 'initiative' ? { abilities } : {}) };
    }
    case 'resistance':
      if (typeof raw.damage !== 'string' || !DAMAGE_CODES.has(raw.damage)) return `resistance: вид урона «${String(raw.damage)}» не из списка`;
      return { kind: 'resistance', damage: raw.damage };
    case 'speed': {
      const feet = whole(raw.feet, -30, 60);
      if (!feet || feet % 5) return 'speed: feet — кратное 5 от −30 до 60, не 0';
      return { kind: 'speed', feet };
    }
    case 'passive': {
      const value = whole(raw.value, -10, 10);
      if (raw.skill !== 'perception' || !value) return 'passive: skill — perception, value — целое от −10 до 10, не 0';
      return { kind: 'passive', skill: 'perception', value };
    }
    case 'reroll-ones':
      return { kind: 'reroll-ones' };
    case 'save-proficiency':
      if (!isAbility(raw.ability)) return 'save-proficiency: ability — одна из шести характеристик';
      return { kind: 'save-proficiency', ability: raw.ability };
    case 'hp-per-level': {
      const value = whole(raw.value, 1, 5);
      if (!value) return 'hp-per-level: value — целое от 1 до 5';
      return { kind: 'hp-per-level', value };
    }
    default:
      return `эффект «${String(raw.kind)}»: kind — ${TRAIT_EFFECT_KINDS.join(', ')}`;
  }
}

export function normalizeTraitEffects(input: unknown, limit = 12): TraitEffect[] | string {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return 'effects — список эффектов';
  if (input.length > limit) return `effects — не больше ${limit}`;
  const effects: TraitEffect[] = [];
  for (const item of input) {
    const effect = normalizeTraitEffect(item);
    if (typeof effect === 'string') return effect;
    effects.push(effect);
  }
  return effects;
}

// «Устойчивый (Сила)» is named «устойчивый» in roll reasons.
export const reasonOf = (source: string) => source.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase();

export function sourced(source: string, effects: readonly TraitEffect[] | undefined): SourcedEffect[] {
  return (effects ?? []).map(effect => ({ source, effect }));
}

function pushOnce(list: string[], reason: string) {
  if (!list.includes(reason)) list.push(reason);
}

export type TraitSaveAgainst = { condition?: string | null; magic?: boolean; damageType?: string | null; concentration?: boolean };

// Every filter the effect names must hold: «against poison» is two effects, one for the condition and one for the damage.
export function traitSaveAdvantages(effects: readonly SourcedEffect[], ability: string, against: TraitSaveAgainst | null | undefined): string[] {
  const reasons: string[] = [];
  for (const { source, effect } of effects) {
    if (effect.kind !== 'save-advantage') continue;
    if (effect.abilities && !effect.abilities.includes(ability as TraitAbility)) continue;
    if ((effect.condition || effect.damage || effect.magic || effect.concentration) && !against) continue;
    if (effect.condition && against?.condition !== effect.condition) continue;
    if (effect.damage && against?.damageType !== effect.damage) continue;
    if (effect.magic && !against?.magic) continue;
    if (effect.concentration && !against?.concentration) continue;
    pushOnce(reasons, reasonOf(source));
  }
  return reasons;
}

export type TraitRollKind = 'attack' | 'save' | 'ability' | 'skill' | 'initiative';
const ROLLS_OF: Record<TraitRollKind, string> = { attack: 'attacks', save: 'saves', ability: 'checks', skill: 'checks', initiative: 'initiative' };

export function traitRollBonus(effects: readonly SourcedEffect[], kind: TraitRollKind, ability: string | null): { value: number; reasons: string[] } {
  let value = 0;
  const reasons: string[] = [];
  for (const { source, effect } of effects) {
    if (effect.kind !== 'roll-bonus' || effect.rolls !== ROLLS_OF[kind]) continue;
    if (effect.abilities && !(ability && effect.abilities.includes(ability as TraitAbility))) continue;
    value += effect.value;
    reasons.push(`${reasonOf(source)} ${effect.value > 0 ? '+' : '−'}${Math.abs(effect.value)}`);
  }
  return { value, reasons };
}

export function traitResistance(effects: readonly SourcedEffect[], damageType: string | null): string | null {
  if (!damageType) return null;
  return effects.find(({ effect }) => effect.kind === 'resistance' && effect.damage === damageType)?.source ?? null;
}

export function traitResistances(effects: readonly SourcedEffect[]): string[] {
  return [...new Set(effects.flatMap(({ effect }) => (effect.kind === 'resistance' ? [effect.damage] : [])))];
}

export function traitSpeed(effects: readonly SourcedEffect[]): { feet: number; reasons: string[] } {
  let feet = 0;
  const reasons: string[] = [];
  for (const { source, effect } of effects) {
    if (effect.kind !== 'speed') continue;
    feet += effect.feet;
    reasons.push(`скорость ${effect.feet > 0 ? '+' : '−'}${Math.abs(effect.feet)} фт.: ${reasonOf(source)}`);
  }
  return { feet, reasons };
}

export function traitPassive(effects: readonly SourcedEffect[], skill: 'perception'): number {
  return effects.reduce((sum, { effect }) => sum + (effect.kind === 'passive' && effect.skill === skill ? effect.value : 0), 0);
}

export function traitRerollOnes(effects: readonly SourcedEffect[]): string | null {
  const found = effects.find(({ effect }) => effect.kind === 'reroll-ones');
  return found ? reasonOf(found.source) : null;
}

export function traitSaveProficiency(effects: readonly SourcedEffect[], ability: string): string | null {
  const found = effects.find(({ effect }) => effect.kind === 'save-proficiency' && effect.ability === ability);
  return found ? reasonOf(found.source) : null;
}

export function traitHpPerLevel(effects: readonly SourcedEffect[] | readonly TraitEffect[]): number {
  return effects.reduce((sum, entry) => {
    const effect = 'effect' in entry ? entry.effect : entry;
    return sum + (effect.kind === 'hp-per-level' ? effect.value : 0);
  }, 0);
}

const ABILITY_RU: Record<TraitAbility, string> = {
  strength: 'Силы', dexterity: 'Ловкости', constitution: 'Телосложения', intelligence: 'Интеллекта', wisdom: 'Мудрости', charisma: 'Харизмы',
};
const CONDITION_RU = new Map(CONDITIONS);
const DAMAGE_RU = new Map(DAMAGE_TYPES);
const ROLLS_RU = { attacks: 'атакам', checks: 'проверкам', saves: 'спасброскам', initiative: 'инициативе' } as const;

export function describeTraitEffect(effect: TraitEffect): string {
  const signed = (value: number) => (value > 0 ? `+${value}` : `−${-value}`);
  const only = (abilities?: TraitAbility[]) => (abilities ? ` (${abilities.map(ability => ABILITY_RU[ability]).join(', ')})` : '');
  switch (effect.kind) {
    case 'save-advantage': {
      const against = [
        effect.condition ? CONDITION_RU.get(effect.condition) ?? effect.condition : null,
        effect.damage ? `урон: ${DAMAGE_RU.get(effect.damage) ?? effect.damage}` : null,
        effect.magic ? 'магия' : null,
        effect.concentration ? 'концентрация' : null,
      ].filter(Boolean);
      return `Спасброски${only(effect.abilities)}${against.length ? ` против: ${against.join(', ')}` : ''} — с преимуществом`;
    }
    case 'roll-bonus': return `${signed(effect.value)} к ${ROLLS_RU[effect.rolls]}${only(effect.abilities)}`;
    case 'resistance': return `Сопротивление: ${DAMAGE_RU.get(effect.damage) ?? effect.damage}`;
    case 'speed': return `Скорость ${signed(effect.feet)} фт.`;
    case 'passive': return `${signed(effect.value)} к пассивному Восприятию`;
    case 'reroll-ones': return 'Натуральная 1 на к20 перебрасывается';
    case 'save-proficiency': return `Владение спасбросками ${ABILITY_RU[effect.ability]}`;
    case 'hp-per-level': return `Максимум хитов +${effect.value} за уровень`;
  }
}
