export type SfxEvent =
  | 'dice' | 'melee-swing' | 'melee-hit' | 'melee-miss' | 'ranged-shot' | 'ranged-hit' | 'ranged-miss' | 'crit'
  | 'heal' | 'level' | 'combat-start' | 'combat-end' | 'your-turn'
  | 'spell-fire' | 'spell-cold' | 'spell-earth' | 'spell-thunder' | 'spell-acid' | 'spell-other' | 'spell-miss'
  | 'door-open' | 'door-close' | 'gate-open' | 'gate-close' | 'chest-open' | 'chest-close' | 'unlock' | 'torch-light'
  | 'strike-wood' | 'strike-stone' | 'steps';
export type SfxGroup = 'combat' | 'magic' | 'world';
export type Surface = 'dirt' | 'stone' | 'water' | 'wood';
export type SfxShape = 'circle' | 'cone' | 'square' | 'line';

export type SfxChoice = {
  id: string;
  label: string;
  files?: string[];
  area?: string[];
  spray?: string[];
  synth?: 'dice' | 'hit' | 'miss' | 'crit' | 'spell' | 'heal' | 'level' | 'turn';
  surface?: Surface | 'scene';
  chain?: boolean;
};
export type SfxEventDef = { id: SfxEvent; label: string; hint?: string; group: SfxGroup; volume: number; choices: SfxChoice[] };

export const take = (path: string, count: number) => Array.from({ length: count }, (_, index) => `${path}-${index + 1}.ogg`);

export const SFX_GROUPS: Array<{ id: SfxGroup; label: string }> = [
  { id: 'combat', label: 'Бой' },
  { id: 'magic', label: 'Магия' },
  { id: 'world', label: 'Предметы, стены, шаги' },
];

export const SFX_EVENTS: SfxEventDef[] = [
  { id: 'dice', label: 'Бросок кубиков', group: 'combat', volume: 1, choices: [{ id: 'synth', label: 'Стук кубиков (синтезатор)', synth: 'dice' }] },
  {
    id: 'melee-swing', label: 'Взмах оружия', hint: 'перед ударом в ближнем бою', group: 'combat', volume: 0.8,
    choices: [{ id: 'pack', label: 'Свист клинка', files: take('attack/sword-swing', 3) }],
  },
  {
    id: 'melee-hit', label: 'Попадание в ближнем бою', group: 'combat', volume: 1,
    choices: [
      { id: 'pack', label: 'Удар клинка', files: take('attack/sword-hit', 3) },
      { id: 'synth', label: 'Глухой удар (синтезатор)', synth: 'hit' },
    ],
  },
  {
    id: 'melee-miss', label: 'Промах в ближнем бою', group: 'combat', volume: 1,
    choices: [
      { id: 'pack', label: 'Клинок отбит', files: take('attack/sword-blocked', 3) },
      { id: 'parry', label: 'Парирование', files: take('attack/sword-parry', 3) },
      { id: 'synth', label: 'Свист (синтезатор)', synth: 'miss' },
    ],
  },
  { id: 'ranged-shot', label: 'Выстрел', hint: 'лук, арбалет, праща', group: 'combat', volume: 0.9, choices: [{ id: 'pack', label: 'Тетива', files: take('attack/bow-shot', 2) }] },
  {
    id: 'ranged-hit', label: 'Попадание издалека', group: 'combat', volume: 1,
    choices: [
      { id: 'pack', label: 'Стрела в цель', files: take('attack/bow-hit', 3) },
      { id: 'synth', label: 'Глухой удар (синтезатор)', synth: 'hit' },
    ],
  },
  {
    id: 'ranged-miss', label: 'Промах издалека', group: 'combat', volume: 1,
    choices: [
      { id: 'pack', label: 'Стрела отбита', files: take('attack/bow-blocked', 3) },
      { id: 'synth', label: 'Свист (синтезатор)', synth: 'miss' },
    ],
  },
  {
    id: 'crit', label: 'Критическое попадание', hint: 'поверх звука попадания', group: 'combat', volume: 1,
    choices: [
      { id: 'synth', label: 'Звон (синтезатор)', synth: 'crit' },
      { id: 'pack', label: 'Магический удар', files: take('spell/impact', 3) },
    ],
  },
  {
    id: 'heal', label: 'Лечение', group: 'combat', volume: 1,
    choices: [
      { id: 'synth', label: 'Перезвон (синтезатор)', synth: 'heal' },
      { id: 'pack', label: 'Усиление', files: take('spell/fire-buff', 2) },
    ],
  },
  { id: 'level', label: 'Новый уровень', group: 'combat', volume: 1, choices: [{ id: 'synth', label: 'До-ми-соль-до (синтезатор)', synth: 'level' }] },
  { id: 'combat-start', label: 'Начало боя', group: 'combat', volume: 1, choices: [{ id: 'pack', label: 'Клинок из ножен', files: take('attack/sword-unsheath', 2) }] },
  { id: 'combat-end', label: 'Конец боя', group: 'combat', volume: 1, choices: [{ id: 'pack', label: 'Клинок в ножны', files: take('attack/sword-sheath', 2) }] },
  {
    id: 'your-turn', label: 'Ваш ход', hint: 'начался ход вашего существа', group: 'combat', volume: 1,
    choices: [
      { id: 'synth', label: 'Колокольчик (синтезатор)', synth: 'turn' },
      { id: 'pack', label: 'Клинок из ножен', files: take('attack/sword-unsheath', 2) },
    ],
  },

  {
    id: 'spell-fire', label: 'Огонь', hint: 'одна цель и круг — огненный шар, конус и линия — струя пламени', group: 'magic', volume: 1,
    choices: [
      { id: 'pack', label: 'По форме заклинания', files: take('spell/fireball', 3), area: take('spell/fireball', 3), spray: take('spell/fire-spray', 2) },
      { id: 'ball', label: 'Всегда огненный шар', files: take('spell/fireball', 3) },
      { id: 'spray', label: 'Всегда струя пламени', files: take('spell/fire-spray', 2) },
      { id: 'synth', label: 'Перелив (синтезатор)', synth: 'spell' },
    ],
  },
  {
    id: 'spell-cold', label: 'Холод', hint: 'одна цель — ледяной снаряд, круг — град льдинок, конус и линия — заморозка', group: 'magic', volume: 1,
    choices: [
      { id: 'pack', label: 'По форме заклинания', files: take('spell/ice-throw', 2), area: take('spell/ice-barrage', 2), spray: take('spell/ice-freeze', 2) },
      { id: 'wall', label: 'Ледяная стена', files: take('spell/ice-wall', 2) },
      { id: 'synth', label: 'Перелив (синтезатор)', synth: 'spell' },
    ],
  },
  {
    id: 'spell-earth', label: 'Камень и оружие', hint: 'дробящий, колющий, рубящий урон: снаряд или каменный дождь', group: 'magic', volume: 1,
    choices: [
      { id: 'pack', label: 'По форме заклинания', files: take('spell/rock-throw', 2), area: take('spell/rock-swarm', 2), spray: take('spell/rock-throw', 2) },
      { id: 'wall', label: 'Каменная стена', files: take('spell/rock-wall', 2) },
      { id: 'synth', label: 'Перелив (синтезатор)', synth: 'spell' },
    ],
  },
  {
    id: 'spell-thunder', label: 'Звук', hint: 'громовой урон — ударная волна', group: 'magic', volume: 1,
    choices: [
      { id: 'pack', label: 'Ударная волна', files: take('spell/wave', 2) },
      { id: 'synth', label: 'Перелив (синтезатор)', synth: 'spell' },
    ],
  },
  {
    id: 'spell-acid', label: 'Кислота и яд', group: 'magic', volume: 1,
    choices: [
      { id: 'pack', label: 'Брызги', files: take('spell/water-spray', 2) },
      { id: 'synth', label: 'Перелив (синтезатор)', synth: 'spell' },
    ],
  },
  {
    id: 'spell-other', label: 'Прочая магия', hint: 'силовое поле, молния, излучение, некротика, психическая энергия', group: 'magic', volume: 1,
    choices: [
      { id: 'pack', label: 'Магический удар', files: take('spell/impact', 3) },
      { id: 'synth', label: 'Перелив (синтезатор)', synth: 'spell' },
    ],
  },
  { id: 'spell-miss', label: 'Заклинание мимо', hint: 'после звука самого заклинания', group: 'magic', volume: 0.8, choices: [{ id: 'synth', label: 'Свист (синтезатор)', synth: 'miss' }] },

  { id: 'door-open', label: 'Дверь открылась', group: 'world', volume: 1, choices: [{ id: 'pack', label: 'Скрип двери', files: take('object/door-open', 2) }] },
  { id: 'door-close', label: 'Дверь закрылась', group: 'world', volume: 1, choices: [{ id: 'pack', label: 'Стук двери', files: take('object/door-close', 2) }] },
  {
    id: 'gate-open', label: 'Ворота открылись', hint: 'объект с «ворота» или «решётка» в названии', group: 'world', volume: 1,
    choices: [
      { id: 'pack', label: 'Створки ворот', files: ['object/gate-open-1.ogg'] },
      { id: 'portcullis', label: 'Подъёмная решётка', files: ['object/portcullis-1.ogg'] },
    ],
  },
  {
    id: 'gate-close', label: 'Ворота закрылись', group: 'world', volume: 1,
    choices: [
      { id: 'pack', label: 'Створки ворот', files: ['object/gate-close-1.ogg'] },
      { id: 'portcullis', label: 'Подъёмная решётка', files: ['object/portcullis-1.ogg'] },
    ],
  },
  { id: 'chest-open', label: 'Сундук открылся', hint: 'и любой другой открываемый предмет', group: 'world', volume: 1, choices: [{ id: 'pack', label: 'Крышка сундука', files: take('object/chest-open', 2) }] },
  { id: 'chest-close', label: 'Сундук закрылся', group: 'world', volume: 1, choices: [{ id: 'pack', label: 'Крышка сундука', files: take('object/chest-close', 2) }] },
  { id: 'unlock', label: 'Замок отперт', group: 'world', volume: 1, choices: [{ id: 'pack', label: 'Щелчок замка', files: ['object/unlock-1.ogg'] }] },
  { id: 'torch-light', label: 'Зажгли свет', hint: 'факел, лампа, костёр', group: 'world', volume: 1, choices: [{ id: 'pack', label: 'Вспыхнул факел', files: take('object/torch-light', 2) }] },
  { id: 'strike-wood', label: 'Удар по дереву', hint: 'деревянная стена, дверь, живая изгородь', group: 'world', volume: 1, choices: [{ id: 'pack', label: 'Топор по дереву', files: take('object/chop', 4) }] },
  { id: 'strike-stone', label: 'Удар по камню', hint: 'каменная, кирпичная стена, скала', group: 'world', volume: 1, choices: [{ id: 'pack', label: 'Кирка по камню', files: take('object/mine', 5) }] },
  {
    id: 'steps', label: 'Шаги', hint: 'когда существо идёт по сцене', group: 'world', volume: 0.45,
    choices: [
      { id: 'scene', label: 'Как задал мастер у сцены', surface: 'scene' },
      { id: 'scene-chain', label: 'Как у сцены, со звоном доспехов', surface: 'scene', chain: true },
      { id: 'dirt', label: 'Всегда земля', surface: 'dirt' },
      { id: 'stone', label: 'Всегда камень', surface: 'stone' },
      { id: 'water', label: 'Всегда вода', surface: 'water' },
      { id: 'wood', label: 'Всегда дерево', surface: 'wood' },
    ],
  },
];

const BY_ID = new Map(SFX_EVENTS.map(definition => [definition.id, definition]));
export const sfxEvent = (id: SfxEvent) => BY_ID.get(id)!;

export function spellSfxEvent(damageType: string | null | undefined): SfxEvent {
  if (damageType === 'fire') return 'spell-fire';
  if (damageType === 'cold') return 'spell-cold';
  if (damageType === 'bludgeoning' || damageType === 'piercing' || damageType === 'slashing') return 'spell-earth';
  if (damageType === 'thunder') return 'spell-thunder';
  if (damageType === 'acid' || damageType === 'poison') return 'spell-acid';
  return 'spell-other';
}

export type AmbiencePlace = 'none' | 'forest' | 'cave' | 'beach' | 'sea' | 'inside';
export type AmbienceWater = 'none' | 'river' | 'stream' | 'waterfall';
export type AmbienceSteps = 'auto' | Surface;
export type SceneAmbience = { place?: AmbiencePlace; water?: AmbienceWater; volume?: number; steps?: AmbienceSteps };

export const AMBIENCE_PLACES: Array<{ id: AmbiencePlace; label: string }> = [
  { id: 'none', label: 'Без фона' },
  { id: 'forest', label: 'Лес' },
  { id: 'cave', label: 'Пещера, подземелье' },
  { id: 'beach', label: 'Берег' },
  { id: 'sea', label: 'Море, корабль' },
  { id: 'inside', label: 'Под крышей (дом, таверна)' },
];
export const AMBIENCE_WATERS: Array<{ id: AmbienceWater; label: string }> = [
  { id: 'none', label: 'Без воды' },
  { id: 'river', label: 'Река' },
  { id: 'stream', label: 'Ручей' },
  { id: 'waterfall', label: 'Водопад' },
];
export const AMBIENCE_STEPS: Array<{ id: AmbienceSteps; label: string }> = [
  { id: 'auto', label: 'По месту' },
  { id: 'dirt', label: 'Земля, трава' },
  { id: 'stone', label: 'Камень' },
  { id: 'water', label: 'Вода, мелководье' },
  { id: 'wood', label: 'Дерево, палуба' },
];

export function sceneSurface(ambience: SceneAmbience | null | undefined): Surface {
  if (ambience?.steps && ambience.steps !== 'auto') return ambience.steps;
  switch (ambience?.place) {
    case 'forest':
    case 'beach':
      return 'dirt';
    case 'sea':
    case 'inside':
      return 'wood';
    default:
      return 'stone';
  }
}

export function ambienceTrack(place: AmbiencePlace | undefined, night: boolean, weather: string | undefined): string | null {
  if (!place || place === 'none') return null;
  const base = place === 'forest' || place === 'inside' ? `${place}-${night ? 'night' : 'day'}` : place;
  const suffix = weather === 'rain' ? '-rain' : weather === 'storm' ? '-storm' : '';
  return `ambience/${base}${suffix}.webm`;
}

export function waterTrack(water: AmbienceWater | undefined): string | null {
  return water && water !== 'none' ? `ambience/${water}.webm` : null;
}
