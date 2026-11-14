<script setup lang="ts">
import { computed } from 'vue';
import { ABILITIES, ABILITY_LABELS, ABILITY_SHORT, mod, signed } from '../../../characterWizard/catalog';
import { t } from '../../../i18n/i18n';
import type { LevelUp } from '../../../levelUp/useLevelUp';
import GameIcon from '../../game/GameIcon.vue';

const props = defineProps<{ level: LevelUp }>();

const before = computed(() => props.level.preview?.before ?? null);
const after = computed(() => props.level.preview?.after ?? null);
const hpAfter = computed(() => {
  const preview = props.level.preview;
  if (!preview) return '—';
  return preview.hpRange ? `${preview.before.hpMax + preview.hpRange[0]}–${preview.before.hpMax + preview.hpRange[1]}` : String(preview.after.hpMax);
});
const vitals = computed(() => {
  if (!before.value || !after.value) return [];
  return [
    { label: t('хиты'), from: String(before.value.hpMax), to: hpAfter.value },
    { label: t('КД'), from: String(before.value.armorClass), to: String(after.value.armorClass) },
    { label: t('мастерство'), from: signed(before.value.proficiency), to: signed(after.value.proficiency) },
    { label: t('атак'), from: String(before.value.attacks), to: String(after.value.attacks) },
  ];
});
const changes = computed(() => {
  if (!before.value || !after.value) return [];
  const lines: string[] = [];
  for (const slot of after.value.slots) {
    const was = before.value.slots.find(entry => entry.level === slot.level)?.max ?? 0;
    if (slot.max !== was) lines.push(t('Ячейки {level}-го круга: {from} → {to}', { level: slot.level, from: was, to: slot.max }));
  }
  const pactBefore = before.value.pact;
  const pactAfter = after.value.pact;
  if (pactAfter && (pactAfter.count !== pactBefore?.count || pactAfter.level !== pactBefore?.level)) {
    lines.push(t('Ячейки договора: {count} × {level}-й круг', { count: pactAfter.count, level: pactAfter.level }));
  }
  for (const resource of after.value.resources) {
    const was = before.value.resources.find(entry => entry.name === resource.name)?.max;
    if (was === undefined) lines.push(t('Новое: {name} ({max})', { name: resource.name, max: resource.max }));
    else if (was !== resource.max) lines.push(t('{name}: {from} → {to}', { name: resource.name, from: was, to: resource.max }));
  }
  const spells = after.value.spells - before.value.spells;
  if (spells > 0) lines.push(t('Заклинаний и заговоров: +{count}', { count: spells }));
  return lines;
});
</script>

<template>
  <aside class="hero-card" aria-label="Герой: было → стало">
    <span class="hero-portrait"><GameIcon :name="level.classInfo?.icon ?? 'levelUp'" :size="40" /></span>
    <strong class="hero-title">{{ level.info?.name }}</strong>
    <p class="hero-line">{{ before?.className || level.plan?.className || '—' }}<template v-if="level.preview?.className && level.preview.className !== before?.className"><br>→ {{ level.preview.className }}</template></p>
    <p class="hero-line">Уровень <strong>{{ level.plan?.from }} → {{ level.plan?.to }}</strong></p>
    <p v-if="!level.preview" class="muted">Считаю, что изменится…</p>
    <template v-else>
      <div class="hero-vitals">
        <span v-for="entry in vitals" :key="entry.label" :class="{ changed: entry.from !== entry.to }" :title="entry.label">
          <b>{{ entry.to }}</b><small>{{ entry.label }}</small><em v-if="entry.from !== entry.to">было {{ entry.from }}</em>
        </span>
      </div>
      <div class="hero-abilities">
        <span v-for="ability in ABILITIES" :key="ability" :class="{ primary: level.primary.has(ability), changed: after!.scores[ability] !== before!.scores[ability] }" :title="ABILITY_LABELS[ability]">
          <small>{{ ABILITY_SHORT[ability] }}</small><b>{{ after!.scores[ability] }}</b><em>{{ signed(mod(after!.scores[ability])) }}</em>
        </span>
      </div>
      <ul v-if="changes.length" class="hero-changes"><li v-for="line in changes" :key="line">{{ line }}</li></ul>
    </template>
    <p v-if="level.missing.length" class="hero-problems"><GameIcon class="inline-icon" name="alert" :size="16" /> Осталось выбрать: {{ level.missing.length }}</p>
  </aside>
</template>

<style scoped src="../../characters/wizard/heroCard.css"></style>

<style scoped>
.hero-portrait{cursor:default;color:var(--brass,#b08d57)}
.hero-title{font:700 18px var(--heading-font);text-align:center}
.hero-vitals{display:grid;grid-template-columns:repeat(2,1fr)}
.hero-vitals span.changed,.hero-abilities span.changed{border-color:#3f8a4e;box-shadow:inset 0 0 0 1px #3f8a4e88}
.hero-vitals em{font-style:normal;font-size:10px;opacity:.75}
.hero-changes{margin:0;padding-left:16px;font-size:11px;line-height:1.4;width:100%}
</style>
