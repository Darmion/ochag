import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import { itemArt, libraryArt } from '../art/itemArt';
import { mapTargetDecision } from '../tabletop/mapTargeting';
import type { Weapon, FeatureAim, SpellEntry, SpellAreaView, ActionBarProps, Popover, BeastForm, MapAimState, Metamagic } from './types';
import { weaponLimit } from './weapons';

export type MapAimDeps = {
  props: ActionBarProps;
  popover: Ref<Popover>;
  working: Ref<boolean>;
  actionError: Ref<string>;
  weapons: Ref<Weapon[]>;
  castingEntry: Ref<SpellEntry | null>;
  targetId: Ref<string>;
  castMetamagic: Ref<Metamagic>;
  perform: (action: () => Promise<unknown>, keepOpen?: boolean) => Promise<void>;
  weaponBlocked: (weaponId: string) => boolean;
  check: (kind: "attack" | "skill" | "save" | "ability", key: string, options?: { hidden?: boolean; }) => Promise<void> | undefined;
  chosenBeast: ComputedRef<BeastForm | null>;
  conjureCountOf: (entry: SpellEntry, option: number) => number;
  conjureOption: Ref<number>;
  castBeast: Ref<string>;
  castTargets: Ref<string[]>;
  castArea: Ref<string>;
  spellName: (entry: SpellEntry) => string;
  cast: (entry: SpellEntry, templateId?: string, extra?: Record<string, unknown>) => Promise<any>;
  spellRangeFeet: (entry: SpellEntry | null) => number | null;
};

export function useMapAim({ props, popover, working, actionError, weapons, castingEntry, targetId, castMetamagic, perform, weaponBlocked, check, chosenBeast, conjureCountOf, conjureOption, castBeast, castTargets, castArea, spellName, cast, spellRangeFeet }: MapAimDeps) {
  const mapAiming = ref(false);
  const armedWeapon = ref<Weapon | null>(null);
  const aimArt = computed(() => {
    if (popover.value === 'attack') return (armedWeapon.value ? itemArt(armedWeapon.value.name) : null) ?? libraryArt('ui/symbols/sword');
    if (popover.value === 'features') return featureAim.value?.art ?? libraryArt('ui/symbols/target');
    const mechanics = castingEntry.value?.spell?.mechanics;
    return mechanics?.healingFormula && !mechanics.damageFormula ? libraryArt('ui/symbols/heart') : libraryArt('ui/symbols/magic-wand');
  });
  const aimName = computed(() => popover.value === 'attack' ? armedWeapon.value?.name ?? ''
    : popover.value === 'features' ? featureAim.value?.label ?? ''
    : castingEntry.value ? spellName(castingEntry.value) : '');

  const featureAim = ref<FeatureAim | null>(null);
  function aimFeature(spec: FeatureAim) {
    if (working.value) return;
    actionError.value = '';
    featureAim.value = spec;
    mapAiming.value = true;
  }
  const meleeReach = computed(() => Math.max(5, ...weapons.value.filter(weapon => weapon.weapon_kind !== 'ranged').map(weapon => weapon.range_feet ?? 5)));
  const rangedReach = computed(() => Math.max(5, ...weapons.value.filter(weapon => weapon.weapon_kind === 'ranged').map(weaponLimit)));

  const areaHover = ref<{ names: string[]; inRange: boolean } | null>(null);
  function setAreaHover(names: string[], inRange: boolean) {
    areaHover.value = { names, inRange };
  }
  const targetingCursor = computed(() => targetingActive.value ? aimArt.value : null);
  function armWeapon(weapon: Weapon) {
    if (working.value || weaponBlocked(weapon.id)) return;
    armedWeapon.value = weapon;
    targetId.value = '';
    actionError.value = '';
    mapAiming.value = true;
  }
  watch(popover, () => { mapAiming.value = false; armedWeapon.value = null; featureAim.value = null; });
  watch(mapAiming, on => { if (!on) { featureAim.value = null; areaHover.value = null; } });
  watch(() => `${props.actor?.characterId ?? ''}|${props.sceneId}`, () => {
    mapAiming.value = false; armedWeapon.value = null; castingEntry.value = null; castTargets.value = []; featureAim.value = null;
  });

  const targetingActive = computed(() => mapAiming.value &&
    ((popover.value === 'attack' && armedWeapon.value !== null) || (popover.value === 'spell' && castingEntry.value !== null)
      || (popover.value === 'features' && featureAim.value !== null)));

  const AREA_COLORS: Record<string, string> = {
    fire: '#ff7a3d', cold: '#7fc8ff', lightning: '#c9a7ff', thunder: '#9fb4ff', acid: '#a6e05a', poison: '#7bd36a',
    necrotic: '#9a7bc5', radiant: '#ffe28a', psychic: '#e58ad9', force: '#c8d0ff',
  };
  function areaColor(entry: SpellEntry) {
    return AREA_COLORS[entry.spell?.mechanics?.damageType ?? ''] ?? '#e8835a';
  }

  const aimState = computed<MapAimState | null>(() => {
    if (!targetingActive.value) return null;
    if (popover.value === 'attack') {
      return { rangeFeet: armedWeapon.value ? weaponLimit(armedWeapon.value) : null, walls: true, area: null, chosen: [] as string[], self: false, only: null as string[] | null, living: true };
    }
    if (popover.value === 'features') {
      const spec = featureAim.value!;
      return { rangeFeet: spec.rangeFeet, walls: false, area: null, chosen: [] as string[], self: spec.self, only: spec.only ?? null, living: true };
    }
    const entry = castingEntry.value!;
    const area = entry.spell?.area ?? null;
    const summon = entry.spell?.summon;
    if (summon && chosenBeast.value) {
      return {
        rangeFeet: spellRangeFeet(entry), walls: false, area: null, chosen: [] as string[], self: false, only: null as string[] | null, living: false,
        place: { size: chosenBeast.value.size, count: summon.kind === 'conjure-animals' ? conjureCountOf(entry, conjureOption.value) : 1 },
      };
    }
    if (entry.spell?.teleport) {
      return {
        rangeFeet: entry.spell.teleport.rangeFeet, walls: false, area: null, chosen: [] as string[], self: false, only: null as string[] | null, living: false,
        place: { size: 'medium', count: 1 },
      };
    }
    return {
      rangeFeet: area?.fromSelf ? null : spellRangeFeet(entry), walls: false,
      area: area ? { ...area, color: areaColor(entry) } : null, chosen: castTargets.value,
      self: !(entry.spell?.mechanics?.attack || entry.spell?.mechanics?.save || entry.spell?.mechanics?.damageFormula), only: null as string[] | null,
      living: false,
    };
  });

  function setMapArea(placed: { x: number; z: number; direction: number; inRange: boolean }): boolean {
    const entry = castingEntry.value;
    const area = entry?.spell?.area;
    if (!targetingActive.value || popover.value !== 'spell' || !entry || !area) return false;
    if (working.value || props.busy) return true;
    if (!placed.inRange) {
      actionError.value = 'Точка области дальше, чем достаёт заклинание.';
      return true;
    }
    void castOnArea(entry, area, placed);
    return true;
  }

  async function castOnArea(entry: SpellEntry, area: SpellAreaView, placed: { x: number; z: number; direction: number }) {
    const actor = props.actor;
    if (!actor || !props.sceneId) return;
    const base = `/campaigns/${props.campaignId}/scenes/${props.sceneId}/templates`;
    let templateId = '';
    working.value = true;
    actionError.value = '';
    try {
      const made = await props.request(base, 'POST', {
        shape: area.shape, x: placed.x, z: placed.z, direction: placed.direction, sizeFeet: area.sizeFeet,
        ...(area.shape === 'line' ? { widthFeet: area.widthFeet ?? 5 } : {}), color: areaColor(entry), label: `${spellName(entry)} — ${actor.name}`.slice(0, 100),
      });
      templateId = made.id;
    } catch (cause) {
      actionError.value = cause instanceof Error ? cause.message : 'Не получилось.';
    } finally {
      working.value = false;
    }
    if (!templateId) return;
    const result = await cast(entry, templateId);
    const remove = () => void props.request(`${base}/${templateId}`, 'DELETE').catch(() => undefined);
    if (!result) remove();
    else if (!result.pending) setTimeout(remove, 1500);
  }

  function setMapPlace(point: { x: number; z: number }): boolean {
    const entry = castingEntry.value;
    if (targetingActive.value && popover.value === 'spell' && entry?.spell?.teleport) {
      if (!working.value && !props.busy) void cast(entry, '', { place: { x: point.x, z: point.z } });
      return true;
    }
    if (!targetingActive.value || popover.value !== 'spell' || !entry?.spell?.summon || !castBeast.value) return false;
    if (working.value || props.busy) return true;
    void cast(entry, '', {
      beast: castBeast.value, place: { x: point.x, z: point.z },
      ...(entry.spell.summon.kind === 'conjure-animals' ? { conjureOption: conjureOption.value } : {}),
    });
    return true;
  }

  function strikeWall(wallId: string, tile: number | null): boolean {
    const actor = props.actor;
    const weapon = armedWeapon.value;
    if (!targetingActive.value || popover.value !== 'attack' || !weapon || !actor || !props.sceneId) return false;
    if (working.value || props.busy) return true;
    void perform(async () => {
      await props.request(`/campaigns/${props.campaignId}/scenes/${props.sceneId}/walls/${wallId}/strike`, 'POST', {
        characterId: actor.characterId, weaponId: weapon.id, ...(tile !== null ? { tile } : {}),
      });
    });
    return true;
  }

  function setMapTarget(characterId: string): boolean {
    if (!targetingActive.value) return false;
    if (popover.value === 'features' && featureAim.value) {
      const spec = featureAim.value;
      if (working.value || props.busy) return true;
      const self = props.actor?.characterId === characterId;
      const target = props.targets.find(item => item.characterId === characterId);
      if (self ? !spec.self : !target) actionError.value = self ? 'На себя — нельзя: выберите другую цель.' : 'Эта цель недоступна.';
      else if (spec.only && !spec.only.includes(characterId)) actionError.value = 'Не эта цель — выберите одну из отмеченных.';
      else if (!self && spec.rangeFeet !== null && target?.distanceFeet != null && target.distanceFeet > spec.rangeFeet) actionError.value = `Цель дальше ${spec.rangeFeet} фут. — подойдите ближе.`;
      else {
        mapAiming.value = false;
        void spec.run(characterId);
      }
      return true;
    }
    if (popover.value === 'spell' && castingEntry.value?.spell?.area) return true;
    const target = props.targets.find(item => item.characterId === characterId);
    const weapon = armedWeapon.value;
    const entry = castingEntry.value;
    const attacking = popover.value === 'attack';
    const single = Boolean(entry?.spell?.singleTarget && castMetamagic.value !== 'twinned');
    const result = mapTargetDecision({
      mode: attacking ? 'attack' : 'spell', id: characterId, known: Boolean(target),
      self: props.actor?.characterId === characterId, busy: working.value || Boolean(props.busy),
      blocked: attacking && (!weapon || weaponBlocked(weapon.id)),
      distance: target?.distanceFeet ?? null,
      range: attacking && weapon ? weaponLimit(weapon) : entry ? spellRangeFeet(entry) : null,
      selected: castTargets.value, single,
    });
    if (result.kind === 'error') actionError.value = result.message;
    if (result.kind === 'attack' && weapon) {
      targetId.value = characterId;
      void check('attack', weapon.id);
    }
    if (result.kind === 'spell' && entry) {
      actionError.value = '';
      castArea.value = '';
      castTargets.value = result.targets;
      if (single && !entry.spell?.projectiles) void cast(entry);
    }
    return true;
  }

  const aimHint = computed(() => {
    if (popover.value === 'attack') return 'Щёлкните по фигуре, предмету, стене или двери, чтобы атаковать.';
    if (popover.value === 'features') return featureAim.value?.self ? 'Щёлкните по фигуре (или по себе), чтобы применить умение.' : featureAim.value?.only ? 'Щёлкните по одной из отмеченных фигур.' : 'Щёлкните по фигуре, чтобы применить умение.';
    const entry = castingEntry.value;
    if (entry?.spell?.summon) return `Щёлкните по клетке рядом — туда встанет ${chosenBeast.value?.name ?? 'зверь'}${aimState.value && 'place' in aimState.value && (aimState.value.place?.count ?? 1) > 1 ? ` ×${aimState.value.place!.count}` : ''}.`;
    if (entry?.spell?.teleport) return `Щёлкните по свободной клетке в ${entry.spell.teleport.rangeFeet} фт., которую видно, — туда перенесётесь.`;
    if (entry?.spell?.shape) return entry.spell.singleTarget ? `Щёлкните по фигуре — облик: ${chosenBeast.value?.name ?? 'зверь'}.` : `Отметьте согласных щелчками, затем подтвердите — облик: ${chosenBeast.value?.name ?? 'зверь'}.`;
    if (entry?.spell?.area) return entry.spell.area.fromSelf ? 'Поверните область курсором и щёлкните — заклинание ляжет туда.' : 'Наведите область и щёлкните — заклинание ляжет туда.';
    return entry?.spell?.singleTarget && castMetamagic.value !== 'twinned' && !entry.spell.projectiles ? 'Щёлкните по фигуре, чтобы сотворить заклинание.' : 'Отметьте цели щелчками, затем подтвердите заклинание.';
  });

  return { mapAiming, armedWeapon, aimArt, aimName, aimFeature, meleeReach, rangedReach, areaHover, setAreaHover, targetingCursor, armWeapon, targetingActive, aimState, setMapArea, setMapPlace, strikeWall, setMapTarget, aimHint };
}
