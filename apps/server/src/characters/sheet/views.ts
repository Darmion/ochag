import { hitDicePools } from '../../../../../packages/domain/character/rest.ts';
import { CLASS_LABELS, attacksForClasses, characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { multiclassSpellSlots } from '../../../../../packages/domain/spells/spell-slots.ts';
import { experienceFor, nextLevelExperience, XP_THRESHOLDS } from '../../../../../packages/domain/character/experience.ts';

export function classView(character: any) {
  const parsed = characterClassLevels(character);
  const slots = parsed.multiclass ? multiclassSpellSlots(parsed.classes) : null;
  return {
    classId: parsed.classes[0]?.id ?? null,
    attacksPerAction: character.attacks_per_action ?? attacksForClasses(parsed.classes),
    classes: parsed.classes.map(entry => ({ ...entry, label: CLASS_LABELS[entry.id] })),
    multiclass: parsed.multiclass,
    problem: parsed.problem,
    multiclassSlots: slots ? { slots: slots.slots, pact: slots.pact } : null,
  };
}

export function experienceView(character: any) {
  const level = Math.max(1, Math.min(20, character.level ?? 1));
  return {
    floor: XP_THRESHOLDS[level - 1],
    next: nextLevelExperience(level),
    reward: character.kind === 'npc' ? experienceFor(character) : null,
  };
}

export function hitDiceView(character: any) {
  const pools = hitDicePools(
    characterClassLevels(character).classes, character.hit_die, character.level, character.hit_dice_spent ?? 0, character.hit_dice_spent_by_die,
  );
  return {
    die: pools[0]!.die,
    total: pools.reduce((sum, pool) => sum + pool.total, 0),
    left: pools.reduce((sum, pool) => sum + pool.total - pool.spent, 0),
    pools: pools.map(pool => ({ die: pool.die, total: pool.total, left: pool.total - pool.spent })),
  };
}
