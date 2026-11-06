import { createApp } from 'vue'
import './style.css'
import './art/artPersonalization'
import { initArt } from './art/artPacks'
import PhoneApp from './PhoneApp.vue'

// Separate entry: the phone must not load App.vue/PlayerViewApp.vue and the Babylon scene.
void initArt().finally(() => createApp(PhoneApp).mount('#app'))

void import('./i18n/domTranslate').then(({ installDomTranslation }) => installDomTranslation())
