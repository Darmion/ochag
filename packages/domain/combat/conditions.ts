import { linkedCodes, ruleClauses, ruleOf, type Clause, type ConditionRule, type RuleSet } from './condition-rules.ts';

export const CONDITION_CODES = [
  'blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible',
  'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
] as const;

export const CONDITION_LABELS: Record<string, string> = {
  blinded: 'ослеплён',
  charmed: 'очарован',
  deafened: 'оглох',
  frightened: 'испуган',
  grappled: 'схвачен',
  incapacitated: 'недееспособен',
  invisible: 'невидим',
  paralyzed: 'парализован',
  petrified: 'окаменел',
  poisoned: 'отравлен',
  prone: 'лежит ничком',
  restrained: 'опутан',
  stunned: 'ошеломлён',
  unconscious: 'без сознания',
  concentration: 'концентрация',
  dead: 'мёртв',
  stable: 'стабилен',
  dodging: 'уклоняется',
  hidden: 'спрятался',
  raging: 'в ярости',
  bardic_inspiration: 'кость вдохновения',
  turned: 'изгнан',
  sacred_weapon: 'священное оружие',
  slowed: 'замедлен',
  no_reactions: 'без реакций',
  no_healing: 'не лечится',
  guided: 'подсвечен',
  helped: 'помощь',
  camouflaged: 'замаскирован',
  mocked: 'осмеян',
  blessed: 'благословлён',
  baned: 'под «Порчей»',
  marked: 'метка охотника',
  outlined: 'очерчен светом',
  heroism: 'героизм',
  ac_bonus: '«Щит веры»',
  sanctuary: 'под «Убежищем»',
  wild_shape: 'в зверином облике',
  summoned: 'призван',
  guidance: 'под «Указанием»',
  resistance_die: 'под «Сопротивлением»',
  true_strike: '«Меткий удар»',
  barkskin: '«Дубовая кора»',
  longstrider: '«Скороход»',
  expeditious: '«Поспешное отступление»',
  blurred: '«Размытый образ»',
  energy_ward: '«Защита от энергии»',
  stoneskin: '«Каменная кожа»',
  death_ward: '«Защита от смерти»',
  hasted: 'ускорен',
  slow_spell: 'замедлен заклинанием',
  stupor: 'в оцепенении',
  lethargic: 'вял после «Ускорения»',
  mirror_images: 'зеркальные отражения',
  shillelagh: '«Дубинка»',
  magic_weapon: '«Магическое оружие»',
  warding_bond: '«Охраняющая связь»',
  beacon_of_hope: '«Маяк надежды»',
  darkvision_spell: '«Тёмное зрение»',
  aid: '«Помощь»',
  mage_armor: '«Доспехи мага»',
  reckless: 'безрассуден',
  overchannel: 'сверхзаряд (до долгого отдыха)',
  multiattack_defense: 'защита от мультиатаки',
  spell_light: 'светится',
  spell_darkness: 'окутан тьмой',
  spell_action: 'действие заклинания',
  climbing: 'на стене',
  spider_climb: '«Паук»',
};

export type Ability = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
export type Advantage = 'none' | 'adv' | 'disadv';
export type D20Kind = 'attack' | 'save' | 'ability' | 'skill';

export type ConditionState = {
  codes: Set<string>;
  exhaustion: number;
  // The campaign's own condition rules (missing — the SRD) and who put each condition on the creature.
  rules?: RuleSet;
  sources?: ReadonlyMap<string, ReadonlySet<string>>;
  // Conditions whose source the creature cannot see right now: their «while the source is in sight» clauses rest.
  outOfSight?: ReadonlySet<string>;
  // The stage of each staged condition (a disease that worsens); missing — the first one.
  stages?: ReadonlyMap<string, number>;
  // Conditions held only because another one brings them along («вместе с состоянием»), with the code that brought them.
  linked?: ReadonlyMap<string, string>;
};

export function conditionState(
  effectCodes: Iterable<string>, rules?: RuleSet, sources?: ReadonlyMap<string, ReadonlySet<string>>, stages?: ReadonlyMap<string, number>,
): ConditionState {
  const codes = new Set<string>();
  let exhaustion = 0;
  for (const code of effectCodes) {
    const level = /^exhaustion_([1-6])$/.exec(code);
    if (level) exhaustion = Math.max(exhaustion, Number(level[1]));
    else codes.add(code);
  }
  const linked = new Map<string, string>();
  let allSources = sources;
  const queue = [...codes];
  while (queue.length) {
    const code = queue.shift()!;
    for (const other of linkedCodes(ruleOf(rules, code), stages?.get(code))) {
      if (codes.has(other)) continue;
      codes.add(other);
      linked.set(other, code);
      queue.push(other);
      const from = allSources?.get(code);
      if (from?.size) allSources = new Map([...(allSources ?? []), [other, new Set([...(allSources?.get(other) ?? []), ...from])]]);
    }
  }
  return {
    codes, exhaustion, ...(rules ? { rules } : {}), ...(allSources ? { sources: allSources } : {}),
    ...(stages?.size ? { stages } : {}), ...(linked.size ? { linked } : {}),
  };
}

export function withoutCodes(state: ConditionState, drop: readonly string[]): ConditionState {
  return { ...state, codes: new Set([...state.codes].filter(code => !drop.includes(code))) };
}

const has = (state: ConditionState, code: string) => state.codes.has(code);

type Held = { code: string; rule: ConditionRule; clause: Clause };

function heldClauses(state: ConditionState, kind: Clause['kind']): Held[] {
  const found: Held[] = [];
  for (const code of [...state.codes].sort()) {
    const rule = ruleOf(state.rules, code);
    for (const clause of ruleClauses(rule, state.stages?.get(code))) if (clause.kind === kind) found.push({ code, rule: rule!, clause });
  }
  return found;
}

const nameOf = (state: ConditionState, code: string) => ruleOf(state.rules, code)?.name ?? CONDITION_LABELS[code] ?? code;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const INCAPACITATED_ORDER = ['unconscious', 'paralyzed', 'petrified', 'stunned', 'incapacitated'];

function helplessCodes(state: ConditionState): string[] {
  const codes = heldClauses(state, 'cannot-act').filter(held => held.clause.values.what === 'all').map(held => held.code);
  return [...new Set(codes)].sort((a, b) => (INCAPACITATED_ORDER.indexOf(a) + 1 || 99) - (INCAPACITATED_ORDER.indexOf(b) + 1 || 99));
}

export function isIncapacitated(state: ConditionState): boolean {
  return has(state, 'dead') || state.exhaustion >= 6 || helplessCodes(state).length > 0;
}

export function incapacitatedReason(state: ConditionState): string | null {
  if (has(state, 'dead') || state.exhaustion >= 6) return 'мёртв';
  const code = helplessCodes(state)[0];
  return code ? nameOf(state, code) : null;
}

export function reactionBlocked(state: ConditionState): string | null {
  const unable = incapacitatedReason(state);
  if (unable) return unable;
  if (has(state, 'no_reactions')) return 'без реакций до начала своего хода';
  if (has(state, 'turned')) return 'изгнан';
  const banned = heldClauses(state, 'cannot-act').find(held => held.clause.values.what === 'reactions');
  return banned ? banned.rule.name : null;
}

export type SpeedRuling = { feet: number; reasons: string[]; crawling: boolean };

export function effectiveSpeed(baseFeet: number, state: ConditionState): SpeedRuling {
  const speeds = heldClauses(state, 'speed');
  const stopped = [...new Set(speeds.filter(held => held.clause.values.mode === 'zero').map(held => held.code)), ...(has(state, 'dead') ? ['dead'] : [])];
  if (stopped.length) return { feet: 0, reasons: stopped.map(code => `скорость 0: ${nameOf(state, code)}`), crawling: false };
  if (state.exhaustion >= 5) return { feet: 0, reasons: ['скорость 0: истощение 5'], crawling: false };

  const reasons: string[] = [];
  let feet = baseFeet;
  if (state.exhaustion >= 2) {
    feet = Math.floor(feet / 2);
    reasons.push(`скорость вдвое меньше: истощение ${state.exhaustion}`);
  }
  for (const held of speeds.filter(entry => entry.clause.values.mode === 'half')) {
    feet = Math.floor(feet / 2);
    reasons.push(`скорость вдвое меньше: ${held.rule.name}`);
  }
  const crawling = speeds.some(held => held.clause.values.mode === 'crawl');
  if (crawling) reasons.push('ползком: каждый фут стоит два');
  return { feet, reasons, crawling };
}

export type RollContext = {
  kind: D20Kind;
  ability: Ability;
  own: ConditionState;
  target?: ConditionState | null;
  targetId?: string | null;
  targetWithin5ft?: boolean | null;
  requested?: Advantage;
  inspiration?: boolean;
  extraDisadvantages?: string[];
  extraAdvantages?: string[];
  noAdvantage?: string | null;
  unseenNoAdvantage?: boolean;
  ignoreUnseen?: boolean;
  sense?: 'sight' | 'hearing' | null;
  sightBlocked?: string | null;
};

export type RollRuling = {
  advantage: Advantage;
  autoFail: boolean;
  autoCritOnHit: boolean;
  reasons: string[];
  notes: string[];
};

function rollMatches(values: Record<string, unknown>, kind: D20Kind, ability: Ability): boolean {
  const rolls = values.rolls;
  const check = kind === 'ability' || kind === 'skill';
  if ((rolls === 'attacks' && kind !== 'attack') || (rolls === 'saves' && kind !== 'save') || (rolls === 'checks' && !check)) return false;
  const pick = values.ability ?? 'any';
  if (kind === 'attack' || pick === 'any') return true;
  return pick === 'str-dex' ? ability === 'strength' || ability === 'dexterity' : pick === ability;
}

export function d20Ruling(context: RollContext): RollRuling {
  const { own } = context;
  const advantages: string[] = [];
  const disadvantages: string[] = [];
  const notes: string[] = [];
  let autoFail = false;
  let autoCritOnHit = false;
  const autoFailReasons: string[] = [];
  const effectWords: Record<string, string> = { advantage: 'преимущество', disadvantage: 'помеха', fail: 'автопровал' };

  if (context.requested === 'adv') advantages.push('выбрано преимущество');
  if (context.requested === 'disadv') disadvantages.push('выбрана помеха');
  if (context.inspiration) advantages.push('вдохновение');
  for (const reason of context.extraDisadvantages ?? []) disadvantages.push(reason);
  for (const reason of context.extraAdvantages ?? []) advantages.push(reason);

  let sightFailed = false;
  for (const { code, rule, clause } of heldClauses(own, 'own-rolls')) {
    const v = clause.values;
    if (!rollMatches(v, context.kind, context.ability)) continue;
    if (v.whileSourceSeen && own.outOfSight?.has(code)) continue;
    if (context.kind === 'attack' && v.against === 'source' && !(context.targetId && own.sources?.get(code)?.has(context.targetId))) continue;
    if (context.kind === 'attack' && v.bySight) {
      if (v.effect === 'disadvantage' && context.ignoreUnseen) continue;
      if (v.effect === 'advantage' && context.unseenNoAdvantage) continue;
    }
    const sense = v.sense ?? 'any';
    if (context.kind !== 'attack' && context.kind !== 'save' && sense !== 'any') {
      const by = sense === 'sight' ? 'зрением' : 'слухом';
      if (context.sense !== sense) {
        if (!context.sense) {
          notes.push(v.effect === 'fail'
            ? `${capital(rule.name)}: проверка, требующая ${sense === 'sight' ? 'зрения' : 'слуха'}, проваливается автоматически.`
            : `${capital(rule.name)}: проверка, требующая ${sense === 'sight' ? 'зрения' : 'слуха'}, — ${effectWords[String(v.effect)]}.`);
        }
        continue;
      }
      if (v.effect === 'fail') {
        autoFail = true;
        if (sense === 'sight') sightFailed = true;
        autoFailReasons.push(`автопровал: ${rule.name} — проверка ${by}`);
        continue;
      }
    }
    if (v.effect === 'fail') {
      autoFail = true;
      autoFailReasons.push(`автопровал: ${rule.name}`);
    } else (v.effect === 'advantage' ? advantages : disadvantages).push(rule.name);
    if (v.whileSourceSeen && context.kind === 'attack') notes.push(`${capital(rule.name)}: ${effectWords[String(v.effect)]}, пока источник в поле зрения.`);
  }

  if (context.kind === 'attack') {
    if (own.exhaustion >= 3) disadvantages.push(`истощение ${own.exhaustion}`);
    const target = context.target;
    if (target && dodges(target)) disadvantages.push('цель уклоняется');
    if (target) {
      for (const { code, rule, clause } of heldClauses(target, 'rolls-against')) {
        const v = clause.values;
        if (v.bySight && context.ignoreUnseen) continue;
        if (v.range === 'near' && context.targetWithin5ft === false) continue;
        if (v.range === 'far' && context.targetWithin5ft !== false) continue;
        const text = v.range === 'near' ? `цель ${rule.name}, вы в 5 фут.` : v.range === 'far' ? `цель ${rule.name}, вы дальше 5 фут.` : rule.asTarget ?? `цель ${nameOf(target, code)}`;
        (v.effect === 'advantage' ? advantages : disadvantages).push(text);
      }
      for (const { clause } of heldClauses(target, 'crit-against')) {
        if (clause.values.range !== 'near' || context.targetWithin5ft !== false) autoCritOnHit = true;
      }
    }
  } else if (context.kind === 'save') {
    if (context.ability === 'dexterity' && dodges(own)) advantages.push('уклонение');
    if (context.ability === 'dexterity' && has(own, 'hasted')) advantages.push('ускорение');
    if (context.ability === 'wisdom' && has(own, 'beacon_of_hope')) advantages.push('маяк надежды');
    if (context.ability === 'strength' && has(own, 'raging')) advantages.push('ярость');
    if (own.exhaustion >= 3) disadvantages.push(`истощение ${own.exhaustion}`);
  } else {
    if (context.ability === 'strength' && has(own, 'raging')) advantages.push('ярость');
    if (own.exhaustion >= 1) disadvantages.push(`истощение ${own.exhaustion}`);
    if (context.sense === 'sight' && !sightFailed && context.sightBlocked) {
      autoFail = true;
      autoFailReasons.push(`автопровал: ${context.sightBlocked} — проверка зрением`);
    }
  }

  const blocked = context.kind === 'attack' && context.noAdvantage && advantages.length ? context.noAdvantage : null;
  if (blocked) advantages.length = 0;

  const advantage: Advantage =
    advantages.length && disadvantages.length ? 'none'
    : advantages.length ? 'adv'
    : disadvantages.length ? 'disadv'
    : 'none';

  const reasons = [
    ...autoFailReasons,
    ...advantages.map(reason => `преимущество: ${reason}`),
    ...disadvantages.map(reason => `помеха: ${reason}`),
    ...(blocked ? [`без преимущества: ${blocked}`] : []),
  ];
  if (advantages.length && disadvantages.length) reasons.push('преимущество и помеха гасят друг друга');

  return { advantage, autoFail, autoCritOnHit, reasons, notes };
}

// Who the condition holder may not attack: the source of the condition, anyone, or anyone but the source.
export function attackBan(state: ConditionState, targetId: string): { code: string; name: string } | null {
  for (const { code, rule, clause } of heldClauses(state, 'cannot-attack')) {
    const fromTarget = Boolean(state.sources?.get(code)?.has(targetId));
    const whom = clause.values.whom;
    if (whom === 'anyone' || (whom === 'source' && fromTarget) || (whom === 'others' && !fromTarget)) return { code, name: rule.name };
  }
  return null;
}

export function approachBans(state: ConditionState): Array<{ code: string; name: string; whileSeen: boolean }> {
  return heldClauses(state, 'cannot-approach').map(({ code, rule, clause }) => ({ code, name: rule.name, whileSeen: clause.values.whileSeen !== false }));
}

export function resistsAll(state: ConditionState): string | null {
  return heldClauses(state, 'resistance')[0]?.rule.name ?? null;
}

// Plain numbers the conditions add to the creature's own d20 rolls (a disease's −2 to attacks).
export function conditionRollBonus(state: ConditionState, kind: D20Kind, ability: Ability | null, sense: 'sight' | 'hearing' | null = null) {
  let value = 0;
  const reasons: string[] = [];
  for (const { rule, clause } of heldClauses(state, 'roll-bonus')) {
    const v = clause.values;
    if (!rollMatches(v, kind, ability ?? 'strength') || (ability === null && (v.ability ?? 'any') !== 'any' && kind !== 'attack')) continue;
    const wanted = v.sense ?? 'any';
    if (kind !== 'attack' && kind !== 'save' && wanted !== 'any' && wanted !== sense) continue;
    const amount = Number(v.value) || 0;
    if (!amount) continue;
    value += amount;
    if (!reasons.includes(rule.name)) reasons.push(rule.name);
  }
  return { value, reasons };
}

function dodges(state: ConditionState) {
  return has(state, 'dodging') && !isIncapacitated(state) && !has(state, 'grappled') && !has(state, 'restrained') && state.exhaustion < 5;
}

export function castingUse(castingTime: string | null | undefined): 'action' | 'bonus' | 'reaction' {
  const text = (castingTime ?? '').toLowerCase();
  if (/bonus|бонус/.test(text)) return 'bonus';
  if (/reaction|реакц/.test(text)) return 'reaction';
  return 'action';
}

export function attackOutcome(natural: number, total: number, targetAc: number, autoCritOnHit: boolean, critAt = 20) {
  if (natural >= Math.min(20, critAt)) return { hit: true, critical: true };
  if (natural === 1) return { hit: false, critical: false };
  const hit = total >= targetAc;
  return { hit, critical: hit && autoCritOnHit };
}

export function concentrationDc(damage: number): number {
  return Math.max(10, Math.floor(damage / 2));
}

export type DeathSaveState = { successes: number; failures: number };

export function deathSaveOutcome(natural: number, before: DeathSaveState) {
  if (natural === 20) return { successes: 0, failures: 0, regained: true, stable: false, dead: false };
  let { successes, failures } = before;
  if (natural === 1) failures += 2;
  else if (natural >= 10) successes += 1;
  else failures += 1;
  successes = Math.min(3, successes);
  failures = Math.min(3, failures);
  return { successes, failures, regained: false, stable: successes >= 3, dead: failures >= 3 };
}

export function damageAtZero(before: DeathSaveState, damage: number, critical: boolean, hpMax: number) {
  if (damage >= hpMax) return { ...before, failures: 3, dead: true };
  const failures = Math.min(3, before.failures + (critical ? 2 : 1));
  return { successes: before.successes, failures, dead: failures >= 3 };
}
