import { fixedFormula } from '../../rules/dice';
import { computed, ref, watch, nextTick, type Ref, type ComputedRef } from 'vue';
import type { WallSegment, Tabletop, MultiSelection } from '../scene';
import { signalColor } from '../signals';
import { type Position, footprintCells } from '../grid';
import { inArea, type AreaShape } from '../areas';
import type { TokenMenuTarget, TokenSaveRequest } from '../../components/game/TokenMenu.vue';
import { wallTileAt } from '../../components/game/WallPopover.vue';
import { conditionInfo } from '../../rules/conditions';
import GameActionBar from '../../components/game/actionBar/GameActionBar.vue';
import type { TabletopProps, SceneDetail, SceneObjectDTO, WallTool, InitiativeEntry } from './types';
import type { TableToast } from '../toasts';

export type TokenMenuDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  gameUi: ComputedRef<boolean>;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  actionBar: Ref<InstanceType<typeof GameActionBar> | null>;
  targetingActive: ComputedRef<boolean>;
  objects: Ref<SceneObjectDTO[]>;
  activeObjectId: Ref<string>;
  walls: Ref<WallSegment[]>;
  wallTool: Ref<WallTool | null>;
  wallPopover: Ref<{ at: { x: number; y: number }; wallId: string; tile: number; edit: boolean } | null>;
  terrainMode: Ref<boolean>;
  wallFirstPoint: Ref<Position | null>;
  initiativeEntries: Ref<InitiativeEntry[]>;
  editRotation: Ref<number>;
  editScale: Ref<number>;
  editHidden: Ref<boolean>;
  table: () => Tabletop | undefined;
  factionsOpen: Ref<boolean>;
  multiSelection: Ref<MultiSelection>;
  multiCount: ComputedRef<number>;
  tokenMenu: Ref<{ at: { x: number; y: number }; objectId: string } | null>;
  areaPopover: Ref<{ at: { x: number; y: number }; templateId: string } | null>;
  sendPing: (point: Position) => void;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  loadRolls: () => Promise<void>;
  loadInitiative: () => Promise<void>;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  saveObjectTransform: () => void;
  removeFromScene: () => Promise<void>;
  joinInitiative: (characterId: string) => Promise<void>;
  deleteInitiativeEntry: (entryId: string) => Promise<void>;
  triggerAreaList: ComputedRef<{ id: string; area: { shape: AreaShape; x: number; z: number; direction: number; size: number; width: number; }; }[]>;
  trapPopover: Ref<{ at: { x: number; y: number; }; triggerId: string; } | null>;
  templateAreas: ComputedRef<{ id: string; shape: AreaShape; x: number; z: number; direction: number; size: number; width: number; color: string; label: string | null; }[]>;
  groupMenu: Ref<{ at: { x: number; y: number; }; } | null>;
  actorObject: ComputedRef<SceneObjectDTO | null>;
  leaveCombat: (characterId: string) => Promise<void>;
};

export function useTokenMenu({ props, viewOnly, gameUi, sceneId, sceneDetail, actionBar, targetingActive, objects, activeObjectId, walls, wallTool, wallPopover, terrainMode, wallFirstPoint, initiativeEntries, editRotation, editScale, editHidden, table, factionsOpen, multiSelection, multiCount, tokenMenu, areaPopover, sendPing, pushToast, loadRolls, loadInitiative, refresh, run, saveObjectTransform, removeFromScene, joinInitiative, deleteInitiativeEntry, triggerAreaList, trapPopover, templateAreas, groupMenu, actorObject, leaveCombat }: TokenMenuDeps) {
  function onTableContext(target: { objectId: string | null; point: Position | null; screen: { x: number; y: number }; wallId?: string | null }) {
    if (targetingActive.value) { actionBar.value?.cancelStep(); return; }
    if (viewOnly) return;
    if (wallTool.value || terrainMode.value) {
      wallFirstPoint.value = null;
      return;
    }
    if (!gameUi.value) return;
    tokenMenu.value = null;
    areaPopover.value = null;
    groupMenu.value = null;
    if (multiCount.value > 1 && !target.wallId && (!target.objectId || multiSelection.value.objects.includes(target.objectId))) {
      groupMenu.value = { at: target.screen };
      return;
    }
    const onCell = !target.objectId && target.point
      ? [...objects.value].sort((a, b) => Number(a.kind === 'object') - Number(b.kind === 'object')).find(entry => {
        if (entry.parent_object_id) return false;
        const half = footprintCells(entry.size) / 2;
        return Math.abs(entry.world_x - target.point!.x) <= half && Math.abs(entry.world_z - target.point!.z) <= half;
      })
      : undefined;
    const objectId = target.objectId ?? onCell?.id ?? null;
    if (objectId) {
      tokenMenu.value = { at: target.screen, objectId };
      return;
    }
    const wall = target.wallId ? walls.value.find(entry => entry.id === target.wallId) : undefined;
    if (wall) {
      wallPopover.value = { at: target.screen, wallId: wall.id, tile: wallTileAt(wall, target.point), edit: false };
      return;
    }
    const object = target.objectId ? objects.value.find(entry => entry.id === target.objectId) : null;
    const point = target.point ?? (object ? { x: object.world_x, z: object.world_z } : null);
    if (point && sceneDetail.value?.canManage && !viewOnly) {
      const trap = triggerAreaList.value.find(entry => inArea(entry.area, point.x, point.z));
      if (trap) {
        trapPopover.value = { at: target.screen, triggerId: trap.id };
        return;
      }
    }
    if (point) {
      const area = templateAreas.value.find(entry => inArea(entry, point.x, point.z));
      if (area) areaPopover.value = { at: target.screen, templateId: area.id };
    }
  }

  const tokenMenuObject = computed(() => (tokenMenu.value ? objects.value.find(entry => entry.id === tokenMenu.value!.objectId) ?? null : null));
  const tokenMenuTarget = computed<TokenMenuTarget | null>(() => {
    const object = tokenMenuObject.value;
    if (!object) return null;
    return {
      characterId: object.character_id, objectId: object.id, name: object.name,
      hpText: object.hp ? `♡ ${object.hp.current} / ${object.hp.max}${object.hp.temp ? ` +${object.hp.temp}` : ''}` : null,
      conditions: object.conditions ?? [], hidden: object.hidden, kind: object.kind,
      hp: object.hp ?? null,
      inCombat: initiativeEntries.value.some(entry => entry.character_id === object.character_id),
      disposition: object.disposition,
      merchant: object.merchant === true,
      factions: object.factions ?? null,
      canFly: object.canFly === true,
      flightHeight: object.flightHeight ?? null,
    };
  });

  const factionList = ref<Array<{ id: string; name: string; color: string }>>([]);
  async function loadFactionList() {
    if (!sceneDetail.value?.canManage) return;
    try {
      const data = await props.request(`/campaigns/${props.campaignId}/factions`);
      factionList.value = (data.factions ?? []).map((faction: any) => ({ id: faction.id, name: faction.name, color: faction.color }));
    } catch {
    }
  }
  watch(() => tokenMenu.value?.objectId, id => { if (id && sceneDetail.value?.canManage) void loadFactionList(); });
  watch(factionsOpen, open => { if (!open) void loadFactionList(); });

  function tokenFactions(ids: string[] | null) {
    const object = tokenMenuObject.value;
    if (!object) return;
    return run(async () => {
      const path = `/campaigns/${props.campaignId}/characters/${object.character_id}/factions`;
      await (ids ? props.request(path, 'PUT', { factionIds: ids }) : props.request(path, 'DELETE'));
      tokenNotice.value = ids
        ? (ids.length ? `Фракции: ${ids.map(id => factionList.value.find(faction => faction.id === id)?.name ?? '?').join(', ')}` : 'Ни в одной фракции')
        : 'Фракции — по умолчанию';
      await Promise.all([refresh(), loadInitiative()]);
    });
  }
  const tokenNotice = ref<string | null>(null);
  watch(() => tokenMenu.value?.objectId, () => { tokenNotice.value = null; });
  const tokenMenuCanAttack = computed(() => {
    const actor = actorObject.value;
    const object = tokenMenuObject.value;
    return Boolean(actor && object && actor.canEdit && actor.kind !== 'object' && actor.character_id !== object.character_id);
  });

  function tokenAttack() {
    const object = tokenMenuObject.value;
    if (object) actionBar.value?.openAttackOn(object.character_id);
  }
  function tokenSpell() {
    const object = tokenMenuObject.value;
    if (object) actionBar.value?.openSpellOn(object.character_id);
  }

  function tokenHp(mode: 'damage' | 'heal' | 'temp', amount: number) {
    const object = tokenMenuObject.value;
    if (!object || amount < 1) return;
    return run(async () => {
      if (mode === 'temp') {
        const sheet = await props.request(`/campaigns/${props.campaignId}/characters/${object.character_id}`);
        const value = Math.max(Number(sheet.hp_temp ?? 0), amount);
        await props.request(`/campaigns/${props.campaignId}/characters/${object.character_id}`, 'PATCH', { revision: sheet.revision, hpTemp: value });
        tokenNotice.value = `Временные хиты: ${value}`;
        await refresh();
        return;
      }
      const roll = await props.request(`/campaigns/${props.campaignId}/rolls`, 'POST', {
        formula: fixedFormula(amount), label: `${mode === 'damage' ? 'Урон' : 'Лечение'} → ${object.name}`.slice(0, 100),
      });
      await props.request(`/campaigns/${props.campaignId}/rolls/${roll.id}/apply`, 'POST', { characterId: object.character_id, mode });
      tokenNotice.value = `${mode === 'damage' ? 'Урон' : 'Лечение'} ${amount}`;
      await Promise.all([loadRolls(), refresh()]);
    });
  }

  function tokenFly(on: boolean, height?: number) {
    const object = tokenMenuObject.value;
    if (!object) return;
    return run(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/${object.character_id}/flying`, 'PUT', { on, ...(height !== undefined ? { height } : {}) });
      tokenNotice.value = String(result.message ?? (on ? 'Летит' : 'На земле'));
      await refresh();
    });
  }

  function tokenFall(feet: number) {
    const object = tokenMenuObject.value;
    if (!object) return;
    return run(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/${object.character_id}/fall`, 'POST', { feet });
      tokenNotice.value = String(result.message ?? `Падение с ${feet} фут.`);
      await Promise.all([loadRolls(), refresh()]);
    });
  }

  function tokenSave(request: TokenSaveRequest) {
    const object = tokenMenuObject.value;
    if (!object) return;
    return run(async () => {
      const roll = await props.request(`/campaigns/${props.campaignId}/rolls/check`, 'POST', {
        characterId: object.character_id, kind: 'save', key: request.ability, advantage: request.advantage,
        ...(sceneId.value ? { sceneId: sceneId.value } : {}),
      });
      const short = ({ strength: 'СИЛ', dexterity: 'ЛОВ', constitution: 'ТЕЛ', intelligence: 'ИНТ', wisdom: 'МДР', charisma: 'ХАР' } as Record<string, string>)[request.ability];
      tokenNotice.value = `Спасбросок ${short}: ${roll.total ?? '—'}${roll.outcome?.autoFail ? ' (автопровал)' : ''}`;
      await loadRolls();
    });
  }

  function tokenCombat(join: boolean) {
    const object = tokenMenuObject.value;
    if (!object) return;
    if (join) return joinInitiative(object.character_id);
    if (!sceneDetail.value?.canManage) return leaveCombat(object.character_id);
    const entry = initiativeEntries.value.find(row => row.character_id === object.character_id);
    return entry ? deleteInitiativeEntry(entry.id) : undefined;
  }

  function tokenDisposition(value: 'hostile' | 'neutral' | 'friendly') {
    const object = tokenMenuObject.value;
    if (!object || object.disposition === value) return;
    return run(async () => {
      const sheet = await props.request(`/campaigns/${props.campaignId}/characters/${object.character_id}`);
      await props.request(`/campaigns/${props.campaignId}/characters/${object.character_id}`, 'PATCH', { revision: sheet.revision, disposition: value });
      tokenNotice.value = ({ hostile: 'Теперь враг', neutral: 'Теперь нейтрал', friendly: 'Теперь союзник' } as const)[value];
      await Promise.all([refresh(), loadInitiative()]);
    });
  }

  function tokenPing() {
    const object = tokenMenuObject.value;
    if (!object) return;
    const point = { x: object.world_x, z: object.world_z };
    table()?.showPing(point, 'Вы', signalColor(props.currentUserId));
    sendPing(point);
  }

  function tokenCondition(code: string, durationRounds: number | null = null) {
    const object = tokenMenuObject.value;
    if (!object) return;
    const actor = actorObject.value;
    const label = conditionInfo(code).label;
    return run(async () => {
      if (object.conditions?.includes(code)) {
        tokenNotice.value = `Снято: ${label}`;
        const sheet = await props.request(`/campaigns/${props.campaignId}/characters/${object.character_id}`);
        for (const effect of (sheet.effects ?? []).filter((entry: any) => entry.effect_code === code)) {
          await props.request(`/campaigns/${props.campaignId}/characters/${object.character_id}/effects/${effect.id}`, 'DELETE');
        }
      } else {
        const withSource = actor && actor.character_id !== object.character_id && actor.canEdit && (['grappled', 'frightened', 'charmed'].includes(code) || !sceneDetail.value?.canManage);
        await props.request(`/campaigns/${props.campaignId}/conditions/apply`, 'POST', {
          targetIds: [object.character_id], code, ...(withSource ? { sourceCharacterId: actor!.character_id } : {}),
          ...(durationRounds ? { durationRounds } : {}),
        });
        tokenNotice.value = `Наложено: ${label}${durationRounds ? `, ${durationRounds === 1 ? '1 раунд' : durationRounds === 10 ? '1 минута' : `${durationRounds} раундов`}` : ''}`;
      }
      await refresh();
    });
  }

  async function tokenHide() {
    const object = tokenMenuObject.value;
    if (!object) return;
    activeObjectId.value = object.id;
    await nextTick();
    editHidden.value = !object.hidden;
    saveObjectTransform();
  }

  async function tokenRotate(degrees: number) {
    const object = tokenMenuObject.value;
    if (!object) return;
    activeObjectId.value = object.id;
    await nextTick();
    editRotation.value = (((editRotation.value + degrees) % 360) + 360) % 360;
    saveObjectTransform();
  }

  async function tokenScale(factor: number) {
    const object = tokenMenuObject.value;
    if (!object) return;
    activeObjectId.value = object.id;
    await nextTick();
    editScale.value = factor === 0 ? 1 : Math.min(10, Math.max(0.2, Math.round(editScale.value * factor * 100) / 100));
    saveObjectTransform();
  }

  function tokenDuplicate(count: number) {
    const object = tokenMenuObject.value;
    if (!object) return;
    return run(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/${object.character_id}/duplicate`, 'POST', { count, sceneId: sceneId.value });
      pushToast({ tone: 'info', title: 'Копии', detail: `${result.characters?.map((entry: any) => entry.name).join(', ') ?? count} — рядом с «${object.name}».` });
      await refresh();
    });
  }

  async function tokenRemove() {
    const object = tokenMenuObject.value;
    if (!object) return;
    activeObjectId.value = object.id;
    await nextTick();
    await removeFromScene();
  }

  return { onTableContext, tokenMenuObject, tokenMenuTarget, factionList, loadFactionList, tokenFactions, tokenNotice, tokenMenuCanAttack, tokenAttack, tokenSpell, tokenHp, tokenFly, tokenFall, tokenSave, tokenCombat, tokenDisposition, tokenPing, tokenCondition, tokenHide, tokenRotate, tokenScale, tokenDuplicate, tokenRemove };
}
