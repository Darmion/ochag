// Example mechanics mod (docs/MODS.md): a race, a subrace for an SRD race, a feat, a bestiary creature and two windows.
// What a trait does is a list of effects; the rules read them the same way as the SRD traits.

export default function (api) {
  // 1. A new race for the hero wizard: everything the wizard shows and builds, plus traits with effects.
  api.races.define({
    id: 'mod_ashborn', name: 'Пеплорождённый', size: 'medium', speed: 30,
    bonuses: { constitution: 2, charisma: 1 }, darkvision: 60, languages: 'Общий, Игнан',
    icon: 'flame', tagline: 'Дети пепелищ: огонь их не берёт, а страх отпускает быстро.',
    names: ['Искрен', 'Золана', 'Тлеон', 'Варра', 'Угрим', 'Сажена'],
    cantrip: { index: 'produce-flame', ability: 'charisma' },
    traits: [
      { name: 'Тёмное зрение', text: 'В темноте видит на 60 футов, как при тусклом свете.' },
      { name: 'Жаростойкость', text: 'Сопротивление урону огнём.', effects: [{ kind: 'resistance', damage: 'fire' }] },
      { name: 'Тлеющая решимость', text: 'Спасброски против испуга — с преимуществом.', effects: [{ kind: 'save-advantage', condition: 'frightened' }] },
      { name: 'Огонёк в ладони', text: 'Знает заговор «Сотворение пламени»; базовая характеристика — Харизма.' },
    ],
    subraces: [
      {
        id: 'mod_ashborn_coal', name: 'Угольный пеплорождённый', bonuses: { strength: 1 },
        traits: [{ name: 'Крепость угля', text: 'Максимум хитов больше на 1 за каждый уровень.', effects: [{ kind: 'hp-per-level', value: 1 }] }],
      },
      {
        id: 'mod_ashborn_spark', name: 'Искристый пеплорождённый', bonuses: { dexterity: 1 }, speed: 35,
        traits: [{ name: 'Быстрая искра', text: 'Скорость 35 футов.' }],
      },
    ],
  });

  // 2. A subrace for an SRD race: it appears among the dwarf's subraces in the wizard.
  api.races.subrace('dwarf', {
    id: 'mod_ash_dwarf', name: 'Пепельный дварф', bonuses: { charisma: 1 },
    traits: [{ name: 'Кузнечный жар', text: 'Сопротивление урону огнём.', effects: [{ kind: 'resistance', damage: 'fire' }] }],
  });

  // 3. A feat: in the level-up list («Из модов») and in the sheet's «Черты».
  // `abilities` — the feat raises one of them by 1, the player picks which.
  api.feats.define({
    id: 'mod_cool_headed', name: 'Хладнокровный', en: 'Cool-Headed', abilities: ['wisdom', 'charisma'],
    text: '+1 к Мудрости или Харизме; спасброски против испуга — с преимуществом; +2 к инициативе.',
    effects: [
      { kind: 'save-advantage', condition: 'frightened' },
      { kind: 'roll-bonus', rolls: 'initiative', value: 2 },
    ],
  });

  // 4. A bestiary creature: the same stat block as the SRD ones. Attack bonuses, the average damage, hit points and
  // passive Perception are worked out when left out; the GM spawns it from the bestiary like any other.
  api.bestiary.define({
    id: 'mod_ash_hound', name: 'Пепельная гончая', en: 'Ash Hound', size: 'medium', type: 'чудовище', alignment: 'без мировоззрения',
    ac: 13, acNote: 'природный доспех', hitDice: '5d8+5', speed: 40, cr: 1,
    abilities: { strength: 14, dexterity: 15, constitution: 13, intelligence: 3, wisdom: 12, charisma: 6 },
    skills: { perception: 3, stealth: 4 }, resistant: ['fire'], conditionImmunities: ['frightened'], darkvision: 60,
    traits: [
      { name: 'Тлеющая шерсть', text: 'Существо, которое касается гончей или попадает по ней рукопашной атакой, находясь в пределах 5 фт. от неё, получает 2 (1d4) урона огнём.' },
      { name: 'Тонкий нюх', text: 'Совершает с преимуществом проверки Мудрости (Восприятие), полагающиеся на обоняние.' },
    ],
    multiattack: { count: 2, text: 'Совершает две атаки укусом.' },
    attacks: [{ name: 'Укус', kind: 'melee', reach: 5, damage: '1d6+2', type: 'piercing' }],
  });

  // 5. Windows: the mod describes the fields, the app draws them with its own controls and checks the values;
  // `run` gets them and does the work inside the request's transaction. They are in the table's «Ещё» menu.
  api.ui.form({
    id: 'ash-whirl', title: 'Пепельный вихрь', icon: 'fog', who: 'gm', submit: 'Поднять вихрь',
    description: 'Горячий пепел обжигает одно существо; сопротивление огню и иммунитет работают как обычно.',
    fields: [
      { key: 'target', label: 'Кого обжечь', type: 'character', required: true },
      { key: 'dice', label: 'Сила вихря', type: 'select', default: '2d6', options: [
        { value: '1d6', label: 'Слабый — 1d6' }, { value: '2d6', label: 'Средний — 2d6' }, { value: '4d6', label: 'Сильный — 4d6' },
      ] },
    ],
    run: async ({ q, ctx, kit, campaignId, userId, values }) => {
      const [count, sides] = values.dice.split('d').map(Number);
      const dice = Array.from({ length: count }, () => kit.rollDie(sides));
      const total = dice.reduce((sum, value) => sum + value, 0);
      await kit.insertRoll(q, campaignId, userId, values.target, 'Пепельный вихрь', values.dice, dice, 0, total, false);
      const hit = await kit.applyHpChange(q, campaignId, userId, values.target, { mode: 'damage', amount: total, damageType: 'fire', critical: false });
      await kit.notifyCampaign(campaignId, { type: 'character', characterId: values.target });
      const resisted = hit.modified === 'resisted' ? ' (сопротивление огню)' : '';
      return { message: `Вихрь обжёг «${hit.name}»: ${hit.applied} урона огнём${resisted}.` };
    },
  });
  api.ui.form({
    id: 'shake-ash', title: 'Отряхнуть пепел', icon: 'heart', who: 'everyone', scope: 'character', submit: 'Отряхнуться',
    description: 'Выбранная фигура стряхивает пепел и восстанавливает 1d4 хита.',
    run: async ({ q, kit, campaignId, userId, characterId }) => {
      const healed = kit.rollDie(4);
      const result = await kit.applyHpChange(q, campaignId, userId, characterId, { mode: 'heal', amount: healed, damageType: null, critical: false });
      await kit.notifyCampaign(campaignId, { type: 'character', characterId });
      return { message: `«${result.name}» отряхнулся: +${result.applied} хита.` };
    },
  });

  api.log('готов: раса «Пеплорождённый», подраса «Пепельный дварф», черта «Хладнокровный», существо «Пепельная гончая», два окна');
}
