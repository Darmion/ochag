import { DAMAGE_TYPE_CHOICES, MOD_MODES } from './internal.ts';
import { AREA_AFFECTS, AREA_ORIGINS, AREA_SHAPES, CASTING_TIMES, COMMAND_COSTS, COMMAND_DOES, COMMAND_WHEN, CONDITIONS, CREATURE_TYPES, DURATION_KINDS, OBJECT_FILTERS, OBJECT_KINDS, type Option, OUTCOME_LABELS, RANGE_KINDS, REACTION_TRIGGERS, SCALING_PER, SCALING_WHAT, SCHOOLS, SIDES, SKILLS, TIMES, WHEN, WHO } from './options.ts';
import { EFFECT_CATALOG, PRESETS } from './effect-catalog.ts';
import type { Action, Effect, Outcome, SpellTemplate } from './types.ts';
import { allEffects } from './traversal.ts';
import { optionLabel } from './validate.ts';

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const ABILITY_GENITIVE: Readonly<Record<string, string>> = {
  strength: 'Силы', dexterity: 'Ловкости', constitution: 'Телосложения', intelligence: 'Интеллекта', wisdom: 'Мудрости', charisma: 'Харизмы',
};
const DAMAGE_INSTRUMENTAL: Readonly<Record<string, string>> = {
  acid: 'кислотой', bludgeoning: 'дробящим', cold: 'холодом', fire: 'огнём', force: 'силовым полем', lightning: 'электричеством',
  necrotic: 'некротической энергией', piercing: 'колющим', poison: 'ядом', psychic: 'психической энергией', radiant: 'излучением',
  slashing: 'рубящим', thunder: 'звуком',
};
const damageWith = (type: string) => DAMAGE_INSTRUMENTAL[type] ?? type;

function feetText(value: number) {
  return `${value} фт.`;
}

export function describeCasting(t: SpellTemplate): string {
  const c = t.casting;
  const time = c.time === 'custom' ? `${c.minutes} мин` : optionLabel(CASTING_TIMES, c.time);
  const trigger = c.time === 'reaction' ? ` (${c.trigger === 'custom' ? c.triggerText || 'своё' : optionLabel(REACTION_TRIGGERS, c.trigger)})` : '';
  const parts = [c.verbal ? 'В' : '', c.somatic ? 'С' : '', c.material ? `М${c.materialText ? ` (${c.materialText}${c.materialCost ? `, ${c.materialCost} зм` : ''}${c.materialConsumed ? ', расходуется' : ''})` : ''}` : ''].filter(Boolean);
  const range = c.range === 'feet' ? feetText(c.rangeValue) : c.range === 'miles' ? `${c.rangeValue} миль` : c.range === 'special' ? c.rangeText || 'особая' : optionLabel(RANGE_KINDS, c.range);
  return `${time}${trigger}${c.ritual ? ', или ритуалом' : ''} · ${parts.join(' ') || 'без компонентов'} · ${range}`;
}

export function describeDuration(t: SpellTemplate): string {
  const d = t.duration;
  const span = d.kind === 'rounds' ? `${d.value} раунд.` : d.kind === 'minutes' ? `${d.value} мин` : d.kind === 'hours' ? `${d.value} ч` : d.kind === 'days' ? `${d.value} дн.` : d.kind === 'special' ? d.text || 'особая' : optionLabel(DURATION_KINDS, d.kind);
  return d.concentration ? `концентрация, до ${span}` : span;
}

export function describeTargeting(t: SpellTemplate): string {
  const g = t.targeting;
  if (g.kind === 'self') return 'на себя';
  if (g.kind === 'none') return 'без цели';
  if (g.kind === 'creatures' || g.kind === 'chain') {
    const who = optionLabel(SIDES, g.side);
    const count = `${g.countMode === 'up-to' ? 'до ' : ''}${g.count} ${g.count === 1 ? 'существо' : g.count < 5 ? 'существа' : 'существ'}`;
    const types = g.typeMode !== 'any' && g.types.length ? `, ${g.typeMode === 'only' ? 'только' : 'кроме'}: ${g.types.map(type => optionLabel(CREATURE_TYPES, type)).join(', ')}` : '';
    const apart = g.maxApartFeet ? `, не дальше ${feetText(g.maxApartFeet)} друг от друга` : '';
    const self = g.includeSelf ? ', можно себя' : '';
    const base = `${count} (${who})${types}${apart}${self}`;
    return g.kind === 'chain' ? `цепочка: ${base}, затем ${g.hops} перескок. до ${feetText(g.hopFeet)}${g.repeats ? '' : ', без повторов'}` : base;
  }
  if (g.kind === 'area') {
    const size = g.shape === 'line' ? `${feetText(g.sizeFeet)} × ${feetText(g.widthFeet)}` : g.shape === 'cylinder' ? `радиус ${feetText(g.sizeFeet)}, высота ${feetText(g.heightFeet)}` : feetText(g.sizeFeet);
    return `${optionLabel(AREA_SHAPES, g.shape)} ${size}, ${lower(optionLabel(AREA_ORIGINS, g.origin))}; задевает ${optionLabel(AREA_AFFECTS, g.affects)}`;
  }
  if (g.kind === 'object') return `${optionLabel(OBJECT_KINDS, g.objectKind)} (${g.objectOwner === 'self' ? 'своё' : 'цели'}, ${optionLabel(OBJECT_FILTERS, g.objectFilter)})`;
  if (g.kind === 'place') return 'свободное место в дальности';
  return `стена: ${g.segments} отрезк. по ${feetText(g.segmentFeet)}, высота ${feetText(g.wallHeight)}`;
}

export function describeEffect(effect: Effect): string {
  const v = effect.values;
  const s = (key: string) => String(v[key] ?? '');
  const n = (key: string) => Number(v[key] ?? 0);
  const list = (key: string, options: readonly Option[]) => (Array.isArray(v[key]) ? (v[key] as string[]).map(item => optionLabel(options, item)).join(', ') : '');
  const field = (key: string) => EFFECT_CATALOG[effect.kind].fields.find(entry => entry.key === key)!;
  switch (effect.kind) {
    case 'damage': {
      const type = s('damageType') === 'param' ? `{${s('param')}}` : s('damageType') === 'weapon' ? 'как у оружия' : damageWith(s('damageType'));
      const head = `урон ${s('formula')} ${type}`;
      return s('split') === 'split' ? `${head}, поровну между целями` : head;
    }
    case 'heal': return `лечение ${s('formula')}`;
    case 'temp-hp': return `временные хиты ${s('formula')}${v.eachTurn ? ' каждый ход' : ''}`;
    case 'max-hp': return `максимум хитов +${s('formula')}`;
    case 'condition': {
      const code = s('code') === 'exhaustion' ? `истощение ${n('levels')}` : optionLabel(CONDITIONS, s('code'));
      const term = s('duration') === 'rounds' ? `${n('rounds')} раунд.` : lower(optionLabel(field('duration').options!, s('duration')));
      const repeat = s('repeatSave') !== 'none' ? `; повторный спасбросок ${lower(optionLabel(field('repeatSave').options!, s('repeatSave')))}` : '';
      return `«${code}» (${term}${repeat}${v.endsOnDamage ? '; урон снимает' : ''})`;
    }
    case 'ac': return s('mode') === 'floor' ? `КД не ниже ${n('value')}` : s('mode') === 'base' ? `КД = ${n('value')} + ЛОВ` : `КД +${n('value')}`;
    case 'speed': return s('mode') === 'plus' ? `скорость +${n('feet')} фт.` : s('mode') === 'minus' ? `скорость −${n('feet')} фт.` : ['fly', 'climb', 'swim'].includes(s('mode')) ? `${optionLabel(field('mode').options!, s('mode'))} ${n('feet')} фт.` : `скорость ${optionLabel(field('mode').options!, s('mode'))}`;
    case 'attack-rolls':
    case 'checks': {
      const how = s('mode') === 'die' ? `+к${s('die')}` : s('mode') === 'minus-die' ? `−к${s('die')}` : s('mode') === 'plus' ? `+${n('value')}` : s('mode') === 'minus' ? `−${n('value')}` : optionLabel(MOD_MODES, s('mode'));
      const what = effect.kind === 'attack-rolls'
        ? (s('whose') === 'own' ? 'к своим атакам' : 'к атакам по цели')
        : `к ${lower(optionLabel(field('roll').options!, s('roll')))}${s('ability') !== 'all' ? ` ${ABILITY_GENITIVE[s('ability')] ?? s('ability')}` : ''}`;
      return `${how} ${what}${v.once ? ' (один раз)' : ''}`;
    }
    case 'extra-damage': return `+${s('formula')} ${s('damageType') === 'param' || s('damageType') === 'weapon' ? optionLabel(DAMAGE_TYPE_CHOICES, s('damageType')) : damageWith(s('damageType'))} при попадании ${lower(optionLabel(field('on').options!, s('on')))}${v.oncePerTurn ? ', раз за ход' : ''}`;
    case 'defense': return s('mode') === 'condition-immunity' ? `иммунитет к состояниям: ${list('conditions', CONDITIONS)}` : `${optionLabel(field('mode').options!, s('mode'))}: ${list('types', field('types').options!)}`;
    case 'senses': return s('sense') === 'light' ? `светится: яркий ${n('feet')} фт., тусклый ещё ${n('dimFeet')}` : s('sense') === 'see-invisible' ? 'видит невидимое' : `${optionLabel(field('sense').options!, s('sense'))} ${n('feet')} фт.`;
    case 'invisible': return `невидим${s('breaks') === 'never' ? '' : ' (атака или заклинание снимают)'}`;
    case 'restrict': return `нельзя: ${list('what', field('what').options!)}`;
    case 'extra-action': return `ещё одно действие: ${list('allowed', field('allowed').options!)}`;
    case 'move': return s('mode') === 'swap' ? 'поменяться местами' : `${optionLabel(field('mode').options!, s('mode'))} на ${n('feet')} фт.`;
    case 'summon': return `призыв: ${s('creatures') || `${optionLabel(field('creatureType').options!, s('creatureType'))} ПО ≤ ${n('maxCr')}`} ×${n('count')}`;
    case 'shape': return `превращение (${s('limit') === 'fixed' ? `ПО ≤ ${n('maxCr')}` : 'ПО ≤ уровня цели'})`;
    case 'zone': {
      const traits = [v.difficult ? 'труднопроходимо' : '', s('obscured') !== 'none' ? `заслонено ${lower(optionLabel(field('obscured').options!, s('obscured')))}` : '', v.darkness ? 'магическая тьма' : '', v.silence ? 'тишина' : '', n('lightFeet') ? `свет ${n('lightFeet')} фт.` : ''].filter(Boolean);
      return `зона на карте${traits.length ? ` (${traits.join(', ')})` : ''}`;
    }
    case 'wall': return `стена: преграждает ${list('blocks', field('blocks').options!)}${s('damageFormula') ? `, урон ${s('damageFormula')} ${damageWith(s('damageType'))} при проходе` : ''}`;
    case 'remove': return `снять: ${s('what') === 'conditions' || s('what') === 'one-condition' ? list('conditions', CONDITIONS) : lower(optionLabel(field('what').options!, s('what')))}${s('what') === 'spells' ? ` до ${n('upTo')} круга` : ''}`;
    case 'weapon': return `оружие: +${n('bonus')}${s('die') !== 'none' ? `, кость к${s('die')}` : ''}${v.castingAbility ? ', атака заклинательной характеристикой' : ''}${s('extraFormula') ? `, +${s('extraFormula')} ${damageWith(s('extraType'))}` : ''}`;
    case 'pool': return `${lower(optionLabel(field('mode').options!, s('mode')))}: ${s('formula')}`;
    case 'preset': return optionLabel(PRESETS, s('preset'));
    case 'message': return `сообщение (${lower(optionLabel(field('audience').options!, s('audience')))}): «${s('text')}»`;
    case 'special': return `особое — мастеру: «${s('text')}»`;
  }
}

export function primaryOutcome(action: Action): Outcome {
  return action.check.kind === 'attack' ? 'hit' : action.check.kind === 'save' || action.check.kind === 'ability' || action.check.kind === 'contest' ? 'fail'
    : action.check.kind === 'caster-d20' || action.check.kind === 'hp-threshold' ? 'met' : 'always';
}

export function describeCheck(action: Action): string {
  const check = action.check;
  const ability = ABILITY_GENITIVE[check.ability] ?? check.ability;
  return check.kind === 'attack' ? `${check.attackRange === 'melee' ? 'рукопашная' : 'дальнобойная'} атака заклинанием${check.attackCount > 1 ? ` ×${check.attackCount}` : ''}`
    : check.kind === 'save' ? `спасбросок ${ability} против ${check.dc === 'spell' ? 'СЛ заклинаний' : `СЛ ${check.dcValue}`}`
    : check.kind === 'ability' ? `проверка ${check.skill !== 'none' ? optionLabel(SKILLS, check.skill) : ability} (${check.roller === 'caster' ? 'заклинатель' : 'цель'})`
    : check.kind === 'contest' ? `состязание: ${optionLabel(SKILLS, check.contestMine)} против ${optionLabel(SKILLS, check.contestTheirs)}`
    : check.kind === 'caster-d20' ? `к20 заклинателя не меньше ${check.threshold}`
    : check.kind === 'hp-threshold' ? `хиты цели не больше ${check.hpFormula}`
    : check.attackCount > 1 ? `снарядов: ${check.attackCount}, каждый попадает сам` : '';
}

export function actionParts(action: Action): {
  when: string; times: string; who: string; check: string;
  outcomes: Array<{ outcome: Outcome; label: string; effects: string[] }>; half: boolean;
} {
  return {
    when: lower(optionLabel(WHEN, action.when)),
    times: action.times === 'each' ? '' : action.times === 'count' ? `${action.timesCount} раз` : lower(optionLabel(TIMES, action.times)),
    who: lower(optionLabel(WHO, action.who)),
    check: describeCheck(action),
    outcomes: (Object.entries(action.outcomes) as Array<[Outcome, Effect[] | undefined]>)
      .filter(([, effects]) => effects?.length)
      .map(([outcome, effects]) => ({ outcome, label: outcome === 'always' ? '' : OUTCOME_LABELS[outcome], effects: effects!.map(describeEffect) })),
    half: action.successHalf,
  };
}

export function describeAction(action: Action): string {
  const parts = actionParts(action);
  const times = parts.times ? `, ${parts.times}` : '';
  const head = `«${action.name}» (${parts.when}${times}; ${parts.who})`;
  const outcomes = parts.outcomes.map(({ label, effects }) => `${label ? `${label}: ` : ''}${effects.join(', ')}`);
  if (parts.half) outcomes.push('успех: половина урона');
  const sentence = (text: string) => (text.endsWith('.') ? text : `${text}.`);
  return `${head}: ${parts.check ? `${parts.check}. ` : ''}${outcomes.length ? outcomes.map(sentence).join(' ') : 'ничего.'}`;
}

export function describeEnding(t: SpellTemplate): string[] {
  return [
    t.ending.concentration && t.duration.concentration ? 'концентрация прервалась' : '',
    t.ending.casterDown ? 'хиты заклинателя упали до 0' : '',
    t.ending.distanceFeet ? `цель дальше ${t.ending.distanceFeet} фт.` : '',
    t.ending.targetActs ? 'цель атаковала или колдовала' : '',
    t.ending.targetDamaged ? 'цель получила урон' : '',
    t.ending.targetSaves ? 'цель спаслась' : '',
    t.ending.recast ? 'сотворено ещё раз' : '',
    t.ending.afterUses ? `сработало ${t.ending.afterUses} раз` : '',
  ].filter(Boolean);
}

export function describeTemplate(t: SpellTemplate): string[] {
  const lines: string[] = [];
  const level = t.passport.level ? `${t.passport.level} круг` : 'заговор';
  lines.push(`${t.passport.name || 'Без названия'} — ${level}, ${optionLabel(SCHOOLS, t.passport.school)}.`);
  const sentence = (text: string) => (text.endsWith('.') ? text : `${text}.`);
  lines.push(`Сотворение: ${sentence(describeCasting(t))} Длительность: ${sentence(describeDuration(t))}`);
  lines.push(`Цели: ${describeTargeting(t)}.`);
  if (t.options.params.length) lines.push(`При сотворении выбирают: ${t.options.params.map(param => `${param.label || param.key} {${param.key}}`).join(', ')}.`);
  const walk = (actions: Action[], indent: string) => {
    for (const action of actions) {
      lines.push(`${indent}${describeAction(action)}`);
      for (const effects of Object.values(action.outcomes)) for (const effect of effects ?? []) if (effect.actions.length) walk(effect.actions, `${indent}  └ `);
    }
  };
  walk(t.actions, '');
  for (const mode of t.options.modes) {
    lines.push(`Режим «${mode.name}»:`);
    walk(mode.actions, '  ');
  }
  for (const command of t.commands) {
    const does = command.does === 'run-action' ? 'выполнить действие' : lower(optionLabel(COMMAND_DOES, command.does));
    lines.push(`Команда «${command.name}» — ${optionLabel(COMMAND_COSTS, command.cost)}, ${lower(optionLabel(COMMAND_WHEN, command.when))}: ${does}${command.feet && command.does.startsWith('move') ? ` на ${command.feet} фт.` : ''}.`);
  }
  for (const rule of t.scaling) {
    const amount = rule.per === 'steps' ? rule.steps.map(([slot, value]) => `${slot} → ${value}`).join(', ') : rule.amount;
    const per = `${lower(optionLabel(SCALING_PER, rule.per))}${rule.per === 'slot' || rule.per === 'two-slots' ? ` ${t.passport.level}` : ''}`;
    lines.push(`Усиление: ${optionLabel(SCALING_WHAT, rule.what)} ${amount} ${per}.`);
  }
  const ends = describeEnding(t);
  if (ends.length) lines.push(`Кончается досрочно: ${ends.join('; ')}.`);
  if (t.ending.onEnd.length) {
    lines.push('При окончании:');
    walk(t.ending.onEnd, '  ');
  }
  return lines;
}

export function manualParts(t: SpellTemplate): string[] {
  return allEffects(t)
    .filter(({ effect }) => EFFECT_CATALOG[effect.kind].support === 'no')
    .map(({ effect, action }) => `«${action.name}»: ${describeEffect(effect)}`);
}
