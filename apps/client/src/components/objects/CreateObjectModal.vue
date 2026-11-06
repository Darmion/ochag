<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import { confirmAction } from '../../ui/confirmDialog';
import { computed, ref, watch } from 'vue';
import { CLASS_OPTIONS, classText } from '../../rules/classOptions';
import { MATERIALS, objectHint, type Durability, type Material } from '../../rules/objectRules';
import { OBJECT_KINDS, KIND_LABELS, DISPOSITION_LABELS, SIZE_LABELS, type ObjectKind, type Disposition, type CreatureSize } from '../../campaign/objects';
import ArtPickerDialog from '../common/ArtPickerDialog.vue';
import { useObjectLook } from '../../createObject/look';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  campaignId: string;
  canManage: boolean;
  offerPlacement?: boolean;
  initialKind?: ObjectKind;
  request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
}>();

const emit = defineEmits<{
  close: [];
  created: [payload: { character: any; place: boolean }];
  bestiary: [];
  wizard: [];
}>();
useEscapeClose(() => void close());

const kinds = computed(() => OBJECT_KINDS.filter(kind => kind !== 'npc' || props.canManage));

const kind = ref<ObjectKind>(props.initialKind && kinds.value.includes(props.initialKind) ? props.initialKind : props.canManage ? 'npc' : 'character');
const name = ref('');
const disposition = ref<Disposition>('hostile');
const size = ref<CreatureSize>('medium');
const level = ref<number | null>(null);
const OTHER_CLASS = '__other';
const classChoice = ref('');
const subclassChoice = ref('');
const classFreeText = ref('');
const subclassEntry = computed(() => CLASS_OPTIONS.find(entry => entry.label === classChoice.value) ?? null);
const subclassOptions = computed(() => [...(subclassEntry.value?.subclasses ?? []), ...(subclassEntry.value?.others ?? [])]);
watch(classChoice, () => { subclassChoice.value = ''; });
const className = computed(() => (classChoice.value === OTHER_CLASS ? classFreeText.value : classText(classChoice.value, subclassChoice.value)));
const hpMax = ref<number>(10);
const armorClass = ref<number>(10);
const material = ref<Material>('wood');
const durability = ref<Durability>('resilient');
const hint = computed(() => objectHint(material.value, size.value, durability.value));

function applyHint() {
  armorClass.value = hint.value.ac;
  hpMax.value = hint.value.hp;
}
const speedFeet = ref<number>(30);
const abilities = ref({ strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 });
const place = ref(Boolean(props.offerPlacement));

const {
  look, imageFile, imagePreview, modelFile, modelAssetId, library, onImageChange, artPickerOpen,
  artBusy, artError, artSuggested, onLibraryArt, onModelChange,
} = useObjectLook({
  props, kind, name,
});

const busy = ref(false);
const error = ref('');

const creature = computed(() => kind.value !== 'object');

const ABILITY_LABELS: Record<keyof typeof abilities.value, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение',
  intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};

function onKindChange() {
  speedFeet.value = kind.value === 'object' ? 0 : 30;
}

const dirty = computed(() => Boolean(name.value.trim() || className.value.trim() || imageFile.value || modelFile.value));
const backdropHint = ref(false);

function onBackdrop() {
  backdropHint.value = true;
}

async function close() {
  if (dirty.value && !(await confirmAction('Закрыть окно? Введённое не сохранится.', { title: 'Закрыть без сохранения', confirmLabel: 'Закрыть', danger: true }))) return;
  if (imagePreview.value.startsWith('blob:')) URL.revokeObjectURL(imagePreview.value);
  emit('close');
}

async function submit() {
  if (kind.value === 'character') {
    emit('wizard');
    return;
  }
  if (!name.value.trim() || busy.value) return;

  busy.value = true;
  error.value = '';

  try {
    let imageAssetId: string | undefined;
    let chosenModelId: string | undefined;

    if (look.value === 'image' && imageFile.value) {
      imageAssetId = (await props.request(`/campaigns/${props.campaignId}/assets?kind=object_image`, 'POST', undefined, imageFile.value)).id;
    }

    if (look.value === 'model') {
      chosenModelId = modelFile.value
        ? (await props.request(`/campaigns/${props.campaignId}/assets?kind=object_model`, 'POST', undefined, modelFile.value)).id
        : modelAssetId.value || undefined;
    }

    const character = await props.request(`/campaigns/${props.campaignId}/characters`, 'POST', {
      kind: kind.value,
      name: name.value.trim(),
      ...(kind.value === 'npc' ? { disposition: disposition.value } : {}),
      size: size.value,
      ...(creature.value && Number.isFinite(level.value) && level.value ? { level: level.value } : {}),
      ...(creature.value && className.value.trim() ? { className: className.value.trim() } : {}),
      ...(creature.value ? abilities.value : {}),
      hpMax: hpMax.value,
      armorClass: armorClass.value,
      speedFeet: speedFeet.value,
      ...(imageAssetId ? { imageAssetId } : {}),
      ...(chosenModelId ? { modelAssetId: chosenModelId } : {}),
    });

    if (imagePreview.value.startsWith('blob:')) URL.revokeObjectURL(imagePreview.value);
    emit('created', { character, place: place.value });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось создать объект. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Новый объект кампании" @click.self="onBackdrop">
    <form class="modal-card creation-card" @submit.prevent="submit">
      <header class="modal-header">
        <div><span class="eyebrow">Летопись кампании</span><h3>{{ kind === 'npc' ? 'Новый НПС' : kind === 'object' ? 'Новый объект' : 'Новый герой' }}</h3><p class="header-caption">{{ kind === 'object' ? 'Добавьте деталь, которая оживит ваш мир.' : 'У каждой истории есть свои действующие лица.' }}</p></div>
        <button type="button" class="modal-close" aria-label="Закрыть" @click="close"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <div class="creation-body">
      <p v-if="backdropHint" class="notice" role="status">Окно закрывается крестиком или кнопкой «Отмена» — так введённое не пропадёт случайно.</p>

      <p v-if="error" class="notice error" role="alert">{{ error }}</p>

      <fieldset class="kind-choice">
        <legend>Что создаём</legend>
        <label v-for="option in kinds" :key="option" class="choice-tile" :class="{ selected: kind === option }">
          <input v-model="kind" type="radio" :value="option" :disabled="busy" @change="onKindChange" />
          <GameIcon class="ui-icon" :name="option === 'character' ? 'sword' : option === 'npc' ? 'person' : 'pouch'" :size="26" /><span><strong>{{ KIND_LABELS[option] }}</strong><small>{{ option === 'character' ? 'Герой приключения' : option === 'npc' ? 'Друг, враг или незнакомец' : 'Предмет вашего мира' }}</small></span>
        </label>
      </fieldset>
        <p v-if="!canManage" class="muted">НПС создаёт мастер.</p>
        <button v-if="canManage && kind === 'npc'" type="button" class="bestiary-link" :disabled="busy" @click="emit('bestiary')">
          <GameIcon class="ui-icon" name="scroll" :size="20" /> Выбрать существо из бестиария <span aria-hidden="true">↗</span>
        </button>

      <section v-if="kind === 'character'" class="wizard-card">
        <p>Персонаж игрока собирается по шагам: раса, класс, характеристики, предыстория и навыки, снаряжение, заклинания — с подсказками на каждом шаге.</p>
        <button type="button" class="primary" :disabled="busy" @click="emit('wizard')"><GameIcon class="inline-icon" name="wand" :size="16" /> Собрать героя по шагам…</button>
        <small class="muted">Готовый лист из файла другого приложения — кнопка импорта на вкладке «Отряд»; импорт добавляют моды (окно «Моды»).</small>
      </section>
      <div v-else class="creation-columns">
      <section class="creation-section identity-section">
      <h4><span aria-hidden="true">I</span> {{ creature ? 'Личность и параметры' : 'Свойства объекта' }}</h4>

      <label>
        {{ creature ? 'Имя' : 'Название' }}
        <input v-model="name" maxlength="200" required :disabled="busy" :placeholder="kind === 'object' ? 'Например, старинный сундук' : 'Например, Элира — хранительница леса'" />
      </label>

      <label v-if="kind === 'npc'">
        Отношение к отряду
        <select v-model="disposition" :disabled="busy">
          <option v-for="(label, value) in DISPOSITION_LABELS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>

      <div class="field-row">
        <label>
          Размер
          <select v-model="size" :disabled="busy">
            <option v-for="(label, value) in SIZE_LABELS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <label v-if="creature" title="По классу — кость хитов, «Дополнительная атака», ячейки заклинаний">
          Класс
          <select v-model="classChoice" :disabled="busy">
            <option value="">— без класса —</option>
            <option v-for="entry in CLASS_OPTIONS" :key="entry.label" :value="entry.label">{{ entry.label }}</option>
            <option :value="OTHER_CLASS">Другое — вписать (мультикласс)…</option>
          </select>
        </label>
        <label v-if="creature && subclassOptions.length" title="Подкласс, умения которого считает автоматика; можно поменять потом в «Умениях»">
          Подкласс
          <select v-model="subclassChoice" :disabled="busy">
            <option value="">— по умолчанию —</option>
            <optgroup v-if="subclassEntry?.subclasses.length" label="Умения считает автоматика (SRD)">
              <option v-for="entry in subclassEntry.subclasses" :key="entry" :value="entry">{{ entry }}</option>
            </optgroup>
            <optgroup v-if="subclassEntry?.others.length" label="Умения подкласса — в листе вручную">
              <option v-for="entry in subclassEntry.others" :key="entry" :value="entry">{{ entry }}</option>
            </optgroup>
          </select>
        </label>
        <label v-if="creature && classChoice === OTHER_CLASS" title="Например: «Воин 3 / Волшебник 2» или класс не из SRD">
          Класс текстом
          <input v-model="classFreeText" maxlength="100" :disabled="busy" placeholder="Воин 3 / Волшебник 2" />
        </label>

        <label v-if="creature">
          Уровень
          <input v-model.number="level" type="number" min="1" max="20" placeholder="не указан" :disabled="busy" />
        </label>
      </div>

      <div v-if="kind === 'object'" class="field-row dmg-hint">
        <label>
          Материал
          <select v-model="material" :disabled="busy">
            <option v-for="entry in MATERIALS" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
          </select>
        </label>
        <label>
          Прочность
          <select v-model="durability" :disabled="busy">
            <option value="resilient">прочный</option>
            <option value="fragile">хрупкий</option>
          </select>
        </label>
        <button type="button" :disabled="busy" :title="hint.text" @click="applyHint">Подставить по таблице предметов</button>
        <small class="muted">{{ hint.text }}</small>
      </div>

      <div class="field-row">
        <label>
          Хиты
          <input v-model.number="hpMax" type="number" min="0" :disabled="busy" />
        </label>
        <label>
          Класс доспеха
          <input v-model.number="armorClass" type="number" :disabled="busy" />
        </label>
        <label>
          Скорость, фут.
          <input v-model.number="speedFeet" type="number" min="0" :disabled="busy" />
        </label>
      </div>

      <details v-if="creature">
        <summary>Характеристики <small>Сила, ловкость и другие</small></summary>
        <div class="ability-grid">
          <label v-for="(label, key) in ABILITY_LABELS" :key="key">
            {{ label }}
            <input v-model.number="abilities[key]" type="number" min="0" :disabled="busy" />
          </label>
        </div>
      </details>

      </section>
      <section class="creation-section appearance-section">
      <h4><span aria-hidden="true">II</span> Облик на столе</h4>
      <p class="section-caption">Выберите, как представить {{ creature ? 'персонажа' : 'объект' }} на сцене.</p>
      <fieldset class="look-choice">
        <legend class="sr-only">Как выглядит на столе</legend>
        <label class="look-tile" :class="{ selected: look === 'default' }">
          <input v-model="look" type="radio" value="default" :disabled="busy" />
          <GameIcon class="ui-icon" :name="creature ? 'person' : 'pouch'" :size="28" /><span><strong>{{ creature ? 'Фигурка' : 'Деревянный ящик' }}</strong><small>{{ creature ? 'Цвет соответствует стороне' : 'Готовая объёмная фигурка' }}</small></span>
        </label>
        <label class="look-tile" :class="{ selected: look === 'image' }">
          <input v-model="look" type="radio" value="image" :disabled="busy" />
          <GameIcon class="ui-icon" name="scroll" :size="28" /><span><strong>Картинка-стойка</strong><small>Портрет или иллюстрация</small></span>
        </label>
        <label class="look-tile" :class="{ selected: look === 'model' }">
          <input v-model="look" type="radio" value="model" :disabled="busy" />
          <GameIcon class="ui-icon" name="wand" :size="28" /><span><strong>3D-модель</strong><small>Из библиотеки или файла GLB</small></span>
        </label>

        <div v-if="look === 'image'" class="look-detail">
          <small class="muted">PNG, JPEG или WebP · до 5 МБ</small>
          <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="onImageChange" />
          <button type="button" class="library-pick" :disabled="busy" @click="artPickerOpen = true">
            {{ kind === 'object' ? 'Картинка из библиотеки…' : 'Портрет из библиотеки…' }}
          </button>
          <img v-if="imagePreview" :src="imagePreview" alt="Предпросмотр миниатюры" class="image-preview" />
          <ArtPickerDialog
            v-if="artPickerOpen"
            :title="kind === 'object' ? 'Картинка из библиотеки' : 'Портрет из библиотеки'"
            :sections="kind === 'object' ? [] : ['Портреты']"
            :suggested="artSuggested"
            :busy="artBusy"
            :error="artError"
            @pick="onLibraryArt"
            @close="artPickerOpen = false"
          />
        </div>

        <div v-if="look === 'model'" class="look-detail">
          <label>
            Из библиотеки кампании
            <select v-model="modelAssetId" :disabled="busy || Boolean(modelFile)">
              <option value="">— выберите модель —</option>
              <option v-for="asset in library" :key="asset.id" :value="asset.id">{{ asset.original_filename || asset.id }}</option>
            </select>
          </label>
          <label>
            Или загрузить новую — GLB, до 25 МБ
            <input type="file" accept=".glb,model/gltf-binary" :disabled="busy" @change="onModelChange" />
          </label>
        </div>
      </fieldset>

      <label v-if="offerPlacement" class="checkbox-label">
        <input v-model="place" type="checkbox" :disabled="busy" />
        Сразу поставить на текущую сцену
      </label>

      </section>
      </div>
      </div>

      <footer class="modal-footer">
        <button type="button" :disabled="busy" @click="close">Отмена</button>
        <button v-if="kind !== 'character'" type="submit" class="primary" :disabled="busy || !name.trim() || (look === 'image' && !imageFile) || (look === 'model' && !modelFile && !modelAssetId)">
          {{ busy ? 'Создание…' : kind === 'npc' ? 'Создать НПС' : 'Создать объект' }}
        </button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3000;background:#080609bd;backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:20px}
.creation-card{width:min(880px,100%);max-height:90vh;overflow:hidden;padding:0;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:12px;box-shadow:0 24px 90px #0009,inset 0 0 0 4px color-mix(in srgb,var(--brass) 12%,transparent);display:flex;flex-direction:column;gap:0;min-height:0}
.creation-card .modal-header{margin:0;flex:none;display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:nowrap;gap:16px;padding:24px 28px 20px;border-bottom:1px solid var(--brass-light);background:linear-gradient(110deg,color-mix(in srgb,var(--brass) 14%,transparent),transparent)}
.eyebrow{display:block;font:600 10px/1.4 var(--g-body-font,'Segoe UI',sans-serif);text-transform:uppercase;letter-spacing:2.5px;color:var(--muted-ink);margin-bottom:7px}
.modal-header h3{margin:0;font-size:28px;line-height:1.2}
.header-caption,.section-caption{margin:8px 0 0;color:var(--muted-ink);font:13px/1.5 var(--g-body-font,'Segoe UI',sans-serif)}
.modal-close{flex:none;min-height:34px;width:34px;padding:0}
.creation-body{overflow-y:auto;min-height:0;padding:20px 28px 24px;scrollbar-gutter:stable}
.creation-card label{margin:0;min-width:0;gap:6px;font-size:13px}
.creation-card input:not([type=radio]):not([type=checkbox]),.creation-card select{width:100%;min-width:0;box-sizing:border-box;font:14px/1.3 var(--g-body-font,'Segoe UI',sans-serif);min-height:40px;padding:9px 10px;border-radius:5px}
.creation-card input:focus-visible,.creation-card select:focus-visible,.creation-card button:focus-visible,.creation-card summary:focus-visible{outline:2px solid var(--brass);outline-offset:3px}
fieldset{min-width:0;margin:0;padding:0;border:0}
.kind-choice{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:12px}
.kind-choice legend{font:600 11px/1.4 var(--g-body-font,'Segoe UI',sans-serif);letter-spacing:1px;text-transform:uppercase;color:var(--muted-ink);padding:0;margin-bottom:10px}
.creation-card .choice-tile,.creation-card .look-tile{position:relative;display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--brass-light);border-radius:7px;background:var(--surface-inset);cursor:pointer;transition:border-color .15s,background .15s}
.choice-tile span,.look-tile span{min-width:0}
.choice-tile strong,.look-tile strong{display:block;font-size:13px;line-height:1.4}
.choice-tile small,.look-tile small{display:block;margin-top:3px;color:var(--muted-ink);font:11px/1.4 var(--g-body-font,'Segoe UI',sans-serif)}
.creation-card .selected{border-color:var(--brass);background:color-mix(in srgb,var(--brass) 16%,var(--surface-inset));box-shadow:inset 0 0 0 1px var(--brass)}
.choice-tile:focus-within,.look-tile:focus-within{outline:2px solid var(--brass);outline-offset:3px}
.choice-tile input{position:absolute;opacity:0;width:1px;height:1px}
.look-tile input{flex:none;margin:0;accent-color:var(--brass);width:15px;height:15px}
.choice-tile:has(input:disabled),.look-tile:has(input:disabled){opacity:.6;cursor:wait}
.bestiary-link{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 12px;margin-bottom:20px;font-size:12px;border:1px dashed var(--brass-light);background:transparent;box-shadow:none;border-radius:5px}
.bestiary-link span{margin-left:auto}
.creation-columns{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:24px;margin-top:20px}
.creation-section{min-width:0;display:flex;flex-direction:column;gap:16px}
.creation-section h4{display:flex;align-items:center;gap:9px;margin:0 0 2px;font:17px/1.4 var(--g-title-font,Georgia,serif);color:var(--ink)}
.creation-section h4>span{display:grid;place-items:center;flex:none;width:24px;height:24px;border:1px solid var(--brass-light);border-radius:50%;color:var(--muted-ink);font:12px Georgia,serif}
.appearance-section{border-left:1px solid var(--brass-light);padding-left:24px}
.section-caption{margin:-8px 0 0}
.field-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px}
.dmg-hint{padding:12px;background:var(--surface-inset);border-radius:6px;border:1px solid var(--brass-light)}
.dmg-hint button,.dmg-hint small{grid-column:1/-1}
.dmg-hint button{font-size:13px;padding:8px}
.dmg-hint small{line-height:1.5}
.creation-section details{border-top:1px solid var(--brass-light);padding-top:12px}
.creation-section summary{cursor:pointer;font-size:15px}
.creation-section summary small{display:block;color:var(--muted-ink);font:11px/1.4 var(--g-body-font,'Segoe UI',sans-serif);margin:4px 0 0 18px}
.ability-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}
.ability-grid label{font-size:11px}
.look-choice{display:flex;flex-direction:column;gap:8px}
.look-detail{display:flex;flex-direction:column;gap:12px;margin-top:6px;min-width:0}
.creation-card input[type=file]{font-size:11px!important;padding:8px!important;max-width:100%}
.image-preview{width:100%;max-height:180px;object-fit:contain;border:1px solid var(--brass-light);border-radius:6px;background:var(--surface-inset)}
.library-pick{font-size:12px;padding:9px}
.checkbox-label{display:flex;align-items:flex-start;font:12px/1.5 var(--g-body-font,'Segoe UI',sans-serif)!important}
.checkbox-label input{margin:3px 0 0;accent-color:var(--brass)}
.modal-footer{display:flex;justify-content:flex-end;gap:10px;padding:16px 28px;margin:0;border-top:1px solid var(--brass-light);background:var(--surface-inset);flex:none}
.modal-footer button{min-height:40px;font-size:14px;padding:9px 20px}
.muted{font-size:12px;margin:0;color:var(--muted-ink)}
.wizard-card{display:flex;flex-direction:column;align-items:flex-start;gap:14px;padding:20px;border:1px solid var(--brass-light);border-radius:8px;background:var(--surface-inset);line-height:1.6}
.wizard-card p{margin:0}
.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media(max-width:680px){.modal-overlay{padding:10px}.creation-card .modal-header{padding:18px}.creation-body{padding:16px}.creation-columns{grid-template-columns:1fr;gap:22px}.appearance-section{border-left:0;border-top:1px solid var(--brass-light);padding:18px 0 0}.kind-choice{gap:6px}.creation-card .choice-tile{flex-direction:column;align-items:flex-start;padding:10px;gap:6px}.choice-tile small{display:none}.choice-tile strong{font-size:12px}.modal-header h3{font-size:24px}.modal-footer{padding:12px 16px}.field-row{grid-template-columns:repeat(auto-fit,minmax(100px,1fr))}}
</style>
