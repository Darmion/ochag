import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue';
import { ensureSrdSkills, type SrdSkill } from '../rules/srd';
import { ABILITY_BY_INDEX, modifierValue, type Ability } from './abilities';
import type { CharacterDTO, SheetRequest } from './types';

export type SkillState = { index: string; proficient: boolean; expertise: boolean };
export type SaveState = { ability: string; hidden: boolean; proficient: boolean | null; customBonus: number | null };

export type ProficienciesDeps = {
  props: { campaignId: string; characterId: string; request: SheetRequest };
  character: Ref<CharacterDTO | null>;
  error: Ref<string>;
  readOnly: ComputedRef<boolean>;
  proficiencyBonus: ComputedRef<number | null>;
};

export function useProficiencies({ props, character, error, readOnly, proficiencyBonus }: ProficienciesDeps) {
  const srdSkillsList = ref<SrdSkill[]>([]);
  const characterSkills = ref<SkillState[]>([]);
  const skillsBusy = ref(false);

  async function loadSkills() {
    skillsBusy.value = true;

    try {
      srdSkillsList.value = await ensureSrdSkills(props.request);
      const data = await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/skills`,
      );
      characterSkills.value = data.skills;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить навыки. Попробуйте ещё раз.';
    } finally {
      skillsBusy.value = false;
    }
  }

  async function setSkillState(skillIndex: string, patch: Partial<{ proficient: boolean; expertise: boolean }>) {
    const current = characterSkills.value.find(s => s.index === skillIndex)
      ?? { index: skillIndex, proficient: false, expertise: false };
    const next = { ...current, ...patch };
    if (!next.proficient) next.expertise = false;

    skillsBusy.value = true;

    try {
      const updated = await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/skills/${skillIndex}`,
        'PUT',
        { proficient: next.proficient, expertise: next.expertise },
      );
      const index = characterSkills.value.findIndex(s => s.index === skillIndex);
      const saved = { index: updated.skill_index, proficient: updated.proficient, expertise: updated.expertise };
      if (index === -1) characterSkills.value.push(saved);
      else characterSkills.value[index] = saved;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось изменить навык. Попробуйте ещё раз.';
    } finally {
      skillsBusy.value = false;
    }
  }

  // Rows come from the server's characterSkills: hidden skills are dropped there and must not render as «not proficient».
  const visibleSkillRows = computed<SrdSkill[]>(() => {
    if (!readOnly.value) return srdSkillsList.value;
    return characterSkills.value
      .map(s => srdSkillsList.value.find(skill => skill.index === s.index))
      .filter((s): s is SrdSkill => Boolean(s));
  });

  function skillTotal(skill: SrdSkill): number | null {
    if (!character.value || proficiencyBonus.value === null) return null;
    const state = characterSkills.value.find(s => s.index === skill.index);
    const abilityScore = character.value[ABILITY_BY_INDEX[skill.ability]] as number;
    const proficiencyPart = state?.proficient
      ? proficiencyBonus.value * (state.expertise ? 2 : 1)
      : 0;
    return modifierValue(abilityScore) + proficiencyPart;
  }

  const skillMark = (index: string) => {
    const state = characterSkills.value.find(entry => entry.index === index);
    return state?.expertise ? '◆' : state?.proficient ? '●' : '';
  };

  const characterSaves = ref<SaveState[]>([]);
  const savesBusy = ref(false);

  async function loadSaves() {
    savesBusy.value = true;

    try {
      const data = await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/saves`,
      );
      characterSaves.value = data.saves;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить спасброски. Попробуйте ещё раз.';
    } finally {
      savesBusy.value = false;
    }
  }

  function saveFor(ability: string): SaveState {
    return characterSaves.value.find(s => s.ability === ability)
      ?? { ability, hidden: false, proficient: false, customBonus: 0 };
  }

  async function setSaveState(ability: string, patch: Partial<{ proficient: boolean; customBonus: number }>) {
    const current = saveFor(ability);
    const next = { proficient: current.proficient ?? false, customBonus: current.customBonus ?? 0, ...patch };

    savesBusy.value = true;

    try {
      const updated = await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/saves/${ability}`,
        'PUT',
        next,
      );
      const index = characterSaves.value.findIndex(s => s.ability === ability);
      const saved: SaveState = { ability: updated.ability, hidden: false, proficient: updated.proficient, customBonus: updated.customBonus };
      if (index === -1) characterSaves.value.push(saved);
      else characterSaves.value[index] = saved;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось изменить спасбросок. Попробуйте ещё раз.';
    } finally {
      savesBusy.value = false;
    }
  }

  function saveTotal(save: SaveState): number | null {
    if (!character.value || proficiencyBonus.value === null || save.hidden) return null;
    const abilityScore = character.value[save.ability as Ability] as number;
    const bonus = (save.proficient ? proficiencyBonus.value : 0) + (save.customBonus ?? 0);
    return modifierValue(abilityScore) + bonus;
  }

  return reactive({
    srdSkillsList, characterSkills, skillsBusy, loadSkills, setSkillState, visibleSkillRows, skillTotal, skillMark,
    characterSaves, savesBusy, loadSaves, saveFor, setSaveState, saveTotal,
  });
}

export type Proficiencies = ReturnType<typeof useProficiencies>;
