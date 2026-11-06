import type { CharacterDTO, SheetRequest } from './types';
import { modifierValue } from './abilities';
import type { useProficiencies } from './proficiencies';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { WeaponDTO } from '../components/sheet/WeaponsPanel.vue';

export type HeroTabDeps = {
  props: { campaignId: string; characterId: string; request: SheetRequest };
  character: Ref<CharacterDTO | null>;
  proficiencyBonus: ComputedRef<number | null>;
  proficiencies: ReturnType<typeof useProficiencies>;
};

export function useHeroTab({ props, character, proficiencyBonus, proficiencies }: HeroTabDeps) {
  let heroNamesCache: Promise<{ races: Map<string, string>; subraces: Map<string, string>; backgrounds: Map<string, string> }> | null = null;
  const heroNames = ref<{ races: Map<string, string>; subraces: Map<string, string>; backgrounds: Map<string, string> } | null>(null);
  async function loadHeroNames() {
    if (!character.value?.sheet_extra?.builder) return;
    heroNamesCache ??= props.request('/srd/heroes').then((data: any) => ({
      races: new Map<string, string>((data.races ?? []).map((race: any) => [race.id, race.nameRu])),
      subraces: new Map<string, string>((data.races ?? []).flatMap((race: any) => (race.subraces ?? []).map((sub: any) => [sub.id, sub.nameRu]))),
      backgrounds: new Map<string, string>((data.backgrounds ?? []).map((entry: any) => [entry.id, entry.nameRu])),
    })).catch(() => ({ races: new Map<string, string>(), subraces: new Map<string, string>(), backgrounds: new Map<string, string>() }));
    heroNames.value = await heroNamesCache;
  }
  const heroLine = computed(() => {
    const data = character.value;
    if (!data) return '';
    const builder = data.sheet_extra?.builder;
    const info = data.sheet_extra?.info;
    const race = builder?.raceName ? String(builder.raceName)
      : builder?.subrace ? heroNames.value?.subraces.get(builder.subrace) : builder?.race ? heroNames.value?.races.get(builder.race) : typeof info?.race === 'string' ? info.race : '';
    const classes = data.class_info?.classes?.length
      ? data.class_info.classes.map(entry => (data.class_info?.multiclass ? `${entry.label} ${entry.level}` : entry.label)).join(' / ')
      : data.class_name ?? '';
    const background = builder?.background ? heroNames.value?.backgrounds.get(builder.background) : '';
    return [race, classes, background].filter(Boolean).join(' · ');
  });
  const initiativeBonus = computed(() => (character.value ? modifierValue(character.value.dexterity) : 0));
  const passivePerception = computed(() => {
    const perception = proficiencies.srdSkillsList.find(skill => skill.index === 'perception');
    const total = perception ? proficiencies.skillTotal(perception) : null;
    return total === null ? null : 10 + total;
  });
  function weaponStat(weapon: WeaponDTO) {
    const data = character.value!;
    const ability = weapon.ability === 'finesse'
      ? Math.max(modifierValue(data.strength), modifierValue(data.dexterity))
      : modifierValue(data[weapon.ability]);
    const toHit = ability + (weapon.proficient && proficiencyBonus.value !== null ? proficiencyBonus.value : 0) + (weapon.attack_bonus ?? 0);
    const damage = (weapon.damage_formula ?? '').replace(/\+?\s*@mod\b/g, ability === 0 ? '' : ability > 0 ? `+${ability}` : String(ability));
    return { toHit, damage };
  }

  return { loadHeroNames, heroLine, initiativeBonus, passivePerception, weaponStat };
}
