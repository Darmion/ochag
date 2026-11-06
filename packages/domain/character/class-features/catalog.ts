import type { ClassId } from '../classes.ts';

export type FeatureId =
  | 'rage' | 'second-wind' | 'action-surge' | 'cunning-action' | 'sneak-attack' | 'divine-smite'
  | 'bardic-inspiration' | 'turn-undead' | 'sacred-weapon' | 'unarmored-defense' | 'unarmored-defense-monk'
  | 'flurry-of-blows' | 'patient-defense' | 'step-of-the-wind' | 'lay-on-hands' | 'wild-shape' | 'protection-style'
  | 'stunning-strike' | 'deflect-missiles'
  | 'improved-critical' | 'uncanny-dodge' | 'evasion' | 'evasion-monk' | 'eldritch-invocations'
  | 'reckless-attack' | 'danger-sense' | 'aura-of-protection' | 'metamagic' | 'arcane-recovery'
  | 'disciple-of-life' | 'preserve-life' | 'combat-superiority' | 'hunters-prey'
  | 'sculpt-spells' | 'dark-ones-blessing' | 'elemental-affinity' | 'cutting-words'
  | 'open-hand-technique' | 'frenzy' | 'turn-the-unholy' | 'natural-recovery' | 'blessed-healer' | 'empowered-evocation'
  | 'mindless-rage' | 'aura-of-devotion' | 'wholeness-of-body' | 'dark-ones-own-luck' | 'divine-strike'
  | 'aura-of-courage' | 'improved-divine-smite' | 'brutal-critical' | 'relentless-rage' | 'reliable-talent'
  | 'stillness-of-mind' | 'purity-of-body'
  | 'indomitable' | 'diamond-soul' | 'fast-movement' | 'unarmored-movement' | 'feral-instinct' | 'jack-of-all-trades'
  | 'remarkable-athlete' | 'slippery-mind' | 'elusive' | 'song-of-rest' | 'survivor' | 'indomitable-might' | 'cleansing-touch'
  | 'stroke-of-luck' | 'divine-intervention'
  | 'vanish' | 'feral-senses' | 'mystic-arcanum' | 'spell-mastery' | 'signature-spells' | 'sorcerous-restoration'
  | 'hide-in-plain-sight' | 'blindsense' | 'beast-spells'
  | 'superior-inspiration' | 'perfect-self' | 'eldritch-master' | 'persistent-rage' | 'primal-champion'
  | 'draconic-resilience' | 'potent-cantrip' | 'overchannel' | 'fiendish-resilience' | 'supreme-healing'
  | 'defensive-tactics' | 'hunter-multiattack' | 'slow-fall'
  | 'retaliation' | 'superior-hunters-defense' | 'empty-body' | 'quivering-palm' | 'hurl-through-hell' | 'holy-nimbus'
  | 'lands-stride' | 'lands-stride-ranger' | 'dragon-wings' | 'peerless-skill'
  | 'countercharm' | 'flexible-casting' | 'archdruid' | 'supreme-sneak' | 'tranquility' | 'favored-enemy' | 'foe-slayer'
  | 'intimidating-presence' | 'draconic-presence' | 'purity-of-spirit' | 'natures-ward' | 'natures-sanctuary' | 'thiefs-reflexes';

export type ClassFeature = {
  id: FeatureId;
  classId: ClassId;
  level: number;
  name: string;
  resource: string | null;
  use: 'bonus' | 'action' | 'free' | 'passive';
  text: string;
  subclass?: string;
};

export const CLASS_FEATURE_LIST: ClassFeature[] = [
  {
    id: 'rage', classId: 'barbarian', level: 1, name: 'Ярость', resource: 'Ярость', use: 'bonus',
    text: 'Бонусным действием на минуту (10 раундов): прибавка к урону рукопашным оружием на Силе, сопротивление дробящему, колющему и рубящему урону, преимущество в проверках и спасбросках Силы. В ярости нельзя колдовать и концентрироваться. Кончается раньше, если ваш ход кончился, а с прошлого хода вы не атаковали и не получали урона.',
  },
  {
    id: 'second-wind', classId: 'fighter', level: 1, name: 'Второе дыхание', resource: 'Второе дыхание', use: 'bonus',
    text: 'Бонусным действием восстановить 1d10 + уровень воина хитов. Раз до короткого отдыха.',
  },
  {
    id: 'action-surge', classId: 'fighter', level: 2, name: 'Всплеск действий', resource: 'Всплеск действий', use: 'free',
    text: 'В свой ход — ещё одно действие. Раз до короткого отдыха (с 17-го уровня — два раза, но не больше раза за ход).',
  },
  {
    id: 'cunning-action', classId: 'rogue', level: 2, name: 'Хитрое действие', resource: null, use: 'bonus',
    text: 'Рывок, Отход или «Спрятаться» бонусным действием.',
  },
  {
    id: 'sneak-attack', classId: 'rogue', level: 1, name: 'Скрытая атака', resource: null, use: 'passive',
    text: 'Раз в ход — дополнительные кости урона атакой фехтовальным или дальнобойным оружием с преимуществом. Без преимущества — если в 5 футах от цели ваш союзник в силах действовать, а помехи нет.',
  },
  {
    id: 'divine-smite', classId: 'paladin', level: 2, name: 'Божественная кара', resource: null, use: 'passive',
    text: 'Попав рукопашным оружием, можно потратить ячейку: 2d8 урона излучением за ячейку 1-го уровня и 1d8 за каждый уровень выше (не больше 5d8); нежити и исчадиям — ещё 1d8.',
  },
  {
    id: 'bardic-inspiration', classId: 'bard', level: 1, name: 'Вдохновение барда', resource: 'Вдохновение барда', use: 'bonus',
    text: 'Бонусным действием — кость вдохновения существу в 60 футах, кроме себя (к6; к8 с 5-го уровня, к10 с 10-го, к12 с 15-го). В течение 10 минут оно может прибавить её к одной проверке, броску атаки или спасброску. Одна кость на существо.',
  },
  {
    id: 'turn-undead', classId: 'cleric', level: 2, name: 'Божественный канал: Изгнание нежити', resource: 'Божественный канал', use: 'action',
    text: 'Действием: каждая нежить в 30 футах — спасбросок Мудрости против СЛ ваших заклинаний; провал — изгнана на минуту (бежит, без реакций; урон снимает). С 5-го уровня слабая нежить сразу уничтожена (опасность 1/2; 1 — с 8-го, 2 — с 11-го, 3 — с 14-го, 4 — с 17-го).',
  },
  {
    id: 'sacred-weapon', classId: 'paladin', level: 3, subclass: 'devotion', name: 'Божественный канал: Священное оружие', resource: 'Божественный канал', use: 'action',
    text: 'Действием на минуту: к броскам атаки оружием — модификатор Харизмы (не меньше +1).',
  },
  {
    id: 'flurry-of-blows', classId: 'monk', level: 2, name: 'Шквал ударов', resource: 'Ци', use: 'bonus',
    text: 'После действия «Атака» — за 1 очко ци бонусным действием два безоружных удара (кость боевых искусств: к4, к6 с 5-го, к8 с 11-го, к10 с 17-го уровня).',
  },
  {
    id: 'patient-defense', classId: 'monk', level: 2, name: 'Терпеливая защита', resource: 'Ци', use: 'bonus',
    text: 'За 1 очко ци бонусным действием — «Уклонение».',
  },
  {
    id: 'step-of-the-wind', classId: 'monk', level: 2, name: 'Шаг ветра', resource: 'Ци', use: 'bonus',
    text: 'За 1 очко ци бонусным действием — «Отход» или «Рывок».',
  },
  {
    id: 'improved-critical', classId: 'fighter', level: 3, subclass: 'champion', name: 'Чемпион: Улучшенный критический удар', resource: null, use: 'passive',
    text: 'Атаки оружием — крит на 19–20 (с 15-го уровня — «Превосходный критический удар», 18–20).',
  },
  {
    id: 'uncanny-dodge', classId: 'rogue', level: 5, name: 'Невероятное уклонение', resource: null, use: 'passive',
    text: 'Попал атакующий, которого вы видите, — реакцией урон этой атаки вдвое меньше. «Наготове» — само, без вопроса.',
  },
  {
    id: 'evasion', classId: 'rogue', level: 7, name: 'Увёртливость', resource: null, use: 'passive',
    text: 'Спасбросок Ловкости против эффекта «половина урона при успехе»: успех — без урона, провал — половина. Само.',
  },
  {
    id: 'evasion-monk', classId: 'monk', level: 7, name: 'Увёртливость', resource: null, use: 'passive',
    text: 'Спасбросок Ловкости против эффекта «половина урона при успехе»: успех — без урона, провал — половина. Само.',
  },
  {
    id: 'eldritch-invocations', classId: 'warlock', level: 2, name: 'Таинственные воззвания', resource: null, use: 'passive',
    text: 'Отметьте выбранные: «Мучительный взрыв» — к урону каждого заряда «Мистического заряда» модификатор Харизмы; «Отталкивающий взрыв» — попавший заряд отбрасывает цель на 10 футов.',
  },
  {
    id: 'deflect-missiles', classId: 'monk', level: 3, name: 'Отражение снарядов', resource: null, use: 'passive',
    text: 'Попадание дальнобойным оружием — реакцией урон меньше на 1d10 + Ловкость + уровень монаха. «Наготове» — само, без вопроса.',
  },
  {
    id: 'stunning-strike', classId: 'monk', level: 5, name: 'Ошеломляющий удар', resource: 'Ци', use: 'passive',
    text: 'Попав рукопашной атакой, за 1 очко ци: цель — спасбросок Телосложения против СЛ ци (8 + мастерство + Мудрость), провал — ошеломлена до конца вашего следующего хода.',
  },
  {
    id: 'lay-on-hands', classId: 'paladin', level: 1, name: 'Наложение рук', resource: 'Наложение рук', use: 'action',
    text: 'Действием, касанием — вернуть хиты из запаса (5 × уровень паладина за долгий отдых) или за 5 из запаса снять болезнь или яд. Не действует на нежить и конструктов.',
  },
  {
    id: 'wild-shape', classId: 'druid', level: 2, name: 'Дикий облик', resource: 'Дикий облик', use: 'action',
    text: 'Действием — облик зверя из бестиария (опасность до 1/4, без полёта и плавания; до 1/2 с 4-го уровня, до 1 с 8-го): его хиты, КД, скорость, Сила, Ловкость, Телосложение и атаки; хиты зверя на 0 — снова в себе, лишний урон переходит. Колдовать нельзя. Два раза до короткого отдыха.',
  },
  {
    id: 'reckless-attack', classId: 'barbarian', level: 2, name: 'Безрассудная атака', resource: null, use: 'free',
    text: 'Перед первой атакой своего хода: рукопашные атаки Силой в этот ход — с преимуществом, атаки по вам — с преимуществом до начала вашего следующего хода.',
  },
  {
    id: 'danger-sense', classId: 'barbarian', level: 2, name: 'Опасное чутьё', resource: null, use: 'passive',
    text: 'Спасброски Ловкости — с преимуществом (ловушки, заклинания, дыхание), если вы не ослеплены, не оглохли и в силах действовать. Само.',
  },
  {
    id: 'aura-of-protection', classId: 'paladin', level: 6, name: 'Аура защиты', resource: null, use: 'passive',
    text: 'Вы и союзники в 10 футах (с 18-го уровня — в 30) — +модификатор Харизмы (не меньше +1) ко всем спасброскам, пока вы в силах действовать. Само.',
  },
  {
    id: 'metamagic', classId: 'sorcerer', level: 3, name: 'Метамагия', resource: 'Очки чародейства', use: 'passive',
    text: 'Отметьте выбранные; в окне сотворения — «Ускоренное заклинание» (2 очка: заклинание действием — бонусным) или «Удвоенное заклинание» (очки по уровню ячейки, заговор — 1: заклинание на одно существо — на второе).',
  },
  {
    id: 'arcane-recovery', classId: 'wizard', level: 1, name: 'Арканное восстановление', resource: 'Арканное восстановление', use: 'free',
    text: 'Вне боя, раз до долгого отдыха (лучше — после короткого): вернуть потраченные ячейки суммой уровней до половины уровня волшебника (округляя вверх), не выше 5-го.',
  },
  {
    id: 'disciple-of-life', classId: 'cleric', level: 1, subclass: 'life', name: 'Домен Жизни: Последователь жизни', resource: null, use: 'passive',
    text: 'Заклинание 1-го уровня и выше, восстанавливающее хиты, лечит каждого ещё на 2 + уровень ячейки. Само.',
  },
  {
    id: 'preserve-life', classId: 'cleric', level: 2, subclass: 'life', name: 'Божественный канал: Сохранение жизни', resource: 'Божественный канал', use: 'action',
    text: 'Действием: 5 × уровень жреца хитов поделить между существами в 30 футах — каждому не выше половины его максимума. Нежить и конструкты — нет.',
  },
  {
    id: 'combat-superiority', classId: 'fighter', level: 3, subclass: 'battle-master', name: 'Мастер боевых искусств: Боевое превосходство', resource: 'Кости превосходства', use: 'passive',
    text: 'Отметьте приёмы; попав оружием — кнопка приёма: кость превосходства (к8; к10 с 10-го, к12 с 18-го уровня) к урону и эффект — «Атака с подсечкой» (сбить с ног), «Толкающая атака» (на 15 фт.), «Угрожающая атака» (испуг), «Отвлекающий удар» (следующая атака другого — с преимуществом). Спасбросок — против СЛ 8 + мастерство + СИЛ или ЛОВ. Кости — до короткого отдыха.',
  },
  {
    id: 'hunters-prey', classId: 'ranger', level: 3, subclass: 'hunter', name: 'Охотник: Добыча охотника', resource: null, use: 'passive',
    text: 'Выберите: «Убийца колоссов» — раз в ход +1d8 урона оружием по существу, у которого хиты не полны (само); «Убийца великанов» и «Сокрушитель орд» — вручную.',
  },
  {
    id: 'sculpt-spells', classId: 'wizard', level: 2, subclass: 'evocation', name: 'Школа Воплощения: Ваяние заклинаний', resource: null, use: 'passive',
    text: 'Своё заклинание воплощения по области: свои задетые (до 1 + уровень заклинания) спасаются сами, а где успех — половина урона, не получают ничего. Само.',
  },
  {
    id: 'dark-ones-blessing', classId: 'warlock', level: 1, subclass: 'fiend', name: 'Исчадие: Тёмное благословение', resource: null, use: 'passive',
    text: 'Опустили хиты враждебного существа до 0 — временные хиты: ХАР + уровень колдуна (не меньше 1). Само.',
  },
  {
    id: 'elemental-affinity', classId: 'sorcerer', level: 6, subclass: 'draconic', name: 'Драконья кровь: Стихийная сродность', resource: null, use: 'passive',
    text: 'Заклинание с уроном вида вашего предка — +ХАР к одному его броску урона. Предок — из создания персонажа или выбором здесь.',
  },
  {
    id: 'cutting-words', classId: 'bard', level: 3, subclass: 'lore', name: 'Коллегия знаний: Острое словцо', resource: 'Вдохновение барда', use: 'passive',
    text: 'Существо, которое вы видите в 60 футах, атакует — реакцией кость вдохновения вычитается из броска. «Наготове» — само: только когда это может отвести попадание по своему.',
  },
  {
    id: 'open-hand-technique', classId: 'monk', level: 3, subclass: 'open-hand', name: 'Путь открытой ладони: Техника открытой ладони', resource: null, use: 'passive',
    text: 'Попав ударом «Шквала ударов» — на выбор: спасбросок ЛОВ или сбит с ног; СИЛ или отброшен на 15 фт.; без реакций до конца вашего следующего хода. СЛ — как у ци.',
  },
  {
    id: 'frenzy', classId: 'barbarian', level: 3, subclass: 'berserker', name: 'Путь берсерка: Бешенство', resource: null, use: 'bonus',
    text: 'Впадая в ярость — можно в бешенство: в каждый следующий ход ярости — бонусным действием одна рукопашная атака оружием. Ярость кончилась — уровень истощения.',
  },
  {
    id: 'turn-the-unholy', classId: 'paladin', level: 3, subclass: 'devotion', name: 'Божественный канал: Изгнание нечестивых', resource: 'Божественный канал', use: 'action',
    text: 'Действием: каждое исчадие и нежить в 30 футах — спасбросок Мудрости против СЛ ваших заклинаний; провал — изгнаны на минуту (бегут, без реакций; урон снимает).',
  },
  {
    id: 'natural-recovery', classId: 'druid', level: 2, subclass: 'land', name: 'Круг Земли: Природное восстановление', resource: 'Природное восстановление', use: 'free',
    text: 'Вне боя, раз до долгого отдыха (лучше — после короткого): вернуть потраченные ячейки суммой уровней до половины уровня друида (округляя вверх), не выше 5-го.',
  },
  {
    id: 'blessed-healer', classId: 'cleric', level: 6, subclass: 'life', name: 'Домен Жизни: Благословенный целитель', resource: null, use: 'passive',
    text: 'Лечите заклинанием 1-го уровня и выше другого — сами восстанавливаете 2 + уровень ячейки хитов. Само.',
  },
  {
    id: 'empowered-evocation', classId: 'wizard', level: 10, subclass: 'evocation', name: 'Школа Воплощения: Усиленное воплощение', resource: null, use: 'passive',
    text: 'К одному броску урона вашего заклинания воплощения — модификатор Интеллекта. Само.',
  },
  {
    id: 'mindless-rage', classId: 'barbarian', level: 6, subclass: 'berserker', name: 'Путь берсерка: Бездумная ярость', resource: null, use: 'passive',
    text: 'В ярости вас нельзя очаровать или испугать; очарование и испуг, что были до ярости, приостановлены до её конца. Само.',
  },
  {
    id: 'aura-of-devotion', classId: 'paladin', level: 7, subclass: 'devotion', name: 'Клятва преданности: Аура преданности', resource: null, use: 'passive',
    text: 'Вас и союзников в 10 футах (с 18-го уровня — в 30) нельзя очаровать, пока вы в силах действовать. Само.',
  },
  {
    id: 'wholeness-of-body', classId: 'monk', level: 6, subclass: 'open-hand', name: 'Путь открытой ладони: Цельность тела', resource: 'Цельность тела', use: 'action',
    text: 'Действием восстановить хиты: 3 × уровень монаха. Раз до долгого отдыха.',
  },
  {
    id: 'dark-ones-own-luck', classId: 'warlock', level: 6, subclass: 'fiend', name: 'Исчадие: Удача тёмного', resource: 'Удача тёмного', use: 'passive',
    text: 'Проверка характеристики или спасбросок против СЛ провалены, а к10 может спасти, — кость прибавляется сама. Раз до короткого отдыха.',
  },
  {
    id: 'divine-strike', classId: 'cleric', level: 8, subclass: 'life', name: 'Домен Жизни: Божественный удар', resource: null, use: 'passive',
    text: 'Раз в свой ход, попав атакой оружием, — ещё 1d8 урона излучением (с 14-го уровня — 2d8). Само.',
  },
  {
    id: 'aura-of-courage', classId: 'paladin', level: 10, name: 'Аура отваги', resource: null, use: 'passive',
    text: 'Вас и союзников в 10 футах (с 18-го уровня — в 30) нельзя испугать, пока вы в силах действовать. Само.',
  },
  {
    id: 'improved-divine-smite', classId: 'paladin', level: 11, name: 'Улучшенная божественная кара', resource: null, use: 'passive',
    text: 'Каждое попадание рукопашным оружием — ещё 1d8 урона излучением (крит — 2d8). Само.',
  },
  {
    id: 'brutal-critical', classId: 'barbarian', level: 9, name: 'Сокрушительный критический удар', resource: null, use: 'passive',
    text: 'Критическое попадание рукопашным оружием — ещё одна кость урона оружия (с 13-го уровня — две, с 17-го — три). Само.',
  },
  {
    id: 'relentless-rage', classId: 'barbarian', level: 11, name: 'Непреклонная ярость', resource: null, use: 'passive',
    text: 'В ярости хиты упали до 0, но не убит сразу — спасбросок Телосложения СЛ 10 (+5 за каждый следующий раз до отдыха): успех — 1 хит. Само.',
  },
  {
    id: 'reliable-talent', classId: 'rogue', level: 11, name: 'Надёжный талант', resource: null, use: 'passive',
    text: 'Проверка навыка, которым вы владеете: к20 меньше 10 считается 10. Само.',
  },
  {
    id: 'stillness-of-mind', classId: 'monk', level: 7, name: 'Спокойствие разума', resource: null, use: 'action',
    text: 'Действием — закончить на себе очарование или испуг.',
  },
  {
    id: 'purity-of-body', classId: 'monk', level: 10, name: 'Чистота тела', resource: null, use: 'passive',
    text: 'Иммунитет к болезням и яду: урон ядом не проходит, «отравлен» не накладывается. Само.',
  },
  {
    id: 'unarmored-movement', classId: 'monk', level: 2, name: 'Движение без доспехов', resource: null, use: 'passive',
    text: 'Без доспеха и щита скорость больше на 10 футов (с 6-го — на 15, с 10-го — на 20, с 14-го — на 25, с 18-го — на 30). Само.',
  },
  {
    id: 'diamond-soul', classId: 'monk', level: 14, name: 'Алмазная душа', resource: 'Ци', use: 'passive',
    text: 'Владение всеми спасбросками; проваленный спасбросок — переброс за 1 ци (новый результат обязателен). Само.',
  },
  {
    id: 'fast-movement', classId: 'barbarian', level: 5, name: 'Быстрое передвижение', resource: null, use: 'passive',
    text: 'Без тяжёлого доспеха скорость больше на 10 футов. Само.',
  },
  {
    id: 'feral-instinct', classId: 'barbarian', level: 7, name: 'Дикий инстинкт', resource: null, use: 'passive',
    text: 'Инициатива — с преимуществом. Само.',
  },
  {
    id: 'indomitable-might', classId: 'barbarian', level: 18, name: 'Неукротимая мощь', resource: null, use: 'passive',
    text: 'Проверка Силы ниже значения Силы — вместо неё значение Силы. Само.',
  },
  {
    id: 'indomitable', classId: 'fighter', level: 9, name: 'Упорный', resource: 'Упорный', use: 'passive',
    text: 'Проваленный спасбросок — переброс (новый результат обязателен); раз до долгого отдыха, с 13-го — два, с 17-го — три. Само.',
  },
  {
    id: 'remarkable-athlete', classId: 'fighter', level: 7, subclass: 'champion', name: 'Чемпион: Выдающийся атлет', resource: null, use: 'passive',
    text: 'К проверкам Силы, Ловкости и Телосложения без владения (и к инициативе) — половина мастерства, округлённая вверх. Само.',
  },
  {
    id: 'survivor', classId: 'fighter', level: 18, subclass: 'champion', name: 'Чемпион: Выживший', resource: null, use: 'passive',
    text: 'В начале своего хода: хитов не больше половины, но не 0 — +5 + Телосложение хитов. Само.',
  },
  {
    id: 'jack-of-all-trades', classId: 'bard', level: 2, name: 'Мастер на все руки', resource: null, use: 'passive',
    text: 'К проверкам характеристик без владения (и к инициативе, и к пассивному Восприятию) — половина мастерства, округлённая вниз. Само.',
  },
  {
    id: 'song-of-rest', classId: 'bard', level: 2, name: 'Песнь отдыха', resource: null, use: 'passive',
    text: 'Короткий отдых: кто потратил кости хитов, тот ещё +к6 хитов (к8 с 9-го, к10 с 13-го, к12 с 17-го), если бард в сознании. Само.',
  },
  {
    id: 'slippery-mind', classId: 'rogue', level: 15, name: 'Скользкий ум', resource: null, use: 'passive',
    text: 'Владение спасбросками Мудрости. Само.',
  },
  {
    id: 'elusive', classId: 'rogue', level: 18, name: 'Неуловимость', resource: null, use: 'passive',
    text: 'У атак по вам нет преимущества, пока вы в силах действовать. Само.',
  },
  {
    id: 'vanish', classId: 'ranger', level: 14, name: 'Исчезновение', resource: null, use: 'passive',
    text: '«Спрятаться» — бонусным действием (в «Действиях»); магией не выследить.',
  },
  {
    id: 'feral-senses', classId: 'ranger', level: 18, name: 'Дикие чувства', resource: null, use: 'passive',
    text: 'Атаки по тем, кого не видите (невидим, спрятался, вы ослеплены), — без помехи. Само.',
  },
  {
    id: 'mystic-arcanum', classId: 'warlock', level: 11, name: 'Мистический арканум', resource: null, use: 'passive',
    text: 'Заклинание 6-го уровня (с 13-го — и 7-го, с 15-го — 8-го, с 17-го — 9-го) — без ячейки, каждого уровня раз до долгого отдыха: галочка в окне сотворения.',
  },
  {
    id: 'spell-mastery', classId: 'wizard', level: 18, name: 'Мастерство заклинаний', resource: null, use: 'passive',
    text: 'Выбранные заклинания 1-го и 2-го уровня — своим уровнем без ячейки, сколько угодно: выбор здесь, галочка в окне сотворения.',
  },
  {
    id: 'signature-spells', classId: 'wizard', level: 20, name: 'Фирменные заклинания', resource: null, use: 'passive',
    text: 'Два выбранных заклинания 3-го уровня — каждое раз до короткого отдыха без ячейки: выбор здесь, галочка в окне сотворения.',
  },
  {
    id: 'sorcerous-restoration', classId: 'sorcerer', level: 20, name: 'Чародейское восстановление', resource: null, use: 'passive',
    text: 'Короткий отдых возвращает 4 очка чародейства. Само.',
  },
  {
    id: 'hide-in-plain-sight', classId: 'ranger', level: 10, name: 'Сокрытие', resource: null, use: 'action',
    text: 'Минута маскировки (вне боя): +10 к Скрытности, пока стоите на месте и ничего не делаете — шаг, атака или заклинание её снимают.',
  },
  {
    id: 'blindsense', classId: 'rogue', level: 14, name: 'Слепое чувство', resource: null, use: 'passive',
    text: 'Пока слышите — знаете, где спрятавшиеся в 10 футах: атака по ним без помехи «цель скрыта» (невидимость — помеха остаётся). Само.',
  },
  {
    id: 'beast-spells', classId: 'druid', level: 18, name: 'Звериные заклинания', resource: null, use: 'passive',
    text: 'В облике зверя можно сотворять заклинания (без дорогих материальных компонентов). Само.',
  },
  {
    id: 'stroke-of-luck', classId: 'rogue', level: 20, name: 'Удача', resource: 'Удача', use: 'passive',
    text: 'Промах по цели — попадание: галочка в окне атаки, тратится только при промахе. Раз до короткого отдыха.',
  },
  {
    id: 'divine-intervention', classId: 'cleric', level: 10, name: 'Божественное вмешательство', resource: null, use: 'action',
    text: 'Действием — воззвать к божеству: к100 не больше уровня жреца (с 20-го — всегда) — божество вмешивается (решает мастер); после удачи — снова через 7 дней, после неудачи — после долгого отдыха.',
  },
  {
    id: 'cleansing-touch', classId: 'paladin', level: 14, name: 'Очищающее касание', resource: 'Очищающее касание', use: 'action',
    text: 'Действием — закончить одно заклинание на себе или союзнике рядом (вредное — первым). Харизма раз до долгого отдыха (не меньше 1).',
  },
  {
    id: 'superior-inspiration', classId: 'bard', level: 20, name: 'Превосходное вдохновение', resource: null, use: 'passive',
    text: 'Бросая инициативу без единой кости вдохновения, вы получаете одну. Само.',
  },
  {
    id: 'perfect-self', classId: 'monk', level: 20, name: 'Совершенство', resource: null, use: 'passive',
    text: 'Бросая инициативу без единого очка ци, вы получаете 4 очка. Само.',
  },
  {
    id: 'eldritch-master', classId: 'warlock', level: 20, name: 'Мастер таинств', resource: 'Мастер таинств', use: 'action',
    text: 'Минуту взывая к покровителю, вернуть все потраченные ячейки договора. Вне боя, раз до долгого отдыха.',
  },
  {
    id: 'persistent-rage', classId: 'barbarian', level: 15, name: 'Неудержимая ярость', resource: null, use: 'passive',
    text: 'Ярость кончается раньше срока, только если вы теряете сознание или сами её заканчиваете. Само.',
  },
  {
    id: 'primal-champion', classId: 'barbarian', level: 20, name: 'Первобытный чемпион', resource: null, use: 'passive',
    text: 'Сила и Телосложение +4, предел — 24. Само при повышении до 20-го уровня.',
  },
  {
    id: 'draconic-resilience', classId: 'sorcerer', level: 1, subclass: 'draconic', name: 'Драконья кровь: Драконья устойчивость', resource: null, use: 'passive',
    text: 'Без доспехов КД = 13 + Ловкость (щит можно); максимум хитов +1 за каждый уровень чародея. Само: в мастере создания и на новом уровне.',
  },
  {
    id: 'potent-cantrip', classId: 'wizard', level: 6, subclass: 'evocation', name: 'Школа Воплощения: Мощный заговор', resource: null, use: 'passive',
    text: 'Цель преуспела в спасброске от вашего заговора — получает половину его урона, но без прочих эффектов. Само.',
  },
  {
    id: 'overchannel', classId: 'wizard', level: 14, subclass: 'evocation', name: 'Школа Воплощения: Сверхзаряд', resource: null, use: 'passive',
    text: 'Заклинание 1–5 уровня с уроном — урон наибольший (галочка в окне сотворения). Первый раз до долгого отдыха — без последствий; дальше — сразу 2к12 некротического урона за уровень заклинания, каждый следующий раз ещё +1к12 за уровень; сопротивление и иммунитет не помогают.',
  },
  {
    id: 'fiendish-resilience', classId: 'warlock', level: 10, subclass: 'fiend', name: 'Исчадие: Демоническая стойкость', resource: null, use: 'passive',
    text: 'Вне боя (после отдыха) выберите вид урона — сопротивление ему, пока не выберете другой. Дробящий, колющий и рубящий урон магического или серебряного оружия его не замечает — это решает мастер.',
  },
  {
    id: 'supreme-healing', classId: 'cleric', level: 17, subclass: 'life', name: 'Домен Жизни: Высшее исцеление', resource: null, use: 'passive',
    text: 'Кости лечения ваших заклинаний не бросаются — каждая даёт наибольшее. Само.',
  },
  {
    id: 'defensive-tactics', classId: 'ranger', level: 7, subclass: 'hunter', name: 'Охотник: Тактика защиты', resource: null, use: 'passive',
    text: 'Выберите одно: «Уйти от толпы» — атаки при уходе по вам с помехой; «Защита от мультиатаки» — существо попало по вам, и до конца хода его следующие атаки по вам — против КД +4; «Стальная воля» — спасброски против испуга с преимуществом.',
  },
  {
    id: 'hunter-multiattack', classId: 'ranger', level: 11, subclass: 'hunter', name: 'Охотник: Мультиатака', resource: null, use: 'action',
    text: 'Выберите одно: «Залп» — действием дальнобойная атака по каждому существу в 10 футах от точки; «Вихрь» — действием рукопашная атака по каждому существу в 5 футах от вас. Каждой цели — свой бросок атаки.',
  },
  {
    id: 'slow-fall', classId: 'monk', level: 4, name: 'Медленное падение', resource: null, use: 'passive',
    text: 'Падая, реакцией уменьшить урон от падения на 5 × уровень монаха. Само (в бою — если реакция свободна).',
  },
  {
    id: 'retaliation', classId: 'barbarian', level: 14, subclass: 'berserker', name: 'Путь берсерка: Ответный удар', resource: null, use: 'passive',
    text: 'Получив урон от существа в 5 футах, реакцией — рукопашная атака оружием по нему. «Наготове» — само, лучшим рукопашным оружием, если реакция свободна.',
  },
  {
    id: 'superior-hunters-defense', classId: 'ranger', level: 15, subclass: 'hunter', name: 'Охотник: Сверхзащита охотника', resource: null, use: 'passive',
    text: 'Выберите одно: «Увёртливость» — спасбросок Ловкости «половина при успехе»: успех — без урона, провал — половина; «Против течения» — враг промахнулся по вам рукопашной, и реакцией вы заставляете его повторить ту же атаку по другому существу рядом с ним (своему врагу); «Невероятное уклонение» — попал атакующий, которого вы видите, — реакцией урон вдвое меньше. Само.',
  },
  {
    id: 'empty-body', classId: 'monk', level: 18, name: 'Пустое тело', resource: 'Ци', use: 'action',
    text: 'Действием, 4 очка ци: на минуту — невидимость и сопротивление всем видам урона, кроме урона силовым полем.',
  },
  {
    id: 'quivering-palm', classId: 'monk', level: 17, subclass: 'open-hand', name: 'Путь открытой ладони: Дрожащая ладонь', resource: 'Ци', use: 'action',
    text: 'Попав безоружным ударом, за 3 очка ци — смертельная дрожь в теле цели (на столько дней, сколько у вас уровней монаха; одна цель за раз). Действием её можно оборвать: цель — спасбросок Телосложения против СЛ ци, провал — 0 хитов, успех — 10к10 некротического урона.',
  },
  {
    id: 'hurl-through-hell', classId: 'warlock', level: 14, subclass: 'fiend', name: 'Исчадие: Бросок через ад', resource: 'Бросок через ад', use: 'passive',
    text: 'Попав атакой по существу, можно мгновенно швырнуть его через нижние планы: до конца вашего следующего хода его нет на поле боя (недееспособно, его не видно); вернувшись, оно получает 10к10 психического урона, если это не исчадие. Раз до долгого отдыха.',
  },
  {
    id: 'holy-nimbus', classId: 'paladin', level: 20, subclass: 'devotion', name: 'Клятва преданности: Святой нимб', resource: 'Святой нимб', use: 'action',
    text: 'Действием на минуту: вас окружает яркий свет на 30 футов (и тусклый ещё на 30); враг, начинающий ход в ярком свете, получает 10 урона излучением; спасброски от заклинаний исчадий и нежити — с преимуществом. Раз до долгого отдыха.',
  },
  {
    id: 'lands-stride', classId: 'druid', level: 6, subclass: 'land', name: 'Круг Земли: Поступь по земле', resource: null, use: 'passive',
    text: 'Немагическая труднопроходимая местность не стоит лишнего движения. Само: клетки местности сцены — как обычные.',
  },
  {
    id: 'lands-stride-ranger', classId: 'ranger', level: 8, name: 'Поступь по земле', resource: null, use: 'passive',
    text: 'Немагическая труднопроходимая местность не стоит лишнего движения. Само: клетки местности сцены — как обычные.',
  },
  {
    id: 'dragon-wings', classId: 'sorcerer', level: 14, subclass: 'draconic', name: 'Драконья кровь: Драконьи крылья', resource: null, use: 'bonus',
    text: 'Бонусным действием — драконьи крылья: скорость полёта, равная обычной, пока вы их не уберёте (тоже бонусным). Летящему не мешает местность и не страшны ямы-ловушки.',
  },
  {
    id: 'peerless-skill', classId: 'bard', level: 14, subclass: 'lore', name: 'Коллегия знаний: Непревзойдённое мастерство', resource: 'Вдохновение барда', use: 'passive',
    text: 'К своей проверке характеристики (и навыка) можно прибавить кость вдохновения барда — тратится одно вдохновение. Галочка в «Проверках».',
  },
  {
    id: 'countercharm', classId: 'bard', level: 6, name: 'Контрочарование', resource: null, use: 'action',
    text: 'Действием — до конца вашего следующего хода вы и союзники в 30 футах совершаете спасброски от испуга и очарования с преимуществом.',
  },
  {
    id: 'flexible-casting', classId: 'sorcerer', level: 2, name: 'Гибкое заклинание', resource: 'Очки чародейства', use: 'bonus',
    text: 'Бонусным действием: ячейка — в очки чародейства (столько, каков её уровень) или очки — в ячейку до 5-го уровня (1-я — 2 очка, 2-я — 3, 3-я — 5, 4-я — 6, 5-я — 7).',
  },
  {
    id: 'archdruid', classId: 'druid', level: 20, name: 'Архидруид', resource: null, use: 'passive',
    text: '«Дикий облик» — сколько угодно раз. Само.',
  },
  {
    id: 'supreme-sneak', classId: 'rogue', level: 9, subclass: 'thief', name: 'Вор: Превосходная скрытность', resource: null, use: 'passive',
    text: 'Проверка Скрытности — с преимуществом, если в этот ход вы прошли не больше половины скорости. Само.',
  },
  {
    id: 'thiefs-reflexes', classId: 'rogue', level: 17, subclass: 'thief', name: 'Вор: Рефлексы вора', resource: null, use: 'passive',
    text: 'В первом раунде боя — два хода: на свою инициативу и на неё −10 (вторая запись в очереди «… : рефлексы вора»). Само.',
  },
  {
    id: 'tranquility', classId: 'monk', level: 11, subclass: 'open-hand', name: 'Путь открытой ладони: Спокойствие', resource: null, use: 'passive',
    text: 'После долгого отдыха вы под «Убежищем» (СЛ 8 + Мудрость + мастерство) до следующего долгого отдыха; напали или навредили заклинанием — кончается. Само.',
  },
  {
    id: 'favored-enemy', classId: 'ranger', level: 1, name: 'Избранный враг', resource: null, use: 'passive',
    text: 'Выберите тип существ (ещё один с 6-го и с 14-го уровня): с «Убийцей врагов» 20-го уровня — прибавка к урону по ним. Преимущество на Выживание и Интеллект о них — решает мастер.',
  },
  {
    id: 'foe-slayer', classId: 'ranger', level: 20, name: 'Убийца врагов', resource: null, use: 'passive',
    text: 'Раз в ход попав по избранному врагу — к урону модификатор Мудрости. Само.',
  },
  {
    id: 'intimidating-presence', classId: 'barbarian', level: 10, subclass: 'berserker', name: 'Путь берсерка: Пугающее присутствие', resource: null, use: 'action',
    text: 'Действием — существо в 30 футах, что видит вас: спасбросок Мудрости (СЛ 8 + мастерство + Харизма), провал — испугано до конца вашего следующего хода; дальше — действием продлить. Устоявшее — сутки неуязвимо.',
  },
  {
    id: 'draconic-presence', classId: 'sorcerer', level: 18, subclass: 'draconic', name: 'Драконья кровь: Драконье присутствие', resource: 'Очки чародейства', use: 'action',
    text: 'Действием, 5 очков: аура на 60 футов на минуту (концентрация) — страх или очарование. Враг, начинающий ход в ауре, — спасбросок Мудрости против СЛ ваших заклинаний, провал — испуган или очарован, пока аура держится; устоявший — сутки неуязвим.',
  },
  {
    id: 'purity-of-spirit', classId: 'paladin', level: 15, subclass: 'devotion', name: 'Клятва преданности: Чистота духа', resource: null, use: 'passive',
    text: 'Всегда под «Защитой от добра и зла»: аберрации, небожители, элементали, феи, исчадия и нежить атакуют вас с помехой и не могут очаровать или испугать. Само.',
  },
  {
    id: 'natures-ward', classId: 'druid', level: 10, subclass: 'land', name: 'Круг Земли: Защита природы', resource: null, use: 'passive',
    text: 'Иммунитет к яду (урон и отравление) и болезням; элементали и феи не могут вас очаровать или испугать. Само.',
  },
  {
    id: 'natures-sanctuary', classId: 'druid', level: 14, subclass: 'land', name: 'Круг Земли: Святилище природы', resource: null, use: 'passive',
    text: 'Зверь или растение, атакующее вас, сначала спасается Мудростью против СЛ ваших заклинаний; провал — атака не состоится. Само.',
  },
  {
    id: 'unarmored-defense', classId: 'barbarian', level: 1, name: 'Защита без доспехов', resource: null, use: 'passive',
    text: 'Без доспехов КД = 10 + Ловкость + Телосложение; щит можно. При мультиклассе — второй раз не берётся.',
  },
  {
    id: 'unarmored-defense-monk', classId: 'monk', level: 1, name: 'Защита без доспехов', resource: null, use: 'passive',
    text: 'Без доспехов и щита КД = 10 + Ловкость + Мудрость. При мультиклассе — второй раз не берётся.',
  },
];
