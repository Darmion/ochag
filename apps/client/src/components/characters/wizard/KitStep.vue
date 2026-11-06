<script setup lang="ts">
import { kitArt } from '../../../characterWizard/catalog';
import type { HeroBuilder } from '../../../characterWizard/heroBuilder';
import type { HeroClass, Heroes } from '../../../characterWizard/types';
import ItemArt from '../../rpg/ItemArt.vue';
import GameIcon from '../../game/GameIcon.vue';

defineProps<{
  wizard: HeroBuilder;
  heroes: Heroes;
  heroClass: HeroClass;
}>();
</script>

<template>
  <h3>С чем герой выходит в путь?</h3>
  <div class="kit-cards">
    <button v-for="kit in heroClass.kits" :key="kit.id" type="button" class="kit-card" :class="{ active: wizard.choice.kit === kit.id }" @click="wizard.choice.kit = kit.id">
      <span v-if="kitArt(kit).length" class="kit-art">
        <ItemArt v-for="name in kitArt(kit)" :key="name" :name="name" :size="40" :title="name" />
      </span>
      <strong>{{ kit.nameRu }}</strong>
      <small><GameIcon class="inline-icon" name="swords" :size="13" /> {{ kit.weaponNames.join(', ') }}{{ kit.ammo ? ` (${kit.ammo.name.toLowerCase()} ×${kit.ammo.count})` : '' }}</small>
      <small><GameIcon class="inline-icon" name="shield" :size="13" /> {{ kit.armorName ? kit.armorName : 'без доспеха' }}{{ kit.shield ? ', щит' : '' }}</small>
      <small v-if="kit.gearNames.length"><GameIcon class="inline-icon" name="pouch" :size="16" /> {{ kit.gearNames.join(', ') }}</small>
    </button>
  </div>
  <p class="muted">У всех — набор путешественника: {{ heroes.explorerPack.join(', ') }}. От предыстории: {{ wizard.background?.gearNames.join(', ') }}, {{ wizard.background?.gp }} зм.</p>
</template>

<style scoped src="./wizardKit.css"></style>

<style scoped>
.kit-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}
.kit-card{display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;padding:10px 12px;min-height:92px}
.kit-card small{font-weight:400;font-size:12px;line-height:1.3}
.kit-art{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:2px}
.kit-card.active{border-color:var(--burgundy,#7a2e2e);box-shadow:inset 0 0 0 2px var(--burgundy,#7a2e2e);background:#7a2e2e1f}
</style>
