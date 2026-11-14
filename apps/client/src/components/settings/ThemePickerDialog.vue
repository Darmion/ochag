<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { GAME_SKINS, SKIN_GROUPS, SKIN_SWATCHES, gameSkin, setGameSkin, skinMotion, type GameSkin } from '../../settings/uiMode';
import { useEscapeClose } from '../../ui/escapeStack';
import GameIcon from '../game/GameIcon.vue';
import { t } from '../../i18n/i18n';

const emit = defineEmits<{ close: [] }>();
const startSkin = gameSkin.value;
const startMotion = skinMotion.value;
const opener = document.activeElement as HTMLElement | null;
const listEl = ref<HTMLElement | null>(null);

function cancel() {
  setGameSkin(startSkin);
  skinMotion.value = startMotion;
  emit('close');
}
useEscapeClose(cancel);
onMounted(async () => {
  await nextTick();
  (listEl.value?.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
});
onBeforeUnmount(() => opener?.focus?.());

const current = computed(() => GAME_SKINS.find(skin => skin.id === gameSkin.value) ?? GAME_SKINS[0]!);
const changed = computed(() => gameSkin.value !== startSkin || skinMotion.value !== startMotion);

function onKey(event: KeyboardEvent, skin: GameSkin) {
  const index = GAME_SKINS.findIndex(entry => entry.id === skin);
  const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? index + 1
    : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? index - 1
    : event.key === 'Home' ? 0 : event.key === 'End' ? GAME_SKINS.length - 1 : null;
  if (next === null) return;
  event.preventDefault();
  const target = GAME_SKINS[(next + GAME_SKINS.length) % GAME_SKINS.length]!;
  setGameSkin(target.id);
  void nextTick(() => (listEl.value?.querySelector(`[data-skin-id="${target.id}"]`) as HTMLElement | null)?.focus());
}
const swatch = (skin: GameSkin) => {
  const colors = SKIN_SWATCHES[skin];
  return { background: `linear-gradient(135deg, ${colors.bg} 0 45%, ${colors.tint} 45% 70%, ${colors.rim} 70%)` };
};
</script>

<template>
  <div class="modal-overlay theme-overlay" role="dialog" aria-modal="true" aria-label="Оформление">
    <section class="modal-card g-frame theme-dialog">
      <header class="theme-head">
        <h3>Оформление</h3>
        <button type="button" class="theme-close icon-only" aria-label="Закрыть без изменений" @click="cancel"><GameIcon name="close" :size="16" /></button>
      </header>

      <div class="theme-body">
        <div ref="listEl" class="theme-list" role="radiogroup" aria-label="Темы">
          <template v-for="group in SKIN_GROUPS" :key="group.id">
            <h4>{{ group.name }}</h4>
            <button
              v-for="skin in GAME_SKINS.filter(entry => entry.group === group.id)" :key="skin.id" type="button" role="radio"
              :data-skin-id="skin.id" :aria-checked="gameSkin === skin.id" :tabindex="gameSkin === skin.id ? 0 : -1"
              @click="setGameSkin(skin.id)" @keydown="onKey($event, skin.id)"
            >
              <span class="theme-swatch" :style="swatch(skin.id)" aria-hidden="true" />
              <span class="theme-name">{{ skin.name }}</span>
              <GameIcon v-if="gameSkin === skin.id" class="theme-check" name="check" :size="14" />
            </button>
          </template>
        </div>

        <div class="theme-example" aria-label="Пример оформления">
          <p class="example-caption"><b>{{ current.name }}</b> — {{ current.description }}</p>
          <div class="example-panel g-frame">
            <h2>Таверна «Старый очаг»</h2>
            <p>Дождь стучит по ставням. Трактирщик кивает на дальний стол: там вас уже ждут.</p>
            <label class="example-field">Имя героя<input :value="t('Аэлин')" readonly /></label>
            <div class="example-buttons">
              <button type="button" class="primary" tabindex="-1">В путь</button>
              <button type="button" tabindex="-1">Осмотреться</button>
              <button type="button" class="g-gem icon-only" tabindex="-1" aria-hidden="true"><GameIcon name="dice" :size="18" /></button>
            </div>
            <p class="notice">Новое задание: найти пропавший караван.</p>
          </div>
          <div class="example-hud g-plate">
            <span class="example-portrait">
              <span class="example-letter">А</span>
              <span class="example-badge"><GameIcon name="levelUp" :size="14" /></span>
            </span>
            <span class="example-turn"><small>Ходит</small><strong>Аэлин</strong></span>
            <span class="example-hp"><span style="width: 70%" /></span>
          </div>
        </div>
      </div>

      <footer class="theme-foot">
        <label class="theme-motion">
          <input v-model="skinMotion" type="checkbox" />
          Переливы и сияние в движении
          <small>Лава течёт, самоцветы переливаются, неон дышит. Выключите на слабом компьютере — цвета останутся.</small>
        </label>
        <div class="theme-buttons">
          <button type="button" :disabled="!changed" @click="cancel">Отмена</button>
          <button type="button" class="primary" @click="emit('close')">Готово</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.theme-overlay{position:fixed;inset:0;z-index:3600;display:flex;align-items:center;justify-content:center;padding:18px;background:#0b0704b3}
.theme-dialog{width:min(860px,calc(100vw - 32px));max-height:calc(100dvh - 36px);display:flex;flex-direction:column;gap:12px;padding:16px 18px}
.theme-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:0 0 auto}
.theme-head h3{margin:0}
.theme-close{min-height:32px;width:32px;padding:0}
.theme-body{flex:1;min-height:0;display:grid;grid-template-columns:230px 1fr;gap:16px}
.theme-list{display:flex;flex-direction:column;gap:3px;overflow-y:auto;padding:2px 4px 2px 2px}
.theme-list h4{margin:8px 4px 2px;font:600 11px/1.3 var(--g-body-font);letter-spacing:.1em;text-transform:uppercase;color:var(--g-text-dim)}
.theme-list h4:first-child{margin-top:0}
.theme-list button{display:flex;align-items:center;gap:10px;min-height:36px;padding:4px 10px;text-align:left;justify-content:flex-start;font:600 13px/1.2 var(--g-body-font);letter-spacing:0}
.theme-list button[aria-checked="true"]{color:var(--g-gold-hi);box-shadow:inset 0 0 0 1px var(--g-gold-hi);background:color-mix(in srgb,var(--g-gold) 10%,transparent)}
.theme-swatch{flex:none;width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 1px #0008,0 0 0 1px #fff3}
.theme-name{flex:1}
.theme-check{color:var(--g-gold-hi)}
.theme-example{display:flex;flex-direction:column;gap:12px;min-width:0;overflow-y:auto;padding:4px}
.example-caption{margin:0;font-size:13px;color:var(--g-text-dim)}
.example-caption b{color:var(--g-gold-hi)}
.example-panel{display:flex;flex-direction:column;gap:10px;padding:18px 20px}
.example-panel h2{margin:0;font-size:22px}
.example-panel p{margin:0;line-height:1.5}
.example-field{display:flex;flex-direction:column;gap:4px;margin:0;font-weight:600;font-size:13px;max-width:280px}
.example-buttons{display:flex;align-items:center;gap:10px}
.example-buttons button:not(.g-gem){min-height:36px;padding:4px 16px}
.example-buttons .g-gem{width:40px;height:40px}
.example-panel .notice{padding:8px 12px;font-size:13px}
.example-hud{display:flex;align-items:center;gap:14px;padding:10px 14px}
.example-portrait{position:relative;display:grid;place-items:center;width:54px;height:64px;border-radius:4px;background:radial-gradient(circle at 50% 35%,var(--g-stone-1),var(--g-stone-3));box-shadow:inset 0 0 0 1px #000,0 0 0 1px var(--g-gold-hi),0 0 0 3px var(--g-gold),0 0 0 4px #000}
.example-letter{font:400 28px var(--g-title-font);color:var(--g-gold-hi)}
.example-badge{position:absolute;top:-8px;left:-8px;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;color:var(--g-stone-3);background:radial-gradient(circle at 50% 28%,var(--g-gold-hi),var(--g-gold) 52%,var(--g-gold-lo));box-shadow:0 0 0 1px #000,0 0 0 2px var(--g-gold-hi),0 0 0 3px #000}
.example-turn{display:flex;flex-direction:column;line-height:1.2}
.example-turn small{font:600 11px var(--g-body-font);letter-spacing:.12em;text-transform:uppercase;color:var(--g-text-dim)}
.example-turn strong{font:600 15px var(--g-title-font);color:var(--g-gold-hi)}
.example-hp{flex:1;max-width:220px;height:6px;border-radius:3px;background:#0008;overflow:hidden}
.example-hp span{display:block;height:100%;background:var(--g-good)}
.theme-foot{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;padding-top:10px;box-shadow:inset 0 1px 0 var(--g-line)}
.theme-motion{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:2px 10px;margin:0;font-weight:600;font-size:13px;cursor:pointer;max-width:460px}
.theme-motion input{margin:0}
.theme-motion small{grid-column:2;font-size:12px;font-weight:400;color:var(--g-text-dim)}
.theme-buttons{display:flex;gap:8px}
.theme-buttons button{min-height:36px;padding:4px 16px}
@media (max-width:700px){.theme-body{grid-template-columns:1fr}.theme-list{max-height:200px}}
</style>
