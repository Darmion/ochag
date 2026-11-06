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
};

export type Ability = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
export type Advantage = 'none' | 'adv' | 'disadv';
export type D20Kind = 'attack' | 'save' | 'ability' | 'skill';

export type ConditionState = {
  codes: Set<string>;
  exhaustion: number;
};

export function conditionState(effectCodes: Iterable<string>): ConditionState {
  const codes = new Set<string>();
  let exhaustion = 0;
  for (const code of effectCodes) {
    const level = /^exhaustion_([1-6])$/.exec(code);
    if (level) exhaustion = Math.max(exhaustion, Number(level[1]));
    else codes.add(code);
  }
  return { codes, exhaustion };
}

const has = (state: ConditionState, code: string) => state.codes.has(code);

export function isIncapacitated(state: ConditionState): boolean {
  return ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious', 'dead'].some(code => has(state, code)) || state.exhaustion >= 6;
}

export function incapacitatedReason(state: ConditionState): string | null {
  if (has(state, 'dead') || state.exhaustion >= 6) return 'мёртв';
  for (const code of ['unconscious', 'paralyzed', 'petrified', 'stunned', 'incapacitated']) {
    if (has(state, code)) return CONDITION_LABELS[code]!;
  }
  return null;
}

export function reactionBlocked(state: ConditionState): string | null {
  const unable = incapacitatedReason(state);
  if (unable) return unable;
  if (has(state, 'no_reactions')) return 'без реакций до начала своего хода';
  if (has(state, 'turned')) return 'изгнан';
  return null;
}

export type SpeedRuling = { feet: number; reasons: string[]; crawling: boolean };

export function effectiveSpeed(baseFeet: number, state: ConditionState): SpeedRuling {
  const stopped = ['grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious', 'dead'].filter(code => has(state, code));
  if (stopped.length) return { feet: 0, reasons: stopped.map(code => `скорость 0: ${CONDITION_LABELS[code]}`), crawling: false };
  if (state.exhaustion >= 5) return { feet: 0, reasons: ['скорость 0: истощение 5'], crawling: false };

  const reasons: string[] = [];
  let feet = baseFeet;
  if (state.exhaustion >= 2) {
    feet = Math.floor(feet / 2);
    reasons.push(`скорость вдвое меньше: истощение ${state.exhaustion}`);
  }
  const crawling = has(state, 'prone');
  if (crawling) reasons.push('ползком: каждый фут стоит два');
  return { feet, reasons, crawling };
}

export type RollContext = {
  kind: D20Kind;
  ability: Ability;
  own: ConditionState;
  target?: ConditionState | null;
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

export function d20Ruling(context: RollContext): RollRuling {
  const { own } = context;
  const advantages: string[] = [];
  const disadvantages: string[] = [];
  const notes: string[] = [];
  let autoFail = false;
  let autoCritOnHit = false;
  const autoFailReasons: string[] = [];

  if (context.requested === 'adv') advantages.push('выбрано преимущество');
  if (context.requested === 'disadv') disadvantages.push('выбрана помеха');
  if (context.inspiration) advantages.push('вдохновение');
  for (const reason of context.extraDisadvantages ?? []) disadvantages.push(reason);
  for (const reason of context.extraAdvantages ?? []) advantages.push(reason);

  if (context.kind === 'attack') {
    for (const code of ['blinded', 'frightened', 'poisoned', 'prone', 'restrained']) {
      if (code === 'blinded' && context.ignoreUnseen) continue;
      if (has(own, code)) disadvantages.push(CONDITION_LABELS[code]!);
    }
    if (own.exhaustion >= 3) disadvantages.push(`истощение ${own.exhaustion}`);
    if (has(own, 'invisible') && !context.unseenNoAdvantage) advantages.push('невидим');
    if (has(own, 'frightened')) notes.push('Испуган: помеха, пока источник страха в поле зрения.');

    const target = context.target;
    if (target && dodges(target)) disadvantages.push('цель уклоняется');
    if (target) {
      for (const code of ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious']) {
        if (has(target, code)) advantages.push(`цель ${CONDITION_LABELS[code]}`);
      }
      if (has(target, 'invisible') && !context.ignoreUnseen) disadvantages.push('цель невидима');
      if (has(target, 'prone')) {
        if (context.targetWithin5ft === false) disadvantages.push('цель лежит ничком, вы дальше 5 фут.');
        else advantages.push('цель лежит ничком, вы в 5 фут.');
      }
      if ((has(target, 'paralyzed') || has(target, 'unconscious')) && context.targetWithin5ft !== false) autoCritOnHit = true;
    }
  } else if (context.kind === 'save') {
    if (context.ability === 'strength' || context.ability === 'dexterity') {
      for (const code of ['paralyzed', 'petrified', 'stunned', 'unconscious']) {
        if (has(own, code)) {
          autoFail = true;
          autoFailReasons.push(`автопровал: ${CONDITION_LABELS[code]}`);
        }
      }
    }
    if (context.ability === 'dexterity' && has(own, 'restrained')) disadvantages.push('опутан');
    if (context.ability === 'dexterity' && dodges(own)) advantages.push('уклонение');
    if (context.ability === 'dexterity' && has(own, 'hasted')) advantages.push('ускорение');
    if (context.ability === 'wisdom' && has(own, 'beacon_of_hope')) advantages.push('маяк надежды');
    if (context.ability === 'strength' && has(own, 'raging')) advantages.push('ярость');
    if (own.exhaustion >= 3) disadvantages.push(`истощение ${own.exhaustion}`);
  } else {
    if (context.ability === 'strength' && has(own, 'raging')) advantages.push('ярость');
    for (const code of ['frightened', 'poisoned']) {
      if (has(own, code)) disadvantages.push(CONDITION_LABELS[code]!);
    }
    if (own.exhaustion >= 1) disadvantages.push(`истощение ${own.exhaustion}`);
    if (context.sense === 'sight' && (has(own, 'blinded') || context.sightBlocked)) {
      autoFail = true;
      autoFailReasons.push(`автопровал: ${has(own, 'blinded') ? 'ослеплён' : context.sightBlocked} — проверка зрением`);
    } else if (!context.sense && has(own, 'blinded')) notes.push('Ослеплён: проверка, требующая зрения, проваливается автоматически.');
    if (context.sense === 'hearing' && has(own, 'deafened')) {
      autoFail = true;
      autoFailReasons.push('автопровал: оглох — проверка слухом');
    } else if (!context.sense && has(own, 'deafened')) notes.push('Оглох: проверка, требующая слуха, проваливается автоматически.');
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
