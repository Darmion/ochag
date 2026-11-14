import { ABILITIES, usableLevelUpChoice, type Ability, type LevelUpChoice, type LevelUpContext, type LevelUpPlan } from './level-up.ts';
import { FEATS, FEAT_ABILITIES } from './feats.ts';
import type { ClassId } from './classes.ts';

export const CLASS_ABILITY_ORDER: Record<ClassId, Ability[]> = {
  barbarian: ['strength', 'constitution', 'dexterity', 'wisdom', 'charisma', 'intelligence'],
  bard: ['charisma', 'dexterity', 'constitution', 'wisdom', 'intelligence', 'strength'],
  cleric: ['wisdom', 'constitution', 'strength', 'dexterity', 'charisma', 'intelligence'],
  druid: ['wisdom', 'constitution', 'dexterity', 'intelligence', 'charisma', 'strength'],
  fighter: ['strength', 'constitution', 'dexterity', 'wisdom', 'charisma', 'intelligence'],
  monk: ['dexterity', 'wisdom', 'constitution', 'strength', 'intelligence', 'charisma'],
  paladin: ['strength', 'charisma', 'constitution', 'wisdom', 'dexterity', 'intelligence'],
  ranger: ['dexterity', 'wisdom', 'constitution', 'strength', 'intelligence', 'charisma'],
  rogue: ['dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma', 'strength'],
  sorcerer: ['charisma', 'constitution', 'dexterity', 'wisdom', 'intelligence', 'strength'],
  warlock: ['charisma', 'constitution', 'dexterity', 'wisdom', 'intelligence', 'strength'],
  wizard: ['intelligence', 'constitution', 'dexterity', 'wisdom', 'charisma', 'strength'],
};

export const FAVORITE_SPELLS: string[] = [
  'eldritch-blast', 'fire-bolt', 'sacred-flame', 'vicious-mockery', 'produce-flame', 'shillelagh', 'ray-of-frost', 'shocking-grasp', 'guidance',
  'chill-touch', 'mage-hand', 'light', 'minor-illusion', 'prestidigitation', 'spare-the-dying', 'thaumaturgy', 'message', 'druidcraft',
  'shield', 'magic-missile', 'healing-word', 'cure-wounds', 'bless', 'sleep', 'faerie-fire', 'hunters-mark', 'mage-armor', 'detect-magic',
  'thunderwave', 'burning-hands', 'guiding-bolt', 'charm-person', 'feather-fall', 'command', 'sanctuary', 'entangle', 'goodberry', 'fog-cloud',
  'heroism', 'shield-of-faith', 'hellish-rebuke', 'protection-from-evil-and-good', 'divine-favor',
  'misty-step', 'scorching-ray', 'hold-person', 'spiritual-weapon', 'invisibility', 'shatter', 'lesser-restoration', 'web', 'mirror-image', 'aid',
  'pass-without-trace', 'moonbeam', 'flaming-sphere', 'suggestion', 'darkness', 'blur', 'enhance-ability', 'silence', 'spike-growth', 'barkskin',
  'fireball', 'counterspell', 'haste', 'spirit-guardians', 'revivify', 'lightning-bolt', 'hypnotic-pattern', 'fly', 'dispel-magic',
  'mass-healing-word', 'call-lightning', 'slow', 'fear', 'conjure-animals', 'vampiric-touch', 'stinking-cloud', 'bestow-curse',
  'polymorph', 'banishment', 'greater-invisibility', 'wall-of-fire', 'dimension-door', 'death-ward', 'guardian-of-faith', 'ice-storm', 'confusion',
  'blight', 'stoneskin', 'freedom-of-movement',
  'cone-of-cold', 'wall-of-force', 'hold-monster', 'mass-cure-wounds', 'flame-strike', 'greater-restoration', 'animate-objects', 'dominate-person',
  'insect-plague', 'raise-dead', 'cloudkill', 'telekinesis',
  'chain-lightning', 'disintegrate', 'heal', 'globe-of-invulnerability', 'sunbeam', 'harm', 'true-seeing', 'mass-suggestion', 'blade-barrier',
  'finger-of-death', 'plane-shift', 'teleport', 'forcecage', 'resurrection', 'regenerate', 'fire-storm', 'prismatic-spray', 'delayed-blast-fireball',
  'power-word-stun', 'sunburst', 'dominate-monster', 'feeblemind', 'incendiary-cloud', 'holy-aura', 'earthquake', 'maze', 'mind-blank',
  'wish', 'meteor-swarm', 'power-word-kill', 'time-stop', 'true-resurrection', 'mass-heal', 'foresight', 'gate', 'shapechange',
];

const SKILL_PREFERENCE = [
  'perception', 'stealth', 'persuasion', 'athletics', 'insight', 'deception', 'investigation', 'acrobatics', 'sleight-of-hand', 'arcana',
  'intimidation', 'survival', 'medicine', 'performance', 'history', 'nature', 'religion', 'animal-handling',
];

const rankOf = (list: string[], item: string) => {
  const at = list.indexOf(item);
  return at < 0 ? list.length : at;
};

function increases(scores: Record<Ability, number>, order: Ability[]): Partial<Record<Ability, number>> | null {
  const room = (ability: Ability) => 20 - scores[ability];
  const [main] = order.filter(ability => room(ability) > 0);
  if (!main) return null;
  // An odd score gains its modifier from +1, so the other point goes where it also completes a modifier.
  if (scores[main] % 2 === 1 || room(main) === 1) {
    const others = order.filter(ability => ability !== main && room(ability) > 0);
    const second = others.find(ability => scores[ability] % 2 === 1) ?? others[0];
    if (second) return { [main]: 1, [second]: 1 };
    return room(main) >= 2 ? { [main]: 2 } : null;
  }
  return { [main]: 2 };
}

function suggestedAsi(plan: LevelUpPlan, context: LevelUpContext): LevelUpChoice['asi'] {
  const order = plan.classId ? CLASS_ABILITY_ORDER[plan.classId] : ABILITIES;
  const raise = increases(context.scores, order);
  if (raise) return { kind: 'asi', increases: raise };
  const feat = FEATS.find(entry => entry.id === 'tough' && !context.knownFeats?.includes(entry.id))
    ?? FEATS.find(entry => !FEAT_ABILITIES[entry.id] && !context.knownFeats?.includes(entry.id));
  return feat ? { kind: 'feat', id: feat.id, name: feat.nameRu } : null;
}

function bestSpells(count: number, good: (index: string) => boolean, context: LevelUpContext, taken: string[] = []): string[] {
  if (!count) return [];
  return context.spellBook
    .filter(spell => good(spell.index) && !taken.includes(spell.index))
    .sort((a, b) => Number(!FAVORITE_SPELLS.includes(a.index)) - Number(!FAVORITE_SPELLS.includes(b.index))
      || b.level - a.level || rankOf(FAVORITE_SPELLS, a.index) - rankOf(FAVORITE_SPELLS, b.index) || a.index.localeCompare(b.index))
    .slice(0, count)
    .map(spell => spell.index);
}

// «Подобрать за меня»: average hit points, the class's main ability, the SRD subclass and the spells most players take; the player can change any of it.
export function suggestLevelUp(plan: LevelUpPlan, context: LevelUpContext): LevelUpChoice {
  const book = new Map(context.spellBook.map(spell => [spell.index, spell]));
  const known = new Set(context.knownSpells);
  const inList = (index: string) => Boolean(plan.spellList && book.get(index)?.classes.includes(plan.spellList));
  const cantrip = (index: string) => book.get(index)?.level === 0 && !known.has(index) && inList(index);
  const spell = (index: string) => {
    const entry = book.get(index);
    return Boolean(entry && entry.level >= 1 && entry.level <= plan.maxSpellLevel && !known.has(index) && (plan.anyList || inList(index)));
  };

  const wanted = plan.multiclassGain?.skills ?? null;
  const skills = wanted
    ? [...(wanted.from === 'any' ? context.skillIndexes ?? SKILL_PREFERENCE : wanted.from)]
      .filter(skill => !context.proficientSkills.includes(skill))
      .sort((a, b) => rankOf(SKILL_PREFERENCE, a) - rankOf(SKILL_PREFERENCE, b))
      .slice(0, wanted.count)
    : [];
  const expertise = [...new Set([...context.proficientSkills, ...skills])]
    .filter(skill => !context.expertiseSkills.includes(skill))
    .sort((a, b) => rankOf(SKILL_PREFERENCE, a) - rankOf(SKILL_PREFERENCE, b))
    .slice(0, plan.expertise);

  const styles = plan.fightingStyles ?? [];
  const fightingStyle = !styles.length ? null
    : styles.includes('archery') && context.scores.dexterity > context.scores.strength ? 'archery'
      : styles.includes('defense') ? 'defense' : styles[0]!;

  const spells = bestSpells(plan.spells, spell, context);
  return usableLevelUpChoice(plan, {
    hp: 'average',
    asi: plan.asi ? suggestedAsi(plan, context) : null,
    subclass: plan.subclass?.current ?? null,
    cantrips: bestSpells(plan.cantrips, cantrip, context),
    spells,
    expertise,
    fightingStyle,
    skills,
  }, context);
}
