import { type Option, OUTCOME_LABELS, SCALING_WHAT } from './options.ts';
import { EFFECT_CATALOG, type FieldSpec } from './effect-catalog.ts';
import type { Outcome, SpellTemplate } from './types.ts';
import { parseTemplateFormula } from './formulas.ts';
import { allActions, allEffects, outcomesFor } from './traversal.ts';
import { templateStrength } from './strength.ts';

export type TemplateIssue = { path: string; message: string };

export function validateTemplate(t: SpellTemplate): { errors: TemplateIssue[]; warnings: TemplateIssue[] } {
  const errors: TemplateIssue[] = [];
  const warnings: TemplateIssue[] = [];
  const error = (path: string, message: string) => errors.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });

  if (!t.passport.name) error('А1', 'Нет названия.');
  if (t.casting.time === 'reaction' && t.casting.trigger === 'custom' && !t.casting.triggerText.trim()) error('Б2', 'Реакция: опишите, на что она.');
  if (t.casting.time === 'reaction' && t.casting.ritual) warn('Б3', 'Ритуалом реакцию не сотворить.');
  if (t.casting.material && !t.casting.materialText.trim()) warn('Б5', 'Компонент М отмечен, а материал не описан.');
  if (t.duration.concentration && t.duration.kind === 'instant') error('В2', 'Концентрация у мгновенного заклинания.');
  if (t.passport.level === 0 && t.casting.ritual) warn('Б3', 'Заговор ритуалом не творят.');

  const params = new Set(t.options.params.map(param => param.key));
  const actions = allActions(t);
  if (!actions.length) warn('Е', 'Нет ни одного действия — заклинание ничего не сделает в игре.');
  const ids = new Set(actions.map(({ action }) => action.id));
  const usesTargets = actions.some(({ action }) => action.who === 'targets');
  if (usesTargets && (t.targeting.kind === 'none')) error('Г1', 'Действие касается целей, а целей у заклинания нет.');
  if (actions.some(({ action }) => action.who === 'area') && t.targeting.kind !== 'area' && !allEffects(t).some(({ effect }) => effect.kind === 'zone')) {
    error('Г1', 'Действие касается «всех в области», а области нет.');
  }
  for (const { action, scope } of actions) {
    const where = `${scope}: «${action.name}»`;
    const possible = new Set(outcomesFor(action.check.kind));
    const used = Object.entries(action.outcomes).filter(([, effects]) => effects?.length);
    if (!used.length && !action.successHalf) warn(where, 'Нет ни одного последствия.');
    for (const [outcome] of used) if (!possible.has(outcome as Outcome)) error(where, `Исход «${OUTCOME_LABELS[outcome]}» не бывает у этой проверки.`);
    if (action.check.kind === 'hp-threshold' && !parseTemplateFormula(action.check.hpFormula)) error(where, 'Порог хитов: формула не разбирается.');
    if (action.successHalf && action.check.kind !== 'save' && action.check.kind !== 'ability') error(where, '«Половина при успехе» — только у спасброска или проверки.');
    if (action.successHalf && !(action.outcomes.fail ?? []).some(effect => effect.kind === 'damage')) warn(where, '«Половина при успехе», а урона при провале нет.');
    if (action.when.startsWith('zone-') && !scope.includes('Зона')) warn(where, '«Когда» про зону, а действие не внутри последствия «Зона на карте».');
    if (action.when === 'command' && !t.commands.some(command => command.actionId === action.id)) warn(where, '«Командой», но ни одна команда (раздел Ж) его не выполняет.');
  }
  for (const { effect, action } of allEffects(t)) {
    const where = `«${action.name}» → ${EFFECT_CATALOG[effect.kind].label}`;
    for (const field of EFFECT_CATALOG[effect.kind].fields) {
      if (!shown(field, effect.values)) continue;
      const value = effect.values[field.key];
      if (field.type === 'formula' && String(value ?? '').trim() && !parseTemplateFormula(String(value))) error(where, `${field.label}: формула не разбирается («${String(value)}»).`);
      if (field.type === 'formula' && !String(value ?? '').trim() && (effect.kind === 'damage' || effect.kind === 'heal' || effect.kind === 'temp-hp')) error(where, `${field.label}: пусто.`);
      if (field.type === 'multi' && Array.isArray(value) && !value.length) warn(where, `${field.label}: ничего не выбрано.`);
    }
    if ((effect.values.damageType === 'param' || (Array.isArray(effect.values.types) && effect.values.types.includes('param'))) && !params.has(String(effect.values.param ?? ''))) {
      if (!t.options.params.some(param => param.kind === 'damage-type')) error(where, 'Вид урона «из параметра», а параметра вида урона в разделе Д нет.');
    }
    if (effect.kind === 'condition' && effect.values.duration === 'until-save' && effect.values.repeatSave === 'none') warn(where, '«Пока не спасётся», но повторного спасброска нет.');
    if (effect.kind === 'condition' && effect.values.duration === 'spell' && t.duration.kind === 'instant') warn(where, 'Срок «как у заклинания», а заклинание мгновенное — состояние сразу кончится.');
    if (effect.kind === 'zone' && effect.values.shapeFrom === 'targeting' && t.targeting.kind !== 'area') error(where, 'Форма зоны «как в разделе Г», а в Г — не область.');
    if (effect.kind === 'special' && !String(effect.values.text ?? '').trim()) error(where, '«Особое» без текста.');
    if (effect.kind === 'message' && !String(effect.values.text ?? '').trim()) error(where, 'Сообщение без текста.');
  }
  for (const command of t.commands) {
    if (command.does === 'run-action' && !ids.has(command.actionId)) error(`Ж: «${command.name}»`, 'Команда выполняет действие, которого нет.');
    if (command.does === 'move-zone' && !allEffects(t).some(({ effect }) => effect.kind === 'zone')) error(`Ж: «${command.name}»`, 'Сдвинуть зону — а зоны нет.');
    if (command.does === 'switch-mode' && !t.options.modes.length) error(`Ж: «${command.name}»`, 'Сменить режим — а режимов нет.');
  }
  if (t.commands.length && t.duration.kind === 'instant') warn('Ж', 'Команды у мгновенного заклинания не успеют пригодиться.');
  for (const mode of t.options.modes) if (!mode.actions.length) warn(`Д1: «${mode.name}»`, 'У режима нет действий.');
  for (const rule of t.scaling) {
    if (rule.per === 'steps' ? !rule.steps.length : !rule.amount.trim()) error(`З: ${optionLabel(SCALING_WHAT, rule.what)}`, 'Не задано, на сколько растёт.');
    if ((rule.what === 'damage' || rule.what === 'healing' || rule.what === 'temp-hp') && rule.per !== 'steps' && rule.amount.trim() && !parseTemplateFormula(rule.amount)) {
      error(`З: ${optionLabel(SCALING_WHAT, rule.what)}`, `Формула не разбирается («${rule.amount}»).`);
    }
    if (rule.per === 'cantrip' && t.passport.level !== 0) warn(`З: ${optionLabel(SCALING_WHAT, rule.what)}`, 'Рост по уровню персонажа бывает у заговоров.');
    if (rule.ref && !ids.has(rule.ref) && !allEffects(t).some(({ effect }) => effect.id === rule.ref)) error(`З: ${optionLabel(SCALING_WHAT, rule.what)}`, 'Ссылается на действие, которого нет.');
  }
  const strength = templateStrength(t);
  if (strength.band === 'very-strong') warn('Сила', `Урон намного выше обычного для ${t.passport.level ? `${t.passport.level} круга` : 'заговора'}: ~${strength.damage} против ~${strength.expected}.`);
  return { errors, warnings };
}

export function shown(field: FieldSpec, values: Record<string, unknown>): boolean {
  return !field.showIf || field.showIf.in.includes(values[field.showIf.key]);
}

export function optionLabel(list: readonly Option[], value: string): string {
  return list.find(([key]) => key === value)?.[1] ?? value;
}
