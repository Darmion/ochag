import {
  DAMAGE_TYPES, PURPOSES, SCALING_PER, SCALING_WHAT, actionParts, describeCasting, describeDuration, describeEnding, describeTargeting, optionLabel,
  type Action, type Scaling, type SpellTemplate,
} from '../../../../packages/domain/spells/spell-template.ts';
import { LETTER_SECTION } from './constants.ts';
import type { Block, Segment, SuggestionState } from './types.ts';

type Localize = (text: string) => string;
type Issues = { errors: ReadonlyArray<{ path: string }>; warnings: ReadonlyArray<{ path: string }> };

export function suggestedActions(entry: SuggestionState): Array<{ action: Action; depth: number }> {
  const out: Array<{ action: Action; depth: number }> = [];
  const walk = (action: Action, depth: number) => {
    out.push({ action, depth });
    for (const effects of Object.values(action.outcomes)) for (const effect of effects ?? []) for (const inner of effect.actions) walk(inner, depth + 1);
  };
  if (entry.value && typeof entry.value === 'object' && 'outcomes' in (entry.value as object)) walk(entry.value as Action, 0);
  return out;
}

export function highlightPhrases(text: string, suggestions: SuggestionState[]) {
  const phrases = suggestions.filter(entry => entry.status === 'suggested').flatMap(entry => entry.phrase.split(' … ')).map(entry => entry.trim()).filter(entry => entry.length > 3);
  if (!text || !phrases.length) return [{ text, mark: false }];
  const parts: Array<{ text: string; mark: boolean }> = [];
  let rest = text;
  while (rest) {
    let best: { index: number; phrase: string } | null = null;
    for (const phrase of phrases) {
      const index = rest.toLowerCase().indexOf(phrase.toLowerCase());
      if (index >= 0 && (!best || index < best.index)) best = { index, phrase };
    }
    if (!best) { parts.push({ text: rest, mark: false }); break; }
    if (best.index) parts.push({ text: rest.slice(0, best.index), mark: false });
    parts.push({ text: rest.slice(best.index, best.index + best.phrase.length), mark: true });
    rest = rest.slice(best.index + best.phrase.length);
  }
  return parts;
}

export function sectionOfIssue(path: string) {
  if (path.startsWith('При окончании')) return 'ending';
  if (path.startsWith('Режим')) return 'options';
  return LETTER_SECTION[path.charAt(0)] ?? 'actions';
}
export function countSectionBadges(issues: Issues, pending: SuggestionState[]) {
  const out: Record<string, { errors: number; warnings: number; pending: number }> = {};
  const of = (id: string) => (out[id] ??= { errors: 0, warnings: 0, pending: 0 });
  for (const issue of issues.errors) of(sectionOfIssue(issue.path)).errors += 1;
  for (const issue of issues.warnings) of(sectionOfIssue(issue.path)).warnings += 1;
  for (const entry of pending) of(entry.path.split(/[.[]/)[0]!).pending += 1;
  return out;
}

export function scalingSegments(rule: Scaling, level: number, localize: Localize): Segment[] {
  const amount = rule.per === 'steps' ? rule.steps.map(([slot, value]) => `${slot} → ${value}`).join(', ') : rule.amount;
  const per = optionLabel(SCALING_PER, rule.per).toLowerCase();
  return [
    { text: optionLabel(SCALING_WHAT, rule.what) },
    { text: localize(amount) },
    { text: per },
    ...(rule.per === 'slot' || rule.per === 'two-slots' ? [{ text: String(level) }] : []),
  ];
}

export function summarizeSections(t: SpellTemplate, levelText: string, schoolLabel: string, localize: Localize): Record<string, Segment[]> {
  return {
    passport: [{ text: levelText }, { text: schoolLabel }, ...(t.passport.element ? [{ text: optionLabel(DAMAGE_TYPES, t.passport.element) }] : [])],
    casting: [{ text: localize(describeCasting(t)) }],
    duration: [{ text: describeDuration(t) }],
    targeting: [{ text: describeTargeting(t) }],
    options: [
      ...(t.options.modes.length ? [{ text: `режимов: ${t.options.modes.length}` }] : []),
      ...(t.options.params.length ? [{ text: `параметров: ${t.options.params.length}` }] : []),
    ],
    actions: t.actions.map(action => ({ text: action.name, user: true })),
    commands: t.commands.map(command => ({ text: command.name, user: true })),
    scaling: t.scaling.flatMap(rule => scalingSegments(rule, t.passport.level, localize).slice(0, 2)),
    ending: [...describeEnding(t).map(text => ({ text })), ...(t.ending.onEnd.length ? [{ text: `при окончании: ${t.ending.onEnd.length}` }] : [])],
    hints: t.hints.purpose ? [{ text: optionLabel(PURPOSES, t.hints.purpose) }] : [],
  };
}

export function checkFacts(t: SpellTemplate, localize: Localize) {
  const list: Array<{ label: string; section: string; items: Segment[][] }> = [
    { label: 'Сотворение', section: 'casting', items: [[{ text: localize(describeCasting(t)) }]] },
    { label: 'Длительность', section: 'duration', items: [[{ text: describeDuration(t) }]] },
    { label: 'Цели', section: 'targeting', items: [[{ text: describeTargeting(t) }]] },
  ];
  if (t.options.params.length) list.push({ label: 'При сотворении выбирают', section: 'options', items: t.options.params.map(param => [{ text: param.label || param.key, user: true }]) });
  if (t.options.modes.length) list.push({ label: 'Режимы', section: 'options', items: t.options.modes.map(mode => [{ text: mode.name, user: true }]) });
  if (t.scaling.length) list.push({ label: 'Усиление на кругах', section: 'scaling', items: t.scaling.map(rule => scalingSegments(rule, t.passport.level, localize)) });
  if (t.commands.length) list.push({ label: 'Команды', section: 'commands', items: t.commands.map(command => [{ text: command.name, user: true }]) });
  const ends = describeEnding(t);
  if (ends.length) list.push({ label: 'Кончается досрочно', section: 'ending', items: ends.map(text => [{ text }]) });
  return list;
}

export function checkActionBlocks(t: SpellTemplate): Block[] {
  const out: Block[] = [];
  const walk = (actions: Action[], scope: string, scopeUser: boolean, section: string, depth: number) => {
    for (const action of actions) {
      out.push({ key: action.id, scope, scopeUser, section, depth, name: action.name, parts: actionParts(action) });
      for (const effects of Object.values(action.outcomes)) for (const effect of effects ?? []) if (effect.actions.length) walk(effect.actions, 'В зоне', false, section, depth + 1);
    }
  };
  walk(t.actions, '', false, 'actions', 0);
  for (const mode of t.options.modes) walk(mode.actions, mode.name, true, 'options', 0);
  walk(t.ending.onEnd, 'При окончании', false, 'ending', 0);
  return out;
}
