import { computed, reactive, ref, type Ref } from 'vue';
import type { CreatureSize, Disposition, ObjectKind } from '../campaign/objects';
import { objectHint, type Durability, type Material } from '../rules/objectRules';
import type { CharacterDTO, SheetRequest } from './types';

export const CHALLENGES = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, index) => index + 1)];
export const challengeLabel = (value: number) => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' } as Record<number, string>)[value] ?? String(value);
export type Defense = 'resistances' | 'immunities' | 'vulnerabilities';
export const DEFENSE_LABELS: Record<Defense, string> = { resistances: 'Сопротивление (½)', immunities: 'Иммунитет (0)', vulnerabilities: 'Уязвимость (×2)' };
export const CREATURE_TYPE_OPTIONS = [
  ['humanoid', 'гуманоид'], ['beast', 'зверь'], ['undead', 'нежить'], ['construct', 'конструкт'], ['fiend', 'исчадие'], ['celestial', 'небожитель'],
  ['fey', 'фея'], ['elemental', 'элементаль'], ['dragon', 'дракон'], ['giant', 'великан'], ['monstrosity', 'чудовище'], ['aberration', 'аберрация'],
  ['ooze', 'слизь'], ['plant', 'растение'],
] as const;

export type SheetEditFormDeps = {
  props: { campaignId: string; characterId: string; request: SheetRequest };
  character: Ref<CharacterDTO | null>;
  busy: Ref<boolean>;
  error: Ref<string>;
  dirty: Ref<boolean>;
  canManageKinds: Ref<boolean>;
  syncEditFields: (data: CharacterDTO) => void;
};

export function useSheetEditForm({ props, character, busy, error, dirty, canManageKinds, syncEditFields }: SheetEditFormDeps) {
  const editKind = ref<ObjectKind>('character');
  const editDisposition = ref<Disposition>('neutral');
  const editSize = ref<CreatureSize>('medium');

  const editName = ref('');
  const editLevel = ref<number | null>(null);
  const editAbilities = ref({ strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 });
  const editHpCurrent = ref(0);
  const editHpMax = ref(0);
  const editHpTemp = ref(0);
  const editArmorClass = ref(10);
  const editDamageThreshold = ref<number | null>(null);
  const editSpellcasting = ref('');
  const editHitDie = ref<number | ''>('');
  const editClassName = ref('');
  const editAttacks = ref<number | ''>('');
  const editExperience = ref(0);
  const editChallenge = ref<number | ''>('');
  const editXpAward = ref<number | ''>('');
  const editDefenses = ref<Record<Defense, string[]>>({ resistances: [], immunities: [], vulnerabilities: [] });
  const hintMaterial = ref<Material>('wood');
  const hintDurability = ref<Durability>('resilient');
  const objectHintValue = computed(() => objectHint(hintMaterial.value, editSize.value, hintDurability.value));

  function applyObjectHint() {
    editArmorClass.value = objectHintValue.value.ac;
    editHpMax.value = objectHintValue.value.hp;
    editHpCurrent.value = Math.min(editHpCurrent.value || objectHintValue.value.hp, objectHintValue.value.hp);
  }
  const editSpeedFeet = ref(30);
  const editPriceGold = ref<number | ''>('');
  const editWeight = ref<number | ''>('');
  const editMerchant = ref(false);
  const editDarkvision = ref<number | ''>('');
  const editTruesight = ref<number | ''>('');
  const editBlindsight = ref<number | ''>('');
  const editFlySpeed = ref<number | ''>('');
  const editCreatureType = ref('');
  const editExtraText = ref('{}');

  function fillFromCharacter(data: CharacterDTO) {
    editName.value = data.name;
    editKind.value = data.kind;
    editDisposition.value = data.disposition ?? 'neutral';
    editSize.value = data.size;
    editLevel.value = data.level;
    editAbilities.value = {
      strength: data.strength,
      dexterity: data.dexterity,
      constitution: data.constitution,
      intelligence: data.intelligence,
      wisdom: data.wisdom,
      charisma: data.charisma,
    };
    editHpCurrent.value = data.hp_current;
    editHpMax.value = data.hp_max;
    editHpTemp.value = data.hp_temp;
    editArmorClass.value = data.armor_class;
    editDamageThreshold.value = data.damage_threshold ?? null;
    editSpellcasting.value = data.spellcasting_ability ?? '';
    editHitDie.value = data.hit_die ?? '';
    editExperience.value = data.experience ?? 0;
    editClassName.value = data.class_name ?? '';
    editAttacks.value = data.attacks_per_action ?? '';
    editChallenge.value = data.challenge_rating ?? '';
    editXpAward.value = data.xp_award ?? '';
    editDefenses.value = {
      resistances: [...(data.damage_resistances ?? [])],
      immunities: [...(data.damage_immunities ?? [])],
      vulnerabilities: [...(data.damage_vulnerabilities ?? [])],
    };
    editSpeedFeet.value = data.speed_feet;
    editPriceGold.value = data.price_cp === null || data.price_cp === undefined ? '' : data.price_cp / 100;
    editWeight.value = data.weight_lb === null || data.weight_lb === undefined ? '' : data.weight_lb;
    editMerchant.value = data.merchant === true;
    editDarkvision.value = typeof data.sheet_extra?.darkvisionFeet === 'number' && data.sheet_extra.darkvisionFeet > 0 ? data.sheet_extra.darkvisionFeet : '';
    editTruesight.value = typeof data.sheet_extra?.truesightFeet === 'number' && data.sheet_extra.truesightFeet > 0 ? data.sheet_extra.truesightFeet : '';
    editBlindsight.value = typeof data.sheet_extra?.blindsightFeet === 'number' && data.sheet_extra.blindsightFeet > 0 ? data.sheet_extra.blindsightFeet : '';
    editFlySpeed.value = typeof data.sheet_extra?.flySpeedFeet === 'number' && data.sheet_extra.flySpeedFeet > 0 ? data.sheet_extra.flySpeedFeet : '';
    editCreatureType.value = typeof data.sheet_extra?.creatureType === 'string' ? data.sheet_extra.creatureType : '';
    editExtraText.value = JSON.stringify(data.sheet_extra ?? {}, null, 2);
  }

  async function save() {
    if (!character.value) return;

    let sheetExtra: Record<string, unknown>;

    try {
      sheetExtra = JSON.parse(editExtraText.value);
    } catch {
      error.value = 'Дополнительные данные — некорректный JSON.';
      return;
    }
    if (character.value.kind !== 'object') {
      const darkvision = editDarkvision.value === '' ? 0 : Math.max(0, Math.min(1000, Math.round(Number(editDarkvision.value))));
      if (darkvision > 0) sheetExtra.darkvisionFeet = darkvision;
      else delete sheetExtra.darkvisionFeet;
      if (editCreatureType.value) sheetExtra.creatureType = editCreatureType.value;
      else delete sheetExtra.creatureType;
      for (const [field, value] of [['truesightFeet', editTruesight.value], ['blindsightFeet', editBlindsight.value], ['flySpeedFeet', editFlySpeed.value]] as const) {
        const feet = value === '' ? 0 : Math.max(0, Math.min(1000, Math.round(Number(value))));
        if (feet > 0) sheetExtra[field] = feet;
        else delete sheetExtra[field];
      }
    }

    busy.value = true;
    error.value = '';

    try {
      const updated = await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}`,
        'PATCH',
        {
          revision: character.value.revision,
          name: editName.value,
          level: Number.isFinite(editLevel.value) ? editLevel.value : undefined,
          ...editAbilities.value,
          hpCurrent: editHpCurrent.value,
          hpMax: editHpMax.value,
          hpTemp: editHpTemp.value,
          armorClass: editArmorClass.value,
          speedFeet: editSpeedFeet.value,
          ...(character.value.kind === 'object'
            ? { damageThreshold: Number.isFinite(editDamageThreshold.value) && editDamageThreshold.value !== null ? Math.max(0, Math.min(1000, Math.round(editDamageThreshold.value))) : null }
            : {}),
          sheetExtra,
          size: editSize.value,
          spellcastingAbility: editSpellcasting.value || null,
          ...(character.value.kind !== 'object' ? {
            hitDie: editHitDie.value || null,
            className: editClassName.value.trim() || null,
            attacksPerAction: editAttacks.value === '' || !Number.isFinite(editAttacks.value) ? null : Math.max(1, Math.min(10, Math.round(editAttacks.value))),
          } : {}),
          ...(character.value.kind === 'character' && Number.isFinite(editExperience.value)
            ? { experience: Math.max(0, Math.min(10_000_000, Math.round(editExperience.value))) } : {}),
          ...(character.value.kind === 'npc' ? {
            challengeRating: editChallenge.value === '' ? null : editChallenge.value,
            xpAward: editXpAward.value === '' || !Number.isFinite(editXpAward.value) ? null : Math.max(0, Math.round(editXpAward.value)),
          } : {}),
          damageResistances: editDefenses.value.resistances,
          damageImmunities: editDefenses.value.immunities,
          damageVulnerabilities: editDefenses.value.vulnerabilities,
          ...(character.value.kind === 'object' ? {
            priceCp: editPriceGold.value === '' || !Number.isFinite(Number(editPriceGold.value)) ? null : Math.max(0, Math.round(Number(editPriceGold.value) * 100)),
            weightLb: editWeight.value === '' || !Number.isFinite(Number(editWeight.value)) ? null : Math.max(0, Number(editWeight.value)),
          } : {}),
          ...(canManageKinds.value && character.value.kind === 'npc' ? { merchant: editMerchant.value } : {}),
          ...(canManageKinds.value ? {
            kind: editKind.value,
            disposition: editKind.value === 'npc' ? editDisposition.value : null,
          } : {}),
        },
      );

      character.value = updated;
      syncEditFields(updated);
      dirty.value = false;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить лист. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  return reactive({
    name: editName, kind: editKind, disposition: editDisposition, size: editSize, level: editLevel,
    abilities: editAbilities, hpCurrent: editHpCurrent, hpMax: editHpMax, hpTemp: editHpTemp,
    armorClass: editArmorClass, damageThreshold: editDamageThreshold, spellcasting: editSpellcasting,
    hitDie: editHitDie, className: editClassName, attacks: editAttacks, experience: editExperience,
    challenge: editChallenge, xpAward: editXpAward, defenses: editDefenses, speedFeet: editSpeedFeet,
    priceGold: editPriceGold, weight: editWeight, merchant: editMerchant, darkvision: editDarkvision,
    truesight: editTruesight, blindsight: editBlindsight, flySpeed: editFlySpeed, creatureType: editCreatureType,
    extraText: editExtraText, hintMaterial, hintDurability, objectHintValue, applyObjectHint, fillFromCharacter, save,
  });
}

export type SheetEditForm = ReturnType<typeof useSheetEditForm>;
