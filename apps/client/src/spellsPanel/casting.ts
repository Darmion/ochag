import { reactive, ref, type Ref } from 'vue';
import type { Spellcasting, SpellsRequest } from './types';

type CastingInput = {
  props: { campaignId: string; characterId: string; request: SpellsRequest };
  busy: Ref<boolean>;
  error: Ref<string>;
};

export function useSpellcasting({ props, busy, error }: CastingInput) {
  const casting = ref<Spellcasting | null>(null);
  const castingEdit = ref(false);
  const castingDraft = ref<{ ability: string; dc: string; attack: string }>({ ability: '', dc: '', attack: '' });

  async function loadCasting() {
    try {
      casting.value = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/spellcasting`);
    } catch {
      casting.value = null;
    }
  }

  async function toggleReaction(key: 'shield' | 'counterspell' | 'hellish-rebuke') {
    const value = casting.value;
    if (!value) return;
    busy.value = true;
    error.value = '';
    try {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/reactions`, 'PUT', { [key]: !(value.autoReactions ?? []).includes(key) });
      casting.value = { ...value, autoReactions: result.autoReactions };
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось переключить. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  function startCastingEdit() {
    const value = casting.value;
    if (!value) return;
    castingDraft.value = {
      ability: value.abilityFromSheet ? value.ability : '',
      dc: value.dcOverride === null ? '' : String(value.dcOverride),
      attack: value.attackOverride === null ? '' : String(value.attackOverride),
    };
    castingEdit.value = true;
  }

  async function saveCasting() {
    const draft = castingDraft.value;
    const dc = draft.dc.trim() === '' ? null : Number(draft.dc);
    const attack = draft.attack.trim() === '' ? null : Number(draft.attack.replace('+', ''));
    if ((dc !== null && !(Number.isInteger(dc) && dc >= 1 && dc <= 40)) || (attack !== null && !(Number.isInteger(attack) && attack >= -10 && attack <= 30))) {
      error.value = 'СЛ — от 1 до 40, атака — от −10 до +30 (пусто — по расчёту).';
      return;
    }
    busy.value = true;
    error.value = '';
    try {
      await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/spellcasting`, 'PUT', {
        ability: draft.ability || null, dcOverride: dc, attackOverride: attack,
      });
      castingEdit.value = false;
      await loadCasting();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  return reactive({ casting, castingEdit, castingDraft, loadCasting, toggleReaction, startCastingEdit, saveCasting });
}

export type Caster = ReturnType<typeof useSpellcasting>;
