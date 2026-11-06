<script setup lang="ts">
import { hostError, hostStatus } from '../../connection/hostStore';
import VcRuntimeButton from './VcRuntimeButton.vue';
</script>

<template>
  <p v-if="hostError || hostStatus.state === 'error'" class="notice error" role="alert">
    {{ hostError || hostStatus.message }}
    <VcRuntimeButton />
  </p>
</template>
