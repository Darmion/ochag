<script setup lang="ts">
import { computed } from 'vue';
import HudPortrait from '../HudPortrait.vue';
import GameIcon from '../GameIcon.vue';
import { conditionInfo } from '../../../rules/conditions';
import type { ActionBarProps } from '../../../actionBar/types';

const props = defineProps<{
  actor: ActionBarProps['actor'];
  movementLeft: ActionBarProps['movementLeft'];
  economy: ActionBarProps['economy'];
  working: boolean;
  error: string;
}>();
const emit = defineEmits<{ openSheet: []; focus: []; deselect: []; economy: [field: 'action' | 'bonus' | 'reaction']; dismiss: [] }>();

const hpPercent = computed(() => {
  const hp = props.actor?.hp;
  return hp && hp.max > 0 ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : null;
});
const hpState = computed(() => (hpPercent.value === null ? '' : hpPercent.value <= 25 ? 'low' : hpPercent.value <= 60 ? 'mid' : 'high'));
const actorConditions = computed(() => (props.actor?.conditions ?? []).map(code => conditionInfo(code)));
</script>

<template>
  <div class="actor-card" :class="actor ? `side-${actor.side}` : 'empty'">
    <button
      type="button"
      class="actor-medallion"
      :class="actor ? `side-${actor.side}` : ''"
      :disabled="!actor"
      :title="actor ? `${actor.name} — открыть лист (двойной щелчок по портрету — камера)` : 'Никто не выбран'"
      @click="emit('openSheet')"
      @dblclick="emit('focus')"
    >
      <HudPortrait :name="actor?.name ?? '?'" :image-url="actor?.imageUrl ?? null" :image-crop="actor?.imageCrop" :crest="actor?.crest" />
      <span v-if="hpPercent !== null" class="hp-ring" :class="hpState" :style="{ '--g-action-hp': `${hpPercent}%` }" />
    </button>

    <div class="actor-info">
      <strong class="actor-name">
        <span class="actor-name-text" :title="actor?.name">{{ actor?.name ?? 'Не выбран' }}</span>
        <button v-if="actor" type="button" class="actor-clear" title="Снять выбор (Esc) — никем не действовать" aria-label="Снять выбор" @click="emit('deselect')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </strong>
      <span v-if="actor?.hp" class="actor-hp" :class="hpState">
        <GameIcon name="heart" :size="14" /> {{ actor.hp.current }} / {{ actor.hp.max }}<template v-if="actor.hp.temp"> +{{ actor.hp.temp }}</template>
      </span>
      <span v-else-if="actor" class="actor-hp muted">хиты скрыты</span>
      <span v-if="movementLeft" class="actor-move" :class="{ empty: movementLeft.feet <= 0 }" :title="`Движение в этот ход: осталось ${movementLeft.feet} из ${movementLeft.budget} фут.`">
        <GameIcon name="run" :size="13" /> {{ movementLeft.feet }} / {{ movementLeft.budget }} фут.
        <i class="move-bar" :style="{ '--g-action-move': `${movementLeft.budget > 0 ? Math.max(0, Math.min(100, Math.round(movementLeft.feet / movementLeft.budget * 100))) : 0}%` }" aria-hidden="true" />
      </span>
      <span v-if="actorConditions.length" class="actor-conditions">
        <span v-for="condition in actorConditions" :key="condition.code" class="condition" :title="`${condition.label}: ${condition.rule}`"><GameIcon :name="condition.icon" :size="13" /></span>
      </span>
      <span v-if="economy" class="economy" aria-label="Что осталось в этот ход">
        <button
          v-for="pip in ([['action', '●', 'Действие'], ['bonus', '▲', 'Бонусное действие'], ['reaction', '⟲', 'Реакция']] as const)"
          :key="pip[0]" type="button" class="pip" :class="[pip[0], { spent: !economy[pip[0]] }]" :disabled="working"
          :title="`${pip[2]}: ${economy[pip[0]] ? 'есть — щелчок отмечает потраченным' : 'потрачено'}`"
          @click="emit('economy', pip[0])"
        >{{ pip[1] }}</button>
      </span>
      <span v-if="error" class="action-error" role="alert">
        <span>{{ error }}</span>
        <button type="button" aria-label="Закрыть сообщение" @click="emit('dismiss')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.actor-card{display:flex;align-items:center;gap:12px;flex:0 1 auto;min-width:0;padding:6px 12px 6px 6px;border-radius:52px 10px 10px 52px;background:linear-gradient(90deg,#0000004d,#0000001f 70%,#0000);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--g-gold-lo) 55%,transparent)}
.actor-card.empty{background:none;box-shadow:none}
.actor-card.empty .actor-name{font-size:14px;white-space:normal}
.actor-medallion{position:relative;flex:0 0 84px;width:84px;height:84px;min-height:0;padding:0;border-radius:50%;overflow:visible;background:radial-gradient(circle,var(--g-stone-1),var(--g-stone-3));box-shadow:inset 0 0 0 2px #000,0 0 0 2px var(--g-gold-hi),0 0 0 4px var(--g-gold),0 0 0 5px var(--g-gold-lo),0 0 0 6px #000,0 6px 16px #000c}
.actor-medallion img{width:100%;height:100%;object-fit:cover;object-position:top;border-radius:50%}
.actor-medallion .monogram{font:400 38px var(--g-title-font);color:var(--g-gold-hi)}
.actor-medallion{--portrait-letter:18px}
.actor-medallion .hud-portrait-crest{border-radius:50%;overflow:hidden}
.actor-medallion.side-mine{background:radial-gradient(circle,#2f5a43,#0f2219)}
.actor-medallion.side-party{background:radial-gradient(circle,#30436e,#0e1628)}
.actor-medallion.side-hostile{background:radial-gradient(circle,#6d2523,#250a09)}
.actor-medallion.side-neutral{background:radial-gradient(circle,#6a5527,#241b0a)}
.actor-medallion.side-friendly{background:radial-gradient(circle,#255e5b,#0a2423)}
@property --g-action-hp{syntax:'<percentage>';inherits:false;initial-value:100%}
@property --g-action-move{syntax:'<percentage>';inherits:false;initial-value:100%}
.hp-ring{transition:--g-action-hp .45s ease}
.hp-ring{position:absolute;inset:-9px;border-radius:50%;pointer-events:none;background:conic-gradient(var(--hp-color,#5ea764) var(--g-action-hp),#0000 0);-webkit-mask:radial-gradient(circle,#0000 61%,#000 62%,#000 67%,#0000 68%);mask:radial-gradient(circle,#0000 61%,#000 62%,#000 67%,#0000 68%)}
.hp-ring.mid{--hp-color:#e0aa3e}.hp-ring.low{--hp-color:#cf4a3d}
.actor-info{display:flex;flex-direction:column;gap:3px;flex:0 1 150px;min-width:90px}
.actor-name{display:flex;align-items:center;gap:4px;font:600 16px var(--g-title-font);color:var(--g-gold-hi);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.actor-name-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
.actor-clear{flex:none;width:20px;height:20px;min-height:0;padding:0;border-radius:50%;font-size:10px;line-height:1;opacity:.7}
.actor-clear:hover{opacity:1}
.actor-hp{display:inline-flex;align-items:center;gap:4px;font-size:13px;color:#9fd8a6}
.actor-hp.mid{color:#f0c56a}.actor-hp.low{color:#ff8f80}
.actor-move{display:inline-flex;flex-wrap:wrap;align-items:center;gap:2px 4px;font-size:12px;color:#9fd8ff;white-space:nowrap}
.actor-move.empty{color:#ff9c8c}
.move-bar{flex:1 1 100%;height:3px;border-radius:2px;background:linear-gradient(90deg,currentColor var(--g-action-move),#ffffff1f 0);transition:--g-action-move .35s ease}
.action-error{position:absolute;bottom:calc(100% + 18px);z-index:6;display:flex;align-items:flex-start;gap:8px;width:max-content;max-width:min(380px,60vw);padding:8px 8px 8px 12px;font-size:13px;line-height:1.35;color:#ffd9d2;border-radius:6px;background:linear-gradient(180deg,#3a1410f7,#200a08f7);box-shadow:0 0 0 1px #000,0 0 0 2px #a8453b,0 8px 18px #000a}
.action-error button{flex:none;width:22px;height:22px;min-height:0;padding:0;border-radius:50%;font-size:11px;line-height:1}
.actor-conditions{display:flex;gap:3px;flex-wrap:wrap}
.actor-conditions .condition{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;font-size:11px;color:var(--g-gold-hi);background:#000a;box-shadow:0 0 0 1px var(--g-gold-lo);cursor:help}
.economy{display:flex;gap:4px}
.economy .pip{--pip:#ffe6a0;width:22px;height:22px;min-height:0;padding:0;border-radius:50%;font-size:12px;line-height:1;color:var(--pip);background:#0008;box-shadow:0 0 0 1px color-mix(in srgb,var(--pip) 60%,#000),0 0 6px color-mix(in srgb,var(--pip) 35%,transparent)}
.economy .pip.action{--pip:#8fdc8a}.economy .pip.bonus{--pip:#f2a64a}.economy .pip.reaction{--pip:#8fc8ff}
.economy .pip.spent{color:#6b5b45;background:#0004;box-shadow:0 0 0 1px #3a2f22}
.economy .pip{transition:color .25s ease,background-color .25s ease,box-shadow .25s ease}
@container actions (max-width:951px){
  .actor-info{flex-basis:96px;min-width:72px}
  .actor-name{font-size:14px}
  .actor-card{gap:8px;padding-right:8px}
  .actor-conditions{display:none}
  .economy{gap:3px}
  .economy .pip{width:20px;height:20px;font-size:11px}
}
@container actions (max-width:784px){.actor-medallion{flex-basis:64px;width:64px;height:64px}.actor-medallion .monogram{font-size:28px}.actor-info{flex-basis:76px;min-width:62px}.economy .pip{width:18px;height:18px;font-size:10px}}
</style>
