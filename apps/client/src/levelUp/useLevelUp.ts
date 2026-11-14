import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import { ensureSrdSkills, ensureSrdSpells, type SrdSkill, type SrdSpell } from '../rules/srd';
import { ABILITIES, ABILITY_LABELS, CLASS_INFO } from '../characterWizard/catalog';
import { t, tn } from '../i18n/i18n';
import type { GameIconName } from '../ui/gameIcons';
import type { Ability, Choice, Info, Preview, Result, StepId } from './types';

export const CUSTOM_FEAT = '__custom';

const emptyIncreases = (): Record<Ability, number> => ({ strength: 0, dexterity: 0, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0 });

// State of the level-up window; mutable on purpose, the window and its steps write `form` and `current` directly.
export function useLevelUp(props: {
  campaignId: string;
  characterId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}, { onDone }: { onDone: () => void }) {
  const info = ref<Info | null>(null);
  const spells = ref<SrdSpell[]>([]);
  const skills = ref<SrdSkill[]>([]);
  const error = ref('');
  const working = ref(false);
  const result = ref<Result | null>(null);
  const preview = ref<Preview | null>(null);
  const chosenClass = ref('');
  const current = ref<StepId>('class');

  const form = reactive({
    hp: 'average' as 'average' | 'roll',
    asiKind: 'asi' as 'asi' | 'feat',
    increases: emptyIncreases(),
    featId: '', featName: '', featText: '', featIncrease: '' as Ability | '',
    subclass: '',
    replaceFrom: '', replaceTo: '',
    cantrips: [] as string[], spells: [] as string[], expertise: [] as string[], skills: [] as string[],
    fightingStyle: '',
  });

  const plan = computed(() => info.value?.plan ?? info.value?.milestone ?? null);
  const milestone = computed(() => !info.value?.plan && Boolean(info.value?.milestone));
  const base = () => `/campaigns/${props.campaignId}/characters/${props.characterId}/level-up`;

  function reset() {
    Object.assign(form, {
      hp: 'average', asiKind: 'asi', increases: emptyIncreases(), featId: '', featName: '', featText: '', featIncrease: '',
      subclass: plan.value?.subclass?.current ?? '', replaceFrom: '', replaceTo: '', cantrips: [], spells: [], expertise: [], skills: [], fightingStyle: '',
    });
    preview.value = null;
  }

  async function load() {
    error.value = '';
    try {
      const query = chosenClass.value ? `?classId=${chosenClass.value}` : '';
      info.value = await props.request(`${base()}${query}`);
      [spells.value, skills.value] = await Promise.all([ensureSrdSpells(props.request), ensureSrdSkills(props.request)]);
      reset();
      queuePreview();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  onMounted(load);

  async function chooseClass(value: string) {
    chosenClass.value = value;
    await load();
  }

  const classInfo = computed(() => (plan.value?.classId ? CLASS_INFO[plan.value.classId] ?? null : null));
  const primary = computed(() => new Set<Ability>((classInfo.value?.order ?? []).slice(0, 2)));
  const ownClasses = computed(() => (plan.value?.classOptions ?? []).filter(option => option.level > 0));
  const otherClasses = computed(() => (plan.value?.classOptions ?? []).filter(option => option.level === 0));
  const canMulticlass = computed(() => !plan.value?.classProblem);

  const known = computed(() => new Set(info.value?.knownSpells ?? []));
  const spellName = (spell: SrdSpell) => spell.nameRu || spell.name;
  const spellNames = computed(() => new Map(spells.value.map(spell => [spell.index, spellName(spell)])));
  const byLevel = (a: SrdSpell, b: SrdSpell) => a.level - b.level || spellName(a).localeCompare(spellName(b), 'ru');
  const inList = (spell: SrdSpell) => Boolean(plan.value?.spellList && spell.classes.includes(plan.value.spellList));
  const cantripOptions = computed(() => (plan.value?.cantrips ? spells.value.filter(spell => spell.level === 0 && !known.value.has(spell.index) && inList(spell)) : []));
  const spellOptions = computed(() => {
    const value = plan.value;
    if (!value?.spells) return [];
    return spells.value
      .filter(spell => spell.level >= 1 && spell.level <= value.maxSpellLevel && !known.value.has(spell.index) && (value.anyList || inList(spell)))
      .sort(byLevel);
  });
  const replaceable = computed(() => {
    const swappable = new Set(info.value?.swappableSpells ?? []);
    return spells.value.filter(spell => swappable.has(spell.index)).sort(byLevel);
  });
  const replaceOptions = computed(() => {
    const value = plan.value;
    if (!value?.replaceSpell || !form.replaceFrom) return [];
    return spells.value
      .filter(spell => spell.level >= 1 && spell.level <= value.maxSpellLevel && !known.value.has(spell.index) && !form.spells.includes(spell.index) && inList(spell))
      .sort(byLevel);
  });
  watch(() => form.replaceFrom, () => { form.replaceTo = ''; });
  watch(() => [...form.spells], list => { if (list.includes(form.replaceTo)) form.replaceTo = ''; });
  const pickingSpells = computed(() => Boolean(plan.value?.cantrips || plan.value?.spells || (plan.value?.replaceSpell && replaceable.value.length)));

  const skillName = (index: string) => skills.value.find(skill => skill.index === index)?.nameRu ?? index;
  const gainSkillCount = computed(() => plan.value?.multiclassGain?.skills?.count ?? 0);
  const gainSkillOptions = computed(() => {
    const wanted = plan.value?.multiclassGain?.skills;
    if (!wanted) return [];
    const have = new Set(info.value?.proficientSkills ?? []);
    return skills.value.map(skill => skill.index).filter(index => !have.has(index) && (wanted.from === 'any' || wanted.from.includes(index)));
  });
  const expertiseOptions = computed(() => [...(info.value?.proficientSkills ?? []), ...form.skills].filter(skill => !(info.value?.expertiseSkills ?? []).includes(skill)));
  watch(() => [...form.skills], () => { form.expertise = form.expertise.filter(skill => expertiseOptions.value.includes(skill)); });
  const styleOptions = computed(() => (info.value?.fightingStyles ?? []).filter(style => plan.value?.fightingStyles?.includes(style.id)));

  const feats = computed(() => info.value?.feats ?? []);
  const feat = computed(() => feats.value.find(entry => entry.id === form.featId) ?? null);
  const featAbilities = computed<Ability[]>(() => (form.featId === CUSTOM_FEAT ? ABILITIES : feat.value?.abilities ?? []));
  watch(() => form.featId, () => { form.featIncrease = feat.value?.abilities?.length === 1 ? feat.value.abilities[0]! : ''; });

  const score = (ability: Ability) => info.value?.scores[ability] ?? 10;
  const pointsLeft = computed(() => 2 - ABILITIES.reduce((sum, ability) => sum + form.increases[ability], 0));
  function stepIncrease(ability: Ability, delta: number) {
    const next = form.increases[ability] + delta;
    if (next < 0 || next > 2 || (delta > 0 && (pointsLeft.value <= 0 || score(ability) + next > 20))) return;
    form.increases[ability] = next;
  }

  function toggle(list: string[], value: string, limit: number) {
    const index = list.indexOf(value);
    if (index >= 0) list.splice(index, 1);
    else if (list.length < limit) list.push(value);
  }

  function body(): Choice & { milestone?: boolean; classId?: string } {
    const value = plan.value!;
    const increases = Object.fromEntries(ABILITIES.filter(ability => form.increases[ability]).map(ability => [ability, form.increases[ability]]));
    const increase = form.featIncrease ? { increase: form.featIncrease } : {};
    const featBody = form.featId === CUSTOM_FEAT
      ? { kind: 'feat' as const, name: form.featName.trim() || '…', text: form.featText.trim(), ...increase }
      : { kind: 'feat' as const, id: form.featId, name: feat.value?.nameRu ?? form.featId, ...increase };
    return {
      hp: form.hp,
      ...(value.asi ? { asi: form.asiKind === 'asi' ? { kind: 'asi', increases } : form.featId ? featBody : null } : {}),
      ...(value.subclass ? { subclass: form.subclass || null } : {}),
      ...(value.replaceSpell && form.replaceFrom && form.replaceTo ? { replace: { from: form.replaceFrom, to: form.replaceTo } } : {}),
      ...(value.cantrips ? { cantrips: [...form.cantrips] } : {}),
      ...(value.spells ? { spells: [...form.spells] } : {}),
      ...(value.expertise ? { expertise: [...form.expertise] } : {}),
      ...(gainSkillCount.value ? { skills: [...form.skills] } : {}),
      ...(value.fightingStyles ? { fightingStyle: form.fightingStyle || null } : {}),
      ...(milestone.value ? { milestone: true } : {}),
      ...(chosenClass.value ? { classId: chosenClass.value } : {}),
    };
  }

  function applySuggestion() {
    const suggestion = info.value?.suggestion;
    if (!suggestion) return;
    const asi = suggestion.asi;
    Object.assign(form, {
      hp: suggestion.hp,
      asiKind: asi?.kind === 'feat' ? 'feat' : 'asi',
      increases: { ...emptyIncreases(), ...(asi?.kind === 'asi' ? asi.increases : {}) },
      featId: asi?.kind === 'feat' ? asi.id ?? CUSTOM_FEAT : '',
      subclass: suggestion.subclass ?? form.subclass,
      cantrips: [...(suggestion.cantrips ?? [])], spells: [...(suggestion.spells ?? [])],
      expertise: [...(suggestion.expertise ?? [])], skills: [...(suggestion.skills ?? [])],
      fightingStyle: suggestion.fightingStyle ?? '', replaceFrom: '', replaceTo: '',
    });
    if (asi?.kind === 'feat') form.featIncrease = asi.increase ?? '';
    current.value = 'summary';
  }

  const STEPS = computed<Array<{ id: StepId; label: string; icon: GameIconName }>>(() => {
    const value = plan.value;
    return [
      { id: 'class', label: t('Класс и умения'), icon: (classInfo.value?.icon ?? 'levelUp') as GameIconName },
      ...(value?.subclass ? [{ id: 'subclass' as const, label: t('Подкласс'), icon: 'subclass' as const }] : []),
      ...(value?.asi ? [{ id: 'improve' as const, label: t('Улучшение'), icon: 'stats' as const }] : []),
      ...(value?.fightingStyles || value?.expertise ? [{ id: 'talents' as const, label: value.fightingStyles ? t('Боевой стиль') : t('Компетентность'), icon: value.fightingStyles ? 'fightingStyle' as const : 'swords' as const }] : []),
      ...(pickingSpells.value ? [{ id: 'spells' as const, label: t('Заклинания'), icon: 'spellbook' as const }] : []),
      { id: 'summary', label: t('Итог'), icon: 'check' },
    ];
  });
  const stepIndex = computed(() => Math.max(0, STEPS.value.findIndex(entry => entry.id === current.value)));
  watch(STEPS, list => { if (!list.some(entry => entry.id === current.value)) current.value = 'class'; });
  function goStep(delta: number) {
    const next = STEPS.value[stepIndex.value + delta];
    if (next) current.value = next.id;
  }

  const todo = computed<Record<StepId, string[]>>(() => {
    const value = plan.value;
    const list: Record<StepId, string[]> = { class: [], subclass: [], improve: [], talents: [], spells: [], summary: [] };
    if (!value) return list;
    if (form.skills.length < gainSkillCount.value) list.class.push(tn(gainSkillCount.value - form.skills.length, 'ещё {n} навык нового класса|ещё {n} навыка нового класса|ещё {n} навыков нового класса'));
    if (value.subclass && !form.subclass) list.subclass.push(t('подкласс'));
    if (value.asi && form.asiKind === 'asi' && pointsLeft.value > 0) list.improve.push(tn(pointsLeft.value, 'ещё {n} очко|ещё {n} очка|ещё {n} очков'));
    if (value.asi && form.asiKind === 'feat') {
      if (!form.featId) list.improve.push(t('черту'));
      else if (form.featId === CUSTOM_FEAT && !form.featName.trim()) list.improve.push(t('название черты'));
      else if (form.featId !== CUSTOM_FEAT && featAbilities.value.length > 1 && !form.featIncrease) list.improve.push(t('характеристику для +1'));
    }
    if (value.fightingStyles && !form.fightingStyle) list.talents.push(t('боевой стиль'));
    if (form.expertise.length < value.expertise) list.talents.push(tn(value.expertise - form.expertise.length, 'ещё {n} навык для компетентности|ещё {n} навыка для компетентности|ещё {n} навыков для компетентности'));
    if (form.cantrips.length < value.cantrips) list.spells.push(tn(value.cantrips - form.cantrips.length, 'ещё {n} заговор|ещё {n} заговора|ещё {n} заговоров'));
    if (form.spells.length < value.spells) list.spells.push(tn(value.spells - form.spells.length, 'ещё {n} заклинание|ещё {n} заклинания|ещё {n} заклинаний'));
    if (form.replaceFrom && !form.replaceTo) list.spells.push(t('заклинание на замену'));
    return list;
  });
  const missing = computed(() => STEPS.value.flatMap(entry => todo.value[entry.id]));

  const stepValue = computed<Record<StepId, string>>(() => {
    const value = plan.value;
    const raised = ABILITIES.filter(ability => form.increases[ability]).map(ability => `${t(ABILITY_LABELS[ability])} +${form.increases[ability]}`);
    return {
      class: value ? `${value.className ?? t('класс')} ${value.classLevel - 1} → ${value.classLevel}` : '',
      subclass: value?.subclass?.options.find(option => option.value === form.subclass)?.label ?? '',
      improve: form.asiKind === 'asi' ? raised.join(', ') : form.featId === CUSTOM_FEAT ? form.featName.trim() : feat.value?.nameRu ?? '',
      talents: [styleOptions.value.find(style => style.id === form.fightingStyle)?.nameRu, ...form.expertise.map(skillName)].filter(Boolean).join(', '),
      spells: [...form.cantrips, ...form.spells].map(index => spellNames.value.get(index) ?? index).join(', '),
      summary: form.hp === 'average' ? t('средние хиты') : t('бросок хитов'),
    };
  });

  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewSeq = 0;
  async function refreshPreview() {
    if (!plan.value || result.value) return;
    const seq = ++previewSeq;
    try {
      const answer = await props.request(base(), 'POST', { ...body(), dryRun: true });
      if (seq === previewSeq) preview.value = answer;
    } catch (cause) {
      if (seq === previewSeq) error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  function queuePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void refreshPreview(), 350);
  }
  watch(form, queuePreview, { deep: true });
  onBeforeUnmount(() => clearTimeout(previewTimer));

  async function apply() {
    if (!plan.value || missing.value.length) return;
    working.value = true;
    error.value = '';
    try {
      result.value = await props.request(base(), 'POST', body());
      onDone();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      working.value = false;
    }
  }

  async function nextLevel() {
    result.value = null;
    current.value = 'class';
    await load();
  }

  return reactive({
    info, spells, skills, error, working, result, preview, chosenClass, current, form, plan, milestone,
    classInfo, primary, ownClasses, otherClasses, canMulticlass, chooseClass,
    spellName, spellNames, cantripOptions, spellOptions, replaceable, replaceOptions, pickingSpells,
    skillName, gainSkillCount, gainSkillOptions, expertiseOptions, styleOptions,
    feats, feat, featAbilities, score, pointsLeft, stepIncrease, toggle, applySuggestion,
    STEPS, stepIndex, goStep, todo, missing, stepValue, apply, nextLevel,
  });
}

export type LevelUp = ReturnType<typeof useLevelUp>;
