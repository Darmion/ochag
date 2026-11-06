<script setup lang="ts">
import VisibilityControl, { type VisibilitySetting } from '../common/VisibilityControl.vue';
import WeaponsPanel from './WeaponsPanel.vue';
import WalletPanel from './WalletPanel.vue';
import CharacterItems from './CharacterItems.vue';
import ItemCard from '../rpg/ItemCard.vue';
import ResourceBar from '../rpg/ResourceBar.vue';
import type { CampaignMember } from '../../campaign/members';
import { itemArt } from '../../art/itemArt';
import { hitDiceSummary } from '../../rules/hitDice';
import { describe, weaponTitle } from '../../characterSheet/sheetExtra';
import { RECHARGE_LABELS, type Resources } from '../../characterSheet/resources';
import type { CharacterDTO, Recharge, SheetRequest } from '../../characterSheet/types';

defineProps<{
  character: CharacterDTO;
  isCreature: boolean;
  readOnly: boolean;
  busy: boolean;
  rollBusy: boolean;
  legacyWeapons: unknown[];
  resources: Resources;
  campaignId: string;
  characterId: string;
  request: SheetRequest;
  campaignMembers: CampaignMember[];
  visibilityFor: (fieldKey: string) => VisibilitySetting;
}>();
const emit = defineEmits<{ changed: []; attack: [weaponId: string]; visibility: [fieldKey: string, setting: VisibilitySetting] }>();
const onVisibilityChange = (fieldKey: string, setting: VisibilitySetting) => emit('visibility', fieldKey, setting);
</script>

<template>
  <section class="sheet-tab gear-tab">
    <div class="sheet-section-lead">
      <span class="section-kicker">Арсенал и имущество</span>
      <h3>Снаряжение</h3>
      <p>Оружие готово к броску, а имущество собрано в каталог с быстрым поиском и подробностями предмета.</p>
    </div>

    <section v-if="isCreature" class="gear-block gear-weapons" aria-labelledby="gear-weapons-title">
      <div class="gear-block-head">
        <span><small>В бою</small><h4 id="gear-weapons-title">Оружие и атаки</h4></span>
        <VisibilityControl v-if="!readOnly" field-key="weapons" :campaign-id="campaignId" :character-id="characterId" :request="request" :setting="visibilityFor('weapons')" :members="campaignMembers" @change="s => onVisibilityChange('weapons', s)" />
      </div>
      <WeaponsPanel
        :campaign-id="campaignId"
        :character-id="characterId"
        :weapons="character.weapons ?? []"
        :resources="character.resources"
        :legacy="legacyWeapons"
        :read-only="readOnly"
        :busy="busy || rollBusy"
        :request="request"
        @changed="emit('changed')"
        @attack="weaponId => emit('attack', weaponId)"
      />
      <details v-if="legacyWeapons.length" class="legacy-weapons">
        <summary>Оружие из импортированного листа</summary>
        <div class="item-card-grid">
          <ItemCard v-for="(weapon, index) in legacyWeapons" :key="index" icon="swords" :art="itemArt(weaponTitle(weapon))" :title="weaponTitle(weapon)">
            <p>{{ describe(weapon) }}</p>
          </ItemCard>
        </div>
      </details>
    </section>

    <section v-if="isCreature" class="gear-block gear-inventory" aria-labelledby="gear-inventory-title">
      <div class="gear-block-head">
        <span><small>Имущество</small><h4 id="gear-inventory-title">Кошелёк и инвентарь</h4></span>
      </div>
      <WalletPanel
        :campaign-id="campaignId"
        :character-id="characterId"
        :wallet="{ cp: character.cp ?? 0, sp: character.sp ?? 0, ep: character.ep ?? 0, gp: character.gp ?? 0, pp: character.pp ?? 0 }"
        :revision="character.revision"
        :read-only="readOnly"
        :request="request"
        @changed="emit('changed')"
      />
    </section>

    <section v-if="isCreature && !readOnly" class="gear-block gear-magic" aria-labelledby="gear-magic-title">
      <div class="gear-block-head">
        <span><small>Особые свойства</small><h4 id="gear-magic-title">Магические предметы</h4></span>
      </div>
      <CharacterItems
        :campaign-id="campaignId"
        :character-id="characterId"
        :revision="character.revision"
        :request="request"
        @changed="emit('changed')"
      />
    </section>

    <section class="gear-block effects-block resources-block" aria-labelledby="resources-title">
    <div class="effects-block-head">
      <span><small>Запасы</small><h4 id="resources-title">Ресурсы</h4></span>
    </div>
    <p class="muted block-help">Тратьте и восполняйте значения прямо во время игры.</p>
    <p v-if="isCreature && character.hit_dice" class="muted block-help" title="Отдых — кнопка «Отдых» на панели действий стола">Кости хитов: <strong>{{ hitDiceSummary(character.hit_dice) }}</strong></p>
    <div v-if="character.resources.length" class="resource-bar-grid">
      <ResourceBar
        v-for="resource in character.resources"
        :key="resource.id"
        :label="resource.name"
        :current="resource.current"
        :max="resource.max"
        :read-only="busy || readOnly"
        @increment="resources.adjustResource(resource, 1)"
        @decrement="resources.adjustResource(resource, -1)"
      >
        <template v-if="!readOnly" #corner>
          <VisibilityControl
            :field-key="`resource:${resource.id}`"
            :campaign-id="campaignId"
            :character-id="characterId"
            :request="request"
            :setting="visibilityFor(`resource:${resource.id}`)"
            :members="campaignMembers"
            @change="s => onVisibilityChange(`resource:${resource.id}`, s)"
          />
        </template>
        <template v-if="!readOnly" #actions>
          <select
            class="recharge-select" :value="resource.recharge ?? 'none'" :disabled="busy"
            title="Когда восстанавливается" aria-label="Когда восстанавливается"
            @input.stop
            @change.stop="resources.setRecharge(resource, ($event.target as HTMLSelectElement).value as Recharge)"
          >
            <option v-for="(label, key) in RECHARGE_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
          <button type="button" :disabled="busy" @click="resources.removeResource(resource.id)">Удалить</button>
        </template>
      </ResourceBar>
    </div>
    <p v-else class="muted">Ресурсов пока нет.</p>

    <details v-if="!readOnly" class="sheet-add-form">
      <summary>Добавить ресурс</summary>
      <div class="resource-add-grid">
      <label>
        Название
        <input v-model="resources.newResourceName" maxlength="100" placeholder="Например: Ярость" :disabled="busy" />
      </label>
      <label>
        Максимум
        <input type="number" min="0" v-model.number="resources.newResourceMax" :disabled="busy" />
      </label>
      <label>
        Восстанавливается
        <select v-model="resources.newResourceRecharge" :disabled="busy">
          <option v-for="(label, key) in RECHARGE_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <button type="button" :disabled="busy || !resources.newResourceName.trim()" @click="resources.addResource">
        Добавить ресурс
      </button>
      </div>
    </details>
    </section>

  </section>
</template>

<style scoped src="./sheetKit.css"></style>
<style scoped>
.muted{font-size:13px}
.item-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:12px}
.resource-bar-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:12px}
.gear-tab{display:grid;gap:14px}
.legacy-weapons{margin-top:12px;padding-top:10px;border-top:1px solid var(--brass-light)}
.legacy-weapons > summary{cursor:pointer;font-size:13px;color:var(--muted-ink)}
.effects-block{min-width:0;padding:14px;border:1px solid var(--brass-light);border-radius:7px;background:color-mix(in srgb,var(--surface-inset) 62%,transparent)}
.effects-block .sheet-add-form{margin:12px 0 0;background:transparent}
.resources-block .resource-bar-grid{grid-template-columns:1fr;margin-bottom:0}
.sheet-add-form{margin:16px 0;padding:12px;border:1px dashed var(--brass-light);border-radius:6px}
.sheet-add-form > summary{cursor:pointer;font-size:14px}
.resource-add-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(70px,1fr) minmax(0,2fr);align-items:end;gap:12px;margin-top:14px}
.resource-add-grid > button{grid-column:1 / -1;justify-self:start}
.sheet-add-form label{margin:0}
.resources-block :deep(.resource-bar){border-color:var(--brass-light)}
.resources-block :deep(.resource-bar-actions){flex-wrap:wrap;gap:8px}
.resources-block .recharge-select{flex:1 1 140px;min-width:0;width:auto}
@media(max-width:600px){.resource-add-grid{grid-template-columns:minmax(0,1fr)}.sheet-add-form button{justify-self:start}}
</style>
