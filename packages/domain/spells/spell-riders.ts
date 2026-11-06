export type ExpiresAt = 'caster-start' | 'caster-end' | 'target-start' | 'target-end';

export type SpellRider =
  | { kind: 'slowed'; feet: number; expires: ExpiresAt }
  | { kind: 'no_reactions'; expires: ExpiresAt }
  | { kind: 'no_healing'; expires: ExpiresAt }
  | { kind: 'guided'; expires: ExpiresAt }
  | { kind: 'mocked'; expires: ExpiresAt }
  | { kind: 'blessed'; die: number }
  | { kind: 'baned'; die: number }
  | { kind: 'marked'; dice: string }
  | { kind: 'outlined' }
  | { kind: 'push'; feet: number }
  | { kind: 'temp_hp'; dice: string; perSlot: number }
  | { kind: 'heroism' }
  | { kind: 'ac_bonus'; bonus: number }
  | { kind: 'sanctuary' }
  | { kind: 'aid'; bonus: number }
  | { kind: 'mage_armor'; base: number }
  | { kind: 'dispel'; upTo: number }
  | { kind: 'restore'; conditions: string[] }
  | { kind: 'protected_from_evil' }
  | { kind: 'flying'; feet: number }
  | { kind: 'light'; bright: number; dim: number; replaces: boolean }
  | { kind: 'darkness'; radius: number; dispelsLight: number }
  | { kind: 'dispel_darkness'; upTo: number }
  | { kind: 'hasted' }
  | { kind: 'slow_spell' }
  | { kind: 'stupor' };

const text = (value: string | null | undefined) => String(value ?? '').replace(/\s+/g, ' ');

export function spellRiders(desc: string | null | undefined): SpellRider[] {
  const source = text(desc);
  const riders: SpellRider[] = [];
  if (/speed is doubled, it gains a \+2 bonus to AC/i.test(source)) riders.push({ kind: 'hasted' });
  if (/speed is halved, it takes a -2 penalty to AC and dexterity saving throws/i.test(source)) riders.push({ kind: 'slow_spell' });
  if (/while charmed by this spell, the creature is incapacitated and has a speed of 0/i.test(source)) riders.push({ kind: 'stupor' });
  const slowed = /speed is reduced by (\d+) feet until the start of your next turn/i.exec(source);
  if (slowed) riders.push({ kind: 'slowed', feet: Number(slowed[1]), expires: 'caster-start' });
  if (/can't take reactions until the start of its next turn/i.test(source)) riders.push({ kind: 'no_reactions', expires: 'target-start' });
  if (/can't regain hit points until the start of your next turn/i.test(source)) riders.push({ kind: 'no_healing', expires: 'caster-start' });
  if (/next attack roll made against this target before the end of your next turn has advantage/i.test(source)) riders.push({ kind: 'guided', expires: 'caster-end' });
  if (/disadvantage on the next attack roll it makes before the end of its next turn/i.test(source)) riders.push({ kind: 'mocked', expires: 'target-end' });
  const bless = /roll a d(\d+) and add the number rolled to the attack roll or saving throw/i.exec(source);
  if (bless) riders.push({ kind: 'blessed', die: Number(bless[1]) });
  const bane = /roll a d(\d+) and subtract the number rolled from the attack roll or saving throw/i.exec(source);
  if (bane) riders.push({ kind: 'baned', die: Number(bane[1]) });
  const mark = /deal an extra (\d+d\d+) damage to the target whenever you hit it with a weapon attack/i.exec(source);
  if (mark) riders.push({ kind: 'marked', dice: mark[1]! });
  if (/attack roll against an affected creature or object has advantage/i.test(source)) riders.push({ kind: 'outlined' });
  const push = /(?:is |be )?pushed (\d+) feet away from you/i.exec(source);
  if (push) riders.push({ kind: 'push', feet: Number(push[1]) });
  const temp = /gains? (\d+d\d+(?:\s*\+\s*\d+)?) temporary hit points/i.exec(source);
  if (temp) riders.push({ kind: 'temp_hp', dice: temp[1]!.replace(/\s+/g, ''), perSlot: 0 });
  if (/temporary hit points equal to your spellcasting ability modifier at the start of each of its turns/i.test(source)) riders.push({ kind: 'heroism' });
  const ac = /\+(\d+) bonus to AC for the duration/i.exec(source);
  if (ac) riders.push({ kind: 'ac_bonus', bonus: Number(ac[1]) });
  if (/must first make a wisdom saving throw\. On a failed save, the creature must choose a new target or lose the attack or spell/i.test(source)) riders.push({ kind: 'sanctuary' });
  const aid = /hit point maximum and current hit points increase by (\d+)/i.exec(source);
  if (aid) riders.push({ kind: 'aid', bonus: Number(aid[1]) });
  const armor = /base AC becomes (\d+) \+ its Dexterity modifier/i.exec(source);
  if (armor) riders.push({ kind: 'mage_armor', base: Number(armor[1]) });
  const dispel = /Any spell of (\d)(?:st|nd|rd|th) level or lower on the target ends/i.exec(source);
  if (dispel) riders.push({ kind: 'dispel', upTo: Number(dispel[1]) });
  const restore = /end either one disease or one condition afflicting it\. The condition can be ([a-z, ]+?)\./i.exec(source);
  if (restore) riders.push({ kind: 'restore', conditions: restore[1]!.split(/,\s*(?:or\s+)?|\s+or\s+/).map(word => word.trim().toLowerCase()).filter(Boolean) });
  if (/protected against certain types of creatures: aberrations, celestials, elementals, fey, fiends, and undead/i.test(source)) riders.push({ kind: 'protected_from_evil' });
  const flight = /gains a flying speed of (\d+) feet/i.exec(source);
  if (flight) riders.push({ kind: 'flying', feet: Number(flight[1]) });
  const light = lightRider(source);
  if (light) riders.push(light);
  const darkness = /Magical darkness spreads from a point you choose within range to fill a (\d+)-foot-radius sphere/i.exec(source);
  if (darkness) {
    const dispels = /overlaps with an area of light created by a spell of (\d)(?:st|nd|rd|th) level or lower/i.exec(source);
    riders.push({ kind: 'darkness', radius: Number(darkness[1]), dispelsLight: dispels ? Number(dispels[1]) : 0 });
  }
  const dawn = /overlaps with an area of darkness created by a spell of (\d)(?:st|nd|rd|th) level or lower/i.exec(source);
  if (dawn) riders.push({ kind: 'dispel_darkness', upTo: Number(dawn[1]) });
  return riders;
}

function lightRider(source: string): SpellRider | null {
  if (/ignites flammable objects not being worn or carried/i.test(source)) return null;
  const replaces = /The spell ends if you cast it again/i.test(source);
  const glow = /bright light in an? (\d+)-foot radius and dim light for an additional (\d+) feet/i.exec(source);
  if (glow) return { kind: 'light', bright: Number(glow[1]), dim: Number(glow[2]), replaces };
  const sphere = /(\d+)-foot-radius sphere of light/i.exec(source);
  const sphereDim = /sheds dim light for an additional (\d+) feet/i.exec(source);
  if (sphere) return { kind: 'light', bright: Number(sphere[1]), dim: sphereDim ? Number(sphereDim[1]) : 0, replaces };
  if (/equivalent in brightness to a torch/i.test(source)) return { kind: 'light', bright: 20, dim: 20, replaces };
  const dim = /(?:each light|affected creatures) sheds? dim light in an? (\d+)-foot radius/i.exec(source);
  if (dim) return { kind: 'light', bright: 0, dim: Number(dim[1]), replaces };
  return null;
}

export function spellCylinderFeet(desc: string | null | undefined): number | null {
  const source = text(desc);
  const radiusFirst = /\d+-foot[- ]radius,? (\d+)-foot[- ]?(?:high|tall) cylinder/i.exec(source);
  if (radiusFirst) return Number(radiusFirst[1]);
  const heightFirst = /(\d+)-foot-(?:high|tall) cylinder with an? \d+-foot radius/i.exec(source);
  return heightFirst ? Number(heightFirst[1]) : null;
}

export function aidPerSlot(higherLevel: string | null | undefined): number {
  const match = /increase by an additional (\d+) for each slot level above/i.exec(text(higherLevel));
  return match ? Number(match[1]) : 0;
}

export function tempHpPerSlot(higherLevel: string | null | undefined): number {
  const match = /(\d+) additional temporary hit points for each slot level above/i.exec(text(higherLevel));
  return match ? Number(match[1]) : 0;
}

const COUNTS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export type ProjectileRule = { base: number; noun: 'ray' | 'dart' | 'beam'; perSlotFrom: number | null; byLevel: Array<[number, number]> | null };

export function projectileRule(spell: { desc?: string | null; higherLevel?: string | null }): ProjectileRule | null {
  const source = text(spell.desc);
  const higher = text(spell.higherLevel);
  const created = /create (one|two|three|four|five|six|\d+) (?:[a-z-]+ ){0,3}(rays?|darts?|beams?)\b/i.exec(source);
  const noun = (word: string) => (/^ray/i.test(word) ? 'ray' : /^dart/i.test(word) ? 'dart' : 'beam') as ProjectileRule['noun'];
  if (created) {
    const base = COUNTS[created[1]!.toLowerCase()] ?? Number(created[1]);
    const more = /one (?:additional|more) (?:ray|dart|beam) for each slot level above (\d)/i.exec(higher);
    return { base, noun: noun(created[2]!), perSlotFrom: more ? Number(more[1]) : null, byLevel: null };
  }
  const levels = [...source.matchAll(/(two|three|four) beams at (\d+)(?:st|nd|rd|th) level/gi)].map(match => [Number(match[2]), COUNTS[match[1]!.toLowerCase()]!] as [number, number]);
  if (levels.length) return { base: 1, noun: 'beam', perSlotFrom: null, byLevel: levels };
  return null;
}

export function projectileCount(rule: ProjectileRule, slotLevel: number, characterLevel: number | null | undefined): number {
  let count = rule.base;
  if (rule.perSlotFrom !== null) count += Math.max(0, slotLevel - rule.perSlotFrom);
  for (const [level, value] of rule.byLevel ?? []) if ((characterLevel ?? 1) >= level) count = Math.max(count, value);
  return count;
}

export function distributeShots(count: number, targetIds: string[], shots?: string[] | null): string[] | { error: string } {
  if (!targetIds.length) return [];
  if (shots && shots.length) {
    if (shots.length > count) return { error: `Снарядов всего ${count}, а назначено ${shots.length}.` };
    const unknown = shots.find(id => !targetIds.includes(id));
    if (unknown) return { error: 'Снаряд назначен не выбранной цели.' };
    return shots;
  }
  return Array.from({ length: count }, (_, index) => targetIds[index % targetIds.length]!);
}

export function targetLimit(spell: { desc?: string | null; higherLevel?: string | null }, slotLevel: number): number | null {
  const up = /up to (one|two|three|four|five|six|\d+) creatures/i.exec(text(spell.desc));
  if (!up) return null;
  let limit = COUNTS[up[1]!.toLowerCase()] ?? Number(up[1]);
  const more = /one additional creature for each slot level above (\d)/i.exec(text(spell.higherLevel));
  if (more) limit += Math.max(0, slotLevel - Number(more[1]));
  return limit;
}

const AREA = /\b\d+-foot[- ](?:radius|cube|cone|line|sphere|cylinder|square)|\bradius\b|\bcone\b|\bcube\b|\bsphere\b|\bcylinder\b/i;
const MANY = /\beach creature\b|\bany number of\b|creatures of your choice|\bup to (?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|\d+)\b|\btwo creatures\b|\bone or two\b|\bmultiple\b|\byou and\b|\ba number of creatures\b|\bcreatures within\b|\bother targets\b|\bas many as\b/i;
const ONE = /\b(?:a|one) (?:creature|target|humanoid|beast|willing creature|living creature|corpse|creature or object|creature, object)\b|\byou touch\b|\bthe target\b/i;
export function singleTarget(spell: { desc?: string | null; higherLevel?: string | null; range?: string | null }, level: number, slotLevel: number): boolean {
  const source = text(spell.desc);
  if (/^self/i.test(text(spell.range).trim())) return false;
  const opening = source.split(/(?<=\.)\s+/).slice(0, 2).join(' ');
  if (AREA.test(source) || MANY.test(source) || !ONE.test(opening)) return false;
  if (projectileRule(spell) || targetLimit(spell, slotLevel) !== null || hitPointPool(spell)) return false;
  if (slotLevel > level && /additional (?:creature|target|humanoid|beast|undead)/i.test(text(spell.higherLevel))) return false;
  return true;
}

export type HitPointPool = { dice: string; perSlot: string | null };
export function hitPointPool(spell: { desc?: string | null; higherLevel?: string | null }): HitPointPool | null {
  const pool = /Roll (\d+d\d+); the total is how many hit points of creatures this spell can affect/i.exec(text(spell.desc));
  if (!pool) return null;
  const more = /roll an additional (\d+d\d+) for each slot level above/i.exec(text(spell.higherLevel));
  return { dice: pool[1]!, perSlot: more ? more[1]! : null };
}

export function sleepers<T extends { id: string; hp: number; immune?: boolean }>(pool: number, creatures: T[]): T[] {
  let left = pool;
  const chosen: T[] = [];
  for (const creature of [...creatures].filter(entry => !entry.immune && entry.hp > 0).sort((a, b) => a.hp - b.hp)) {
    if (creature.hp > left) break;
    chosen.push(creature);
    left -= creature.hp;
  }
  return chosen;
}
