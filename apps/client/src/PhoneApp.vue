<script setup lang="ts">
import { branding } from './ui/branding';
import ConfirmDialog from './components/common/ConfirmDialog.vue';
import { loadCampaignArt } from './art/campaignArt';
import { computed, defineAsyncComponent, reactive, ref } from 'vue';
import type { Campaign, RosterEntry } from './phone/sheet';
import { usePhoneSheet } from './phone/phoneSheet';
import PhoneSheet from './components/phone/PhoneSheet.vue';
import GameIcon from './components/game/GameIcon.vue';

const PhoneMap = defineAsyncComponent(() => import('./components/tabletop/PhoneMap.vue'));

function savedLanguage(): string {
  try {
    return localStorage.getItem('ttrpg.locale.choice') || 'en';
  } catch {
    return 'en';
  }
}
const language = ref(savedLanguage());
function chooseLanguage(code: string) {
  language.value = code;
  void import('./i18n/i18n').then(({ locale }) => { locale.value = code; });
}

type Screen = 'login' | 'campaigns' | 'characters' | 'sheet' | 'map';

const screen = ref<Screen>('login');
const busy = ref(false);
const error = ref('');

const token = ref('');
const userId = ref('');
const displayName = ref('');

async function request(path: string, method = 'GET', body?: unknown): Promise<any> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  if (token.value) headers.Authorization = `Bearer ${token.value}`;

  let response: Response;
  try {
    response = await fetch(path, { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
  } catch {
    throw new Error('Сервер недоступен. Проверьте подключение к сети хозяина.');
  }

  const contentType = response.headers.get('content-type') ?? '';
  const result = response.status === 204 ? null
    : contentType.includes('application/json') ? await response.json()
      : response.ok && contentType.startsWith('image/') ? await response.blob() : null;
  if (!response.ok) throw new Error(result?.message ?? `Сервер ответил ошибкой ${response.status}. Попробуйте ещё раз.`);
  return result;
}

async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не получилось.';
  } finally {
    busy.value = false;
  }
}

const loginForm = reactive({ username: '', password: '' });

function login() {
  return run(async () => {
    const data = await request('/auth/login', 'POST', { username: loginForm.username, password: loginForm.password });
    token.value = data.token;
    userId.value = data.user.id;
    displayName.value = data.user.displayName;
    await fetchCampaigns();
    screen.value = 'campaigns';
  });
}

function logout() {
  token.value = '';
  userId.value = '';
  campaigns.value = [];
  characters.value = [];
  sheet.character = null;
  screen.value = 'login';
}

const campaigns = ref<Campaign[]>([]);
const campaignId = ref('');

async function fetchCampaigns() {
  const data = await request('/campaigns');
  campaigns.value = data.campaigns;
}

function openCampaign(id: string) {
  campaignId.value = id;
  void loadCampaignArt(request, id);
  return run(async () => {
    const data = await request(`/campaigns/${id}/characters`);
    characters.value = data.characters;
    screen.value = 'characters';
  });
}

const characters = ref<RosterEntry[]>([]);
const creatures = computed(() => characters.value.filter(c => c.kind !== 'object'));
const myCharacters = computed(() => creatures.value.filter(c => c.owner_user_id === userId.value));
const otherCharacters = computed(() => creatures.value.filter(c => c.owner_user_id !== userId.value));

const sheet = usePhoneSheet({ request, run, campaignId });

function openCharacter(id: string) {
  return run(async () => {
    await sheet.fetchCharacter(id);
    sheet.sheetTab = 'core';
    sheet.lastRoll = '';
    screen.value = 'sheet';
  });
}

function backToCharacters() {
  sheet.character = null;
  screen.value = 'characters';
}
</script>

<template>
  <div class="phone">
    <header class="phone-header">
      <h1>{{ branding.appName }} — лист персонажа</h1>
      <select class="phone-language" translate="no" :value="language" aria-label="Language / Язык" @change="chooseLanguage(($event.target as HTMLSelectElement).value)">
        <option value="en">EN</option>
        <option value="ru">RU</option>
      </select>
      <button v-if="token" type="button" class="link" @click="logout">Выйти</button>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <section v-if="screen === 'login'" class="card">
      <form @submit.prevent="login">
        <label>Логин<input v-model="loginForm.username" type="text" autocomplete="username" required /></label>
        <label>Пароль<input v-model="loginForm.password" type="password" autocomplete="current-password" required /></label>
        <button type="submit" :disabled="busy">Войти</button>
      </form>
    </section>

    <section v-else-if="screen === 'campaigns'" class="card">
      <h2>Кампании</h2>
      <ul class="list">
        <li v-for="c in campaigns" :key="c.id">
          <button type="button" @click="openCampaign(c.id)">{{ c.name }}</button>
        </li>
      </ul>
      <p v-if="!campaigns.length" class="muted">Кампаний пока нет.</p>
    </section>

    <section v-else-if="screen === 'characters'" class="card">
      <div class="row-between">
        <button type="button" class="link" @click="screen = 'campaigns'">← Кампании</button>
        <button type="button" class="link" @click="screen = 'map'"><GameIcon class="inline-icon" name="map" :size="16" /> Карта</button>
      </div>
      <h2>Мои персонажи</h2>
      <ul class="list">
        <li v-for="c in myCharacters" :key="c.id">
          <button type="button" @click="openCharacter(c.id)">{{ c.name }}</button>
        </li>
      </ul>
      <p v-if="!myCharacters.length" class="muted">Нет своих персонажей в этой кампании.</p>
      <template v-if="otherCharacters.length">
        <h2>Другие персонажи</h2>
        <ul class="list">
          <li v-for="c in otherCharacters" :key="c.id">
            <button type="button" @click="openCharacter(c.id)">{{ c.name }} <small class="muted">({{ c.owner_display_name }})</small></button>
          </li>
        </ul>
      </template>
    </section>

    <PhoneSheet v-else-if="screen === 'sheet' && sheet.character" :sheet="sheet" @back="backToCharacters" />

    <section v-else-if="screen === 'map'" class="card map-card">
      <PhoneMap :campaign-id="campaignId" :token="token" :request="request" @back="screen = 'characters'" />
    </section>
    <ConfirmDialog />
  </div>
</template>

<style scoped src="./components/phone/phoneKit.css"></style>

<style scoped>
.phone {
  min-height: 100vh;
  background: #221815;
  color: #ead9c4;
  font-family: Georgia, 'Times New Roman', serif;
  padding: 12px;
  box-sizing: border-box;
}
.phone-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.phone-header h1 {
  font-size: 1.1rem;
  margin: 0;
  flex: 1;
}
.phone-header .phone-language {
  width: auto;
  flex: none;
  margin: 0 10px;
  padding: 2px 4px;
}
.error {
  background: #4a1f1f;
  border: 1px solid #a33;
  color: #ffd7d7;
  padding: 8px 10px;
  border-radius: 6px;
  margin-bottom: 10px;
}
form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9rem;
}
input {
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #5a4636;
  background: #1a1210;
  color: #ead9c4;
  font-size: 1rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.list button {
  width: 100%;
  text-align: left;
}
.row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.map-card {
  padding: 10px;
}
</style>
