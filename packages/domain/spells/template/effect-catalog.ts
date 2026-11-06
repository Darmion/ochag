import { DAMAGE_TYPE_CHOICES, MOD_MODES, SKILL_OR_NONE } from './internal.ts';
import { ABILITIES, AREA_SHAPES, CONDITIONS, CREATURE_TYPES, DAMAGE_TYPES, type Option } from './options.ts';

export type FieldType = 'formula' | 'number' | 'select' | 'multi' | 'bool' | 'text';
export type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  options?: readonly Option[];
  default: unknown;
  showIf?: { key: string; in: readonly unknown[] };
  hint?: string;
};

export type EngineSupport = 'yes' | 'partial' | 'no';

export const EFFECT_KINDS = [
  'damage', 'heal', 'temp-hp', 'max-hp', 'condition', 'ac', 'speed', 'attack-rolls', 'checks', 'extra-damage',
  'defense', 'senses', 'invisible', 'restrict', 'extra-action', 'move', 'summon', 'shape', 'zone', 'wall',
  'remove', 'weapon', 'pool', 'preset', 'message', 'special',
] as const;
export type EffectKind = typeof EFFECT_KINDS[number];

const DIES: readonly Option[] = [['4', 'к4'], ['6', 'к6'], ['8', 'к8'], ['10', 'к10'], ['12', 'к12']];
const CONDITION_DURATIONS: readonly Option[] = [
  ['spell', 'как у заклинания'], ['rounds', 'N раундов'], ['target-next-end', 'до конца следующего хода цели'],
  ['target-next-start', 'до начала следующего хода цели'], ['caster-next-end', 'до конца следующего хода заклинателя'],
  ['caster-next-start', 'до начала следующего хода заклинателя'], ['until-save', 'пока не спасётся'],
];
const REPEAT_SAVES: readonly Option[] = [['none', 'нет'], ['start', 'в начале хода цели'], ['end', 'в конце хода цели'], ['damaged', 'когда получает урон']];
const ABILITY_OR_ALL: readonly Option[] = [['all', 'все'], ...ABILITIES];

const LASTS: readonly FieldSpec[] = [
  { key: 'lasts', label: 'Сколько длится', type: 'select', options: [['spell', 'как у заклинания'], ['rounds', 'N раундов'], ['target-next-end', 'до конца следующего хода цели'], ['target-next-start', 'до начала следующего хода цели'], ['caster-next-end', 'до конца следующего хода заклинателя'], ['caster-next-start', 'до начала следующего хода заклинателя']], default: 'spell' },
  { key: 'lastsRounds', label: 'Раундов', type: 'number', default: 1, showIf: { key: 'lasts', in: ['rounds'] } },
];

export const PRESETS: readonly Option[] = [
  ['sanctuary', '«Убежище»: атакующий сперва спасается Мудростью'], ['protection-from-evil', '«Защита от добра и зла»'],
  ['heroism', '«Героизм»: без испуга, временные хиты каждый ход'], ['mirror-images', '«Зеркальные отражения»: три двойника'],
  ['death-ward', '«Защита от смерти»: первый раз при 0 хитов — 1 хит'], ['stupor', '«Гипнотический узор»: оцепенение, урон будит'],
  ['darkness', '«Тьма»: магическая тьма вокруг цели'], ['daylight', '«Дневной свет»: рассеять магическую тьму'],
  ['blur', '«Размытый образ»: атаки по цели с помехой'], ['true-strike', '«Меткий удар»: первая атака по выбранной цели с преимуществом'],
  ['guidance', '«Указание»: +к4 к следующей проверке'], ['resistance-die', '«Сопротивление»: +к4 к следующему спасброску'],
  ['expeditious', '«Поспешное отступление»: Рывок бонусным действием'], ['stoneskin', '«Каменная кожа»'],
  ['warding-bond', '«Охраняющая связь»'], ['beacon-of-hope', '«Маяк надежды»'], ['haste', '«Ускорение» целиком (с вялостью после)'],
  ['slow', '«Замедление» целиком'], ['sleep', '«Усыпление»: запас хитов, от меньших к большим'],
];

type EffectSpec = { label: string; support: EngineSupport; fields: readonly FieldSpec[]; nested?: boolean };

export const EFFECT_CATALOG: Readonly<Record<EffectKind, EffectSpec>> = {
  damage: { label: 'Урон', support: 'yes', fields: [
    { key: 'formula', label: 'Формула', type: 'formula', default: '1к6' },
    { key: 'damageType', label: 'Вид урона', type: 'select', options: DAMAGE_TYPE_CHOICES, default: 'fire' },
    { key: 'param', label: 'Параметр вида', type: 'text', default: '', showIf: { key: 'damageType', in: ['param'] }, hint: 'имя параметра из раздела Д' },
    { key: 'magical', label: 'Магический', type: 'bool', default: true },
    { key: 'split', label: 'Распределение', type: 'select', options: [['each', 'каждому полностью'], ['split', 'разделить между целями']], default: 'each' },
  ] },
  heal: { label: 'Лечение', support: 'yes', fields: [
    { key: 'formula', label: 'Формула', type: 'formula', default: '1к8 + @mod' },
    { key: 'notUndead', label: 'Не действует на нежить и конструктов', type: 'bool', default: true },
  ] },
  'temp-hp': { label: 'Временные хиты', support: 'yes', fields: [
    { key: 'formula', label: 'Формула', type: 'formula', default: '1к4 + 4' },
    { key: 'eachTurn', label: 'Каждый ход заново', type: 'bool', default: false },
  ] },
  'max-hp': { label: 'Максимум хитов', support: 'yes', fields: [
    { key: 'formula', label: 'Прибавка', type: 'formula', default: '5' },
    ...LASTS,
  ] },
  condition: { label: 'Наложить состояние', support: 'yes', fields: [
    { key: 'code', label: 'Состояние', type: 'select', options: CONDITIONS, default: 'prone' },
    { key: 'levels', label: 'Уровней истощения', type: 'number', default: 1, showIf: { key: 'code', in: ['exhaustion'] } },
    { key: 'fromCaster', label: 'Источник — заклинатель', type: 'bool', default: true, showIf: { key: 'code', in: ['charmed', 'frightened'] } },
    { key: 'duration', label: 'Срок', type: 'select', options: CONDITION_DURATIONS, default: 'spell' },
    { key: 'rounds', label: 'Раундов', type: 'number', default: 1, showIf: { key: 'duration', in: ['rounds'] } },
    { key: 'repeatSave', label: 'Повторный спасбросок', type: 'select', options: REPEAT_SAVES, default: 'none' },
    { key: 'endsOnDamage', label: 'Снимается при уроне', type: 'bool', default: false },
  ] },
  ac: { label: 'КД', support: 'yes', fields: [
    { key: 'mode', label: 'Как', type: 'select', options: [['plus', '+ число'], ['floor', 'не ниже'], ['base', 'равен N + ЛОВ']], default: 'plus' },
    { key: 'value', label: 'Число', type: 'number', default: 2 },
    ...LASTS,
  ] },
  speed: { label: 'Скорость', support: 'yes', fields: [
    { key: 'mode', label: 'Как', type: 'select', options: [['plus', '+ футы'], ['minus', '− футы'], ['double', '×2'], ['half', '÷2'], ['zero', '= 0'], ['fly', 'полёт'], ['climb', 'лазание'], ['swim', 'плавание']], default: 'plus' },
    { key: 'feet', label: 'Футов', type: 'number', default: 10, showIf: { key: 'mode', in: ['plus', 'minus', 'fly', 'climb', 'swim'] } },
    ...LASTS,
  ] },
  'attack-rolls': { label: 'Броски атаки', support: 'yes', fields: [
    { key: 'whose', label: 'Чьи', type: 'select', options: [['own', 'свои атаки'], ['against', 'атаки по цели']], default: 'own' },
    { key: 'mode', label: 'Как', type: 'select', options: MOD_MODES, default: 'die' },
    { key: 'die', label: 'Кость', type: 'select', options: DIES, default: '4', showIf: { key: 'mode', in: ['die', 'minus-die'] } },
    { key: 'value', label: 'Число', type: 'number', default: 1, showIf: { key: 'mode', in: ['plus', 'minus'] } },
    { key: 'scope', label: 'Какие', type: 'select', options: [['all', 'все'], ['vs-caster', 'против заклинателя'], ['first', 'первая атака']], default: 'all' },
    { key: 'once', label: 'Одноразово', type: 'bool', default: false },
    ...LASTS,
  ] },
  checks: { label: 'Спасброски и проверки', support: 'yes', fields: [
    { key: 'roll', label: 'Что', type: 'select', options: [['save', 'спасброски'], ['check', 'проверки'], ['both', 'и то и другое']], default: 'save' },
    { key: 'ability', label: 'Характеристика', type: 'select', options: ABILITY_OR_ALL, default: 'all' },
    { key: 'skill', label: 'Навык', type: 'select', options: SKILL_OR_NONE, default: 'none', showIf: { key: 'roll', in: ['check', 'both'] } },
    { key: 'mode', label: 'Как', type: 'select', options: MOD_MODES, default: 'die' },
    { key: 'die', label: 'Кость', type: 'select', options: DIES, default: '4', showIf: { key: 'mode', in: ['die', 'minus-die'] } },
    { key: 'value', label: 'Число', type: 'number', default: 1, showIf: { key: 'mode', in: ['plus', 'minus'] } },
    { key: 'once', label: 'Одноразово (кость тратится)', type: 'bool', default: false },
    ...LASTS,
  ] },
  'extra-damage': { label: 'Добавочный урон', support: 'partial', fields: [
    { key: 'on', label: 'При попадании', type: 'select', options: [['weapon', 'оружием'], ['spell', 'заклинанием'], ['any', 'любым']], default: 'weapon' },
    { key: 'against', label: 'По кому', type: 'select', options: [['target', 'по цели заклинания (бьёт заклинатель)'], ['all', 'по всем (бьёт цель заклинания)']], default: 'target' },
    { key: 'formula', label: 'Формула', type: 'formula', default: '1к6' },
    { key: 'damageType', label: 'Вид урона', type: 'select', options: DAMAGE_TYPE_CHOICES, default: 'force' },
    { key: 'oncePerTurn', label: 'Раз за ход', type: 'bool', default: false },
    ...LASTS,
  ] },
  defense: { label: 'Сопротивление и иммунитет', support: 'yes', fields: [
    { key: 'mode', label: 'Что', type: 'select', options: [['resistance', 'сопротивление'], ['immunity', 'иммунитет'], ['vulnerability', 'уязвимость'], ['condition-immunity', 'иммунитет к состоянию']], default: 'resistance' },
    { key: 'types', label: 'Виды урона', type: 'multi', options: [...DAMAGE_TYPES, ['all', 'весь урон'], ['nonmagical-physical', 'немагический Д/К/Р'], ['param', 'из параметра']], default: ['fire'], showIf: { key: 'mode', in: ['resistance', 'immunity', 'vulnerability'] } },
    { key: 'conditions', label: 'Состояния', type: 'multi', options: CONDITIONS, default: ['frightened'], showIf: { key: 'mode', in: ['condition-immunity'] } },
    ...LASTS,
  ] },
  senses: { label: 'Чувства и свет', support: 'yes', fields: [
    { key: 'sense', label: 'Что', type: 'select', options: [['darkvision', 'тёмное зрение'], ['blindsight', 'слепое зрение'], ['truesight', 'истинное зрение'], ['see-invisible', 'видеть невидимое'], ['light', 'светится']], default: 'darkvision' },
    { key: 'feet', label: 'Футов (яркий свет)', type: 'number', default: 60, showIf: { key: 'sense', in: ['darkvision', 'blindsight', 'truesight', 'light'] } },
    { key: 'dimFeet', label: 'Тусклый свет ещё, фт.', type: 'number', default: 20, showIf: { key: 'sense', in: ['light'] } },
    ...LASTS,
  ] },
  invisible: { label: 'Невидимость', support: 'yes', fields: [
    { key: 'breaks', label: 'Снимается', type: 'select', options: [['attack-or-spell', 'при атаке или заклинании'], ['never', 'не снимается']], default: 'attack-or-spell' },
    ...LASTS,
  ] },
  restrict: { label: 'Ограничения', support: 'yes', fields: [
    { key: 'what', label: 'Что запрещено', type: 'multi', options: [['no-reactions', 'реакции'], ['no-healing', 'лечение'], ['no-approach', 'приближаться к заклинателю'], ['action-or-bonus', 'действие и бонусное вместе'], ['one-attack', 'больше одной атаки за ход'], ['no-move-or-act', 'двигаться и действовать']], default: ['no-reactions'] },
    ...LASTS,
  ] },
  'extra-action': { label: 'Лишнее действие', support: 'yes', fields: [
    { key: 'allowed', label: 'Каким действием', type: 'multi', options: [['attack-one', 'атака одним оружием'], ['dash', 'Рывок'], ['disengage', 'Отход'], ['hide', 'Засада'], ['use-object', 'Использование предмета']], default: ['attack-one', 'dash', 'disengage', 'hide', 'use-object'] },
    ...LASTS,
  ] },
  move: { label: 'Перемещение', support: 'partial', fields: [
    { key: 'mode', label: 'Как', type: 'select', options: [['push', 'оттолкнуть'], ['pull', 'притянуть'], ['teleport', 'телепорт'], ['swap', 'поменяться местами']], default: 'push' },
    { key: 'feet', label: 'Футов', type: 'number', default: 10, showIf: { key: 'mode', in: ['push', 'pull', 'teleport'] } },
    { key: 'from', label: 'От чего', type: 'select', options: [['caster', 'от заклинателя'], ['center', 'от центра области']], default: 'caster', showIf: { key: 'mode', in: ['push', 'pull'] } },
    { key: 'who', label: 'Кого', type: 'select', options: [['self', 'себя'], ['target', 'цель']], default: 'self', showIf: { key: 'mode', in: ['teleport'] } },
  ] },
  summon: { label: 'Призыв', support: 'partial', fields: [
    { key: 'creatures', label: 'Существа (через запятую, из бестиария) или пусто — по фильтру', type: 'text', default: '' },
    { key: 'creatureType', label: 'Тип', type: 'select', options: [['any', 'любой'], ...CREATURE_TYPES], default: 'beast' },
    { key: 'maxCr', label: 'ПО не больше', type: 'number', default: 2 },
    { key: 'count', label: 'Сколько', type: 'number', default: 1 },
    { key: 'initiative', label: 'Инициатива', type: 'select', options: [['shared', 'общая (сразу после заклинателя)'], ['own', 'своя']], default: 'shared' },
    { key: 'vanish', label: 'Исчезает', type: 'multi', options: [['zero-hp', 'при 0 хитов'], ['concentration', 'с концом концентрации'], ['duration', 'с концом длительности']], default: ['zero-hp', 'duration'] },
  ] },
  shape: { label: 'Превращение', support: 'partial', fields: [
    { key: 'limit', label: 'ПО облика', type: 'select', options: [['target-level', 'не выше уровня или ПО цели'], ['fixed', 'не выше числа']], default: 'target-level' },
    { key: 'maxCr', label: 'ПО не больше', type: 'number', default: 1, showIf: { key: 'limit', in: ['fixed'] } },
    { key: 'creatureType', label: 'Тип облика', type: 'select', options: [['any', 'любой'], ...CREATURE_TYPES], default: 'beast' },
    { key: 'willingNoSave', label: 'Согласным — без спасброска', type: 'bool', default: true },
    { key: 'forbid', label: 'В облике нельзя', type: 'multi', options: [['cast', 'колдовать'], ['speak', 'говорить']], default: ['cast', 'speak'] },
  ] },
  zone: { label: 'Зона на карте', support: 'partial', nested: true, fields: [
    { key: 'shapeFrom', label: 'Форма', type: 'select', options: [['targeting', 'как в разделе Г'], ['own', 'своя']], default: 'targeting' },
    { key: 'shape', label: 'Своя форма', type: 'select', options: AREA_SHAPES, default: 'sphere', showIf: { key: 'shapeFrom', in: ['own'] } },
    { key: 'sizeFeet', label: 'Размер, фт.', type: 'number', default: 20, showIf: { key: 'shapeFrom', in: ['own'] } },
    { key: 'heightFeet', label: 'Высота, фт. (цилиндр)', type: 'number', default: 0, showIf: { key: 'shapeFrom', in: ['own'] } },
    { key: 'difficult', label: 'Труднопроходимая местность', type: 'bool', default: false },
    { key: 'obscured', label: 'Заслонено', type: 'select', options: [['none', 'нет'], ['light', 'слабо'], ['heavy', 'сильно']], default: 'none' },
    { key: 'darkness', label: 'Магическая тьма', type: 'bool', default: false },
    { key: 'silence', label: 'Тишина', type: 'bool', default: false },
    { key: 'lightFeet', label: 'Свет, фт. (0 — нет)', type: 'number', default: 0 },
  ] },
  wall: { label: 'Стена', support: 'no', fields: [
    { key: 'blocks', label: 'Преграждает', type: 'multi', options: [['move', 'движение'], ['sight', 'взгляд'], ['spells', 'заклинания']], default: ['move'] },
    { key: 'ac', label: 'КД отрезка (0 — неразрушима)', type: 'number', default: 0 },
    { key: 'hp', label: 'Хиты отрезка', type: 'number', default: 0 },
    { key: 'damageFormula', label: 'Урон при проходе', type: 'formula', default: '' },
    { key: 'damageType', label: 'Вид урона', type: 'select', options: DAMAGE_TYPES, default: 'fire' },
    { key: 'oneSide', label: 'Урон только с одной стороны', type: 'bool', default: false },
  ] },
  remove: { label: 'Снятие', support: 'partial', fields: [
    { key: 'what', label: 'Что', type: 'select', options: [['conditions', 'состояния из списка'], ['one-condition', 'одно состояние на выбор'], ['spells', 'заклинания'], ['curse', 'проклятие'], ['disease', 'болезнь'], ['poison', 'яд'], ['exhaustion', 'истощение'], ['petrified', 'окаменение'], ['stabilize', 'стабилизировать'], ['revive', 'оживить']], default: 'conditions' },
    { key: 'conditions', label: 'Состояния', type: 'multi', options: CONDITIONS, default: ['poisoned'], showIf: { key: 'what', in: ['conditions', 'one-condition'] } },
    { key: 'upTo', label: 'До круга', type: 'number', default: 3, showIf: { key: 'what', in: ['spells'] } },
    { key: 'levels', label: 'Уровней', type: 'number', default: 1, showIf: { key: 'what', in: ['exhaustion'] } },
    { key: 'hp', label: 'С хитами', type: 'number', default: 1, showIf: { key: 'what', in: ['revive'] } },
    { key: 'within', label: 'Срок после смерти', type: 'text', default: '1 минута', showIf: { key: 'what', in: ['revive'] } },
  ] },
  weapon: { label: 'Оружие и предметы', support: 'partial', fields: [
    { key: 'bonus', label: '+ к атаке и урону', type: 'number', default: 1 },
    { key: 'die', label: 'Кость урона', type: 'select', options: [['none', 'как была'], ...DIES], default: 'none' },
    { key: 'castingAbility', label: 'Атака характеристикой заклинаний', type: 'bool', default: false },
    { key: 'extraFormula', label: 'Добавочный урон', type: 'formula', default: '' },
    { key: 'extraType', label: 'Вид добавочного', type: 'select', options: DAMAGE_TYPES, default: 'fire' },
    { key: 'magical', label: 'Удар магический', type: 'bool', default: true },
    ...LASTS,
  ] },
  pool: { label: 'Запас', support: 'partial', fields: [
    { key: 'mode', label: 'Что', type: 'select', options: [['hp-pool', 'запас хитов (от меньших к большим)'], ['dice-pool', 'кости, которые распределяют'], ['charges', 'заряды']], default: 'hp-pool' },
    { key: 'formula', label: 'Формула', type: 'formula', default: '5к8' },
  ] },
  preset: { label: 'Готовый эффект (как у заклинания SRD)', support: 'yes', fields: [
    { key: 'preset', label: 'Эффект', type: 'select', options: PRESETS, default: 'sanctuary' },
  ] },
  message: { label: 'Сообщение', support: 'partial', fields: [
    { key: 'audience', label: 'Кому', type: 'select', options: [['all', 'всем'], ['target', 'только цели'], ['gm', 'только мастеру']], default: 'all' },
    { key: 'text', label: 'Текст', type: 'text', default: '' },
  ] },
  special: { label: 'Особое (мастеру)', support: 'no', fields: [
    { key: 'text', label: 'Что сделать вручную', type: 'text', default: '' },
  ] },
};
