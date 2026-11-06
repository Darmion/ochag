<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import { computed, onMounted, ref, watch } from 'vue';
import { ensureSrdSkills, ensureSrdSpells, type SrdSkill, type SrdSpell } from '../../rules/srd';
import { CLASS_OPTIONS } from '../../rules/classOptions';
import SpellPicker from '../spells/SpellPicker.vue';
import GameIcon from '../game/GameIcon.vue';

type Ability = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
type Plan = {
  from: number; to: number; classId: string | null; className: string | null; hitDie: number; averageHp: number; hpBonus: number;
  classLevel: number; newClass: boolean; multiclass: boolean; classText: string | null; prerequisites: string[];
  classOptions: Array<{ id: string; label: string; level: number }>; classProblem: string | null;
  asi: boolean; cantrips: number; spells: number; anyList: boolean; spellList: string | null; maxSpellLevel: number;
  expertise: number; fightingStyles: string[] | null; features: string[];
  multiclassGain?: { text: string; skills: { count: number; from: string[] | 'any' } | null } | null;
  subclass?: { options: Array<{ value: string; label: string }>; current: string; srd: string; srdFeatures: string[] } | null;
  replaceSpell?: boolean;
};
type Feat = { id: string; nameRu: string; en: string; text: string; abilities: Ability[] | null; known: boolean };
type Info = {
  plan: Plan | null; milestone: Plan | null; name: string; scores: Record<Ability, number>;
  proficientSkills: string[]; expertiseSkills: string[]; knownSpells: string[]; swappableSpells?: string[];
  fightingStyles: Array<{ id: string; nameRu: string; text: string }>;
  feats?: Feat[];
};
const CUSTOM_FEAT = '__custom';

const props = defineProps<{
  campaignId: string;
  characterId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();
const emit = defineEmits<{ close: []; done: [] }>();
useEscapeClose(() => emit('close'));

const ABILITIES: Ability[] = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const ABILITY_LABELS: Record<Ability, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение', intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};

const info = ref<Info | null>(null);
const spells = ref<SrdSpell[]>([]);
const skills = ref<SrdSkill[]>([]);
const error = ref('');
const working = ref(false);
const result = ref<{ level: number; className: string | null; hpGain: number; roll: number | null; features: string[]; next: Plan | null } | null>(null);
const chosenClass = ref('');

const hp = ref<'average' | 'roll'>('average');
const asiKind = ref<'asi' | 'feat'>('asi');
const asiMode = ref<'two' | 'one'>('two');
const asiFirst = ref<Ability>('strength');
const asiSecond = ref<Ability>('constitution');
const featName = ref('');
const featText = ref('');
const featId = ref('');
const featIncrease = ref<Ability | ''>('');
const subclass = ref('');
const replaceFrom = ref('');
const replaceTo = ref('');
const cantrips = ref<string[]>([]);
const newSpells = ref<string[]>([]);
const expertise = ref<string[]>([]);
const fightingStyle = ref('');
const gainedSkills = ref<string[]>([]);

const plan = computed(() => info.value?.plan ?? info.value?.milestone ?? null);
const milestone = computed(() => !info.value?.plan && Boolean(info.value?.milestone));

async function load() {
  try {
    const query = chosenClass.value ? `?classId=${chosenClass.value}` : '';
    info.value = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/level-up${query}`);
    [spells.value, skills.value] = await Promise.all([ensureSrdSpells(props.request), ensureSrdSkills(props.request)]);
    hp.value = 'average';
    cantrips.value = [];
    newSpells.value = [];
    expertise.value = [];
    gainedSkills.value = [];
    fightingStyle.value = '';
    featName.value = '';
    featText.value = '';
    featId.value = '';
    featIncrease.value = '';
    subclass.value = plan.value?.subclass?.current ?? '';
    replaceFrom.value = '';
    replaceTo.value = '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}
onMounted(load);

const ownClasses = computed(() => (plan.value?.classOptions ?? []).filter(option => option.level > 0));
const otherClasses = computed(() => (plan.value?.classOptions ?? []).filter(option => option.level === 0));
const canMulticlass = computed(() => !plan.value?.classProblem);

async function chooseClass(value: string) {
  chosenClass.value = value;
  await load();
}

const known = computed(() => new Set(info.value?.knownSpells ?? []));
const spellName = (spell: SrdSpell) => spell.nameRu || spell.name;
const cantripOptions = computed(() => {
  const value = plan.value;
  if (!value?.cantrips) return [];
  return spells.value.filter(spell => spell.level === 0 && !known.value.has(spell.index) && value.spellList && spell.classes.includes(value.spellList));
});
const spellOptions = computed(() => {
  const value = plan.value;
  if (!value?.spells) return [];
  return spells.value
    .filter(spell => spell.level >= 1 && spell.level <= value.maxSpellLevel && !known.value.has(spell.index)
      && (value.anyList || (value.spellList && spell.classes.includes(value.spellList))))
    .sort((a, b) => a.level - b.level || spellName(a).localeCompare(spellName(b), 'ru'));
});
const skillName = (index: string) => skills.value.find(skill => skill.index === index)?.nameRu ?? index;
const expertiseOptions = computed(() => [...(info.value?.proficientSkills ?? []), ...gainedSkills.value].filter(skill => !(info.value?.expertiseSkills ?? []).includes(skill)));
const gainSkillCount = computed(() => plan.value?.multiclassGain?.skills?.count ?? 0);
const gainSkillOptions = computed(() => {
  const wanted = plan.value?.multiclassGain?.skills;
  if (!wanted) return [];
  const have = new Set(info.value?.proficientSkills ?? []);
  return skills.value.map(skill => skill.index).filter(index => !have.has(index) && (wanted.from === 'any' || wanted.from.includes(index)));
});
const styleOptions = computed(() => (info.value?.fightingStyles ?? []).filter(style => plan.value?.fightingStyles?.includes(style.id)));

const subclassGroups = computed(() => {
  const options = plan.value?.subclass?.options ?? [];
  const automated = new Set(CLASS_OPTIONS.find(entry => entry.label === plan.value?.className)?.subclasses ?? []);
  return {
    automated: options.filter(option => automated.has(option.label)),
    others: options.filter(option => !automated.has(option.label) && option.value !== 'other'),
    fallback: options.find(option => option.value === 'other') ?? null,
  };
});

const subclassLabel = computed(() => plan.value?.subclass?.options.find(option => option.value === subclass.value)?.label ?? '');

const feats = computed(() => info.value?.feats ?? []);
const feat = computed(() => feats.value.find(entry => entry.id === featId.value) ?? null);
const featAbilities = computed<Ability[]>(() => (featId.value === CUSTOM_FEAT ? ABILITIES : feat.value?.abilities ?? []));
watch(featId, () => {
  const only = feat.value?.abilities?.length === 1 ? feat.value.abilities[0]! : '';
  featIncrease.value = only;
});
const featProblem = computed(() => {
  if (!featIncrease.value || !info.value) return '';
  return info.value.scores[featIncrease.value] + 1 > 20 ? `${ABILITY_LABELS[featIncrease.value]} не может стать выше 20.` : '';
});

const replaceable = computed(() => {
  const swappable = new Set(info.value?.swappableSpells ?? []);
  return spells.value.filter(spell => swappable.has(spell.index)).sort((a, b) => a.level - b.level || spellName(a).localeCompare(spellName(b), 'ru'));
});
const replaceOptions = computed(() => {
  const value = plan.value;
  if (!value?.replaceSpell || !replaceFrom.value) return [];
  return spells.value
    .filter(spell => spell.level >= 1 && spell.level <= value.maxSpellLevel && !known.value.has(spell.index) && !newSpells.value.includes(spell.index)
      && value.spellList && spell.classes.includes(value.spellList))
    .sort((a, b) => a.level - b.level || spellName(a).localeCompare(spellName(b), 'ru'));
});
watch(replaceFrom, () => { replaceTo.value = ''; });
const replaceToList = computed<string[]>({
  get: () => (replaceTo.value ? [replaceTo.value] : []),
  set: value => { replaceTo.value = value[0] ?? ''; },
});
const pickingSpells = computed(() => Boolean(plan.value?.cantrips || plan.value?.spells || (plan.value?.replaceSpell && replaceable.value.length)));
watch(newSpells, () => { if (newSpells.value.includes(replaceTo.value)) replaceTo.value = ''; }, { deep: true });

function toggle(list: string[], value: string, limit: number) {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  else if (list.length < limit) list.push(value);
}

const increases = computed<Partial<Record<Ability, number>>>(() =>
  asiMode.value === 'one' ? { [asiFirst.value]: 2 } : { [asiFirst.value]: 1, [asiSecond.value]: 1 });
const asiProblem = computed(() => {
  if (!plan.value?.asi || asiKind.value !== 'asi' || !info.value) return '';
  if (asiMode.value === 'two' && asiFirst.value === asiSecond.value) return 'Выберите две разные характеристики.';
  for (const [ability, value] of Object.entries(increases.value)) {
    if (info.value.scores[ability as Ability] + Number(value) > 20) return `${ABILITY_LABELS[ability as Ability]} не может стать выше 20.`;
  }
  return '';
});
const ready = computed(() => {
  const value = plan.value;
  if (!value) return false;
  if (value.asi) {
    if (asiKind.value === 'asi' && asiProblem.value) return false;
    if (asiKind.value === 'feat') {
      if (!featId.value || featProblem.value) return false;
      if (featId.value === CUSTOM_FEAT ? !featName.value.trim() : Boolean(feat.value?.abilities?.length) && !featIncrease.value) return false;
    }
  }
  if (value.subclass && !subclass.value) return false;
  if (replaceFrom.value && !replaceTo.value) return false;
  return cantrips.value.length === value.cantrips && newSpells.value.length === value.spells && expertise.value.length === value.expertise
    && gainedSkills.value.length === gainSkillCount.value
    && (!value.fightingStyles || Boolean(fightingStyle.value));
});

async function apply() {
  const value = plan.value;
  if (!value || !ready.value) return;
  working.value = true;
  error.value = '';
  try {
    result.value = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/level-up`, 'POST', {
      hp: hp.value,
      ...(value.asi ? { asi: asiKind.value === 'asi' ? { kind: 'asi', increases: increases.value } : featBody() } : {}),
      ...(value.subclass ? { subclass: subclass.value } : {}),
      ...(value.replaceSpell && replaceFrom.value && replaceTo.value ? { replace: { from: replaceFrom.value, to: replaceTo.value } } : {}),
      ...(value.cantrips ? { cantrips: cantrips.value } : {}),
      ...(value.spells ? { spells: newSpells.value } : {}),
      ...(value.expertise ? { expertise: expertise.value } : {}),
      ...(gainSkillCount.value ? { skills: gainedSkills.value } : {}),
      ...(value.fightingStyles ? { fightingStyle: fightingStyle.value } : {}),
      ...(milestone.value ? { milestone: true } : {}),
      ...(chosenClass.value ? { classId: chosenClass.value } : {}),
    });
    emit('done');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

function featBody() {
  const increase = featIncrease.value ? { increase: featIncrease.value } : {};
  if (featId.value === CUSTOM_FEAT) return { kind: 'feat', name: featName.value.trim(), text: featText.value.trim(), ...increase };
  return { kind: 'feat', id: featId.value, name: feat.value?.nameRu ?? featId.value, ...increase };
}

async function nextLevel() {
  result.value = null;
  await load();
}
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Новый уровень">
    <section class="modal-card level-up" :class="{ wide: pickingSpells && !result }">
      <header class="level-head">
        <h2>{{ result ? `Уровень ${result.level}!` : plan ? `Новый уровень: ${plan.from} → ${plan.to}` : 'Новый уровень' }}</h2>
        <button type="button" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <template v-if="result">
        <p class="big">{{ info?.name }} — {{ result.level }}-й уровень. Хиты: +{{ result.hpGain }}<template v-if="result.roll !== null"> (на кости {{ result.roll }})</template>.</p>
        <p v-if="result.className" class="muted">Класс: {{ result.className }}</p>
        <ul v-if="result.features.length" class="features"><li v-for="feature in result.features" :key="feature">{{ feature }}</li></ul>
        <footer class="level-foot">
          <button v-if="result.next" type="button" class="primary" @click="nextLevel">Ещё уровень: {{ result.next.from }} → {{ result.next.to }}</button>
          <button type="button" @click="emit('close')">Готово</button>
        </footer>
      </template>

      <template v-else-if="plan && info">
        <p class="muted">{{ info.name }}{{ plan.className ? ` · ${plan.className}` : '' }}<template v-if="milestone"> · по вехе, без опыта (решение мастера)</template></p>
        <section class="block">
          <h3>Какой класс повышать</h3>
          <select :value="chosenClass || plan.classId || ''" :disabled="working" aria-label="Класс" @change="chooseClass(($event.target as HTMLSelectElement).value)">
            <option v-if="!ownClasses.length" value="">— класс не указан —</option>
            <option v-for="option in ownClasses" :key="option.id" :value="option.id">{{ option.label }} {{ option.level }} → {{ option.level + 1 }}</option>
            <optgroup v-if="canMulticlass" label="Новый класс (мультикласс)">
              <option v-for="option in otherClasses" :key="option.id" :value="option.id">{{ option.label }} 1</option>
            </optgroup>
          </select>
          <p v-if="plan.classProblem" class="notice">Взять второй класс нельзя, пока запись класса в листе не поправлена: {{ plan.classProblem }}.</p>
          <p v-if="plan.multiclass && plan.classText" class="muted">Класс станет: {{ plan.classText }}</p>
          <p v-if="plan.prerequisites.length" class="notice warn" role="note">
            Требования мультикласса не выполнены: {{ plan.prerequisites.join('; ') }}. Повысить можно — решает мастер.
          </p>
        </section>

        <section v-if="plan.multiclassGain" class="block">
          <h3>Владения нового класса</h3>
          <p>{{ plan.multiclassGain.text }}.</p>
          <p class="muted">При мультиклассе — только эти, без спасбросков; оружием из листа, которое теперь по силам, отметится владение.</p>
          <template v-if="gainSkillCount">
            <h4>Навык — {{ gainedSkills.length }} из {{ gainSkillCount }}</h4>
            <div class="checks">
              <label v-for="skill in gainSkillOptions" :key="skill" class="checkbox-label">
                <input type="checkbox" :checked="gainedSkills.includes(skill)" @change="toggle(gainedSkills, skill, gainSkillCount)" /> {{ skillName(skill) }}
              </label>
            </div>
          </template>
        </section>

        <section v-if="plan.subclass" class="block">
          <h3>Подкласс — {{ plan.className }} {{ plan.classLevel }}</h3>
          <select v-model="subclass" aria-label="Подкласс">
            <optgroup v-if="subclassGroups.automated.length" label="Умения считает автоматика (SRD)">
              <option v-for="option in subclassGroups.automated" :key="option.value" :value="option.value">{{ option.label }}</option>
            </optgroup>
            <optgroup v-if="subclassGroups.others.length" label="Умения подкласса — в листе вручную">
              <option v-for="option in subclassGroups.others" :key="option.value" :value="option.value">{{ option.label }}</option>
            </optgroup>
            <option v-if="subclassGroups.fallback" :value="subclassGroups.fallback.value">{{ subclassGroups.fallback.label }} (свой, по договорённости с мастером)</option>
          </select>
          <ul v-if="plan.subclass.srdFeatures.length" class="features">
            <template v-if="subclass === plan.subclass.srd"><li v-for="feature in plan.subclass.srdFeatures" :key="feature">{{ feature }}</li></template>
            <li v-else>Умения подкласса «{{ subclassLabel }}» {{ plan.classLevel }}-го уровня впишите в лист вручную (автоматика их не считает)</li>
          </ul>
          <p class="muted">Запишется в класс — «{{ plan.className }} ({{ subclassLabel || '…' }})»; поменять потом можно в «Умениях».</p>
        </section>

        <section v-if="plan.features.length" class="block">
          <h3>Что даёт уровень</h3>
          <ul class="features"><li v-for="feature in plan.features" :key="feature">{{ feature }}</li></ul>
        </section>

        <section class="block">
          <h3>Хиты</h3>
          <label class="checkbox-label"><input v-model="hp" type="radio" value="average" /> средние: +{{ plan.averageHp }}</label>
          <label class="checkbox-label"><input v-model="hp" type="radio" value="roll" /> бросить к{{ plan.hitDie }} + Телосложение<template v-if="plan.hpBonus"> + {{ plan.hpBonus }}</template> (не меньше 1) — бросок увидят все</label>
        </section>

        <section v-if="plan.asi" class="block">
          <h3>Улучшение характеристик или черта</h3>
          <label class="checkbox-label"><input v-model="asiKind" type="radio" value="asi" /> улучшить характеристики</label>
          <div v-if="asiKind === 'asi'" class="asi-row">
            <select v-model="asiMode" aria-label="Как улучшить">
              <option value="two">+1 к двум</option>
              <option value="one">+2 к одной</option>
            </select>
            <select v-model="asiFirst" aria-label="Характеристика">
              <option v-for="ability in ABILITIES" :key="ability" :value="ability">{{ ABILITY_LABELS[ability] }} ({{ info.scores[ability] }})</option>
            </select>
            <select v-if="asiMode === 'two'" v-model="asiSecond" aria-label="Вторая характеристика">
              <option v-for="ability in ABILITIES" :key="ability" :value="ability">{{ ABILITY_LABELS[ability] }} ({{ info.scores[ability] }})</option>
            </select>
          </div>
          <p v-if="asiProblem" class="error">{{ asiProblem }}</p>
          <label class="checkbox-label"><input v-model="asiKind" type="radio" value="feat" /> взять черту</label>
          <div v-if="asiKind === 'feat'" class="feat">
            <select v-model="featId" aria-label="Черта">
              <option value="">— выберите черту —</option>
              <optgroup label="Черты, которые считает автоматика">
                <option v-for="entry in feats" :key="entry.id" :value="entry.id" :disabled="entry.known">
                  {{ entry.nameRu }}{{ entry.abilities ? ' · +1' : '' }}{{ entry.known ? ' — уже есть' : '' }}
                </option>
              </optgroup>
              <option :value="CUSTOM_FEAT">Другая черта — вписать название…</option>
            </select>
            <p v-if="feat" class="muted feat-text">{{ feat.en }}: {{ feat.text }}</p>
            <template v-if="featId === CUSTOM_FEAT">
              <input v-model="featName" maxlength="100" placeholder="Название черты" aria-label="Название черты" />
              <textarea v-model="featText" rows="2" maxlength="2000" placeholder="Что даёт (необязательно)" aria-label="Что даёт черта" />
            </template>
            <label v-if="featAbilities.length" class="feat-increase">+1 к характеристике
              <select v-model="featIncrease" aria-label="+1 к характеристике" :disabled="featAbilities.length === 1">
                <option v-if="featId === CUSTOM_FEAT" value="">— не нужно —</option>
                <option v-else-if="featAbilities.length > 1" value="">— выберите —</option>
                <option v-for="ability in featAbilities" :key="ability" :value="ability">{{ ABILITY_LABELS[ability] }} ({{ info.scores[ability] }} → {{ info.scores[ability] + 1 }})</option>
              </select>
            </label>
            <p v-if="featProblem" class="error">{{ featProblem }}</p>
          </div>
        </section>

        <section v-if="plan.fightingStyles" class="block">
          <h3>Боевой стиль</h3>
          <select v-model="fightingStyle" aria-label="Боевой стиль">
            <option value="">— выберите —</option>
            <option v-for="style in styleOptions" :key="style.id" :value="style.id">{{ style.nameRu }} — {{ style.text }}</option>
          </select>
        </section>

        <section v-if="plan.expertise" class="block">
          <h3>Компетентность — {{ expertise.length }} из {{ plan.expertise }}</h3>
          <div class="checks">
            <label v-for="skill in expertiseOptions" :key="skill" class="checkbox-label">
              <input type="checkbox" :checked="expertise.includes(skill)" @change="toggle(expertise, skill, plan.expertise)" /> {{ skillName(skill) }}
            </label>
          </div>
        </section>

        <section v-if="plan.cantrips" class="block">
          <h3>Новые заговоры</h3>
          <SpellPicker v-model="cantrips" :options="cantripOptions" :limit="plan.cantrips" label="Заговоры" />
        </section>

        <section v-if="plan.spells" class="block">
          <h3>Новые заклинания <small class="muted">(до {{ plan.maxSpellLevel }} круга{{ plan.anyList ? ', из списка любого класса' : ', из списка класса' }})</small></h3>
          <SpellPicker v-model="newSpells" :options="spellOptions" :limit="plan.spells" label="Заклинания" />
        </section>

        <section v-if="plan.replaceSpell && replaceable.length" class="block">
          <h3>Заменить заклинание <small class="muted">(по желанию: одно известное — на другое из списка класса)</small></h3>
          <div class="asi-row replace">
            <select v-model="replaceFrom" aria-label="Какое заклинание забыть">
              <option value="">— не менять —</option>
              <option v-for="spell in replaceable" :key="spell.index" :value="spell.index">{{ spellName(spell) }} · {{ spell.level }} ур.</option>
            </select>
          </div>
          <SpellPicker v-if="replaceFrom" v-model="replaceToList" :options="replaceOptions" :limit="1" :label="`Вместо «${spellName(replaceable.find(spell => spell.index === replaceFrom)!)}»`" />
        </section>

        <footer class="level-foot">
          <button type="button" @click="emit('close')">Позже</button>
          <button type="button" class="primary" :disabled="working || !ready" @click="apply">Повысить до {{ plan.to }}-го уровня{{ plan.multiclass && plan.className ? ` (${plan.className} ${plan.classLevel})` : '' }}</button>
        </footer>
      </template>

      <p v-else-if="info" class="muted">Опыта на новый уровень пока не хватает.</p>
    </section>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3500;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b0704cc}
.modal-card{width:min(720px,100%);transition:width .15s;max-height:92vh;overflow-y:auto;padding:18px 22px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:6px;box-shadow:0 16px 40px #000a;display:flex;flex-direction:column;gap:10px}
.modal-card.wide{width:min(1040px,100%)}
.level-head{display:flex;justify-content:space-between;align-items:center}
.level-head h2{margin:0;font:700 24px var(--heading-font)}
.level-head button{min-height:30px;width:30px;padding:0}
.block{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid var(--brass-light,#0003);border-radius:4px}
.block h3{margin:0 0 2px;font-size:15px}
.features{margin:0;padding-left:18px;font-size:13px;line-height:1.45}
.checkbox-label{display:inline-flex;align-items:center;gap:6px;margin:0;font-size:13px}
.asi-row{display:flex;gap:6px;flex-wrap:wrap;padding-left:22px}
.asi-row select{width:auto}
.feat{display:flex;flex-direction:column;gap:4px;padding-left:22px}
.feat select{width:auto;max-width:100%}
.feat-text{font-size:12px}
.feat-increase{display:flex;align-items:center;gap:8px;font-size:13px}
.feat-increase select{width:auto}
.replace{align-items:center;padding-left:0}
.checks{display:flex;flex-wrap:wrap;gap:4px 16px}
.checks.spells{max-height:220px;overflow-y:auto}
.level-foot{display:flex;justify-content:flex-end;gap:8px}
.big{font-size:16px;font-weight:600;margin:0}
.error{color:#c0392b;margin:0}
.notice{margin:0;font-size:13px}
.notice.warn{color:#9a6a12}
.muted{margin:0}
</style>
