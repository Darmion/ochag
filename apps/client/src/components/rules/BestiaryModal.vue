<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import { locale } from '../../i18n/i18n';
import { computed, onMounted, ref, watch } from 'vue';
import { ensureSrdMonsters, type SrdMonster } from '../../rules/srd';
import { SIZE_LABELS, type CreatureSize } from '../../campaign/objects';
import { bestiaryPortrait } from '../../art/portraitArt';
import DifficultyChip, { type DifficultyView } from './DifficultyChip.vue';
import GameIcon from '../game/GameIcon.vue';

export type BestiaryPick = { index: string; count: number };
export type BestiaryPlacement = {
  monsters: BestiaryPick[]; hp: 'average' | 'roll'; disposition: 'hostile' | 'neutral' | 'friendly'; hidden: boolean; label: string;
};

const props = withDefaults(defineProps<{
  campaignId: string;
  canPlace: boolean;
  sceneId?: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  embedded?: boolean;
  canSpawn?: boolean;
}>(), { embedded: false, canSpawn: true });

const emit = defineEmits<{
  close: [];
  place: [placement: BestiaryPlacement];
  created: [characters: Array<{ id: string; name: string }>];
  saved: [name: string];
}>();
if (!props.embedded) useEscapeClose(() => emit('close'));

const monsters = ref<SrdMonster[]>([]);
const attribution = ref('');
const error = ref('');
const working = ref(false);
const search = ref('');
const band = ref<'all' | 'low' | 'mid' | 'high' | 'top'>('all');
const selectedIndex = ref('');
const count = ref(1);
const basket = ref<BestiaryPick[]>([]);
const hp = ref<'average' | 'roll'>('average');
const disposition = ref<'hostile' | 'neutral' | 'friendly'>('hostile');
const hidden = ref(false);
const encounterName = ref('');

const BANDS: Record<typeof band.value, { label: string; test: (cr: number) => boolean }> = {
  all: { label: 'любая опасность', test: () => true },
  low: { label: 'опасность 0–1/2', test: cr => cr <= 0.5 },
  mid: { label: 'опасность 1–3', test: cr => cr >= 1 && cr <= 3 },
  high: { label: 'опасность 4–6', test: cr => cr >= 4 && cr <= 6 },
  top: { label: 'опасность 7+', test: cr => cr >= 7 },
};

const ABILITIES = ['СИЛ', 'ЛОВ', 'ТЕЛ', 'ИНТ', 'МДР', 'ХАР'];
const SAVE_LABELS: Record<string, string> = {
  strength: 'Сил', dexterity: 'Лов', constitution: 'Тел', intelligence: 'Инт', wisdom: 'Мдр', charisma: 'Хар',
};
const SKILL_LABELS: Record<string, string> = {
  acrobatics: 'Акробатика', 'animal-handling': 'Уход за животными', arcana: 'Магия', athletics: 'Атлетика',
  deception: 'Обман', history: 'История', insight: 'Проницательность', intimidation: 'Запугивание',
  investigation: 'Расследование', medicine: 'Медицина', nature: 'Природа', perception: 'Восприятие',
  performance: 'Выступление', persuasion: 'Убеждение', religion: 'Религия', 'sleight-of-hand': 'Ловкость рук',
  stealth: 'Скрытность', survival: 'Выживание',
};
const DAMAGE_LABELS: Record<string, string> = {
  acid: 'кислота', bludgeoning: 'дробящий', cold: 'холод', fire: 'огонь', force: 'силовое поле', lightning: 'электричество',
  necrotic: 'некротическая энергия', piercing: 'колющий', poison: 'яд', psychic: 'психическая энергия', radiant: 'излучение',
  slashing: 'рубящий', thunder: 'звук',
};

onMounted(async () => {
  try {
    const data = await ensureSrdMonsters(props.request);
    monsters.value = data.monsters;
    attribution.value = data.attribution;
    selectedIndex.value = data.monsters[0]?.index ?? '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
});

const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return monsters.value.filter(monster =>
    BANDS[band.value].test(monster.cr)
    && (!needle || monster.nameRu.toLowerCase().includes(needle) || monster.name.toLowerCase().includes(needle) || monster.type.toLowerCase().includes(needle)));
});

const selected = computed(() => monsters.value.find(monster => monster.index === selectedIndex.value) ?? null);
const senses = computed(() => {
  const monster = selected.value;
  if (!monster) return '';
  return [monster.darkvision ? `тёмное зрение ${monster.darkvision} фт.` : '', monster.senses ?? '', `пассивное Восприятие ${monster.passive}`]
    .filter(Boolean).join(', ');
});
const byIndex = computed(() => new Map(monsters.value.map(monster => [monster.index, monster])));

const modifier = (score: number) => {
  const value = Math.floor((score - 10) / 2);
  return value >= 0 ? `+${value}` : String(value);
};
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));
const listOf = (entries: Record<string, number> | undefined, labels: Record<string, string>) =>
  Object.entries(entries ?? {}).map(([key, value]) => `${labels[key] ?? key} ${signed(value)}`).join(', ');
const damageList = (types: string[] | undefined) => (types ?? []).map(type => DAMAGE_LABELS[type] ?? type).join(', ');
const paragraphs = (text: string) => text.split('\n\n').filter(Boolean).map(entry => {
  const dot = entry.indexOf('. ');
  return dot > 0 ? { title: entry.slice(0, dot), body: entry.slice(dot + 2) } : { title: '', body: entry };
});

const english = computed(() => locale.value !== 'ru');
const monsterName = (monster: SrdMonster) => (english.value ? monster.name : monster.nameRu);
const ATTACK_KIND: Record<string, string> = {
  melee: 'Рукопашная атака оружием', ranged: 'Дальнобойная атака оружием', both: 'Рукопашная или дальнобойная атака оружием',
};
const DAMAGE_PHRASE: Record<string, string> = {
  acid: 'урона кислотой', bludgeoning: 'дробящего урона', cold: 'урона холодом', fire: 'урона огнём',
  force: 'урона силовым полем', lightning: 'урона электричеством', necrotic: 'некротического урона',
  piercing: 'колющего урона', poison: 'урона ядом', psychic: 'психического урона', radiant: 'урона излучением',
  slashing: 'рубящего урона', thunder: 'урона звуком',
};
type AttackView = SrdMonster['attacks'][number] & { note?: string; versatile?: string; extra?: { damage: string; average: number; type: string } };
const attackKind = (attack: AttackView) => (attack.kind === 'ranged' ? ATTACK_KIND.ranged : attack.range ? ATTACK_KIND.both : ATTACK_KIND.melee)!;
const attackReach = (attack: AttackView) => (attack.kind === 'ranged'
  ? `дистанция ${attack.range![0]}/${attack.range![1]} фт.`
  : `досягаемость ${attack.reach ?? 5} фт.${attack.range ? ` или дистанция ${attack.range[0]}/${attack.range[1]} фт.` : ''}`);
const dice = (formula: string) => (formula === '1d1' ? '' : ` (${formula.replace(/([+-])/g, ' $1 ')})`);
const otherActions = computed(() => {
  const monster = selected.value;
  if (!monster) return [];
  const attacks = new Set(monster.attackLines ?? []);
  return paragraphs(monster.texts.actions).filter(entry => !attacks.has(`${entry.title}. ${entry.body}`));
});

const total = computed(() => basket.value.reduce((sum, pick) => sum + pick.count, 0));
const totalXp = computed(() => basket.value.reduce((sum, pick) => sum + (byIndex.value.get(pick.index)?.xp ?? 0) * pick.count, 0));
const basketLabel = computed(() => basket.value.map(pick => {
  const name = byIndex.value.get(pick.index)?.nameRu ?? pick.index;
  return pick.count > 1 ? `${name} ×${pick.count}` : name;
}).join(', '));

const difficulty = ref<DifficultyView | null>(null);
watch(basket, async picks => {
  if (!picks.length) { difficulty.value = null; return; }
  try {
    difficulty.value = await props.request(`/campaigns/${props.campaignId}/difficulty`, 'POST', {
      ...(props.sceneId ? { sceneId: props.sceneId } : {}), monsters: picks.map(pick => ({ index: pick.index, count: Math.max(1, Math.min(20, Math.round(pick.count || 1))) })),
    });
  } catch {
    difficulty.value = null;
  }
}, { deep: true });

function add() {
  const monster = selected.value;
  if (!monster) return;
  const amount = Math.max(1, Math.min(20, Math.round(count.value || 1)));
  const existing = basket.value.find(pick => pick.index === monster.index);
  if (existing) existing.count = Math.min(20, existing.count + amount);
  else basket.value = [...basket.value, { index: monster.index, count: amount }];
  if (!encounterName.value.trim()) encounterName.value = monster.nameRu;
}

function remove(index: string) {
  basket.value = basket.value.filter(pick => pick.index !== index);
}

function place() {
  if (!basket.value.length) return;
  emit('place', { monsters: basket.value, hp: hp.value, disposition: disposition.value, hidden: hidden.value, label: basketLabel.value });
}

async function create() {
  if (!basket.value.length) return;
  working.value = true;
  error.value = '';
  try {
    const result = await props.request(`/campaigns/${props.campaignId}/bestiary/spawn`, 'POST', {
      monsters: basket.value, hp: hp.value, disposition: disposition.value,
    });
    emit('created', result.characters);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

async function saveEncounter() {
  const name = encounterName.value.trim();
  if (!basket.value.length || !name) return;
  working.value = true;
  error.value = '';
  try {
    await props.request(`/campaigns/${props.campaignId}/encounters/bestiary`, 'POST', { name, monsters: basket.value });
    emit('saved', name);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <div :class="embedded ? 'bestiary-embedded' : 'modal-overlay'" :role="embedded ? undefined : 'dialog'" :aria-modal="embedded ? undefined : 'true'" aria-label="Бестиарий" @click.self="!embedded && emit('close')">
    <section :class="embedded ? 'bestiary plain' : 'modal-card bestiary'">
      <header v-if="!embedded" class="bestiary-head">
        <h2>Бестиарий</h2>
        <button type="button" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="bestiary-body">
        <aside class="finder">
          <input v-model="search" type="search" placeholder="Гоблин, дракон, нежить…" aria-label="Поиск монстра" />
          <select v-model="band" aria-label="Опасность">
            <option v-for="(entry, key) in BANDS" :key="key" :value="key">{{ entry.label }}</option>
          </select>
          <ul class="monster-list" role="listbox" aria-label="Монстры">
            <li v-for="monster in filtered" :key="monster.index">
              <button
                type="button" role="option" :aria-selected="monster.index === selectedIndex"
                :class="{ active: monster.index === selectedIndex }" @click="selectedIndex = monster.index"
              >
                <span class="monster-name" :translate="english ? 'no' : undefined"><img v-if="bestiaryPortrait(monster.index)" :src="bestiaryPortrait(monster.index)!" alt="" loading="lazy" />{{ monsterName(monster) }}</span>
                <small>{{ monster.crText }}</small>
              </button>
            </li>
            <li v-if="!filtered.length" class="muted">Ничего не нашлось.</li>
          </ul>
        </aside>

        <article v-if="selected" class="stat-block" :aria-label="`Лист: ${selected.nameRu}`">
          <img v-if="bestiaryPortrait(selected.index)" class="monster-portrait" :src="bestiaryPortrait(selected.index)!" :alt="`Портрет: ${selected.nameRu}`" />
          <h3 v-if="english" translate="no">{{ selected.name }}</h3>
          <h3 v-else>{{ selected.nameRu }} <small class="muted" translate="no">{{ selected.name }}</small></h3>
          <p class="subtitle"><span>{{ SIZE_LABELS[selected.size as CreatureSize] ?? selected.size }}</span> <span>{{ selected.type }}</span>, <span>{{ selected.alignment }}</span></p>
          <hr />
          <p><strong>Класс доспеха</strong> {{ selected.ac }}<template v-if="selected.acNote"> ({{ selected.acNote }})</template></p>
          <p><strong>Хиты</strong> {{ selected.hp }} ({{ selected.hitDice }})</p>
          <p><strong>Скорость</strong> {{ selected.speed }} фт.<template v-if="selected.speedNote">, {{ selected.speedNote }}</template></p>
          <hr />
          <div class="abilities">
            <div v-for="(label, index) in ABILITIES" :key="label">
              <strong>{{ label }}</strong>
              <span>{{ selected.abilities[index] }} ({{ modifier(selected.abilities[index]!) }})</span>
            </div>
          </div>
          <hr />
          <p v-if="selected.saves"><strong>Спасброски</strong> {{ listOf(selected.saves, SAVE_LABELS) }}</p>
          <p v-if="selected.skills"><strong>Навыки</strong> {{ listOf(selected.skills, SKILL_LABELS) }}</p>
          <p v-if="selected.vulnerable?.length"><strong>Уязвимость</strong> {{ damageList(selected.vulnerable) }}</p>
          <p v-if="selected.resistant?.length"><strong>Сопротивление</strong> {{ damageList(selected.resistant) }}</p>
          <p v-if="selected.immune?.length"><strong>Иммунитет к урону</strong> {{ damageList(selected.immune) }}</p>
          <p v-if="selected.conditionImmunities"><strong>Иммунитет к состояниям</strong> {{ selected.conditionImmunities }}</p>
          <p><strong>Чувства</strong> {{ senses }}</p>
          <p><strong>Языки</strong> {{ selected.languages }}</p>
          <p><strong>Опасность</strong> {{ selected.crText }} ({{ selected.xp }} опыта) · <strong>бонус мастерства</strong> {{ signed(selected.proficiency) }}</p>
          <hr />
          <p v-for="(entry, index) in paragraphs(selected.texts.traits)" :key="index" class="entry"><strong><em>{{ entry.title }}.</em></strong> {{ entry.body }}</p>
          <h4>Действия</h4>
          <p v-for="(entry, index) in otherActions.filter(item => /^Мультиатака/.test(item.title))" :key="`m${index}`" class="entry"><strong><em>{{ entry.title }}.</em></strong> {{ entry.body }}</p>
          <p v-for="(attack, index) in (selected.attacks as AttackView[])" :key="`a${index}`" class="entry">
            <strong><em>{{ attack.name }}.</em></strong> <span>{{ attackKind(attack) }}</span>: <span>{{ attack.toHit >= 0 ? `+${attack.toHit}` : attack.toHit }} к попаданию</span>, <span>{{ attackReach(attack) }}</span>, <span>одна цель</span>.
            <template v-if="attack.damage && attack.type"><span>Попадание:</span> {{ attack.average }}{{ dice(attack.damage) }} <span>{{ DAMAGE_PHRASE[attack.type] }}</span><template v-if="attack.extra"> <span>плюс</span> {{ attack.extra.average }}{{ dice(attack.extra.damage) }} <span>{{ DAMAGE_PHRASE[attack.extra.type] }}</span></template>.</template>
            <template v-if="attack.note">{{ ' ' }}<span>{{ attack.note }}</span></template>
          </p>
          <p v-for="(entry, index) in otherActions.filter(item => !/^Мультиатака/.test(item.title))" :key="`o${index}`" class="entry"><strong><em>{{ entry.title }}.</em></strong> {{ entry.body }}</p>
          <template v-if="selected.texts.reactions">
            <h4>Реакции</h4>
            <p v-for="(entry, index) in paragraphs(selected.texts.reactions)" :key="index" class="entry"><strong><em>{{ entry.title }}.</em></strong> {{ entry.body }}</p>
          </template>
          <div v-if="canSpawn" class="add-row">
            <label>Сколько <input v-model.number="count" type="number" min="1" max="20" /></label>
            <button type="button" class="primary" :disabled="working" @click="add">+ В состав</button>
          </div>
        </article>
      </div>

      <section v-if="canSpawn" class="basket" aria-label="Состав">
        <h3>Состав <small v-if="total" class="muted">{{ total }} · {{ totalXp }} опыта</small> <DifficultyChip v-if="total" :result="difficulty" prefix="для отряда:" /></h3>
        <ul v-if="basket.length">
          <li v-for="pick in basket" :key="pick.index">
            <span>{{ byIndex.get(pick.index)?.nameRu }}</span>
            <input v-model.number="pick.count" type="number" min="1" max="20" :aria-label="`Сколько: ${byIndex.get(pick.index)?.nameRu}`" />
            <button type="button" :aria-label="`Убрать: ${byIndex.get(pick.index)?.nameRu}`" @click="remove(pick.index)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
          </li>
        </ul>
        <p v-else class="muted">Выберите монстра слева и нажмите «+ В состав».</p>

        <div class="options">
          <label><input v-model="hp" type="radio" value="average" /> средние хиты</label>
          <label><input v-model="hp" type="radio" value="roll" /> бросить кости хитов</label>
          <label>Отношение
            <select v-model="disposition">
              <option value="hostile">враждебные</option>
              <option value="neutral">нейтральные</option>
              <option value="friendly">дружественные</option>
            </select>
          </label>
          <label v-if="canPlace"><input v-model="hidden" type="checkbox" /> скрыты от игроков</label>
        </div>

        <div class="actions">
          <button v-if="canPlace" type="button" class="primary" :disabled="working || !basket.length" title="Затем щёлкните по клетке карты" @click="place">Поставить на стол</button>
          <button type="button" :disabled="working || !basket.length" title="Создать листы в кампании, на стол не ставить" @click="create">Создать без сцены</button>
          <span class="bestiary-save">
            <input v-model="encounterName" maxlength="100" placeholder="Название встречи" aria-label="Название встречи" />
            <button type="button" :disabled="working || !basket.length || !encounterName.trim()" @click="saveEncounter">Сохранить встречей</button>
          </span>
        </div>
      </section>

      <small class="attribution">{{ attribution }}</small>
    </section>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3500;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b0704cc}
.bestiary.plain{display:flex;flex-direction:column;gap:12px;min-height:0}
.modal-card{width:min(1040px,100%);max-height:92vh;overflow-y:auto;padding:18px 22px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:6px;box-shadow:0 16px 40px #000a;display:flex;flex-direction:column;gap:12px}
.bestiary-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.bestiary-head h2{margin:0;font:700 24px var(--heading-font)}
.bestiary-head button{min-height:30px;width:30px;padding:0}
.bestiary-body{display:grid;grid-template-columns:240px 1fr;gap:16px;min-height:0}
.finder{display:flex;flex-direction:column;gap:6px;min-height:0}
.monster-list{list-style:none;margin:0;padding:0;max-height:52vh;overflow-y:auto;border:1px solid var(--brass-light,#0002);border-radius:3px}
.monster-list button{width:100%;display:flex;justify-content:space-between;gap:6px;min-height:30px;padding:4px 8px;border:0;border-radius:0;background:transparent;color:inherit;font-size:13px;text-align:left;box-shadow:none}
.monster-list button.active{background:var(--burgundy,#7a2e2e);color:var(--ivory,#fff)}
.monster-list li.muted{padding:6px 8px}
.monster-name{display:flex;align-items:center;gap:7px;min-width:0}
.monster-name img{flex:none;width:26px;height:26px;border-radius:3px;object-fit:cover;object-position:top;image-rendering:pixelated;background:#0002}
.monster-portrait{float:right;width:112px;height:112px;margin:2px 0 6px 12px;border:1px solid var(--brass,#a68148);border-radius:4px;object-fit:cover;image-rendering:pixelated;background:#0002}
.stat-block{max-height:60vh;overflow-y:auto;padding:4px 12px 10px;border-left:2px solid var(--burgundy,#7a2e2e);font-size:13px;line-height:1.45}
.stat-block h3{margin:0;font:700 22px var(--heading-font);color:var(--burgundy,#7a2e2e)}
.stat-block h3 small{font:400 13px inherit}
.stat-block h4{margin:10px 0 4px;font:700 16px var(--heading-font);color:var(--burgundy,#7a2e2e);border-bottom:1px solid var(--burgundy,#7a2e2e)}
.stat-block .subtitle{margin:0;font-style:italic}
.stat-block p{margin:2px 0}
.stat-block hr{border:0;border-top:2px solid var(--burgundy,#7a2e2e);opacity:.5;margin:6px 0}
.stat-block .entry{margin:4px 0}
.abilities{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;text-align:center}
.abilities div{display:flex;flex-direction:column}
.add-row{display:flex;align-items:flex-end;gap:8px;margin-top:10px}
.add-row label{display:flex;flex-direction:column;gap:2px;margin:0;width:90px}
.basket{border-top:1px solid var(--brass-light,#0002);padding-top:8px;display:flex;flex-direction:column;gap:8px}
.basket h3{margin:0;font-size:16px}
.basket ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.basket li{display:flex;align-items:center;gap:4px;padding:2px 6px;border:1px solid var(--brass-light,#0002);border-radius:3px}
.basket li input{width:52px;min-height:26px;padding:1px 4px}
.basket li button{min-height:26px;width:26px;padding:0}
.options{display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:13px}
.options label{display:flex;align-items:center;gap:4px;margin:0}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.bestiary-save{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.bestiary-save input{width:200px}
.attribution{font-size:11px;opacity:.7;line-height:1.3}
.error{color:#c0392b;margin:0}
@media(max-width:720px){.bestiary-body{grid-template-columns:1fr}.monster-list{max-height:28vh}.stat-block{max-height:none;border-left:0}}
</style>
