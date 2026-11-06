<script setup lang="ts">
import VisibilityControl, { type VisibilitySetting } from '../common/VisibilityControl.vue';
import ChipMultiSelect from '../common/ChipMultiSelect.vue';
import BossEditor from './BossEditor.vue';
import ProficiencyEditor from './ProficiencyEditor.vue';
import AppearanceSection from './AppearanceSection.vue';
import type { CampaignMember } from '../../campaign/members';
import { DISPOSITION_LABELS, KIND_LABELS, OBJECT_KINDS, SIZE_LABELS } from '../../campaign/objects';
import { DAMAGE_TYPES, MATERIALS } from '../../rules/objectRules';
import { ABILITIES, ABILITY_LABELS, modifier } from '../../characterSheet/abilities';
import { CHALLENGES, CREATURE_TYPE_OPTIONS, DEFENSE_LABELS, challengeLabel, type SheetEditForm } from '../../characterSheet/editForm';
import type { Appearance } from '../../characterSheet/appearance';
import type { Proficiencies } from '../../characterSheet/proficiencies';
import type { CharacterDTO, SheetRequest } from '../../characterSheet/types';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  form: SheetEditForm;
  character: CharacterDTO;
  isCreature: boolean;

  readOnly: boolean;
  busy: boolean;
  rollBusy: boolean;
  canManageKinds: boolean;

  levelUpReady: boolean;
  experiencePercent: number;
  proficiencyBonus: number | null;

  proficiencies: Proficiencies;
  legacySkills: Array<[string, unknown]>;
  legacySaves: Array<[string, unknown]>;
  appearance: Appearance;

  campaignId: string;
  characterId: string;
  request: SheetRequest;
  campaignMembers: CampaignMember[];
  visibilityFor: (fieldKey: string) => VisibilitySetting;
  isHidden: (field: string) => boolean;
}>();
const emit = defineEmits<{ visibility: [fieldKey: string, setting: VisibilitySetting]; roll: [key: string]; 'level-up': []; dirty: [] }>();
const onVisibilityChange = (fieldKey: string, setting: VisibilitySetting) => emit('visibility', fieldKey, setting);
</script>

<template>
  <section class="sheet-tab sheet-editor">
    <h3>{{ readOnly ? 'Данные листа' : 'Правка листа' }}</h3>
    <p v-if="!readOnly" class="muted">Измените поля и сохраните лист кнопкой ниже. Переключение разделов сохраняет введённые значения.</p>
    <p v-if="readOnly" class="muted">Просмотр чужого листа — только чтение.</p>

    <label v-if="!readOnly">
      Имя
      <input v-model="form.name" maxlength="200" :disabled="busy" />
    </label>

    <div v-if="!readOnly" class="kind-grid">
      <label>
        Вид
        <select v-model="form.kind" :disabled="busy || !canManageKinds">
          <option v-for="kind in OBJECT_KINDS" :key="kind" :value="kind">{{ KIND_LABELS[kind] }}</option>
        </select>
      </label>
      <label v-if="form.kind === 'npc'">
        Отношение к отряду
        <select v-model="form.disposition" :disabled="busy || !canManageKinds">
          <option v-for="(label, value) in DISPOSITION_LABELS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <label>
        Размер
        <select v-model="form.size" :disabled="busy">
          <option v-for="(label, value) in SIZE_LABELS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
    </div>
    <p v-if="!readOnly && !canManageKinds" class="muted">Вид объекта и отношение НПС меняет мастер.</p>

    <label v-if="!readOnly && isCreature">
      Уровень
      <input type="number" min="1" max="20" v-model.number="form.level" :disabled="busy" placeholder="не указан" />
    </label>
    <p v-else-if="isCreature && character.level !== null">Уровень: {{ character.level }}</p>

    <div v-if="character.kind === 'character' && character.experience_info" class="xp-block">
      <label v-if="!readOnly">
        Опыт
        <input type="number" min="0" max="10000000" v-model.number="form.experience" :disabled="busy" />
      </label>
      <p v-else>Опыт: {{ character.experience ?? 0 }}</p>
      <div class="xp-bar" role="progressbar" :aria-valuenow="character.experience ?? 0" :aria-valuemin="character.experience_info.floor" :aria-valuemax="character.experience_info.next ?? undefined">
        <span :style="{ width: `${experiencePercent}%` }" />
      </div>
      <small class="muted">
        {{ character.experience_info.next === null ? 'Наивысший уровень' : `${character.experience ?? 0} / ${character.experience_info.next} — до ${(character.level ?? 1) + 1}-го уровня` }}
      </small>
      <button v-if="!readOnly && levelUpReady" type="button" class="primary level-up-button" :disabled="busy" @click="emit('level-up')"><GameIcon class="inline-icon" name="levelUp" :size="16" /> Новый уровень!</button>
      <button v-else-if="!readOnly && canManageKinds && (character.level ?? 1) < 20" type="button" class="link-button" :disabled="busy" title="Без опыта — по решению мастера" @click="emit('level-up')">Уровень по вехе…</button>
    </div>

    <div v-if="character.kind === 'npc'" class="xp-block">
      <template v-if="!readOnly">
        <label title="Уровень опасности: опыт за победу — по таблице">
          Уровень опасности
          <select v-model="form.challenge" :disabled="busy">
            <option value="">не указан</option>
            <option v-for="value in CHALLENGES" :key="value" :value="value">{{ challengeLabel(value) }}</option>
          </select>
        </label>
        <label title="Пусто — по уровню опасности">
          Опыт за победу
          <input type="number" min="0" max="1000000" v-model.number="form.xpAward" :disabled="busy" :placeholder="character.experience_info?.reward ? String(character.experience_info.reward) : 'по уровню опасности'" />
        </label>
      </template>
      <small v-if="character.experience_info?.reward" class="muted">Повергнув его, отряд на сцене поделит {{ character.experience_info.reward }} опыта.</small>
    </div>
    <BossEditor v-if="character.kind === 'npc' && canManageKinds && !readOnly" :campaign-id="campaignId" :character-id="characterId" :request="request" />

    <label v-if="!readOnly && isCreature" title="СЛ спасброска = 8 + мастерство + модификатор, атака заклинанием = мастерство + модификатор">
      Базовая характеристика заклинаний
      <select v-model="form.spellcasting" :disabled="busy">
        <option value="">лучшая из Интеллекта, Мудрости, Харизмы</option>
        <option v-for="key in ABILITIES" :key="key" :value="key">{{ ABILITY_LABELS[key] }}</option>
      </select>
    </label>

    <label v-if="!readOnly && isCreature" title="По классу — кость хитов, «Дополнительная атака», ячейки заклинаний. Пусто — из импортированного листа">
      Класс
      <input v-model="form.className" maxlength="100" :disabled="busy" placeholder="например: Воин или Fighter 5 / Wizard 3" />
    </label>
    <p v-else-if="isCreature && character.class_name">Класс: {{ character.class_name }}</p>
    <p v-if="isCreature && character.class_info?.multiclass" class="muted class-parsed">
      Мультикласс: {{ character.class_info.classes?.map(entry => `${entry.label} ${entry.level}`).join(' · ') }}
    </p>
    <p v-else-if="isCreature && character.class_info?.problem" class="notice class-parsed" role="note">
      Мультикласс не понят: {{ character.class_info.problem }}. Пока считается по первому классу — {{ character.class_info.classes?.[0]?.label }} {{ character.level ?? 1 }}.
    </p>

    <label v-if="!readOnly && isCreature" title="Атак в действии «Атака»: «Дополнительная атака» по классу или мультиатака НПС">
      Атак за действие
      <input type="number" min="1" max="10" v-model.number="form.attacks" :disabled="busy" :placeholder="`по классу: ${character.class_info?.attacksPerAction ?? 1}`" />
    </label>
    <p v-else-if="isCreature && (character.class_info?.attacksPerAction ?? 1) > 1">Атак за действие: {{ character.class_info?.attacksPerAction }}</p>

    <label v-if="!readOnly && isCreature" title="Кость хитов класса: тратится на коротком отдыхе">
      Кость хитов
      <select v-model="form.hitDie" :disabled="busy">
        <option value="">по классу из листа{{ character.hit_dice && !character.hit_die ? ` (${character.hit_dice.pools && character.hit_dice.pools.length > 1 ? character.hit_dice.pools.map(pool => `${pool.total}d${pool.die}`).join(' + ') : `d${character.hit_dice.die}`})` : '' }}</option>
        <option v-for="die in [6, 8, 10, 12]" :key="die" :value="die">d{{ die }}</option>
      </select>
    </label>

    <div v-if="isCreature" class="ability-grid">
      <template v-if="!readOnly">
        <label v-for="key in (Object.keys(form.abilities) as Array<keyof typeof form.abilities>)" :key="key">
          {{ key }}
          <input type="number" min="0" v-model.number="form.abilities[key]" :disabled="busy" />
          <span class="modifier">{{ modifier(form.abilities[key]) }}</span>
          <button type="button" class="roll-button" :disabled="rollBusy" @click="emit('roll', key)">Бросить</button>
          <VisibilityControl
            :field-key="key"
            :campaign-id="campaignId"
            :character-id="characterId"
            :request="request"
            :setting="visibilityFor(key)"
            :members="campaignMembers"
            @change="s => onVisibilityChange(key, s)"
          />
        </label>
      </template>
      <template v-else>
        <div v-for="key in (['strength','dexterity','constitution','intelligence','wisdom','charisma'] as const)" :key="key" class="ability-view">
          {{ key }}
          <span v-if="isHidden(key)" class="muted">скрыто</span>
          <span v-else>{{ character[key] }} ({{ modifier(character[key]) }})</span>
        </div>
      </template>
    </div>

    <ProficiencyEditor
      v-if="isCreature && (!readOnly || legacySkills.length || legacySaves.length)"
      :proficiencies="proficiencies" :read-only="readOnly" :legacy-skills="legacySkills" :legacy-saves="legacySaves"
      :campaign-id="campaignId" :character-id="characterId" :request="request" :campaign-members="campaignMembers"
      :visibility-for="visibilityFor" @visibility="onVisibilityChange"
    />

    <div class="hp-grid">
      <template v-if="!readOnly">
        <label>
          Текущие хиты
          <input type="number" min="0" v-model.number="form.hpCurrent" :disabled="busy" />
          <VisibilityControl field-key="hp_current" :campaign-id="campaignId" :character-id="characterId" :request="request" :setting="visibilityFor('hp_current')" :members="campaignMembers" @change="s => onVisibilityChange('hp_current', s)" />
        </label>
        <label>
          Максимум хитов
          <input type="number" min="0" v-model.number="form.hpMax" :disabled="busy" />
          <VisibilityControl field-key="hp_max" :campaign-id="campaignId" :character-id="characterId" :request="request" :setting="visibilityFor('hp_max')" :members="campaignMembers" @change="s => onVisibilityChange('hp_max', s)" />
        </label>
        <label>
          Временные хиты
          <input type="number" min="0" v-model.number="form.hpTemp" :disabled="busy" />
          <VisibilityControl field-key="hp_temp" :campaign-id="campaignId" :character-id="characterId" :request="request" :setting="visibilityFor('hp_temp')" :members="campaignMembers" @change="s => onVisibilityChange('hp_temp', s)" />
        </label>
      </template>
      <template v-else>
        <div>Текущие хиты: <span v-if="isHidden('hp_current')" class="muted">скрыто</span><span v-else>{{ character.hp_current }}</span></div>
        <div>Максимум хитов: <span v-if="isHidden('hp_max')" class="muted">скрыто</span><span v-else>{{ character.hp_max }}</span></div>
        <div>Временные хиты: <span v-if="isHidden('hp_temp')" class="muted">скрыто</span><span v-else>{{ character.hp_temp }}</span></div>
      </template>
    </div>

    <label v-if="!readOnly">
      КД
      <input type="number" v-model.number="form.armorClass" :disabled="busy" />
      <VisibilityControl field-key="armor_class" :campaign-id="campaignId" :character-id="characterId" :request="request" :setting="visibilityFor('armor_class')" :members="campaignMembers" @change="s => onVisibilityChange('armor_class', s)" />
    </label>
    <p v-else>КД: <span v-if="isHidden('armor_class')" class="muted">скрыто</span><span v-else>{{ character.armor_class }}</span></p>

    <template v-if="character.kind === 'object'">
      <label v-if="!readOnly">
        Порог урона (пусто — нет): урон меньше не проходит
        <input type="number" min="0" max="1000" v-model.number="form.damageThreshold" :disabled="busy" />
      </label>
      <p v-else-if="character.damage_threshold">Порог урона: {{ character.damage_threshold }}</p>

      <div v-if="!readOnly" class="dmg-hint">
        <label>
          Материал
          <select v-model="form.hintMaterial" :disabled="busy">
            <option v-for="entry in MATERIALS" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
          </select>
        </label>
        <label>
          Прочность
          <select v-model="form.hintDurability" :disabled="busy">
            <option value="resilient">прочный</option>
            <option value="fragile">хрупкий</option>
          </select>
        </label>
        <button type="button" :disabled="busy" @click="form.applyObjectHint">Подставить по таблице предметов</button>
        <small class="muted">По таблице предметов: {{ form.objectHintValue.text }} Сохраните лист, чтобы применить.</small>
      </div>
    </template>

    <div v-if="!readOnly" class="defenses">
      <ChipMultiSelect
        v-for="(label, kind) in DEFENSE_LABELS" :key="kind"
        :label="label" :options="DAMAGE_TYPES" :model-value="form.defenses[kind]" :disabled="busy"
        @update:model-value="value => { form.defenses[kind] = value; emit('dirty'); }"
      />
      <small class="muted">Урон этого типа: сопротивление — вдвое меньше, иммунитет — не проходит, уязвимость — вдвое больше. Сохраните лист.</small>
    </div>
    <p v-else-if="(character.damage_resistances?.length || character.damage_immunities?.length || character.damage_vulnerabilities?.length)" class="muted">
      <template v-if="character.damage_resistances?.length">Сопротивление: {{ character.damage_resistances.map(id => DAMAGE_TYPES.find(type => type.id === id)?.label ?? id).join(', ') }}. </template>
      <template v-if="character.damage_immunities?.length">Иммунитет: {{ character.damage_immunities.map(id => DAMAGE_TYPES.find(type => type.id === id)?.label ?? id).join(', ') }}. </template>
      <template v-if="character.damage_vulnerabilities?.length">Уязвимость: {{ character.damage_vulnerabilities.map(id => DAMAGE_TYPES.find(type => type.id === id)?.label ?? id).join(', ') }}.</template>
    </p>

    <label v-if="!readOnly">
      Скорость, фут.
      <input type="number" min="0" v-model.number="form.speedFeet" :disabled="busy" />
      <VisibilityControl field-key="speed_feet" :campaign-id="campaignId" :character-id="characterId" :request="request" :setting="visibilityFor('speed_feet')" :members="campaignMembers" @change="s => onVisibilityChange('speed_feet', s)" />
    </label>
    <p v-else>Скорость: <span v-if="isHidden('speed_feet')" class="muted">скрыто</span><span v-else>{{ character.speed_feet }} фут.</span></p>

    <template v-if="character.kind !== 'object'">
      <label v-if="!readOnly" title="«Взлететь» в меню фигуры: местность и ямы не мешают; сбитый с ног — падает">
        Скорость полёта, фут. (пусто — не летает)
        <input type="number" min="0" max="1000" step="5" v-model.number="form.flySpeed" :disabled="busy" placeholder="нет" />
      </label>
      <p v-else-if="form.flySpeed">Полёт: {{ form.flySpeed }} фут.</p>
      <label v-if="!readOnly">
        Тёмное зрение, фут. (пусто — нет)
        <input type="number" min="0" max="1000" step="5" v-model.number="form.darkvision" :disabled="busy" placeholder="нет" />
      </label>
      <p v-else-if="form.darkvision">Тёмное зрение: {{ form.darkvision }} фут.</p>
      <small v-if="!readOnly" class="muted">В темноте видит на этой дистанции — в оттенках серого; полумрак видит как яркий свет.</small>
      <div v-if="!readOnly" class="senses-row">
        <label>
          Истинное зрение, фут.
          <input type="number" min="0" max="1000" step="5" v-model.number="form.truesight" :disabled="busy" placeholder="нет" />
        </label>
        <label>
          Слепое зрение, фут.
          <input type="number" min="0" max="1000" step="5" v-model.number="form.blindsight" :disabled="busy" placeholder="нет" />
        </label>
      </div>
      <p v-else-if="form.truesight || form.blindsight">
        <template v-if="form.truesight">Истинное зрение: {{ form.truesight }} фут.</template>
        <template v-if="form.truesight && form.blindsight"> · </template>
        <template v-if="form.blindsight">Слепое зрение: {{ form.blindsight }} фут.</template>
      </p>
      <small v-if="!readOnly" class="muted">Видят невидимых в пределах дальности; истинное — и сквозь темноту, слепое — и без глаз.</small>
      <label v-if="!readOnly && character.kind === 'npc'">
        Тип существа
        <select v-model="form.creatureType" :disabled="busy">
          <option value="">— из бестиария или не указан —</option>
          <option v-for="[id, label] in CREATURE_TYPE_OPTIONS" :key="id" :value="id">{{ label }}</option>
        </select>
      </label>
      <p v-else-if="form.creatureType">Тип: {{ CREATURE_TYPE_OPTIONS.find(([id]) => id === form.creatureType)?.[1] ?? form.creatureType }}</p>
    </template>

    <div v-if="character.kind === 'object'" class="hp-grid">
      <label v-if="!readOnly">Цена, зм (пусто — не продаётся)
        <input v-model.number="form.priceGold" type="number" min="0" step="0.01" :disabled="busy" placeholder="—" />
      </label>
      <p v-else>Цена: {{ character.price_cp === null || character.price_cp === undefined ? '—' : `${character.price_cp / 100} зм` }}</p>
      <label v-if="!readOnly">Вес, фнт.
        <input v-model.number="form.weight" type="number" min="0" step="0.1" :disabled="busy" placeholder="—" />
      </label>
      <p v-else>Вес: {{ character.weight_lb ?? '—' }} фнт.</p>
    </div>
    <label v-if="character.kind === 'npc' && canManageKinds && !readOnly" class="checkbox-label">
      <input v-model="form.merchant" type="checkbox" :disabled="busy" /> Торговец — вещи в его инвентаре с ценой можно купить
    </label>

    <p v-if="proficiencyBonus !== null" class="muted">
      Бонус мастерства: {{ proficiencyBonus }}
      <template v-if="character.level !== null">(по уровню {{ character.level }})</template>
      <template v-else-if="!readOnly">(поле «proficiency» в «Сырых данных» внизу «Правки листа» — устареет, как только будет указан уровень)</template>
    </p>

    <button v-if="!readOnly" type="button" class="primary" :disabled="busy" @click="form.save">
      Сохранить
    </button>

    <AppearanceSection :appearance="appearance" :character="character" :read-only="readOnly" :is-creature="isCreature" />
    <details v-if="!readOnly" class="raw-json section-gap">
      <summary><GameIcon class="inline-icon" name="scroll" :size="16" /> Сырые данные</summary>
      <p class="muted">
        Навыки и спасброски используются на экране «Герой», их владение настраивается в «Правке листа»; заклинания находятся в «Магии». Здесь — остальные исходные
        данными: бонус мастерства («proficiency»), спасброски/навыки из файла импорта и
        любые прочие поля.
      </p>
      <textarea v-model="form.extraText" rows="18" spellcheck="false" :disabled="busy" />
      <button type="button" class="primary" :disabled="busy" @click="form.save">
        Сохранить
      </button>
    </details>
  </section>
</template>

<style scoped src="./sheetKit.css"></style>
<style scoped>
.dmg-hint{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:6px 0}
.dmg-hint small{flex-basis:100%}
.kind-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.defenses{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}
.raw-json{margin-top:10px}
.raw-json summary{cursor:pointer;font:700 17px var(--heading-font);margin-bottom:8px}
.ability-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}
.ability-grid label{display:flex;flex-direction:column;padding:8px;border:1px solid var(--brass-light);text-transform:uppercase;font-size:11px;gap:4px}
.ability-grid .modifier{font-size:16px;font-weight:700;text-transform:none}
.ability-view{display:flex;flex-direction:column;padding:8px;border:1px solid var(--brass-light);text-transform:uppercase;font-size:11px;gap:4px}
.hp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.roll-button{font-size:12px;padding:4px 8px}
.raw-json textarea{width:100%;font-family:monospace;margin:8px 0}
.muted{font-size:13px}
.sheet-tab label > .visibility-control{position:absolute;top:-3px;right:0}
.xp-block{display:grid;gap:4px;margin:8px 0}
.xp-block label{margin:0}
@media(max-width:600px){.ability-grid,.hp-grid{grid-template-columns:repeat(2,1fr)}}
.senses-row{display:flex;flex-wrap:wrap;gap:8px}
.senses-row label{flex:1 1 140px}
.sheet-editor{padding:16px;border:1px solid var(--brass-light);border-radius:var(--sheet-radius);background:var(--surface-inset)}
@media(max-width:480px){.sheet-editor{padding:10px}}
</style>
