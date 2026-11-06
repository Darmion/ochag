<script setup lang="ts">
import { t } from '../../i18n/i18n';
import { hostStatus } from '../../connection/hostStore';

// Microsoft's permanent link to the latest x64 installer; the desktop shell allows it in apps/desktop/main/windows.cjs EXTERNAL_LINKS.
const vcRuntimeUrl = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';

function downloadVcRuntime() {
  window.open(vcRuntimeUrl, '_blank', 'noopener');
}
</script>

<template>
  <button
    v-if="hostStatus.code === 'vc-runtime'"
    type="button"
    class="vc-runtime"
    :title="t('Откроет загрузку установщика с сайта Microsoft в браузере')"
    @click="downloadVcRuntime"
  >
    {{ t('Скачать с сайта Microsoft') }}
  </button>
</template>

<style scoped>
.vc-runtime{display:block;margin-top:8px}
</style>
