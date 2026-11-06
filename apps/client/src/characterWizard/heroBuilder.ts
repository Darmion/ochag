import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import { ensureSrdSkills, ensureSrdSpells, type SrdSkill, type SrdSpell } from '../rules/srd';
import { t, tn } from '../i18n/i18n';
import { artFile, heroPortraitPaths } from '../art/portraitArt';
import type { GameIconName } from '../ui/gameIcons';
import { ABILITIES, CLASS_INFO, mod, randomHeroName } from './catalog';
import type { Ability, Heroes, Preview, StepId } from './types';

// Builder state for CharacterWizard.vue; mutable on purpose, the window and its steps write `choice` and `current` directly.
export function useHeroBuilder(props: {
  campaignId: string;
  request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
}, { onCreated }: {
  onCreated: (character: { id: string; name: string }) => void;
}) {
  const heroes = ref<Heroes | null>(null);
  const spells = ref<SrdSpell[]>([]);
  const skills = ref<SrdSkill[]>([]);
  const error = ref('');
  const working = ref(false);

  const choice = reactive({
    name: '',
    race: 'human', subrace: '', ancestry: '', flexible: [] as Ability[], raceName: '',
    className: 'fighter', fightingStyle: '',
    method: 'standard' as 'free' | 'standard' | 'pointbuy' | 'roll',
    assign: { strength: 0, dexterity: 1, constitution: 2, intelligence: 3, wisdom: 4, charisma: 5 } as Record<Ability, number>,
    pointBuy: { strength: 8, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8 } as Record<Ability, number>,
    free: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 } as Record<Ability, number>,
    background: 'acolyte', classSkills: [] as string[], backgroundSkills: [] as string[], raceSkills: [] as string[], expertise: [] as string[],
    kit: '', cantrips: [] as string[], spells: [] as string[], raceCantrip: '',
  });
  const rolled = ref<{ rollId: string; sets: Array<{ dice: number[]; value: number }>; values: number[] } | null>(null);
  const preview = ref<Preview | null>(null);

  onMounted(async () => {
    try {
      heroes.value = await props.request('/srd/heroes');
      [spells.value, skills.value] = await Promise.all([ensureSrdSpells(props.request), ensureSrdSkills(props.request)]);
      choice.kit = heroClass.value?.kits[0]?.id ?? '';
      arrangeForClass();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  });

  const race = computed(() => heroes.value?.races.find(entry => entry.id === choice.race) ?? null);
  const subrace = computed(() => race.value?.subraces.find(entry => entry.id === choice.subrace) ?? null);
  const heroClass = computed(() => heroes.value?.classes.find(entry => entry.id === choice.className) ?? null);
  const background = computed(() => heroes.value?.backgrounds.find(entry => entry.id === choice.background) ?? null);
  const needsAncestry = computed(() => Boolean(race.value?.ancestry || heroClass.value?.subclass?.ancestry));
  const highElf = computed(() => Boolean(subrace.value?.wizardCantrip));
  const caster = computed(() => heroClass.value?.caster ?? null);
  const classInfo = computed(() => CLASS_INFO[choice.className] ?? null);
  const primary = computed(() => new Set((classInfo.value?.order ?? []).slice(0, 2)));

  watch(() => choice.race, () => {
    choice.subrace = race.value?.subraces[0]?.id ?? '';
    choice.flexible = [];
    choice.raceSkills = [];
    choice.raceCantrip = '';
  });
  watch(() => choice.className, () => {
    choice.classSkills = [];
    choice.expertise = [];
    choice.cantrips = [];
    choice.spells = [];
    choice.fightingStyle = '';
    choice.kit = heroClass.value?.kits[0]?.id ?? '';
    if (!abilitiesTouched.value) arrangeForClass();
  });
  watch(() => choice.background, () => { choice.backgroundSkills = []; });

  const pool = computed(() => (choice.method === 'roll' ? rolled.value?.values ?? [] : heroes.value?.standardArray ?? []));
  const baseScores = computed<Record<Ability, number>>(() => {
    if (choice.method === 'pointbuy') return { ...choice.pointBuy };
    if (choice.method === 'free') return { ...choice.free };
    return Object.fromEntries(ABILITIES.map(ability => [ability, pool.value[choice.assign[ability]] ?? 8])) as Record<Ability, number>;
  });
  const bonusOf = (ability: Ability) => (race.value?.bonuses[ability] ?? 0) + (subrace.value?.bonuses[ability] ?? 0) + (race.value?.flexibleBonuses && choice.flexible.includes(ability) ? 1 : 0)
    + (race.value?.custom ? (choice.flexible[0] === ability ? 2 : choice.flexible[1] === ability ? 1 : 0) : 0);
  function setCustomBonus(slot: 0 | 1, ability: Ability | '') {
    const next = [choice.flexible[0] ?? '', choice.flexible[1] ?? ''] as Array<Ability | ''>;
    next[slot] = ability;
    if (ability && next[1 - slot] === ability) next[1 - slot] = '';
    choice.flexible = next as Ability[];
  }
  const finalScores = computed(() => Object.fromEntries(ABILITIES.map(ability => [ability, Math.min(20, baseScores.value[ability] + bonusOf(ability))])) as Record<Ability, number>);
  const cost = (value: number) => heroes.value?.pointBuy.cost[String(value)] ?? 0;
  const pointsSpent = computed(() => ABILITIES.reduce((sum, ability) => sum + cost(choice.pointBuy[ability]), 0));
  const budget = computed(() => heroes.value?.pointBuy.budget ?? 27);

  const abilitiesTouched = ref(false);

  function assignValue(ability: Ability, index: number) {
    abilitiesTouched.value = true;
    const other = ABILITIES.find(entry => entry !== ability && choice.assign[entry] === index);
    if (other) choice.assign[other] = choice.assign[ability];
    choice.assign[ability] = index;
  }

  function arrangeForClass() {
    const order = classInfo.value?.order ?? ABILITIES;
    if (choice.method === 'pointbuy' || choice.method === 'free') {
      const spread = [15, 14, 13, 12, 10, 8];
      order.forEach((ability, index) => { choice[choice.method === 'free' ? 'free' : 'pointBuy'][ability] = spread[index] ?? 8; });
      return;
    }
    const values = pool.value;
    const ranked = values.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
    order.forEach((ability, rank) => { choice.assign[ability] = ranked[rank]?.index ?? rank; });
  }

  function setFree(ability: Ability, value: number) {
    abilitiesTouched.value = true;
    if (Number.isFinite(value)) choice.free[ability] = Math.max(1, Math.min(20, Math.round(value)));
  }

  function stepPoint(ability: Ability, delta: number) {
    abilitiesTouched.value = true;
    const next = choice.pointBuy[ability] + delta;
    if (next < 8 || next > 15) return;
    const spent = pointsSpent.value - cost(choice.pointBuy[ability]) + cost(next);
    if (spent > budget.value) return;
    choice.pointBuy[ability] = next;
  }

  watch(() => choice.method, method => {
    if (method !== 'roll' && !abilitiesTouched.value) arrangeForClass();
  });

  async function rollAbilities() {
    working.value = true;
    error.value = '';
    try {
      rolled.value = await props.request(`/campaigns/${props.campaignId}/characters/ability-roll`, 'POST', {});
      arrangeForClass();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working.value = false;
    }
  }

  const skillName = (index: string) => skills.value.find(skill => skill.index === index)?.nameRu ?? index;
  const skillAbility = (index: string) => skills.value.find(skill => skill.index === index)?.abilityRu ?? '';
  const allSkills = computed(() => skills.value.map(skill => skill.index));
  const classPool = computed(() => {
    const from = heroClass.value?.skills.from;
    return from === 'any' ? allSkills.value : from ?? [];
  });
  const granted = computed(() => new Set([...(race.value?.skills ?? []), ...(background.value?.skills ?? [])]));
  const taken = (except: string[]) => new Set([...granted.value, ...choice.classSkills, ...choice.backgroundSkills, ...choice.raceSkills].filter(skill => !except.includes(skill)));
  const proficient = computed(() => [...new Set([...granted.value, ...choice.classSkills, ...choice.backgroundSkills, ...choice.raceSkills])]);
  const backgroundChoices = computed(() => Boolean(background.value && !background.value.skills));

  function suggestSkills() {
    const count = heroClass.value?.skills.count ?? 0;
    const wanted = [...(classInfo.value?.skills ?? []), ...classPool.value];
    const busy = taken(choice.classSkills);
    choice.classSkills = [...new Set(wanted)].filter(skill => classPool.value.includes(skill) && !busy.has(skill)).slice(0, count);
    if (backgroundChoices.value) {
      const used = taken(choice.backgroundSkills);
      choice.backgroundSkills = [...new Set([...(classInfo.value?.skills ?? []), 'perception', 'insight', 'athletics', 'stealth', 'persuasion'])].filter(skill => !used.has(skill)).slice(0, 2);
    }
    if (race.value?.skillChoices) {
      const used = taken(choice.raceSkills);
      choice.raceSkills = [...new Set([...(classInfo.value?.skills ?? []), 'perception', 'athletics', 'stealth', 'persuasion', 'insight'])].filter(skill => !used.has(skill)).slice(0, race.value.skillChoices);
    }
    if (heroClass.value?.expertise) choice.expertise = proficient.value.slice(0, heroClass.value.expertise);
  }

  const spellName = (spell: SrdSpell) => spell.nameRu || spell.name;
  const cantripOptions = computed(() => spells.value.filter(spell => spell.level === 0 && caster.value && spell.classes.includes(caster.value.list)));
  const spellOptions = computed(() => spells.value.filter(spell => spell.level === 1 && caster.value && spell.classes.includes(caster.value.list)));
  const wizardCantrips = computed(() => spells.value.filter(spell => spell.level === 0 && spell.classes.includes('Wizard')));
  const raceCantripList = computed({
    get: () => (choice.raceCantrip ? [choice.raceCantrip] : []),
    set: value => { choice.raceCantrip = value[0] ?? ''; },
  });
  const spellLimit = computed(() => {
    const value = caster.value;
    if (!value) return 0;
    if (value.spells === 'prepared') return Math.max(1, mod(finalScores.value[value.ability]) + 1);
    if (value.spells === 'spellbook') return 6;
    return value.spells;
  });

  const STEPS = computed<Array<{ id: StepId; label: string; icon: GameIconName }>>(() => [
    { id: 'race', label: 'Раса', icon: 'person' },
    { id: 'class', label: 'Класс', icon: 'sword' },
    { id: 'abilities', label: 'Характеристики', icon: 'stats' },
    { id: 'skills', label: 'Предыстория и навыки', icon: 'target' },
    { id: 'kit', label: 'Снаряжение', icon: 'pouch' },
    ...(caster.value || highElf.value ? [{ id: 'spells' as const, label: 'Заклинания', icon: 'wand' as const }] : []),
    { id: 'summary', label: 'Имя и итог', icon: 'scroll' },
  ]);
  const current = ref<StepId>('race');
  const stepIndex = computed(() => Math.max(0, STEPS.value.findIndex(entry => entry.id === current.value)));
  watch(STEPS, list => { if (!list.some(entry => entry.id === current.value)) current.value = 'summary'; });
  function goStep(delta: number) {
    const next = STEPS.value[stepIndex.value + delta];
    if (next) current.value = next.id;
  }

  const todo = computed<Record<StepId, string[]>>(() => {
    const list: Record<StepId, string[]> = { race: [], class: [], abilities: [], skills: [], kit: [], spells: [], summary: [] };
    if (race.value?.subraces.length && !choice.subrace) list.race.push(t('подрасу'));
    if (race.value?.ancestry && !choice.ancestry) list.race.push(t('дракона-предка'));
    if (race.value?.flexibleBonuses && choice.flexible.length < 2) list.race.push(tn(2 - choice.flexible.length, 'ещё {n} характеристику для +1|ещё {n} характеристики для +1|ещё {n} характеристик для +1'));
    if (race.value?.custom && !(choice.flexible[0] && choice.flexible[1])) list.race.push(t('характеристики для +2 и +1'));
    if (heroClass.value?.fightingStyle && !choice.fightingStyle) list.class.push(t('боевой стиль'));
    if (heroClass.value?.subclass?.ancestry && !race.value?.ancestry && !choice.ancestry) list.class.push(t('дракона-предка'));
    if (choice.method === 'roll' && !rolled.value) list.abilities.push(t('бросить кости'));
    if (choice.method === 'pointbuy' && pointsSpent.value > budget.value) list.abilities.push(t('уложиться в очки'));
    const count = heroClass.value?.skills.count ?? 0;
    if (choice.classSkills.length < count) list.skills.push(tn(count - choice.classSkills.length, 'ещё {n} навык класса|ещё {n} навыка класса|ещё {n} навыков класса'));
    if (backgroundChoices.value && choice.backgroundSkills.length < 2) list.skills.push(tn(2 - choice.backgroundSkills.length, 'ещё {n} навык предыстории|ещё {n} навыка предыстории|ещё {n} навыков предыстории'));
    if (race.value?.skillChoices && choice.raceSkills.length < race.value.skillChoices) list.skills.push(tn(race.value.skillChoices - choice.raceSkills.length, 'ещё {n} навык расы|ещё {n} навыка расы|ещё {n} навыков расы'));
    if (heroClass.value?.expertise && choice.expertise.length < heroClass.value.expertise) list.skills.push(t('компетентность ({count})', { count: heroClass.value.expertise - choice.expertise.length }));
    if (!choice.kit) list.kit.push(t('набор снаряжения'));
    if (caster.value && choice.cantrips.length < caster.value.cantrips) list.spells.push(tn(caster.value.cantrips - choice.cantrips.length, 'ещё {n} заговор|ещё {n} заговора|ещё {n} заговоров'));
    if (caster.value && choice.spells.length < spellLimit.value) list.spells.push(tn(spellLimit.value - choice.spells.length, 'ещё {n} заклинание 1-го круга|ещё {n} заклинания 1-го круга|ещё {n} заклинаний 1-го круга'));
    if (highElf.value && !choice.raceCantrip) list.spells.push(t('заговор высшего эльфа'));
    if (!choice.name.trim()) list.summary.push(t('имя героя'));
    return list;
  });

  const stepValue = computed<Record<StepId, string>>(() => ({
    race: race.value ? `${race.value.nameRu}${subrace.value ? ` · ${subrace.value.nameRu.replace(race.value.nameRu, '').trim() || subrace.value.nameRu}` : ''}` : '',
    class: heroClass.value ? `${heroClass.value.nameRu}${choice.fightingStyle ? ` · ${heroes.value?.fightingStyles.find(style => style.id === choice.fightingStyle)?.nameRu ?? ''}` : ''}` : '',
    abilities: ({ free: 'свободно', standard: 'стандартный набор', pointbuy: `покупка ${pointsSpent.value}/${budget.value}`, roll: rolled.value ? 'брошено 4к6' : 'бросок 4к6' } as const)[choice.method],
    skills: background.value ? `${background.value.nameRu} · ${tn(proficient.value.length, '{n} навык|{n} навыка|{n} навыков')}` : '',
    kit: heroClass.value?.kits.find(kit => kit.id === choice.kit)?.nameRu ?? '',
    spells: caster.value ? `${choice.cantrips.length + choice.spells.length} выбрано` : highElf.value ? (choice.raceCantrip ? '1 заговор' : '') : '',
    summary: choice.name.trim(),
  }));

  const buildBody = (dryRun: boolean) => ({
    name: choice.name.trim() || 'Безымянный',
    race: choice.race, subrace: choice.subrace || null, ancestry: needsAncestry.value ? choice.ancestry || null : null,
    flexible: race.value?.flexibleBonuses || race.value?.custom ? choice.flexible.filter(Boolean) : [],
    ...(race.value?.custom ? { raceName: choice.raceName.trim() || null } : {}),
    className: choice.className, fightingStyle: heroClass.value?.fightingStyle ? choice.fightingStyle || null : null,
    method: choice.method, abilities: baseScores.value, ...(choice.method === 'roll' && rolled.value ? { rollId: rolled.value.rollId } : {}),
    background: choice.background, classSkills: choice.classSkills,
    backgroundSkills: background.value?.skills ? [] : choice.backgroundSkills, raceSkills: race.value?.skillChoices ? choice.raceSkills : [],
    expertise: heroClass.value?.expertise ? choice.expertise : [],
    kit: choice.kit,
    cantrips: caster.value ? choice.cantrips : [], spells: caster.value ? choice.spells : [],
    raceCantrip: highElf.value ? choice.raceCantrip || null : null,
    dryRun,
  });

  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewSeq = 0;
  async function refreshPreview() {
    if (!heroes.value || (choice.method === 'roll' && !rolled.value)) return;
    const seq = ++previewSeq;
    try {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/build`, 'POST', buildBody(true));
      if (seq === previewSeq) preview.value = result;
    } catch (cause) {
      if (seq === previewSeq) preview.value = { problems: [cause instanceof Error ? cause.message : String(cause)], summary: null, skills: [], weapons: [], resources: [], spells: [], items: [] };
    }
  }
  watch(() => JSON.stringify(buildBody(true)), () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void refreshPreview(), 450);
  });
  watch(heroes, () => void refreshPreview());
  onBeforeUnmount(() => clearTimeout(previewTimer));

  function randomName() {
    choice.name = randomHeroName(choice.race, choice.name);
  }

  const portrait = ref<string | null>(null);
  const portraitPicker = ref(false);
  const portraitSuggested = computed(() => heroPortraitPaths(choice.race));
  function pickPortrait(path: string) {
    portrait.value = path;
    portraitPicker.value = false;
  }

  async function attachPortrait(characterId: string) {
    if (!portrait.value) return;
    try {
      const base = `/campaigns/${props.campaignId}`;
      const uploaded = await props.request(`${base}/assets?kind=object_image`, 'POST', undefined, await artFile(portrait.value));
      const created = await props.request(`${base}/characters/${characterId}`);
      await props.request(`${base}/characters/${characterId}`, 'PATCH', { revision: created.revision, imageAssetId: uploaded.id });
    } catch {
    }
  }

  async function create() {
    if (!choice.name.trim()) { error.value = 'Дайте герою имя.'; return; }
    working.value = true;
    error.value = '';
    try {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/build`, 'POST', buildBody(false));
      await attachPortrait(result.character.id);
      onCreated(result.character);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working.value = false;
    }
  }

  const spellNames = computed(() => new Map(spells.value.map(spell => [spell.index, spellName(spell)])));
  const heroLine = computed(() => [race.value?.custom ? choice.raceName.trim() || race.value.nameRu : race.value?.nameRu, heroClass.value?.nameRu, background.value?.nameRu].filter(Boolean).join(' · '));
  const monogram = computed(() => (choice.name.trim()[0] ?? '?').toUpperCase());

  return reactive({
    heroes, error, working, choice, rolled, preview, race, subrace,
    heroClass, background, highElf, caster, classInfo, primary, pool, bonusOf,
    setCustomBonus, finalScores, pointsSpent, budget, abilitiesTouched, assignValue, arrangeForClass, setFree,
    stepPoint, rollAbilities, skillName, skillAbility, allSkills, classPool, granted, taken,
    proficient, backgroundChoices, suggestSkills, cantripOptions, spellOptions, wizardCantrips, raceCantripList, spellLimit,
    STEPS, current, stepIndex, goStep, todo, stepValue, randomName, portrait,
    portraitPicker, portraitSuggested, pickPortrait, create, spellNames, heroLine, monogram,
  });
}

export type HeroBuilder = ReturnType<typeof useHeroBuilder>;
