<script setup lang="ts">
import GameIcon from '../GameIcon.vue';
import ItemArt from '../../rpg/ItemArt.vue';
import { itemArt } from '../../../art/itemArt';
import type { Weapon } from '../../../actionBar/types';
import type { WeaponCard } from '../../../actionBar/weapons';

defineProps<{ card: WeaponCard; working: boolean }>();
const emit = defineEmits<{ arm: []; hover: [weapon: Weapon | null] }>();
</script>

<template>
  <button
    type="button" :disabled="working || card.blocked" class="weapon-command" :class="{ 'out-of-range': card.outOfRange }" :title="card.title"
    @click="emit('arm')" @pointerenter="emit('hover', card.weapon)" @pointerleave="emit('hover', null)"
  >
    <ItemArt v-if="itemArt(card.weapon.name)" :name="card.weapon.name" :size="24" /><GameIcon v-else name="sword" :size="16" /> {{ card.weapon.name }}
    <small class="muted spell-mech">
      {{ card.range }}
    </small>
    <small v-if="card.preview" class="muted hit-chance">{{ card.preview }}</small>
    <small v-if="card.bonusNote" class="muted">{{ card.bonusNote }}</small>
  </button>
</template>

<style scoped src="./actionPopover.css"></style>
<style scoped>
.hit-chance{flex-basis:100%;margin-left:24px;color:var(--g-gold,#c9a24a)}
.action-popover .command-body .weapon-command{min-height:66px;padding:12px 14px;border-left:3px solid var(--g-gold,var(--brass))}
.weapon-command :deep(img){width:38px;height:38px;object-fit:contain;filter:drop-shadow(0 2px 3px #0008)}
.action-popover .weapon-command .spell-mech,.action-popover .weapon-command .hit-chance{flex-basis:100%;margin-left:48px}
</style>
