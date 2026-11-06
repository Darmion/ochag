import { createApp } from 'vue'
import './style.css'
import './settings/uiMode'
import { applyTextSettings } from './settings/textSettings'
import { applyCursor } from './settings/cursorSettings'
import './art/artPersonalization'
import { loadUserLocales } from './i18n/i18n'
import { loadVisualMods } from './settings/visualMods'
import { initArt } from './art/artPacks'
import { installDomTranslation } from './i18n/domTranslate'
import App from './App.vue'

applyTextSettings()
void applyCursor()

// Lazy import: a static one would pull TabletopView.vue and Babylon.js into the main bundle.
const playerView = new URLSearchParams(window.location.search).get('view') === 'player'

void loadUserLocales().catch(() => undefined)
void loadVisualMods().catch(() => undefined)
installDomTranslation()

void initArt().finally(() => {
  if (playerView) void import('./PlayerViewApp.vue').then(({ default: PlayerViewApp }) => createApp(PlayerViewApp).mount('#app'))
  else createApp(App).mount('#app')
})
