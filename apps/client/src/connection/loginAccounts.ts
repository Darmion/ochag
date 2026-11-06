import { computed, ref, type Ref } from 'vue';

import { t } from '../i18n/i18n';
import { isLoopbackAddress, sameServer } from './connection';
import { hostingEnabled } from './hostStore';
import { RECENT_KEY, addRecent, mergeAccounts, parseRecent, type AccountPlace, type RecentAccount } from './recentAccounts';
import type { ServerCheck } from './serverProbe';

export function useLoginAccounts({ saved, serverCheck }: {
  saved: Ref<SavedLogins | null>;
  serverCheck: Pick<ServerCheck, 'targetAddress' | 'probe'>;
}) {
  const savedEntries = computed(() => saved.value?.entries ?? []);

  function serverLabel(entry: AccountPlace) {
    if (isLoopbackAddress(entry.serverUrl)) return t('ваш сервер на этом компьютере');
    return entry.hostName ? t('компьютер «{host}»', { host: entry.hostName }) : t('сервер');
  }

  function readRecent(): RecentAccount[] {
    try {
      return parseRecent(localStorage.getItem(RECENT_KEY));
    } catch {
      return [];
    }
  }
  const recentAccounts = ref<RecentAccount[]>(readRecent());
  function rememberRecent(name: string, serverUrl: string) {
    const list = addRecent(recentAccounts.value, name, serverUrl, Date.now());
    recentAccounts.value = list;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
    }
  }
  const quickAccounts = computed(() => mergeAccounts(savedEntries.value, recentAccounts.value, serverLabel));
  const accountsHere = computed(() => quickAccounts.value.filter(entry =>
    hostingEnabled.value ? isLoopbackAddress(entry.serverUrl) : Boolean(serverCheck.targetAddress) && sameServer(entry.serverUrl, serverCheck.probe?.ok ? serverCheck.probe.origin : serverCheck.targetAddress)));

  return { savedEntries, serverLabel, rememberRecent, quickAccounts, accountsHere };
}
