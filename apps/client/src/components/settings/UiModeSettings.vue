<script setup lang="ts">
import { GAME_SKINS, gameSkin, setGameSkin } from '../../settings/uiMode';
import GameIcon from '../game/GameIcon.vue';
function onSkinKey(event: KeyboardEvent, index: number) {
  let next: number;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % GAME_SKINS.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + GAME_SKINS.length - 1) % GAME_SKINS.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = GAME_SKINS.length - 1;
  else return;
  event.preventDefault();
  setGameSkin(GAME_SKINS[next]!.id);
  const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  buttons?.[next]?.focus();
}
</script>

<template>
  <div class="ui-mode-settings">
    <h4>Оформление</h4>
    <p class="skin-intro">Выберите атмосферу вашего приключения. Цвета, шрифты и рамки меняются во всём приложении.</p>
    <div class="skin-choice" role="radiogroup" aria-label="Оформление">
      <button v-for="(skin, index) in GAME_SKINS" :key="skin.id" type="button" role="radio"
        :class="`skin-${skin.id}`" :aria-checked="gameSkin === skin.id" :tabindex="gameSkin === skin.id ? 0 : -1"
        @keydown="onSkinKey($event, index)" @click="setGameSkin(skin.id)">
        <span class="skin-preview" aria-hidden="true">
          <span class="preview-heading">◆ Очаг <span><GameIcon class="inline-icon" name="sparkle" :size="14" /></span></span>
          <span class="preview-body">История начинается здесь</span>
          <span class="preview-bottom"><span class="preview-gems">◆ ◇ ◆</span><span class="preview-action">В путь</span></span>
        </span>
        <strong class="skin-name">{{ skin.name }} <span v-if="gameSkin === skin.id" aria-hidden="true"><GameIcon class="inline-icon" name="check" :size="16" /></span></strong>
        <small>{{ skin.description }}</small>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ui-mode-settings h4{margin:0 0 8px}
.skin-intro{margin:0 0 14px;font:13px/1.5 var(--g-body-font,Georgia);color:var(--muted-ink)}
.skin-choice{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:12px;margin-bottom:16px}
.skin-choice>button{display:flex;flex-direction:column;align-items:stretch;gap:7px;text-align:left;padding:8px;border:1px solid var(--brass-light);background:var(--surface-inset);color:var(--ink);box-shadow:none;border-radius:7px;min-width:0}
.skin-choice>button[aria-checked=true]{border-color:var(--g-gold,var(--brass));box-shadow:0 0 0 1px var(--g-gold,var(--brass))}
.skin-choice>button:focus-visible{outline:2px solid var(--g-gold-hi,var(--brass));outline-offset:4px}
.skin-choice small{margin:0 3px 4px;font:12px/1.45 var(--g-body-font,Georgia);color:var(--muted-ink);letter-spacing:0;text-transform:none}
.skin-name{display:flex;justify-content:space-between;gap:5px;margin:2px 3px;font:600 14px/1.4 var(--g-title-font,Georgia)}
.skin-name>span{color:var(--g-gold,var(--brass))}
.skin-preview{--preview-title:'Vollkorn SC',Georgia,serif;--preview-body:'Palatino Linotype',Georgia,serif;display:flex;flex-direction:column;gap:10px;padding:13px;border:1px solid var(--preview-rim);border-radius:5px;background:radial-gradient(ellipse at 90% 0,var(--preview-tint),transparent 85%),var(--preview-bg);color:var(--preview-text);box-shadow:inset 0 0 0 3px #0003;text-shadow:none}
.preview-heading{display:flex;justify-content:space-between;font:18px/1.3 var(--preview-title);color:var(--preview-rim);border-bottom:1px solid color-mix(in srgb,var(--preview-rim) 35%,transparent);padding-bottom:7px}
.preview-body{font:12px/1.5 var(--preview-body)}
.preview-bottom{display:flex;justify-content:space-between;align-items:center}.preview-gems{color:var(--preview-rim);font:13px Georgia,serif;letter-spacing:3px}.preview-action{padding:4px 12px;border:1px solid var(--preview-rim);border-radius:3px;background:var(--preview-tint);font:12px/1.4 var(--preview-body);color:var(--preview-text)}
.skin-gate{--preview-bg:#1c1813;--preview-rim:#d4ae5a;--preview-tint:#7a1b16;--preview-text:#ebdfc3}
.skin-winter{--preview-bg:#161b22;--preview-rim:#b8c7d4;--preview-tint:#1e4a73;--preview-text:#dde6ee}
.skin-winter .skin-preview{--preview-title:'Ruslan Display',Georgia,serif}
.skin-planes{--preview-bg:#21160f;--preview-rim:#cf8f4d;--preview-tint:#5e2347;--preview-text:#ecd6b6}
.skin-planes .skin-preview{--preview-title:'Yeseva One',Georgia,serif}
.skin-grove{--preview-bg:#14271f;--preview-rim:#c4c58b;--preview-tint:#28533e;--preview-text:#e5ead5}
.skin-crystal{--preview-bg:#142646;--preview-rim:#a8cee9;--preview-tint:#285b9e;--preview-text:#e4effb}
.skin-crystal .skin-preview{--preview-title:'Yeseva One',Georgia,serif;--preview-body:'Segoe UI',Arial,sans-serif}
.skin-astral{--preview-bg:#241b32;--preview-rim:#ceb78a;--preview-tint:#5c387a;--preview-text:#eee2f3}
.skin-astral .skin-preview{--preview-title:'Yeseva One',Georgia,serif;--preview-body:Georgia,serif}
.skin-crimson{--preview-bg:#261921;--preview-rim:#c7b6b5;--preview-tint:#732b40;--preview-text:#f1e2de}
.skin-crimson .skin-preview{--preview-body:Georgia,serif;border-radius:2px}
@media(max-width:450px){.skin-choice{grid-template-columns:1fr 1fr;gap:8px}.skin-preview{padding:10px}.preview-body{font-size:11px}.skin-name{font-size:12px}.preview-action{padding:3px 7px}}
</style>
