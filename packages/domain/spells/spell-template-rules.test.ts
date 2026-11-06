import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Effect } from './spell-template.ts';
import { SUGGEST_RULES } from './spell-template-rules.ts';
import { suggestTemplate } from './spell-template-suggest.ts';

function suggestedActions(suggestions: ReturnType<typeof suggestTemplate>): Action[] {
  const out: Action[] = [];
  const walk = (action: Action) => {
    out.push(action);
    for (const effects of Object.values(action.outcomes)) for (const effect of effects ?? []) effect.actions.forEach(walk);
  };
  for (const entry of suggestions) if (entry.path === 'actions[+]') walk(entry.value as Action);
  return out;
}

for (const group of SUGGEST_RULES) {
  for (const rule of group.rules) {
    test(`rules window, ${group.title}: ${rule.what}`, () => {
      const suggestions = suggestTemplate({ description: rule.example, higherLevel: rule.higher ?? '', level: 1 });
      const actions = suggestedActions(suggestions);
      const effects: Effect[] = actions.flatMap(action => Object.values(action.outcomes).flatMap(list => list ?? []));
      for (const token of rule.expect) {
        const [kind, value] = token.split(':') as [string, string | undefined];
        const shown = suggestions.map(entry => entry.path).join(', ') + ' | ' + effects.map(effect => effect.kind).join(', ');
        if (kind === 'path') assert.ok(suggestions.some(entry => entry.path === value), `${token}: ${shown}`);
        else if (kind === 'check') assert.ok(actions.some(action => action.check.kind === value), `${token}: ${shown}`);
        else if (kind === 'effect') assert.ok(effects.some(effect => effect.kind === value), `${token}: ${shown}`);
        else if (kind === 'scaling') assert.ok(suggestions.some(entry => entry.path === 'scaling[+]' && (entry.value as { what: string }).what === value), `${token}: ${shown}`);
        else if (kind === 'half') assert.ok(actions.some(action => action.successHalf), `${token}: ${shown}`);
        else assert.fail(`unknown expectation ${token}`);
      }
    });
  }
}
