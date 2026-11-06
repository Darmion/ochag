<script setup lang="ts">
defineProps<{
  special: { spellId: string; spellName: string; casterName: string; items: string[] };
  more: number;
}>();

const emit = defineEmits<{
  dismiss: [];
  mute: [spellId: string];
}>();
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Примените вручную">
    <section class="modal-card spell-special">
      <h2>«<span translate="no">{{ special.spellName }}</span>» — примените вручную</h2>
      <p class="muted">Сотворила: <span translate="no">{{ special.casterName }}</span>. Это игра пока не считает сама:</p>
      <ul><li v-for="item in special.items" :key="item">{{ item }}</li></ul>
      <div class="special-actions">
        <button type="button" class="primary" @click="emit('dismiss')">Понятно</button>
        <button type="button" @click="emit('mute', special.spellId)">Не показывать для этого заклинания</button>
        <small v-if="more > 0" class="muted">ещё {{ more }}</small>
      </div>
    </section>
  </div>
</template>

<style scoped>
p{line-height:1.5}
.muted{font-size:13px}
.spell-special{max-width:560px;display:flex;flex-direction:column;gap:8px}
.spell-special ul{margin:0;padding-left:20px}
.special-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
</style>
