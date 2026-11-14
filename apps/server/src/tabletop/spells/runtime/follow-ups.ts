import type { Queryable } from '../../../db.ts';
import { durationRoundsOf } from '../../../../../../packages/domain/spells/spell-template-engine.ts';
import type { Action, Effect, Outcome } from '../../../../../../packages/domain/spells/spell-template.ts';
import type { TableContext } from '../../context.ts';
import type { CastSpellParams } from '../../shared.ts';
import type { CastBody } from '../cast.ts';
import type { CastDice } from '../cast-dice.ts';
import type { CastSetup } from '../prepare.ts';
import { applyEffects, emptyReport, runAction, type RunReport, type RunTarget, type SpellRun } from './run.ts';
import { storeTimed } from './timed.ts';

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
const modifier = (score: unknown) => Math.floor((Number(score ?? 10) - 10) / 2);

export function spellRunOf(userId: string, params: CastSpellParams, body: CastBody, setup: CastSetup, dice: CastDice, dc: number, attackBonus: number): SpellRun {
  const { character, spellName, level, effectiveLevel, concentration, spellTemplate, lasting } = setup;
  const rounds = spellTemplate ? durationRoundsOf(spellTemplate) : null;
  return {
    campaignId: params.campaignId, userId, sceneId: body.sceneId ?? null,
    casterId: params.characterId, casterName: String(character.name),
    spellName, spellLevel: level, slotLevel: effectiveLevel, characterLevel: Math.max(1, Number(character.level ?? 1)),
    dc, attackBonus, castingModifier: dice.castingModifier, proficiency: dice.proficiencyBonus ?? 2,
    abilities: Object.fromEntries(ABILITIES.map(ability => [ability, modifier(character[ability])])),
    concentration, durationRounds: rounds ? lasting(rounds) : null, param: body.element ?? null, hidden: body.hidden ?? false,
    scaling: spellTemplate?.scaling ?? [],
  };
}

function outcomeOf(entry: Record<string, any> | undefined): Outcome {
  if (entry?.attack) return entry.attack.critical ? 'crit' : entry.attack.hit ? 'hit' : 'miss';
  if (entry?.save) return entry.save.success ? 'success' : 'fail';
  return 'always';
}

function whoFor(action: Action, run: SpellRun, targets: RunTarget[]): RunTarget[] {
  if (action.who === 'caster') return [{ id: run.casterId, name: run.casterName }];
  return targets.length ? targets : [{ id: run.casterId, name: run.casterName }];
}

export async function castFollowUps(
  ctx: TableContext, q: Queryable, run: SpellRun, setup: CastSetup, targets: RunTarget[], results: Array<Record<string, unknown>>,
): Promise<RunReport | null> {
  const plan = setup.castPlan;
  if (!plan || !setup.spellTemplate) return null;
  const { outcomes, actions, timed, mainId } = plan.followUps;
  const main = mainId ? [...setup.spellTemplate.actions, ...setup.spellTemplate.options.modes.flatMap(mode => mode.actions)].find(action => action.id === mainId) ?? null : null;
  const report = emptyReport();
  const touched = Object.values(outcomes).some(list => list?.length);
  if (touched) {
    const people = targets.length ? targets : [{ id: run.casterId, name: run.casterName }];
    for (const target of people) {
      const entry = results.find(item => item.characterId === target.id) as Record<string, any> | undefined;
      const outcome = outcomeOf(entry);
      const effects: Effect[] = outcomes[outcome] ?? (outcome === 'crit' ? outcomes.hit ?? [] : outcome === 'always' ? Object.values(outcomes)[0] ?? [] : []);
      if (effects.length) await applyEffects(ctx, q, run, main, target, effects, { critical: outcome === 'crit' }, report);
    }
  }
  for (const action of actions) await runAction(ctx, q, run, action, whoFor(action, run, targets), report);
  if (timed.length) await storeTimed(q, run, timed, (targets.length ? targets : [{ id: run.casterId, name: run.casterName }]).map(target => target.id));
  for (const line of report.lines) {
    const entry = results.find(item => item.characterId === line.characterId) as Record<string, any> | undefined;
    if (entry) entry.notes = [...((entry.notes as string[] | undefined) ?? []), line.text];
    else results.push({ characterId: line.characterId, name: line.name, notes: [line.text] });
  }
  return report;
}
