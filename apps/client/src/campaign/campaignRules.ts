export const RULE_KINDS = ['flag', 'number', 'formula', 'text'] as const;
export type RuleKind = typeof RULE_KINDS[number];

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  flag: 'Флаг (включено/выключено)',
  number: 'Число',
  formula: 'Формула броска',
  text: 'Текст',
};

export const RULE_KIND_HINTS: Record<RuleKind, string> = {
  flag: 'Переключатель: правило действует или нет.',
  number: 'Число — например, множитель или предел.',
  formula: 'Кости и слагаемые через «+» или «−»: числа и переменные листа (@str … @cha — модификаторы характеристик, @prof — бонус мастерства). Например: 2d6+3, 1d20+@dex+@prof.',
  text: 'Свободное описание правила, если оно не сводится к числу или флагу.',
};

export const KEY_HINT = 'Служебное имя: латинские буквы, цифры и «_», первая — буква (например, flanking). После создания не меняется.';

export const KNOWN_FLAGS: Array<{ key: string; label: string; description: string; enabled: boolean }> = [
  { key: 'auto_damage', label: 'Урон оружием сам', description: 'Попадание оружием по цели само бросает и применяет урон.', enabled: true },
  { key: 'crit_doubles_dice', label: 'Крит удваивает кости', description: 'При критическом попадании кости урона бросаются дважды.', enabled: true },
  { key: 'movement_limit', label: 'Скорость за ход', description: 'В бою двигаться можно только в свой ход и не дальше скорости.', enabled: true },
  { key: 'group_turns', label: 'Групповой ход', description: 'Союзники, идущие в очереди инициативы подряд, ходят одновременно (и враги подряд — тоже).', enabled: true },
  { key: 'gm_free_move', label: 'Мастер действует свободно', description: 'В бою мастер переставляет фигуры и действует ими вне очереди, дальше скорости и сверх действий хода (толчок, телепорт, легендарные действия, логово). Выключено — мастер тоже ходит и действует по правилам.', enabled: false },
  { key: 'party_vision', label: 'Обзор отряда', description: 'Игроки видят то, что видит любой персонаж отряда и союзный НПС.', enabled: true },
  { key: 'one_per_cell', label: 'Одно существо на клетку', description: 'Персонаж или НПС не может закончить движение в клетке другого существа.', enabled: true },
  { key: 'hostile_blocks', label: 'Сквозь врагов не пройти', description: 'Сквозь клетку враждебного существа не пройти, если оно не больше и не меньше на два размера; сквозь союзника и нейтрала — можно.', enabled: true },
  { key: 'reach_limit', label: 'Дальность оружия и заклинаний', description: 'Дальше дистанции по цели не ударить.', enabled: true },
  { key: 'action_economy', label: 'Экономия действий', description: 'Действие, бонусное действие и реакция на ход.', enabled: true },
  { key: 'cover', label: 'Укрытие', description: 'Стены и существа между атакующим и целью повышают её КД.', enabled: true },
  { key: 'opportunity_attacks', label: 'Атаки при уходе', description: 'Уход из досягаемости врага без «Отхода» даёт ему атаку реакцией.', enabled: true },
  { key: 'auto_level', label: 'Новый уровень сам', description: 'Достиг порога опыта — уровень и хиты растут сами (у НПС; у героев — если окно нового уровня выключено).', enabled: true },
  { key: 'long_rest_daily', label: 'Долгий отдых раз в сутки', description: 'Следующий долгий отдых даёт пользу не раньше чем через 24 часа по часам кампании (отдых отряда сам двигает часы на 8 часов).', enabled: true },
  { key: 'level_choices', label: 'Окно нового уровня', description: 'Герой игрока поднимает уровень сам, выбирая хиты (бросок или среднее), улучшение характеристик или черту, новые заклинания.', enabled: true },
  { key: 'diagonal_5_10_5', label: 'Диагонали 5-10-5', description: 'Каждая вторая диагональ стоит две клетки (дополнительное правило).', enabled: false },
  { key: 'spell_targets', label: 'Цели заклинаний по тексту', description: '«Гуманоид, которого вы видите», «зверь», «не действует на нежить и конструктов» — заклинание не сотворить на неподходящую цель.', enabled: true },
  { key: 'flanking', label: 'Фланкирование', description: 'Атакующий и союзник вплотную к цели с разных её сторон — рукопашной атаке преимущество (дополнительное правило).', enabled: false },
  { key: 'auto_legendary', label: 'Легендарные действия сами', description: 'В конце хода героя босс сам тратит лучшее легендарное действие-атаку по тому, до кого достаёт (бьёт закончившего ход, если может). «Перемещение» и прочее — мастером.', enabled: true },
  { key: 'npc_opportunity', label: 'НПС бьют при уходе сами', description: 'Герой уходит из досягаемости НПС без «Отхода» — НПС сам бьёт реакцией лучшим рукопашным оружием, без кнопки мастера. Персонажам игроков — вопрос, как раньше.', enabled: true },
  { key: 'spell_effects', label: 'Эффекты заклинаний по тексту', description: 'Лучи, стрелы и заряды — каждый своей цели; замедление, «без реакций», «не лечится», подсветка, насмешка, «Благословение» и «Порча», «Метка охотника», «Огонь фей», отбрасывание, запас хитов «Усыпления» — из текста SRD.', enabled: true },
];

export const KNOWN_CHOICES: Array<{ key: string; label: string; description: string; options: Array<{ value: string; label: string }>; default: string }> = [
  {
    key: 'pact_slots',
    label: 'Ячейки договора при мультиклассе',
    description: 'Колдун-мультикласс с другим заклинателем: ячейки договора возвращаются на коротком отдыхе, остальные — на долгом.',
    options: [
      { value: 'merged', label: 'Общие с остальными (приближённо): короткий отдых возвращает на уровне договора не больше их числа' },
      { value: 'separate', label: 'Отдельно: свой счётчик, при сотворении выбирается, какую ячейку тратить' },
      { value: 'manual', label: 'Вручную: ячейки такого персонажа автоматика не считает' },
    ],
    default: 'merged',
  },
  {
    key: 'bardic_saves',
    label: 'Кость барда на спасбросок, что бросает сервер',
    description: 'Спасбросок против заклинания, ловушки, концентрации бросает сервер — когда тратить кость «Вдохновения барда».',
    options: [
      { value: 'auto', label: 'Сама: при провале, если кость может закрыть недостачу' },
      { value: 'manual', label: 'Только вручную: переключатель «Кость» перед своим броском' },
    ],
    default: 'auto',
  },
  {
    key: 'legendary_resistance',
    label: 'Легендарное сопротивление боссов',
    description: 'Босс провалил спасбросок, что бросает сервер (MM, с. 11): тратить ли сразу одно из «Легендарных сопротивлений» в день (число — в настройках босса).',
    options: [
      { value: 'auto', label: 'Само: любой провал становится успехом, пока есть заряды' },
      { value: 'manual', label: 'Вручную: мастер сам решает и тратит ресурс в листе' },
    ],
    default: 'auto',
  },
  {
    key: 'save_rerolls',
    label: 'Переброс проваленного спасброска',
    description: '«Упорный» воина 9 и «Алмазная душа» монаха 14: спасбросок, что бросает сервер, провален — перебрасывать ли сразу, тратя заряд «Упорного» или 1 ци.',
    options: [
      { value: 'auto', label: 'Само: любой провал перебрасывается, пока есть заряды (новый результат обязателен)' },
      { value: 'manual', label: 'Вручную: игрок и мастер решают сами, заряд тратится в листе' },
    ],
    default: 'auto',
  },
  {
    key: 'natural_checks',
    label: 'Натуральные 20 и 1 на проверках и спасбросках',
    description: 'У атаки натуральная 20 — всегда попадание (крит), 1 — всегда промах. У проверок и спасбросков, что бросает сервер против СЛ (заклинания, ловушки, скрытность), — по выбору.',
    options: [
      { value: 'rules', label: 'По основным правилам: решает итог с модификаторами; 20 и 1 только выделены' },
      { value: 'auto', label: 'Домашнее: 20 — успех, 1 — провал, без модификаторов' },
    ],
    default: 'rules',
  },
  {
    key: 'rest_interruption',
    label: 'Что срывает привал',
    description: 'Привал отряда (отдых, который длится): бой на сцене срывает короткий; долгий — по выбору.',
    options: [
      { value: 'raw', label: 'По основным правилам: долгий — только час напряжённого (бой дольше часа, «Прервать» мастером)' },
      { value: 'any', label: 'Строже: любой бой срывает и долгий отдых' },
    ],
    default: 'raw',
  },
];

export function knownChoice(key: string) {
  return KNOWN_CHOICES.find(choice => choice.key === key) ?? null;
}

export type CampaignRule = {
  id: string;
  key: string;
  kind: RuleKind;
  label: string;
  description: string;
  value: boolean | number | string;
  revision: number;
  updated_at: string;
  updated_by_name: string;
};

type RequestFn = (path: string, method?: string, body?: unknown) => Promise<any>;

export async function loadRules(request: RequestFn, campaignId: string): Promise<{ canManage: boolean; rules: CampaignRule[] }> {
  return request(`/campaigns/${campaignId}/rules`);
}

export function createRule(
  request: RequestFn,
  campaignId: string,
  input: { key: string; kind: RuleKind; label: string; description?: string; value: unknown },
): Promise<CampaignRule> {
  return request(`/campaigns/${campaignId}/rules`, 'POST', input);
}

export function updateRule(
  request: RequestFn,
  campaignId: string,
  ruleId: string,
  input: { label: string; description?: string; value: unknown; revision: number },
): Promise<CampaignRule> {
  return request(`/campaigns/${campaignId}/rules/${ruleId}`, 'PUT', input);
}

export function deleteRule(request: RequestFn, campaignId: string, ruleId: string): Promise<void> {
  return request(`/campaigns/${campaignId}/rules/${ruleId}`, 'DELETE');
}

const FORMULA_TOKENS = ['str', 'dex', 'con', 'int', 'wis', 'cha', 'prof'];
const FORMULA_SHAPE_PATTERN = /^([1-9][0-9]?)d([1-9][0-9]{0,2})((?:[+-](?:[0-9]{1,3}|@[a-z]+))*)$/i;
const FORMULA_TERM_PATTERN = /[+-](?:[0-9]{1,3}|@([a-z]+))/gi;

export function isValidFormula(value: string): boolean {
  const match = FORMULA_SHAPE_PATTERN.exec(value.trim());
  if (!match) return false;

  for (const term of match[3]!.matchAll(FORMULA_TERM_PATTERN)) {
    const token = term[1];
    if (token !== undefined && !FORMULA_TOKENS.includes(token.toLowerCase())) return false;
  }

  return true;
}

export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
