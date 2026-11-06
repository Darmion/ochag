import { computed, reactive, ref, type Ref } from 'vue';

import { ensureSrdSkills, type SrdSkill } from '../rules/srd';
import {
  abilityForSkill, describeRoll, proficiencyForLevel, saveTotalFor, skillTotalFor,
  type KnownSpell, type Resource, type SaveState, type SkillState, type SpellSlot, type Weapon,
} from './sheet';

// Mutable on purpose: the sheet view writes sheetTab, and the phone root writes character and lastRoll.
export function usePhoneSheet({ request, run, campaignId }: {
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  run: (action: () => Promise<void>) => Promise<void>;
  campaignId: Ref<string>;
}) {
  const character = ref<any | null>(null);
  const weapons = ref<Weapon[]>([]);
  const resources = ref<Resource[]>([]);
  const skills = ref<SkillState[]>([]);
  const saves = ref<SaveState[]>([]);
  const spellSlots = ref<SpellSlot[]>([]);
  const spells = ref<KnownSpell[]>([]);
  const srdSkills = ref<SrdSkill[]>([]);
  const sheetTab = ref<'core' | 'skills' | 'spells' | 'gear'>('core');
  const lastRoll = ref('');

  const proficiencyBonus = computed(() => (typeof character.value?.level === 'number' ? proficiencyForLevel(character.value.level) : 2));

  async function fetchCharacter(id: string) {
    const [detail, skillsData, savesData, slotsData, spellsData, srdSkillsData] = await Promise.all([
      request(`/campaigns/${campaignId.value}/characters/${id}`),
      request(`/campaigns/${campaignId.value}/characters/${id}/skills`),
      request(`/campaigns/${campaignId.value}/characters/${id}/saves`),
      request(`/campaigns/${campaignId.value}/characters/${id}/spell-slots`),
      request(`/campaigns/${campaignId.value}/characters/${id}/spells`),
      ensureSrdSkills(request),
    ]);
    character.value = detail;
    weapons.value = detail.weapons ?? [];
    resources.value = detail.resources ?? [];
    skills.value = skillsData.skills;
    saves.value = savesData.saves;
    spellSlots.value = slotsData.slots.filter((s: SpellSlot) => s.max > 0);
    spells.value = spellsData.spells;
    srdSkills.value = srdSkillsData;
  }

  function skillLabel(index: string): string {
    return srdSkills.value.find(s => s.index === index)?.nameRu ?? index;
  }
  function skillAbility(index: string): string {
    return abilityForSkill(srdSkills.value.find(s => s.index === index)?.ability ?? 'dex');
  }
  function skillTotal(skill: SkillState): number {
    return skillTotalFor(skill, character.value?.[skillAbility(skill.index)] ?? 10, proficiencyBonus.value);
  }
  function saveTotal(save: SaveState): number | null {
    return saveTotalFor(save, character.value?.[save.ability] ?? 10, proficiencyBonus.value);
  }

  function rollCheck(kind: 'ability' | 'save' | 'skill' | 'attack', key: string) {
    return run(async () => {
      const result = await request(`/campaigns/${campaignId.value}/rolls/check`, 'POST', {
        characterId: character.value.id, kind, key,
      });
      lastRoll.value = describeRoll(result);
    });
  }

  function castSpell(known: KnownSpell) {
    const name = known.spell?.nameRu ?? known.spell?.name ?? 'заклинание';
    return run(async () => {
      const result = await request(`/campaigns/${campaignId.value}/characters/${character.value.id}/spells/${known.id}/cast`, 'POST', {});
      lastRoll.value = result?.pending ? `${name}: ждём — противник может ответить «Контрзаклинанием»` : `Сотворено: ${name}`;
    });
  }

  function adjustResource(resource: Resource, delta: number) {
    const next = Math.max(0, Math.min(resource.max, resource.current + delta));
    if (next === resource.current) return;
    return run(async () => {
      const updated = await request(
        `/campaigns/${campaignId.value}/characters/${character.value.id}/resources/${resource.id}`,
        'PATCH', { current: next },
      );
      const entry = resources.value.find(r => r.id === resource.id);
      if (entry) entry.current = updated.current;
    });
  }

  function adjustHp(delta: number) {
    const next = Math.max(0, Math.min(character.value.hp_max, character.value.hp_current + delta));
    if (next === character.value.hp_current) return;
    return run(async () => {
      const updated = await request(
        `/campaigns/${campaignId.value}/characters/${character.value.id}`,
        'PATCH', { revision: character.value.revision, hpCurrent: next },
      );
      character.value = { ...character.value, ...updated };
    });
  }

  function rest(kind: 'short' | 'long') {
    return run(async () => {
      const result = await request(
        `/campaigns/${campaignId.value}/characters/${character.value.id}/rest`,
        'POST', { kind, autoHitDice: true },
      );
      await fetchCharacter(character.value.id);
      lastRoll.value = result.summary ?? '';
    });
  }


  return reactive({
    character, weapons, resources, skills, saves, spellSlots, spells, srdSkills,
    sheetTab, lastRoll, proficiencyBonus, fetchCharacter, skillLabel, skillAbility, skillTotal, saveTotal,
    rollCheck, castSpell, adjustResource, adjustHp, rest,
  });
}

export type PhoneSheetState = ReturnType<typeof usePhoneSheet>;
