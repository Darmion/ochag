<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import { SUGGEST_PRINCIPLES, SUGGEST_RULES } from '../../../../../packages/domain/spells/spell-template-rules';
import GameIcon from '../game/GameIcon.vue';

defineProps<{ busy: boolean }>();
const emit = defineEmits<{ close: []; insert: [text: string, higher: string] }>();
useEscapeClose(() => emit('close'));
</script>

<template>
  <div class="rules-overlay" role="dialog" aria-modal="true" aria-label="Как работает разбор описания" @click.self="emit('close')">
    <section class="rules-card">
      <header class="rules-head">
        <span class="rules-sigil" aria-hidden="true"><GameIcon name="sparkle" :size="20" /></span>
        <div>
          <h3>Как работает разбор описания</h3>
          <p class="muted">Пишите языком правил — и таблица заполнится подсказками.</p>
        </div>
        <button type="button" class="close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <div class="rules-body">
        <ul class="principles">
          <li v-for="line in SUGGEST_PRINCIPLES" :key="line">{{ line }}</li>
        </ul>
        <section v-for="group in SUGGEST_RULES" :key="group.title" class="rules-group">
          <h4><span class="rune" aria-hidden="true">◆</span>{{ group.title }}</h4>
          <article v-for="rule in group.rules" :key="rule.what" class="rule">
            <p class="rule-what">{{ rule.what }}</p>
            <blockquote translate="no">«{{ rule.example }}»<template v-if="rule.higher"><br /><span class="higher">На больших кругах: «{{ rule.higher }}»</span></template></blockquote>
            <button type="button" class="small quiet insert" :disabled="busy" title="Дописать пример в описание и разобрать" @click="emit('insert', rule.example, rule.higher ?? '')">＋ в описание</button>
          </article>
        </section>
        <p class="muted note">Примеры — по-русски. Описание по-английски разбирается как текст SRD 5.1.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.rules-overlay{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:24px;background:#0008}
.rules-card{width:min(760px,100%);max-height:calc(86dvh / var(--ui-zoom, 1));display:flex;flex-direction:column;border:1px solid var(--g-gold-lo,var(--brass));border-radius:10px;background:var(--g-stone-panel,var(--parchment-background));box-shadow:0 18px 50px #000c,inset 0 0 0 1px #ffffff08}
.rules-head{display:flex;gap:12px;align-items:flex-start;padding:16px 18px 12px;border-bottom:1px solid var(--g-line,var(--brass-light))}
.rules-head>div{flex:1;min-width:0}
.rules-head h3{margin:0;color:var(--g-gold-hi,var(--brass));font-family:var(--g-title-font,inherit)}
.rules-head p{margin:4px 0 0;font-size:14px}
.rules-sigil{display:grid;place-items:center;width:40px;height:40px;flex-shrink:0;border-radius:50%;border:1px solid var(--g-gold-lo,var(--brass));color:var(--g-gold-hi,var(--brass));font-size:20px;box-shadow:0 0 14px color-mix(in srgb,var(--g-gold,#c9a227) 35%,transparent)}
.rules-body{overflow-y:auto;overscroll-behavior:contain;padding:12px 18px 18px;display:flex;flex-direction:column;gap:14px}
.principles{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px;font-size:14px;line-height:1.5}
.rules-group h4{display:flex;align-items:center;gap:8px;margin:4px 0 8px;font-size:15px;color:var(--g-gold,var(--brass));letter-spacing:.04em;text-transform:uppercase}
.rules-group h4::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--g-gold-lo,var(--brass-light)),transparent)}
.rune{font-size:10px;color:var(--g-gold-lo,var(--brass))}
.rule{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:start;padding:8px 0;border-top:1px dashed var(--g-line,var(--brass-light))}
.rule-what{margin:0;font-weight:700;font-size:14px;grid-column:1}
.rule blockquote{margin:0;grid-column:1;padding:4px 10px;border-left:2px solid var(--g-gold-lo,var(--brass-light));font-size:13px;line-height:1.5;color:var(--g-text-dim,inherit);font-style:italic}
.higher{font-style:normal}
.insert{grid-column:2;grid-row:1/span 2;align-self:center;white-space:nowrap}
.note{margin:0;font-size:13px}
button.small{min-height:32px;padding:4px 10px;font-size:13px;box-shadow:none}
button.quiet{background:transparent}
:root[data-ui="game"] .rules-card{background:var(--g-stone-3);box-shadow:var(--g-ring-thin),var(--g-shadow)}
:root[data-ui="game"] .rules-head{background:var(--g-plate);border-bottom-color:var(--g-gold-lo)}
:root[data-ui="game"] .rules-body{min-height:0;scrollbar-gutter:stable}
:root[data-ui="game"] .principles{padding:14px 16px 14px 34px;border-left:3px solid var(--g-gold-lo);background:var(--g-well);color:var(--g-text)}
:root[data-ui="game"] .rule{padding:12px 0}
:root[data-ui="game"] .rule blockquote{padding:10px 12px;background:var(--g-well);color:var(--g-text);font-size:14px;line-height:1.6}
:root[data-ui="game"] .rules-sigil{background:var(--g-well);box-shadow:inset 0 0 0 3px var(--g-stone-2),0 0 14px var(--g-glow)}
:root[data-ui="game"] .rules-card :is(button,summary):focus-visible{outline:2px solid var(--g-gold-hi);outline-offset:3px}
</style>
