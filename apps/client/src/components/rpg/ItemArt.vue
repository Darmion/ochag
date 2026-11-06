<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { itemArt, rarityFrame } from '../../art/itemArt';
import type { GameIconName } from '../../ui/gameIcons';
import GameIcon from '../game/GameIcon.vue';

const props = withDefaults(defineProps<{
  name?: string | null;
  srdIndex?: string | null;
  src?: string | null;
  rarity?: string | null;
  size?: number;
  fallbackIcon?: GameIconName | null;
  placeholder?: boolean;
}>(), { name: null, srdIndex: null, src: null, rarity: null, size: 32, fallbackIcon: null, placeholder: false });

const failed = ref(false);
const url = computed(() => props.src ?? itemArt(props.name, props.srdIndex));
const frame = computed(() => rarityFrame(props.rarity));
watch(url, () => { failed.value = false; });
const shown = computed(() => Boolean(url.value) && !failed.value);
</script>

<template>
  <span
    v-if="shown || fallbackIcon || placeholder"
    class="item-art" :class="{ framed: frame && shown, empty: !shown }"
    :style="{ width: `${size}px`, height: `${size}px`, backgroundImage: frame && shown ? `url(${frame})` : undefined }"
    aria-hidden="true"
  >
    <img v-if="shown" :src="url!" alt="" draggable="false" @error="failed = true" />
    <span v-else class="item-art-fallback"><GameIcon v-if="fallbackIcon" :name="fallbackIcon" :size="Math.round(size * 0.65)" /><template v-else>•</template></span>
  </span>
</template>

<style scoped>
.item-art{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;vertical-align:middle;border-radius:6px;background:radial-gradient(circle,#ffffff2e 0,#ffffff0d 55%,transparent 72%);background-size:cover}
.item-art.framed{background-color:transparent;border-radius:4px}
.item-art.framed img{width:72%;height:72%}
.item-art img{width:100%;height:100%;object-fit:contain;pointer-events:none}
.item-art.empty{background:none}
.item-art-fallback{font-size:.9em;line-height:1}
</style>
