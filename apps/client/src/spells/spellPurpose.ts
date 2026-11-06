export type SpellPurpose = 'heal' | 'control' | 'damage' | 'protection' | 'movement' | 'utility';

export const SPELL_PURPOSES: Array<{ id: SpellPurpose; label: string; hint: string }> = [
  { id: 'heal', label: 'Исцеление', hint: 'возвращает хиты, снимает болезни и состояния' },
  { id: 'control', label: 'Контроль', hint: 'очарование, страх, паралич, сон, опутывание, труднопроходимая местность' },
  { id: 'damage', label: 'Урон', hint: 'атака заклинанием или урон по спасброску' },
  { id: 'protection', label: 'Защита', hint: 'КД, сопротивление, временные хиты, прерывание чужой магии' },
  { id: 'movement', label: 'Перемещение', hint: 'телепорт, полёт, скорость, прыжки' },
  { id: 'utility', label: 'Вспомогательные', hint: 'всё остальное: разведка, свет, связь, мелкие чудеса' },
];

export const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
] as const;
export type DamageType = typeof DAMAGE_TYPES[number];

export const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  acid: 'Кислота', bludgeoning: 'Дробящий', cold: 'Холод', fire: 'Огонь', force: 'Силовое поле', lightning: 'Электричество',
  necrotic: 'Некротическая энергия', piercing: 'Колющий', poison: 'Яд', psychic: 'Психическая энергия', radiant: 'Излучение',
  slashing: 'Рубящий', thunder: 'Звук',
};

const DAMAGE_RU: Record<DamageType, RegExp> = {
  acid: /кислот/i, bludgeoning: /дробящ/i, cold: /холод/i, fire: /огн[её]м|огненн|огня/i, force: /силов/i, lightning: /электричеств|молни/i,
  necrotic: /некротическ/i, piercing: /колющ/i, poison: /ядом|ядовит/i, psychic: /психическ/i, radiant: /излучени|светом|сиянием/i,
  slashing: /рубящ/i, thunder: /звуком|громом|звуков/i,
};

export type PurposeSource = {
  name?: string | null;
  desc?: string | null;
  descRu?: string | null;
  damageFormula?: string | null;
  healingFormula?: string | null;
  mechanics?: { attack?: string | null; damageFormula?: string | null; damageType?: string | null; healingFormula?: string | null; condition?: string | null } | null;
};

const HEAL = [
  /\bregains?\b[^.]{0,50}\bhit points?\b/i,
  /\bend (?:either )?one disease\b|\bends? (?:one|any|the|all)\b[^.]{0,40}\b(?:disease|curse|poison)/i,
  /\bbecomes? stable\b|стабилиз/i,
  /восстанавлива\S*[^.]{0,50}хит|исцел|лечени|излечива/i,
];
const HEAL_NAME = /\b(?:cure|heal|healing|restoration|revivify|resurrection|raise dead|regenerate)\b|лечени|исцел|восстановлени|оживлени|воскрешени/i;
const DAMAGE = [
  /\b\d+d\d+\s+(?:\w+\s+){0,2}damage\b/i,
  new RegExp(`\\b(?:${DAMAGE_TYPES.join('|')}) damage\\b`, 'i'),
  /\b\d+[кd]\d+\b[^.]{0,30}урон|урон[^.]{0,20}\b\d+[кd]\d+/i,
];
const CONTROL = [
  /\b(?:be|is|are|becomes?|fall|falls|knocked|knock|left)\s+(?:\w+\s+)?(?:charmed|frightened|paralyzed|restrained|stunned|incapacitated|prone|blinded|deafened|petrified|unconscious)\b/i,
  /\bdifficult terrain\b|\bfollow the command\b|\bbanish\w*\b|\bspeed (?:is|becomes) 0\b/i,
  /очарован|испуган|парализован|опутан|ошеломл|недееспособ|сбит\S* с ног|ничком|ослепл|оглох|окамене|без сознания|труднопроходим|изгна/i,
];
const PROTECTION = [
  /\bAC\b|\barmor class\b|\bresistance to\b|\bimmun\w* to\b|\bward(?:s|ed)?\b|\bprotect\w*\b|\btemporary hit points\b|\bhit point maximum\b/i,
  /\binterrupt a creature in the process of casting\b|\bspell fails\b/i,
  /(?<![а-яё])КД(?![а-яё])|класс доспеха|сопротивлени\S* к|иммунитет|защищ|временн\S* хит/i,
];
const MOVEMENT = [
  /\bteleport\w*\b|\bflying speed\b|\bfly speed\b|\bclimbing speed\b|\bswimming speed\b|\bspeed increases\b|\bspeed is doubled\b|\bjump distance\b|\blevitat\w*\b|\bwater walk\b|\bacross vertical surfaces\b|\bplane shift\b|\bthe Dash action\b/i,
  /телепорт|скорост\S* полёта|скорост\S* лазания|скорость (?:увеличива|удваива)|прыж|левитац/i,
];

function textOf(spell: PurposeSource): string {
  return `${spell.desc ?? ''}\n${spell.descRu ?? ''}`;
}

export function spellPurposes(spell: PurposeSource): SpellPurpose[] {
  const text = textOf(spell);
  const mechanics = spell.mechanics ?? null;
  const found = new Set<SpellPurpose>();
  if (spell.healingFormula || mechanics?.healingFormula || HEAL.some(pattern => pattern.test(text)) || HEAL_NAME.test(spell.name ?? '')) found.add('heal');
  if (spell.damageFormula || mechanics?.damageFormula || mechanics?.attack || DAMAGE.some(pattern => pattern.test(text))) found.add('damage');
  if (mechanics?.condition || CONTROL.some(pattern => pattern.test(text))) found.add('control');
  if (PROTECTION.some(pattern => pattern.test(text))) found.add('protection');
  if (MOVEMENT.some(pattern => pattern.test(text))) found.add('movement');
  if (found.has('heal') && found.has('control') && !mechanics?.condition && /\bend (?:either )?one disease|\bcondition afflicting\b|снима/i.test(text)) found.delete('control');
  return found.size ? [...found] : ['utility'];
}

export function spellDamageTypes(spell: PurposeSource): DamageType[] {
  const found = new Set<DamageType>();
  const own = spell.mechanics?.damageType;
  if (own && (DAMAGE_TYPES as readonly string[]).includes(own)) found.add(own as DamageType);
  const english = spell.desc ?? '';
  for (const type of DAMAGE_TYPES) if (new RegExp(`\\b${type} damage\\b`, 'i').test(english)) found.add(type);
  const russian = spell.descRu ?? '';
  if (/урон/i.test(russian)) for (const type of DAMAGE_TYPES) if (DAMAGE_RU[type].test(russian)) found.add(type);
  return [...found];
}

export type CastingUse = 'action' | 'bonus' | 'reaction' | 'long';
export function castingUse(castingTime: string | null | undefined): CastingUse {
  const text = (castingTime ?? '').toLowerCase();
  if (/bonus|бонусн/.test(text)) return 'bonus';
  if (/reaction|реакци/.test(text)) return 'reaction';
  if (/minute|hour|минут|час/.test(text)) return 'long';
  return 'action';
}
export const CASTING_USE_LABELS: Record<CastingUse, string> = {
  action: 'Действие', bonus: 'Бонусное действие', reaction: 'Реакция', long: 'Вне боя — дольше раунда',
};
