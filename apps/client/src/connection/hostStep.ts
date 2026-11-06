import { computed, ref, watch } from 'vue';

import { t } from '../i18n/i18n';
import { desktopMode, hostLanMode, hostRunning, hostStatus, setLanMode, startHosting } from './hostStore';

export type PlayersWhere = 'solo' | 'lan' | 'internet';

export function useHostStep() {
  function ensureHost() {
    if (!desktopMode || hostRunning.value || hostStatus.value.state === 'starting') return;
    void startHosting();
  }

  const playersWhere = ref<PlayersWhere | null>(null);
  watch(hostLanMode, value => { if (value && playersWhere.value === null) playersWhere.value = 'lan'; }, { immediate: true });

  async function choosePlayersWhere(value: PlayersWhere) {
    playersWhere.value = value;
    if (value === 'lan' && !hostLanMode.value) await setLanMode(true);
  }

  const hostStateText = computed(() => {
    if (hostStatus.value.state === 'running') return t('✔ Сервер работает на этом компьютере.');
    if (hostStatus.value.state === 'starting') return hostStatus.value.message || t('Запускаю сервер…');
    if (hostStatus.value.state === 'error') return t('✖ Сервер не запустился.');
    return t('Сервер остановлен.');
  });

  return { ensureHost, playersWhere, choosePlayersWhere, hostStateText };
}
