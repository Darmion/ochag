export type RuleSort = 'topic' | 'label-asc' | 'label-desc' | 'kind' | 'key' | 'updated';
export type RuleTopic = 'combat' | 'movement' | 'magic' | 'recovery' | 'characters' | 'exploration' | 'other';
export type TopicFilter = 'all' | RuleTopic;
export const RULE_TOPICS: Array<{ id: RuleTopic; label: string; hint: string }> = [
  { id: 'combat', label: 'Бой и урон', hint: 'Атаки, защита, действия, реакции и спасброски' },
  { id: 'movement', label: 'Перемещение', hint: 'Скорость, клетки, дистанции и препятствия' },
  { id: 'magic', label: 'Магия', hint: 'Заклинания, ячейки и магические эффекты' },
  { id: 'recovery', label: 'Отдых и восстановление', hint: 'Привалы, отдых и восстановление ресурсов' },
  { id: 'characters', label: 'Персонажи и развитие', hint: 'Уровни, опыт, классы и способности' },
  { id: 'exploration', label: 'Обзор и исследование', hint: 'Зрение, скрытность, свет и исследование мира' },
  { id: 'other', label: 'Прочее', hint: 'Пользовательские правила без определённого раздела' },
];
const KNOWN_RULE_TOPICS: Record<string, RuleTopic> = {
  auto_damage: 'combat', crit_doubles_dice: 'combat', group_turns: 'combat', gm_free_move: 'combat',
  reach_limit: 'combat', action_economy: 'combat', cover: 'combat', opportunity_attacks: 'combat',
  flanking: 'combat', auto_legendary: 'combat', npc_opportunity: 'combat', bardic_saves: 'combat',
  legendary_resistance: 'combat', save_rerolls: 'combat', natural_checks: 'combat',
  movement_limit: 'movement', one_per_cell: 'movement', hostile_blocks: 'movement', diagonal_5_10_5: 'movement',
  spell_targets: 'magic', spell_effects: 'magic', pact_slots: 'magic',
  long_rest_daily: 'recovery', rest_interruption: 'recovery',
  auto_level: 'characters', level_choices: 'characters',
  party_vision: 'exploration',
};

export function normalizeSearch(value: unknown) {
  return String(value ?? '').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

export function ruleTopic(key: string, label = '', description = ''): RuleTopic {
  const known = KNOWN_RULE_TOPICS[key];
  if (known) return known;
  const source = normalizeSearch(`${key} ${label} ${description}`);
  if (/spell|magic|pact|заклин|маг|ячейк|колдун|ритуал/.test(source)) return 'magic';
  if (/rest|recharg|отдых|привал|восстанов/.test(source)) return 'recovery';
  if (/movement|speed|diagonal|cell|перемещ|движ|скорост|клетк|дистанц/.test(source)) return 'movement';
  if (/vision|sight|stealth|light|обзор|зрени|скрыт|освещ|исслед/.test(source)) return 'exploration';
  if (/level|experience|class|feat|proficien|уров|опыт|класс|черт|мастерств/.test(source)) return 'characters';
  if (/attack|damage|crit|combat|initiative|action|reaction|save|armor|weapon|атак|урон|крит|бой|инициатив|действ|реакц|спас|оруж|брон/.test(source)) return 'combat';
  return 'other';
}

const topicOrder = new Map(RULE_TOPICS.map((topic, index) => [topic.id, index]));
export const topicLabel = (topic: RuleTopic) => RULE_TOPICS.find(entry => entry.id === topic)?.label ?? 'Прочее';
export const compareLabels = (left: string, right: string) => left.localeCompare(right, 'ru', { sensitivity: 'base' });
export const compareTopics = (left: RuleTopic, right: RuleTopic) => (topicOrder.get(left) ?? 99) - (topicOrder.get(right) ?? 99);
