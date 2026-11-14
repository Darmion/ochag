<script setup lang="ts">
import { ref, watch } from 'vue';
import GameIcon from '../GameIcon.vue';

export type SpellCommand = { id: string; name: string; cost: string; does: string; feet: number; aim: 'none' | 'target' | 'place'; blocked: string | null };
export type ActiveSpell = { effectId: string; spellName: string; commands: SpellCommand[] };

const props = defineProps<{
  campaignId: string; characterId: string; sceneId: string; working: boolean; version: number;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();
const emit = defineEmits<{ use: [spell: ActiveSpell, command: SpellCommand] }>();

const COSTS: Record<string, string> = { action: 'действие', bonus: 'бонусное', reaction: 'реакция', free: 'без действия', movement: 'часть движения' };
const spells = ref<ActiveSpell[]>([]);

async function load() {
  if (!props.characterId) { spells.value = []; return; }
  try {
    spells.value = (await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/spell-commands${props.sceneId ? `?sceneId=${props.sceneId}` : ''}`)).spells ?? [];
  } catch {
    spells.value = [];
  }
}
watch(() => [props.characterId, props.sceneId, props.version], load, { immediate: true });
</script>

<template>
  <section v-if="spells.length" class="active-spells" aria-label="Действующие заклинания">
    <h4 class="command-section-title">Действующие заклинания</h4>
    <div v-for="spell in spells" :key="spell.effectId" class="active-spell">
      <strong><GameIcon name="sparkle" :size="16" /> <span translate="no">{{ spell.spellName }}</span></strong>
      <div class="active-commands">
        <button
          v-for="command in spell.commands" :key="command.id" type="button" class="command-button"
          :disabled="working || Boolean(command.blocked)" :title="command.blocked ?? undefined" @click="emit('use', spell, command)"
        >
          <span translate="no">{{ command.name }}</span>
          <small>{{ command.blocked ?? COSTS[command.cost] ?? command.cost }}</small>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.active-spells{display:flex;flex-direction:column;gap:6px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--g-line,#0003)}
.active-spell{display:flex;flex-direction:column;gap:4px}
.active-spell strong{display:inline-flex;align-items:center;gap:6px;font-size:13px}
.active-commands{display:flex;flex-wrap:wrap;gap:6px}
.command-button{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-height:40px;padding:5px 12px;text-align:left}
.command-button small{font-size:11px;opacity:.75}
</style>
