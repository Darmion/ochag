export const CREATURE_TYPES = [
  'aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead',
] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];

export const CREATURE_TYPE_LABELS: Record<CreatureType, string> = {
  aberration: 'аберрация', beast: 'зверь', celestial: 'небожитель', construct: 'конструкт', dragon: 'дракон', elemental: 'элементаль',
  fey: 'фея', fiend: 'исчадие', giant: 'великан', humanoid: 'гуманоид', monstrosity: 'чудовище', ooze: 'слизь', plant: 'растение', undead: 'нежить',
};

const RU_TYPES: Array<[RegExp, CreatureType]> = [
  [/^аберрац/i, 'aberration'], [/^зверь|^звери/i, 'beast'], [/^небожит/i, 'celestial'], [/^конструкт/i, 'construct'],
  [/^дракон/i, 'dragon'], [/^элементал/i, 'elemental'], [/^фея|^феи/i, 'fey'], [/^исчади/i, 'fiend'], [/^великан/i, 'giant'],
  [/^гуманоид/i, 'humanoid'], [/^чудовищ|^монстр/i, 'monstrosity'], [/^слиз/i, 'ooze'], [/^растени/i, 'plant'], [/^нежит/i, 'undead'],
];

export function creatureTypeFromText(text: string | null | undefined): CreatureType | null {
  const value = (text ?? '').trim().toLowerCase();
  if ((CREATURE_TYPES as readonly string[]).includes(value)) return value as CreatureType;
  const english = /^(aberration|beast|celestial|construct|dragon|elemental|fey|fiend|giant|humanoid|monstrosity|ooze|plant|undead)/.exec(value);
  if (english) return english[1] as CreatureType;
  return RU_TYPES.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

export type SpellTargetRules = {
  only: CreatureType | null;
  excluded: CreatureType[];
  mustSee: boolean;
};

const TYPE_WORD: Record<string, CreatureType> = { humanoid: 'humanoid', beast: 'beast', undead: 'undead', plant: 'plant', construct: 'construct', fiend: 'fiend', fey: 'fey' };

export function spellTargetRules(desc: string | null | undefined): SpellTargetRules {
  const text = (desc ?? '').replace(/\s+/g, ' ');
  const only = /\b(?:choose|charm|beguile|target|convince|touch|affect)\s+(?:a|one|up to \w+)\s+(humanoid|beast)s?\b/i.exec(text)
    ?? /\b(?:a|one)\s+(humanoid|beast)\s+(?:that\s+)?you can see\b/i.exec(text);
  const onlyRu = /(?:выберите|выбери|очаровать|одного|одну|одно)\s+(гуманоида|зверя)(?![а-яё])/i.exec(text);
  const excluded = new Set<CreatureType>();
  const none = /no effect on ([a-z]+)s?(?: or ([a-z]+)s?)?/i.exec(text);
  for (const word of none ? [none[1], none[2]] : []) {
    const type = word ? TYPE_WORD[word.toLowerCase().replace(/s$/, '')] : undefined;
    if (type) excluded.add(type);
  }
  if (/не действует на нежить/i.test(text)) excluded.add('undead');
  if (/не действует на[^.]*конструкт/i.test(text)) excluded.add('construct');
  const mustSee = /\b(?:creature|humanoid|beast|target|person)s?\b[^.]{0,40}?\byou can see\b/i.test(text)
    || /(?:которо(?:го|е|ую|й)|кого) вы видите|видим(?:ого|ую|ое) вами/i.test(text);
  return {
    only: only ? TYPE_WORD[only[1]!.toLowerCase()]! : onlyRu ? (onlyRu[1]!.toLowerCase().startsWith('гуманоид') ? 'humanoid' : 'beast') : null,
    excluded: [...excluded],
    mustSee,
  };
}

export function targetTypeProblem(rules: SpellTargetRules, type: CreatureType | null): string | null {
  if (!type) return null;
  if (rules.only && type !== rules.only) return `только на ${rules.only === 'humanoid' ? 'гуманоида' : 'зверя'}, а это ${CREATURE_TYPE_LABELS[type]}`;
  if (rules.excluded.includes(type)) return `не действует на ${rules.excluded.map(entry => CREATURE_TYPE_LABELS[entry]).join(' и ')}`;
  return null;
}
