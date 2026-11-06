<script setup lang="ts">
import { ref, watch } from 'vue';
import LightSourceControl from '../objects/LightSourceControl.vue';
import { LIGHTING_INFO } from '../../tabletop/lightPresets';
import { WEATHER_INFO, type Weather } from '../../campaign/worldClock';
import GameIcon from '../game/GameIcon.vue';

type Lighting = keyof typeof LIGHTING_INFO;
type LightSource = { characterId: string; name: string; kind: string; light: { bright: number; dim: number; lit: boolean } };
type PartyMember = { characterId: string; name: string; darkvisionFeet: number };

const props = defineProps<{
  campaignId: string;
  scenePath: string;
  lighting: Lighting;
  effectiveLighting: Lighting;
  minutes: number;
  sky: 'fixed' | 'clock';
  weather: Weather;
  visionRadiusFeet: number | null;
  fogEnabled: boolean;
  partyVision: boolean;
  preview: boolean;
  sources: LightSource[];
  party: PartyMember[];
  selected: { characterId: string; name: string; light: LightSource['light'] | null } | null;
  busy?: boolean;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ changed: [message?: string]; 'update:preview': [boolean] }>();

const working = ref(false);
const error = ref('');
const radius = ref<number | ''>(props.visionRadiusFeet ?? '');
watch(() => props.visionRadiusFeet, value => { radius.value = value ?? ''; });

async function run(action: () => Promise<string | void>) {
  working.value = true;
  error.value = '';
  try {
    emit('changed', (await action()) ?? undefined);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

const setLighting = (lighting: Lighting) => run(async () => {
  await props.request(props.scenePath, 'PATCH', { lighting });
  return `Освещение сцены: ${LIGHTING_INFO[lighting].label.toLowerCase()}.`;
});

const setFog = (enabled: boolean) => run(async () => {
  await props.request(`/campaigns/${props.campaignId}/fog`, 'PUT', { enabled });
  return enabled ? 'Туман войны включён.' : 'Туман войны выключен — игроки видят всю карту.';
});

const saveRadius = () => run(async () => {
  const value = radius.value === '' ? null : Math.max(0.5, Math.min(1000, Number(radius.value)));
  await props.request(props.scenePath, 'PATCH', { defaultVisionRadiusFeet: value });
  return value === null ? 'Дальность обзора не ограничена.' : `Дальность обзора — ${value} фут.`;
});

const setSky = (sky: 'fixed' | 'clock') => run(async () => {
  await props.request(props.scenePath, 'PATCH', { sky });
  return sky === 'clock' ? 'Свет сцены идёт за часами кампании.' : 'Свет сцены задаётся вручную.';
});

const setPartyVision = (value: boolean) => run(async () => {
  const rulesPath = `/campaigns/${props.campaignId}/rules`;
  const existing = ((await props.request(rulesPath)).rules as Array<any>).find(rule => rule.key === 'party_vision');
  const body = { label: 'Обзор отряда', description: 'Игроки видят то, что видит любой персонаж отряда и союзный НПС.', value };
  if (existing) await props.request(`${rulesPath}/${existing.id}`, 'PUT', { ...body, revision: existing.revision });
  else await props.request(rulesPath, 'POST', { ...body, key: 'party_vision', kind: 'flag' });
  return value ? 'Игроки видят общее для отряда.' : 'Каждый игрок видит только глазами своих существ.';
});
</script>

<template>
  <div class="vision-panel">
    <section>
      <h4>Освещение сцены</h4>
      <div class="lighting-choice" role="radiogroup" aria-label="Небо">
        <button type="button" role="radio" :aria-checked="sky === 'clock'" :class="{ active: sky === 'clock' }" :disabled="busy || working" title="Свет идёт за часами: день, сумерки, ночь" @click="setSky('clock')">Под небом</button>
        <button type="button" role="radio" :aria-checked="sky === 'fixed'" :class="{ active: sky === 'fixed' }" :disabled="busy || working" title="Подземелье, дом: свет задаёте вы" @click="setSky('fixed')">Вручную</button>
      </div>
      <div v-if="sky === 'fixed'" class="lighting-choice" role="radiogroup" aria-label="Освещение сцены">
        <button
          v-for="(info, key) in LIGHTING_INFO" :key="key" type="button" role="radio"
          :aria-checked="lighting === key" :class="{ active: lighting === key }"
          :disabled="busy || working" :title="info.hint" @click="setLighting(key)"
        >
          <GameIcon class="inline-icon" :name="info.icon" :size="16" /> {{ info.label }}
        </button>
      </div>
      <p v-else class="hint">Сейчас по часам — <strong>{{ LIGHTING_INFO[effectiveLighting].label.toLowerCase() }}</strong>: днём светло, на рассвете и в сумерках — сумерки, ночью — темно.</p>
      <p class="hint">{{ LIGHTING_INFO[effectiveLighting].hint }}</p>
      <p v-if="weather !== 'clear'" class="hint">Погода: {{ WEATHER_INFO[weather].label.toLowerCase() }} — {{ WEATHER_INFO[weather].hint }}</p>
      <p class="hint">Время суток и погода — часы на плашке сцены.</p>
    </section>

    <section>
      <h4>Что видят игроки</h4>
      <label class="checkbox-label">
        <input type="checkbox" :checked="fogEnabled" :disabled="busy || working" @change="setFog(($event.target as HTMLInputElement).checked)" />
        Туман войны: видно только то, что видят персонажи
      </label>
      <template v-if="fogEnabled">
        <label class="checkbox-label">
          <input type="radio" name="party-vision" :checked="partyVision" :disabled="busy || working" @change="setPartyVision(true)" />
          Общий обзор: каждый видит то же, что весь отряд
        </label>
        <label class="checkbox-label">
          <input type="radio" name="party-vision" :checked="!partyVision" :disabled="busy || working" @change="setPartyVision(false)" />
          Каждый видит только глазами своих персонажей
        </label>
        <div class="radius-row">
          <label>
            Дальность обзора, фут.
            <input v-model.number="radius" type="number" min="0.5" max="1000" step="5" placeholder="без предела" :disabled="busy || working" />
          </label>
          <button type="button" :disabled="busy || working" @click="saveRadius">Сохранить</button>
        </div>
        <p class="hint">Пусто — без предела. Предел нужен для тумана, метели, густого леса.</p>
        <label class="checkbox-label preview">
          <input type="checkbox" :checked="preview" @change="emit('update:preview', ($event.target as HTMLInputElement).checked)" />
          <GameIcon class="inline-icon" name="eye" :size="16" /> Показать карту глазами отряда
        </label>
        <p class="hint">Глазами одного существа — кнопка «Глазами» на панели действий, у кубиков.</p>
      </template>
      <div class="legend" aria-label="Обозначения">
        <span><i class="sw bright" /> ярко</span>
        <span><i class="sw dim" /> полумрак</span>
        <span><i class="sw dark" /> темнота: тёмное зрение</span>
        <span v-if="fogEnabled"><i class="sw unseen" /> не видно</span>
      </div>
    </section>

    <section>
      <h4>Источники света</h4>
      <div v-if="selected" class="selected-light">
        <small class="muted">Выбрано на карте: {{ selected.name }}</small>
        <LightSourceControl
          :campaign-id="campaignId" :character-id="selected.characterId" :name="selected.name" :light="selected.light"
          :can-edit="true" :busy="busy" :request="request" @changed="message => emit('changed', message)"
        />
      </div>
      <p v-else class="hint">Выберите на карте предмет или существо, чтобы дать ему свет, — например, факел в руку.</p>
      <ul v-if="sources.length" class="sources">
        <li v-for="source in sources" :key="source.characterId">
          <span class="source-name"><GameIcon class="inline-icon" :name="source.kind === 'object' ? 'candle' : 'person'" :size="16" /> {{ source.name }}</span>
          <LightSourceControl
            compact :campaign-id="campaignId" :character-id="source.characterId" :name="source.name" :light="source.light"
            :can-edit="true" :busy="busy" :request="request" @changed="message => emit('changed', message)"
          />
        </li>
      </ul>
      <p v-else class="hint">На сцене нет источников света.</p>
    </section>

    <section v-if="party.length">
      <h4>Тёмное зрение отряда</h4>
      <ul class="party">
        <li v-for="member in party" :key="member.characterId">
          {{ member.name }} — {{ member.darkvisionFeet ? `${member.darkvisionFeet} фут.` : 'нет' }}
        </li>
      </ul>
      <p class="hint">Задаётся в листе персонажа, на вкладке «Правка листа».</p>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.vision-panel{display:flex;flex-direction:column;gap:14px;font-size:13px}
.vision-panel section{display:flex;flex-direction:column;gap:6px}
.vision-panel h4{margin:0;font-size:14px}
.lighting-choice{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:4px}
.clock{margin:0;font-size:14px}
.vision-panel label{display:flex;flex-direction:column;gap:2px;margin:0}
.lighting-choice button{min-height:34px;padding:4px 6px;font-size:13px}
.lighting-choice button.active{background:var(--burgundy);color:var(--burgundy-text,#fff)}
.hint{margin:0;font-size:12px;opacity:.8}
.checkbox-label{margin:0}
.radius-row{display:flex;gap:6px;align-items:flex-end}
.radius-row label{display:flex;flex-direction:column;gap:2px;margin:0;flex:1}
.radius-row button{min-height:30px;padding:2px 10px;font-size:12px}
.preview{font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px}
.legend span{display:inline-flex;align-items:center;gap:4px}
.sw{display:inline-block;width:14px;height:14px;border-radius:2px;border:1px solid #0006}
.sw.bright{background:#e9dcc0}
.sw.dim{background:linear-gradient(#0000,#0000),#a39a8a}
.sw.dark{background:#6f7783}
.sw.unseen{background:#0b0704}
.sources,.party{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.sources li{display:flex;flex-direction:column;gap:3px;padding-bottom:6px;border-bottom:1px solid var(--brass-light,#0002)}
.source-name{font-weight:600}
.selected-light{display:flex;flex-direction:column;gap:4px;padding:8px;border:1px dashed var(--brass-light,#0003);border-radius:4px}
.error{color:#c0392b;margin:0}
</style>
