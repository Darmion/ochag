import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';

import { t } from '../i18n/i18n';
import { parseInvite } from './connection';
import { hostingEnabled, hostLocalUrl } from './hostStore';

export function useServerProbe({ initialInvite }: { initialInvite?: string }) {
  const inviteText = ref(initialInvite ?? '');
  const serverAddress = ref('');
  const manualAddress = ref(false);
  const probe = ref<ServerProbe | null>(null);
  const probing = ref(false);
  const allowOwnServer = ref(false);
  const pasteError = ref('');
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let probeSeq = 0;

  const invite = computed(() => parseInvite(inviteText.value));
  const showAddress = computed(() => manualAddress.value || (Boolean(serverAddress.value) && !invite.value.address));

  watch(() => invite.value.address, address => {
    if (address) serverAddress.value = address;
  }, { immediate: true });

  const targetAddress = computed(() =>
    hostingEnabled.value ? hostLocalUrl.value ?? '' : serverAddress.value.trim(),
  );

  const internetTarget = computed(() => {
    if (hostingEnabled.value) return false;
    const host = (targetAddress.value.replace(/^[a-z]+:\/\//i, '').split(/[/:]/)[0] ?? '').toLowerCase();
    return host.includes('.') && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !/\.(local|lan|home|internal|localdomain)$/.test(host);
  });

  async function pasteInvite() {
    pasteError.value = '';
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        pasteError.value = t('В буфере обмена пусто — скопируйте приглашение у мастера целиком и нажмите ещё раз.');
        return;
      }
      inviteText.value = text;
    } catch {
      pasteError.value = t('Не получилось прочитать буфер обмена — щёлкните в поле и нажмите Ctrl+V.');
    }
  }

  async function runProbe(): Promise<ServerProbe | null> {
    if (!window.desktop) return null;

    const address = targetAddress.value;

    if (!address) {
      probe.value = null;
      return null;
    }

    const seq = ++probeSeq;
    probing.value = true;

    try {
      const result = await window.desktop.probeServer(address);
      if (seq === probeSeq) probe.value = result;
      return result;
    } finally {
      if (seq === probeSeq) probing.value = false;
    }
  }

  watch(targetAddress, () => {
    allowOwnServer.value = false;
    probe.value = null;
    clearTimeout(probeTimer);
    if (!hostingEnabled.value && targetAddress.value) {
      probeTimer = setTimeout(() => void runProbe(), 600);
    }
  });

  const trusting = ref(false);
  const trustError = ref('');

  async function trustCertificate() {
    const current = probe.value;
    if (!window.desktop || !current || current.ok || !current.origin || !current.error.fingerprint) return;

    trusting.value = true;
    trustError.value = '';

    try {
      probe.value = await window.desktop.trustServer(current.origin, current.error.fingerprint);
    } catch (cause) {
      trustError.value = cause instanceof Error
        ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
        : String(cause);
      void runProbe();
    } finally {
      trusting.value = false;
    }
  }

  const inviteCertificateMismatch = computed(() =>
    probe.value && !probe.value.ok && probe.value.error.certificateCode && invite.value.certificate
      ? invite.value.certificate !== probe.value.error.certificateCode
      : false,
  );

  watch([probe, () => invite.value.certificate], ([result, certificate]) => {
    if (result && !result.ok && result.error.code === 'certificate' && certificate && certificate === result.error.certificateCode && !trusting.value) {
      void trustCertificate();
    }
  });

  const ownServerWarning = computed(() =>
    !hostingEnabled.value && probe.value?.ok === true && probe.value.thisComputer && !allowOwnServer.value,
  );

  const playerReady = computed(() => probe.value?.ok === true && !ownServerWarning.value);

  const serverName = computed(() => {
    const found = probe.value;
    if (!found?.ok) return '';
    return found.hostName ? t('компьютер «{host}»', { host: found.hostName }) : t('сервер игры');
  });

  onBeforeUnmount(() => clearTimeout(probeTimer));

  // Mutable on purpose: the player step writes inviteText, serverAddress, manualAddress and allowOwnServer.
  return reactive({
    inviteText, serverAddress, manualAddress, probe, probing, allowOwnServer, pasteError, invite, showAddress, targetAddress, internetTarget,
    pasteInvite, runProbe, trusting, trustError, trustCertificate, inviteCertificateMismatch, ownServerWarning, playerReady, serverName,
  });
}

export type ServerCheck = ReturnType<typeof useServerProbe>;
