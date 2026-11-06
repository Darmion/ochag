<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useEscapeClose } from '../../ui/escapeStack';
import { locale } from '../../i18n/i18n';
import { ensureSrdSkills, ensureSrdSpells, type SrdSkill, type SrdSpell } from '../../rules/srd';
import { CONDITIONS, EXHAUSTION_RULES } from '../../rules/conditions';
import { SCHOOL_LABELS, SPELL_CLASSES, classesRu, componentsRu, spellTextRu } from '../../spells/spellText';
import BestiaryModal, { type BestiaryPlacement } from './BestiaryModal.vue';
import ItemArt from '../rpg/ItemArt.vue';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  campaignId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  canSpawn: boolean;
  canPlace: boolean;
  sceneId?: string;
}>();
const emit = defineEmits<{
  close: [];
  place: [placement: BestiaryPlacement];
  created: [characters: Array<{ id: string; name: string }>];
  saved: [name: string];
}>();
useEscapeClose(() => emit('close'));
const english = computed(() => locale.value !== 'ru');

type Tab = 'bestiary' | 'items' | 'spells' | 'skills' | 'conditions';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'bestiary', label: 'Бестиарий' }, { id: 'items', label: 'Предметы' }, { id: 'spells', label: 'Магия' },
  { id: 'skills', label: 'Навыки' }, { id: 'conditions', label: 'Состояния' },
];
const TAB_KEY = 'ttrpg.compendium.tab';
const tab = ref<Tab>((() => {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.some(entry => entry.id === saved) ? saved as Tab : 'bestiary';
  } catch {
    return 'bestiary';
  }
})());
watch(tab, value => { try { localStorage.setItem(TAB_KEY, value); } catch {  } });
const error = ref('');

type Gear = {
  index: string; nameRu: string; category: string; priceCp: number; weightLb: number; desc?: string;
  armor?: { kind: 'light' | 'medium' | 'heavy' | 'shield'; ac: number; dex: 'full' | 'max2' | 'none'; strength?: number; stealth?: boolean };
};
type Weapon = {
  index: string; name: string; nameRu: string; category: 'simple' | 'martial'; kind: 'melee' | 'ranged';
  damage: string | null; damageType: string | null; properties: string[]; range?: [number, number]; versatile?: string;
};
type MagicItem = {
  index: string; name: string; nameRu: string; rarity: string; attunement: boolean; description: string;
  charges?: { max: number; recharge: string; formula?: string };
};
type ItemEntry = { key: string; group: string; name: string; nameEn: string | null; facts: string[]; notes: Array<[string, string]>; text: string; art: string };

const ITEM_GROUPS: Array<{ id: string; label: string }> = [
  { id: 'weapon', label: 'Оружие' }, { id: 'armor', label: 'Доспехи и щиты' }, { id: 'gear', label: 'Снаряжение' },
  { id: 'consumable', label: 'Расходуемое' }, { id: 'ammo', label: 'Боеприпасы' }, { id: 'tools', label: 'Инструменты' },
  { id: 'focus', label: 'Фокусировки' }, { id: 'clothes', label: 'Одежда' }, { id: 'magic', label: 'Магические предметы' },
];
const DAMAGE_LABELS: Record<string, string> = {
  acid: 'кислотой', bludgeoning: 'дробящий', cold: 'холодом', fire: 'огнём', force: 'силовым полем', lightning: 'электричеством',
  necrotic: 'некротический', piercing: 'колющий', poison: 'ядом', psychic: 'психический', radiant: 'излучением', slashing: 'рубящий', thunder: 'звуком',
};
const PROPERTY_TEXT: Record<string, [string, string]> = {
  ammunition: ['Боеприпасы', 'для дальнобойной атаки нужен боеприпас; после боя половину выпущенных можно собрать.'],
  finesse: ['Фехтовальное', 'атака и урон — Силой или Ловкостью, на выбор.'],
  heavy: ['Тяжёлое', 'Маленькие существа атакуют им с помехой.'],
  light: ['Лёгкое', 'можно сражаться двумя: после атаки лёгким — бонусным действием атака вторым лёгким (урон без модификатора).'],
  loading: ['Перезарядка', 'одна атака им за действие, бонусное действие или реакцию, сколько бы атак ни было.'],
  reach: ['Досягаемость', '+5 фт. к досягаемости — и атаки, и атаки при уходе.'],
  special: ['Особое', 'свои правила — в описании.'],
  thrown: ['Метательное', 'можно бросить: дальнобойная атака той же характеристикой.'],
  'two-handed': ['Двуручное', 'атаковать — только держа двумя руками.'],
  versatile: ['Универсальное', 'двумя руками — урон больше.'],
};
const WEAPON_KIND: Record<string, string> = {
  'simple:melee': 'Простое рукопашное оружие', 'simple:ranged': 'Простое дальнобойное оружие',
  'martial:melee': 'Воинское рукопашное оружие', 'martial:ranged': 'Воинское дальнобойное оружие',
};
const ARMOR_KIND: Record<string, string> = { light: 'Лёгкий доспех', medium: 'Средний доспех', heavy: 'Тяжёлый доспех', shield: 'Щит' };
const RARITY: Record<string, string> = {
  common: 'обычный', uncommon: 'необычный', rare: 'редкий', very_rare: 'очень редкий', legendary: 'легендарный', artifact: 'артефакт',
};
const RECHARGE: Record<string, string> = { dawn: 'на рассвете', short: 'после короткого отдыха', long: 'после долгого отдыха' };

function priceText(cp: number) {
  const gold = Math.floor(cp / 100), silver = Math.floor((cp % 100) / 10), copper = cp % 10;
  return [gold && `${gold} зм`, silver && `${silver} см`, copper && `${copper} мм`].filter(Boolean).join(' ') || '0 мм';
}
const weightText = (lb: number) => (lb ? `${lb} фнт.` : 'меньше фунта');

function armorText(armor: NonNullable<Gear['armor']>) {
  if (armor.kind === 'shield') return `+${armor.ac} к КД; держится в одной руке.`;
  const dex = armor.dex === 'full' ? ' + модификатор Ловкости' : armor.dex === 'max2' ? ' + модификатор Ловкости (не больше +2)' : '';
  return `КД ${armor.ac}${dex}.`;
}

const items = ref<ItemEntry[] | null>(null);
async function loadItems() {
  if (items.value) return;
  try {
    const [gear, weapons, magic] = await Promise.all([props.request('/srd/gear'), props.request('/srd/weapons'), props.request('/srd/magic-items')]);
    const list: ItemEntry[] = [];
    for (const weapon of (weapons.weapons ?? []) as Weapon[]) {
      const facts = [
        WEAPON_KIND[`${weapon.category}:${weapon.kind}`] ?? 'Оружие',
        weapon.damage ? `Урон: ${weapon.damage} ${DAMAGE_LABELS[weapon.damageType ?? ''] ?? ''}${weapon.versatile ? `, двумя руками — ${weapon.versatile}` : ''}` : 'Без урона',
        ...(weapon.range ? [`${weapon.properties.includes('thrown') ? 'Бросок' : 'Дистанция'}: ${weapon.range[0]}/${weapon.range[1]} фт.`] : []),
      ];
      list.push({
        key: `weapon:${weapon.index}`, group: 'weapon', name: weapon.nameRu, nameEn: weapon.name, facts,
        notes: weapon.properties.map(code => PROPERTY_TEXT[code] ?? [code, '']),
        text: '', art: weapon.nameRu,
      });
    }
    for (const entry of (gear.gear ?? []) as Gear[]) {
      const facts = [`Цена: ${priceText(entry.priceCp)}`, `Вес: ${weightText(entry.weightLb)}`];
      const notes: Array<[string, string]> = [];
      if (entry.armor) {
        facts.unshift(ARMOR_KIND[entry.armor.kind] ?? 'Доспех');
        notes.push(['', armorText(entry.armor)]);
        if (entry.armor.strength) notes.push(['', `Нужна Сила ${entry.armor.strength}, иначе скорость −10 фт.`]);
        if (entry.armor.stealth) notes.push(['', 'Помеха к проверкам Ловкости (Скрытность).']);
        if (entry.armor.kind === 'heavy') notes.push(['', 'Надеть — 10 минут, снять — 5.']);
        else if (entry.armor.kind === 'medium') notes.push(['', 'Надеть — 5 минут, снять — 1.']);
        else if (entry.armor.kind === 'light') notes.push(['', 'Надеть — 1 минута, снять — 1.']);
      }
      list.push({ key: `gear:${entry.index}`, group: entry.category, name: entry.nameRu, nameEn: null, facts, notes, text: entry.desc ?? '', art: entry.nameRu });
    }
    for (const item of (magic.items ?? []) as MagicItem[]) {
      const facts = [`Чудесный предмет, ${RARITY[item.rarity] ?? item.rarity}${item.attunement ? ' (нужна настройка)' : ''}`];
      if (item.charges) facts.push(`Заряды: ${item.charges.max}${item.charges.formula ? `, ${RECHARGE[item.charges.recharge] ?? item.charges.recharge} — ${item.charges.formula}` : ''}`);
      list.push({ key: `magic:${item.index}`, group: 'magic', name: item.nameRu, nameEn: item.name, facts, notes: [], text: item.description, art: item.nameRu });
    }
    items.value = list;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}
const itemQuery = ref('');
const itemGroup = ref('');
const itemKey = ref('');
const shownItems = computed(() => {
  const needle = itemQuery.value.trim().toLocaleLowerCase('ru');
  return (items.value ?? []).filter(entry => (!itemGroup.value || entry.group === itemGroup.value)
    && (!needle || entry.name.toLocaleLowerCase('ru').includes(needle) || (entry.nameEn ?? '').toLowerCase().includes(needle)));
});
const item = computed(() => (items.value ?? []).find(entry => entry.key === itemKey.value) ?? shownItems.value[0] ?? null);
const groupLabel = (id: string) => ITEM_GROUPS.find(group => group.id === id)?.label ?? id;

const spells = ref<SrdSpell[] | null>(null);
const spellQuery = ref('');
const spellLevel = ref<number | ''>('');
const spellClass = ref('');
const spellSchool = ref('');
const spellIndex = ref('');
async function loadSpells() {
  if (spells.value) return;
  try {
    spells.value = await ensureSrdSpells(props.request);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}
const spellLabel = (spell: SrdSpell) => (english.value ? spell.name : spell.nameRu || spell.name);
const shownSpells = computed(() => {
  const needle = spellQuery.value.trim().toLocaleLowerCase('ru');
  return [...(spells.value ?? [])].sort((a, b) => a.level - b.level || spellLabel(a).localeCompare(spellLabel(b), english.value ? 'en' : 'ru'))
    .filter(spell => (spellLevel.value === '' || spell.level === spellLevel.value)
    && (!spellClass.value || spell.classes.includes(spellClass.value))
    && (!spellSchool.value || spell.school === spellSchool.value)
    && (!needle || spellLabel(spell).toLocaleLowerCase('ru').includes(needle) || spell.name.toLowerCase().includes(needle)));
});
const spell = computed(() => (spells.value ?? []).find(entry => entry.index === spellIndex.value) ?? shownSpells.value[0] ?? null);
const levelLabel = (level: number) => (level === 0 ? 'Заговор' : `${level} круг`);
const paragraphs = (text: string | null | undefined) => (text ?? '').split(/\n+/).map(line => line.trim()).filter(Boolean);

const skills = ref<SrdSkill[] | null>(null);
const skillIndex = ref('');
async function loadSkills() {
  if (skills.value) return;
  try {
    skills.value = await ensureSrdSkills(props.request);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}
const sortedSkills = computed(() => [...(skills.value ?? [])].sort((a, b) => (english.value ? a.nameEn.localeCompare(b.nameEn, 'en') : a.nameRu.localeCompare(b.nameRu, 'ru'))));
const skill = computed(() => sortedSkills.value.find(entry => entry.index === skillIndex.value) ?? sortedSkills.value[0] ?? null);

const conditionCode = ref('');
const condition = computed(() => CONDITIONS.find(entry => entry.code === conditionCode.value) ?? CONDITIONS[0]!);

watch(tab, value => {
  error.value = '';
  if (value === 'items') void loadItems();
  if (value === 'spells') void loadSpells();
  if (value === 'skills') void loadSkills();
}, { immediate: true });
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Справочник" @click.self="emit('close')">
    <section class="modal-card compendium">
      <header class="compendium-head">
        <h2>Справочник</h2>
        <nav class="compendium-tabs" role="tablist" aria-label="Разделы справочника">
          <button v-for="entry in TABS" :key="entry.id" type="button" role="tab" :aria-selected="tab === entry.id" :class="{ active: tab === entry.id }" @click="tab = entry.id">{{ entry.label }}</button>
        </nav>
        <button type="button" class="close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <BestiaryModal
        v-if="tab === 'bestiary'" embedded :can-spawn="canSpawn" :campaign-id="campaignId" :can-place="canPlace" :scene-id="sceneId" :request="request"
        @place="placement => emit('place', placement)" @created="list => emit('created', list)" @saved="name => emit('saved', name)"
      />

      <div v-else-if="tab === 'items'" class="split">
        <aside class="finder">
          <input v-model="itemQuery" type="search" placeholder="Меч, верёвка, зелье…" aria-label="Поиск предмета" />
          <select v-model="itemGroup" aria-label="Вид предмета">
            <option value="">все предметы</option>
            <option v-for="group in ITEM_GROUPS" :key="group.id" :value="group.id">{{ group.label }}</option>
          </select>
          <ul class="list" role="listbox" aria-label="Предметы">
            <li v-for="entry in shownItems" :key="entry.key">
              <button type="button" role="option" :aria-selected="item?.key === entry.key" :class="{ active: item?.key === entry.key }" @click="itemKey = entry.key">
                <span>{{ entry.name }}</span><small>{{ groupLabel(entry.group) }}</small>
              </button>
            </li>
            <li v-if="items && !shownItems.length" class="muted">Ничего не нашлось.</li>
            <li v-if="!items" class="muted">Загрузка…</li>
          </ul>
        </aside>
        <article v-if="item" class="detail" :aria-label="item.name">
          <ItemArt class="detail-art" :name="item.art" :size="72" />
          <h3>{{ item.name }} <small v-if="item.nameEn && !english" class="muted" translate="no">{{ item.nameEn }}</small></h3>
          <p class="subtitle">{{ groupLabel(item.group) }}</p>
          <hr />
          <p v-for="fact in item.facts" :key="fact">{{ fact }}</p>
          <ul v-if="item.notes.length" class="notes">
            <li v-for="([label, text], index) in item.notes" :key="index"><template v-if="label"><strong>{{ label }}</strong> — </template><span>{{ text }}</span></li>
          </ul>
          <p v-for="(line, index) in paragraphs(item.text)" :key="index" class="text">{{ line }}</p>
        </article>
      </div>

      <div v-else-if="tab === 'spells'" class="split">
        <aside class="finder">
          <input v-model="spellQuery" type="search" placeholder="Огненный шар, лечение…" aria-label="Поиск заклинания" />
          <div class="filters">
            <select v-model="spellLevel" aria-label="Круг">
              <option value="">любой круг</option>
              <option v-for="level in 10" :key="level" :value="level - 1">{{ levelLabel(level - 1) }}</option>
            </select>
            <select v-model="spellClass" aria-label="Класс">
              <option value="">любой класс</option>
              <option v-for="entry in SPELL_CLASSES" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
            </select>
            <select v-model="spellSchool" aria-label="Школа">
              <option value="">любая школа</option>
              <option v-for="(label, id) in SCHOOL_LABELS" :key="id" :value="id">{{ label }}</option>
            </select>
          </div>
          <ul class="list" role="listbox" aria-label="Заклинания">
            <li v-for="entry in shownSpells" :key="entry.index">
              <button type="button" role="option" :aria-selected="spell?.index === entry.index" :class="{ active: spell?.index === entry.index }" @click="spellIndex = entry.index">
                <span :translate="english ? 'no' : undefined">{{ spellLabel(entry) }}</span><small><template v-if="entry.level">{{ entry.level }}</template><GameIcon v-else name="sparkle" :size="12" /></small>
              </button>
            </li>
            <li v-if="spells && !shownSpells.length" class="muted">Ничего не нашлось.</li>
            <li v-if="!spells" class="muted">Загрузка…</li>
          </ul>
        </aside>
        <article v-if="spell" class="detail" :aria-label="spellLabel(spell)">
          <h3 :translate="english ? 'no' : undefined">{{ spellLabel(spell) }} <small v-if="!english" class="muted" translate="no">{{ spell.name }}</small></h3>
          <p class="subtitle">{{ levelLabel(spell.level) }}, {{ (SCHOOL_LABELS[spell.school] ?? spell.school).toLowerCase() }}{{ spell.ritual ? ' (ритуал)' : '' }}</p>
          <hr />
          <template v-if="english">
            <p><strong>Время сотворения:</strong> <span translate="no">{{ spell.castingTime }}</span></p>
            <p><strong>Дистанция:</strong> <span translate="no">{{ spell.range }}</span></p>
            <p><strong>Компоненты:</strong> <span translate="no">{{ spell.components }}<template v-if="spell.material"> ({{ spell.material }})</template></span></p>
            <p><strong>Длительность:</strong> <span translate="no">{{ spell.concentration ? 'Concentration, ' : '' }}{{ spell.duration }}</span></p>
            <p><strong>Классы:</strong> <span translate="no">{{ spell.classes.join(', ') }}</span></p>
            <hr />
            <p v-for="(line, index) in paragraphs(spell.desc)" :key="index" class="text" translate="no">{{ line }}</p>
            <p v-if="spell.higherLevel" class="text"><strong><em>На больших кругах.</em></strong> <span translate="no">{{ spell.higherLevel }}</span></p>
          </template>
          <template v-else>
            <p><strong>Время сотворения:</strong> {{ spellTextRu(spell.castingTime) }}</p>
            <p><strong>Дистанция:</strong> {{ spellTextRu(spell.range) }}</p>
            <p><strong>Компоненты:</strong> {{ componentsRu(spell.components) }}<template v-if="spell.material"> ({{ spell.material }})</template></p>
            <p><strong>Длительность:</strong> {{ spell.concentration ? 'концентрация, ' : '' }}{{ spellTextRu(spell.duration).toLowerCase() }}</p>
            <p><strong>Классы:</strong> {{ classesRu(spell.classes) }}</p>
            <hr />
            <p v-for="(line, index) in paragraphs(spell.descRu ?? spell.desc)" :key="index" class="text">{{ line }}</p>
            <p v-if="spell.higherLevelRu ?? spell.higherLevel" class="text"><strong><em>На больших кругах.</em></strong> {{ spell.higherLevelRu ?? spell.higherLevel }}</p>
          </template>
        </article>
      </div>

      <div v-else-if="tab === 'skills'" class="split">
        <aside class="finder">
          <ul class="list tall" role="listbox" aria-label="Навыки">
            <li v-for="entry in sortedSkills" :key="entry.index">
              <button type="button" role="option" :aria-selected="skill?.index === entry.index" :class="{ active: skill?.index === entry.index }" @click="skillIndex = entry.index">
                <span v-if="english" translate="no">{{ entry.nameEn }}</span><span v-else>{{ entry.nameRu }}</span><small>{{ entry.abilityRu }}</small>
              </button>
            </li>
            <li v-if="!skills" class="muted">Загрузка…</li>
          </ul>
        </aside>
        <article v-if="skill" class="detail" :aria-label="skill.nameRu">
          <h3 v-if="english" translate="no">{{ skill.nameEn }}</h3>
          <h3 v-else>{{ skill.nameRu }} <small class="muted" translate="no">{{ skill.nameEn }}</small></h3>
          <p class="subtitle">Проверка: {{ skill.abilityRu }}</p>
          <hr />
          <p v-for="(line, index) in paragraphs(english && skill.descEn ? skill.descEn : skill.descRu)" :key="index" class="text" :translate="english && skill.descEn ? 'no' : undefined">{{ line }}</p>
          <p class="hint">Бросок: к20 + модификатор характеристики + бонус мастерства, если навыком владеете (компетентность — вдвое). Проверку назначает мастер, СЛ — по сложности: 10 — легко, 15 — средне, 20 — трудно.</p>
        </article>
      </div>

      <div v-else class="split">
        <aside class="finder">
          <ul class="list tall" role="listbox" aria-label="Состояния">
            <li v-for="entry in CONDITIONS" :key="entry.code">
              <button type="button" role="option" :aria-selected="condition.code === entry.code" :class="{ active: condition.code === entry.code }" @click="conditionCode = entry.code">
                <span><b class="icon" aria-hidden="true"><GameIcon class="inline-icon" :name="entry.icon" :size="16" /></b> {{ entry.label }}</span>
              </button>
            </li>
          </ul>
        </aside>
        <article class="detail" :aria-label="condition.label">
          <h3><b class="icon" aria-hidden="true"><GameIcon class="inline-icon" :name="condition.icon" :size="20" /></b> {{ condition.label }}</h3>
          <hr />
          <p class="text">{{ condition.rule }}</p>
          <template v-if="condition.code === 'unconscious' || condition.code === 'incapacitated'">
            <h4>Истощение</h4>
            <ol class="notes"><li v-for="line in EXHAUSTION_RULES" :key="line">{{ line }}</li></ol>
          </template>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3500;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b0704cc}
.modal-card{width:min(1080px,100%);max-height:92vh;overflow-y:auto;padding:16px 22px 18px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:6px;box-shadow:0 16px 40px #000a;display:flex;flex-direction:column;gap:12px}
.compendium-head{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.compendium-head h2{margin:0;font:700 24px var(--heading-font)}
.compendium-tabs{display:flex;gap:4px;flex-wrap:wrap;flex:1}
.compendium-tabs button{min-height:32px;padding:4px 12px;font-size:14px}
.compendium-tabs button.active{background:var(--burgundy,#7a2e2e);color:var(--ivory,#fff);border-color:var(--burgundy,#7a2e2e)}
.close{min-height:30px;width:30px;padding:0}
.split{display:grid;grid-template-columns:260px 1fr;gap:16px;min-height:0}
.finder{display:flex;flex-direction:column;gap:6px;min-height:0}
.filters{display:grid;grid-template-columns:1fr;gap:6px}
.list{list-style:none;margin:0;padding:0;max-height:56vh;overflow-y:auto;border:1px solid var(--brass-light,#0002);border-radius:3px}
.list.tall{max-height:66vh}
.list button{width:100%;display:flex;justify-content:space-between;align-items:center;gap:6px;min-height:30px;padding:4px 8px;border:0;border-radius:0;background:transparent;color:inherit;font-size:13px;text-align:left;box-shadow:none}
.list button small{opacity:.75;flex:none}
.list button.active{background:var(--burgundy,#7a2e2e);color:var(--ivory,#fff)}
.list li.muted{padding:6px 8px}
.detail{max-height:66vh;overflow-y:auto;padding:4px 12px 10px;border-left:2px solid var(--burgundy,#7a2e2e);font-size:13px;line-height:1.5}
.detail h3{margin:0;font:700 22px var(--heading-font);color:var(--burgundy,#7a2e2e)}
.detail h3 small{font:400 13px inherit}
.detail h4{margin:10px 0 4px;font:700 16px var(--heading-font);color:var(--burgundy,#7a2e2e)}
.detail .subtitle{margin:0;font-style:italic}
.detail p{margin:3px 0}
.detail hr{border:0;border-top:2px solid var(--burgundy,#7a2e2e);opacity:.5;margin:6px 0}
.detail .text{margin:6px 0}
.detail .hint{margin-top:12px;padding:6px 9px;border-left:3px solid var(--brass);background:var(--surface-inset);font-size:12px}
.detail-art{float:right;margin:0 0 6px 12px}
.notes{margin:6px 0;padding-left:18px}
.notes li{margin:2px 0}
.icon{display:inline-block;min-width:18px;text-align:center}
.error{color:#c0392b;margin:0}
@media(max-width:720px){.split{grid-template-columns:1fr}.list{max-height:28vh}.detail{max-height:none;border-left:0}}
</style>
