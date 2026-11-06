<script setup lang="ts">
import VisibilityControl, { type VisibilitySetting } from '../common/VisibilityControl.vue';
import type { CampaignMember } from '../../campaign/members';
import type { OtherTab } from '../../characterSheet/otherTab';
import { USE_LABELS } from '../../characterSheet/otherTexts';
import type { SheetRequest } from '../../characterSheet/types';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  other: OtherTab;
  readOnly: boolean;
  busy: boolean;
  campaignId: string;
  characterId: string;
  request: SheetRequest;
  campaignMembers: CampaignMember[];
  visibilityFor: (fieldKey: string) => VisibilitySetting;
}>();
const emit = defineEmits<{ visibility: [fieldKey: string, setting: VisibilitySetting] }>();
const onVisibilityChange = (fieldKey: string, setting: VisibilitySetting) => emit('visibility', fieldKey, setting);
</script>

<template>
  <section class="sheet-tab other-tab">
    <div class="sheet-section-lead">
      <span class="section-kicker">Кто он такой</span>
      <h3>Другое</h3>
      <p>Языки и владения, умения и особенности расы, класса и предыстории, личность и история героя.</p>
    </div>

    <section class="gear-block" aria-labelledby="other-languages-title">
      <div class="gear-block-head">
        <span><small>Говорит и владеет</small><h4 id="other-languages-title">Языки и владения</h4></span>
        <span class="other-head-actions">
          <button v-if="!readOnly" type="button" class="link-button" :disabled="busy" @click="other.startTextEdit('prof')"><template v-if="other.textEdit?.key === 'prof'">Отмена</template><template v-else><GameIcon class="inline-icon" name="pencil" :size="16" /> Изменить</template></button>
          <VisibilityControl v-if="!readOnly" field-key="misc" :campaign-id="campaignId" :character-id="characterId" :request="request" :setting="visibilityFor('misc')" :members="campaignMembers" @change="s => onVisibilityChange('misc', s)" />
        </span>
      </div>
      <div v-if="other.textEdit?.key === 'prof'" class="other-edit">
        <textarea v-model="other.textEdit.value" rows="5" :disabled="busy" placeholder="Языки: Общий, Эльфийский&#10;Доспехи: лёгкие&#10;Инструменты: воровские" />
        <small class="muted">Строкой «Что: перечень» — каждая станет отдельной карточкой.</small>
        <button type="button" class="primary" :disabled="busy" @click="other.saveTextEdit">Сохранить</button>
      </div>
      <dl v-else-if="other.profLines.length" class="other-facts">
        <div v-for="(line, index) in other.profLines" :key="index"><dt>{{ line.label || 'Прочее' }}</dt><dd>{{ line.value }}</dd></div>
      </dl>
      <p v-else class="muted">Не записано{{ readOnly ? '' : ' — «Изменить»' }}.</p>
    </section>

    <section class="gear-block" aria-labelledby="other-features-title">
      <div class="gear-block-head">
        <span><small>Раса, класс, предыстория</small><h4 id="other-features-title">Умения и особенности</h4></span>
        <button v-if="!readOnly" type="button" class="link-button" :disabled="busy" @click="other.startTextEdit('features')"><template v-if="other.textEdit?.key === 'features'">Отмена</template><template v-else><GameIcon class="inline-icon" name="pencil" :size="16" /> Изменить</template></button>
      </div>
      <div v-if="other.textEdit?.key === 'features'" class="other-edit">
        <textarea v-model="other.textEdit.value" rows="10" :disabled="busy" placeholder="Тёмное зрение. Видит в темноте на 60 футов.&#10;&#10;Ярость. Бонусным действием…" />
        <small class="muted">Каждое умение — с новой строки через пустую строку: «Название. Описание».</small>
        <button type="button" class="primary" :disabled="busy" @click="other.saveTextEdit">Сохранить</button>
      </div>
      <div v-else-if="other.featureCards.length" class="other-cards">
        <details v-for="(card, index) in other.featureCards" :key="index" class="other-card" :open="other.featureCards.length <= 4">
          <summary><span class="card-title">{{ card.title || 'Особенность' }}</span></summary>
          <p>{{ card.body }}</p>
        </details>
      </div>
      <p v-else class="muted">Не записано{{ readOnly ? '' : ' — «Изменить»' }}.</p>
      <template v-if="other.levelCards.length">
        <h5 class="other-subhead">С новыми уровнями <small class="muted">что дало каждое повышение</small></h5>
        <div class="other-cards">
          <details v-for="(card, index) in other.levelCards" :key="index" class="other-card">
            <summary><span class="card-title">{{ card.title || 'Уровень' }}</span></summary>
            <p>{{ card.body }}</p>
          </details>
        </div>
      </template>
      <template v-if="other.classFeatures.length">
        <h5 class="other-subhead">Умения класса <small class="muted">считаются сами — кнопки в «Умениях» панели действий</small></h5>
        <div class="other-cards">
          <details v-for="feature in other.classFeatures" :key="feature.id" class="other-card">
            <summary><span class="card-title">{{ feature.name }}</span><span class="use-tag">{{ USE_LABELS[feature.use] ?? feature.use }}</span></summary>
            <p>{{ feature.text }}</p>
            <small v-if="feature.detail" class="muted">{{ feature.detail }}</small>
          </details>
        </div>
      </template>
    </section>

    <section v-if="other.storyTexts.length || other.miscResources.length" class="gear-block" aria-labelledby="other-story-title">
      <div class="gear-block-head">
        <span><small>Черты, идеалы, привязанности</small><h4 id="other-story-title">Личность и история</h4></span>
      </div>
      <div v-if="other.storyTexts.length" class="other-cards">
        <details v-for="entry in other.storyTexts" :key="entry.key" class="other-card">
          <summary><span class="card-title">{{ entry.label }}</span></summary>
          <p>{{ entry.body }}</p>
        </details>
      </div>
      <dl v-if="other.miscResources.length" class="other-facts">
        <div v-for="resource in other.miscResources" :key="resource.key"><dt>{{ resource.label }}</dt><dd>{{ resource.value }}</dd></div>
      </dl>
      <small v-if="!readOnly" class="muted">Правятся в «Сырых данных» внизу «Правки листа».</small>
    </section>
  </section>
</template>

<style scoped src="./sheetKit.css"></style>
<style scoped>
.muted{font-size:13px}
.other-head-actions{display:inline-flex;align-items:center;gap:8px}
.other-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin:0}
.other-facts > div{padding:8px 10px;border:1px solid var(--brass-light);border-radius:6px;background:color-mix(in srgb,var(--surface-inset) 55%,transparent)}
.other-facts dt{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-ink)}
.other-facts dd{margin:3px 0 0;font-size:14px}
.other-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));align-items:start;gap:8px}
.other-card{padding:8px 12px;border:1px solid var(--brass-light);border-radius:6px;background:color-mix(in srgb,var(--surface-inset) 55%,transparent)}
.other-card > summary{display:flex;align-items:baseline;gap:8px;padding:2px 0;cursor:pointer;font:700 15px/1.3 var(--heading-font)}
.other-card .card-title{flex:1 1 0;min-width:0}
.other-card p{margin:6px 0 0;font-size:13px;line-height:1.5;white-space:pre-line}
.other-subhead{margin:14px 0 8px;font:700 14px var(--heading-font)}
.use-tag{flex:none;white-space:nowrap;padding:0 7px;border:1px solid var(--brass-light);border-radius:9px;font:600 10px var(--body-font,inherit);color:var(--muted-ink);text-transform:none}
.other-edit{display:flex;flex-direction:column;gap:6px}
.other-edit textarea{width:100%;font:13px/1.5 inherit}
.other-edit button{align-self:flex-start}
.other-tab .gear-block + .gear-block{margin-top:14px}
</style>
