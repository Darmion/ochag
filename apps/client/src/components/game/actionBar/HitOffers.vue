<script setup lang="ts">
import { ref, watch } from 'vue';
import { fitOnScreen } from '../../../actionBar/fitOnScreen';
import type { HurlOffer, ManeuverOffer, QuiveringOffer, SmiteOffer, StunOffer } from '../../../actionBar/types';
import GameIcon from '../GameIcon.vue';

const props = defineProps<{ actorId: string | undefined; popoverOpen: boolean; working: boolean }>();
const emit = defineEmits<{ smite: [level: number]; stun: []; quivering: []; hurl: []; maneuver: [id: string] }>();
const smiteOffer = defineModel<SmiteOffer | null>('smiteOffer', { required: true });
const stunOffer = defineModel<StunOffer | null>('stunOffer', { required: true });
const quiveringOffer = defineModel<QuiveringOffer | null>('quiveringOffer', { required: true });
const hurlOffer = defineModel<HurlOffer | null>('hurlOffer', { required: true });
const maneuverOffer = defineModel<ManeuverOffer | null>('maneuverOffer', { required: true });

const mine = (offer: { characterId: string }) => offer.characterId === props.actorId && !props.popoverOpen;
const smiteEl = ref<HTMLElement | null>(null);
const smiteShift = ref(0);
watch([smiteOffer, () => props.popoverOpen, () => props.actorId], () => fitOnScreen(smiteEl, smiteShift));
</script>

<template>
  <div v-if="smiteOffer && mine(smiteOffer)" ref="smiteEl" class="smite-offer g-frame" role="alertdialog" aria-label="Божественная кара" :style="smiteShift ? { left: `${smiteShift}px` } : undefined">
    <span><GameIcon class="inline-icon" name="sparkle" :size="16" /> Попадание по «{{ smiteOffer.targetName }}» — Божественная кара? Ячейка:</span>
    <button
      v-for="slot in smiteOffer.slots" :key="slot.level" type="button" class="primary" :disabled="working"
      :title="`2d8 излучением${slot.level > 1 ? ` + ${Math.min(3, slot.level - 1)}d8` : ''}; нежити и исчадиям — ещё 1d8`" @click="emit('smite', slot.level)"
    >{{ slot.level }} ур. · {{ slot.current }}</button>
    <button type="button" :disabled="working" @click="smiteOffer = null">Не надо</button>
  </div>
  <div v-if="stunOffer && mine(stunOffer) && !smiteOffer" class="smite-offer g-frame" role="alertdialog" aria-label="Ошеломляющий удар">
    <span><GameIcon class="inline-icon" name="burst" :size="16" /> Попадание по «{{ stunOffer.targetName }}» — Ошеломляющий удар? (1 ци из {{ stunOffer.ki }}, спасбросок ТЕЛ СЛ {{ stunOffer.dc }})</span>
    <button type="button" class="primary" :disabled="working" @click="emit('stun')">Ошеломить</button>
    <button type="button" :disabled="working" @click="stunOffer = null">Не надо</button>
  </div>
  <div v-if="quiveringOffer && mine(quiveringOffer) && !smiteOffer && !stunOffer" class="smite-offer g-frame" role="alertdialog" aria-label="Дрожащая ладонь">
    <span><GameIcon class="inline-icon" name="yinYang" :size="16" /> Безоружный удар по «{{ quiveringOffer.targetName }}» — «Дрожащая ладонь»? ({{ quiveringOffer.cost }} ци из {{ quiveringOffer.ki }}; оборвать — действием в «Умениях»)</span>
    <button type="button" class="primary" :disabled="working" @click="emit('quivering')">Вложить дрожь</button>
    <button type="button" :disabled="working" @click="quiveringOffer = null">Не надо</button>
  </div>
  <div v-if="hurlOffer && mine(hurlOffer) && !smiteOffer && !stunOffer" class="smite-offer g-frame" role="alertdialog" aria-label="Бросок через ад">
    <span><GameIcon class="inline-icon" name="flame" :size="16" /> Попадание по «{{ hurlOffer.targetName }}» — «Бросок через ад»? (раз до долгого отдыха: до конца вашего следующего хода цели нет, вернувшись — 10к10 психического)</span>
    <button type="button" class="primary" :disabled="working" @click="emit('hurl')">Швырнуть</button>
    <button type="button" :disabled="working" @click="hurlOffer = null">Не надо</button>
  </div>
  <div v-if="maneuverOffer && mine(maneuverOffer) && !smiteOffer && !stunOffer" class="smite-offer g-frame" role="alertdialog" aria-label="Приём">
    <span><GameIcon class="inline-icon" name="swords" :size="16" /> Попадание по «{{ maneuverOffer.targetName }}» — приём? (кость к{{ maneuverOffer.die }}, осталось {{ maneuverOffer.dice }})</span>
    <button v-for="item in maneuverOffer.maneuvers" :key="item.id" type="button" class="primary" :disabled="working" @click="emit('maneuver', item.id)">{{ item.name }}</button>
    <button type="button" :disabled="working" @click="maneuverOffer = null">Не надо</button>
  </div>
</template>

<style scoped>
.smite-offer{position:absolute;left:0;bottom:calc(100% + 18px);z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:6px;max-width:min(520px,80vw);padding:10px 12px;font-size:13px}
.smite-offer span{flex:1 1 100%;font-weight:600;color:#ffe6a0}
.smite-offer button{min-height:30px;padding:2px 10px;font-size:13px}
</style>
