<script setup lang="ts">
import InterfaceSettingsModal from '../settings/InterfaceSettingsModal.vue';
import { setUiScale, uiScale } from '../../settings/uiScale';

const props = defineProps<{ request?: (path: string, method?: string) => Promise<any> }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <InterfaceSettingsModal :ui-scale="uiScale" :request="props.request" @update:ui-scale="setUiScale($event)" @close="emit('close')" />
</template>
