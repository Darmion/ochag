import type { Ref, ComputedRef } from 'vue';
import type { Tabletop } from '../scene';
import { playSfx } from '../sfx';
import { alertMyTurn } from '../../campaign/turnAlert';
import { type TableToast, naturalMark } from '../toasts';
import { describeGroups } from '../../rules/dice';
import { outcomeText } from '../../rules/conditions';
import type { RollEntry, InitiativeEntry, SceneObjectDTO, TabletopProps, Character } from './types';

export type TurnAnnouncementsDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  characters: Ref<Character[]>;
  objects: Ref<SceneObjectDTO[]>;
  activeObjectId: Ref<string>;
  table: () => Tabletop | undefined;
  followTurn: Ref<boolean>;
  selectTurn: Ref<boolean>;
  builderMode: Ref<boolean>;
  multiCount: ComputedRef<number>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
};

export function useTurnAnnouncements({ props, viewOnly, characters, objects, activeObjectId, table, followTurn, selectTurn, builderMode, multiCount, pushToast }: TurnAnnouncementsDeps) {
  function ownsCharacter(characterId: string | null) {
    return Boolean(characterId) &&
      characters.value.find(character => character.id === characterId)?.owner_user_id === props.currentUserId;
  }

  function rollToast(roll: RollEntry): Omit<TableToast, 'id'> {
    const characterName = characters.value.find(character => character.id === roll.character_id)?.name;
    const who = characterName || roll.user_display_name || 'Участник';
    const mark = naturalMark(roll);

    return {
      tone: mark ? mark.kind : 'roll',
      title: roll.user_id === props.currentUserId ? `${who} (вы)` : who,
      value: mark ? mark.text : String(roll.total),
      detail: [
        roll.label,
        `${roll.formula}: ${roll.breakdown?.length ? describeGroups(roll.breakdown) : roll.dice_results.join(', ')}`,
        mark?.total != null ? `итог с модификаторами ${mark.total}` : '',
        roll.outcome?.reasons?.length ? roll.outcome.reasons.join('; ') : '',
      ].filter(Boolean).join(' · '),
      badge: outcomeText(roll.outcome) || (roll.hidden ? 'скрытый' : undefined),
    };
  }

  let rollsPrimed = false;
  const seenRollIds = new Set<string>();

  let initiativePrimed = false;
  let lastCurrentEntryId = '';
  let lastCombatRound = 1;

  function takeFreshRolls(list: RollEntry[]) {
    const fresh = rollsPrimed ? list.filter(roll => !seenRollIds.has(roll.id)) : [];
    for (const roll of list) seenRollIds.add(roll.id);
    rollsPrimed = true;
    return fresh;
  }

  function resetTurnAnnouncements() {
    initiativePrimed = false;
    lastCurrentEntryId = '';
  }

  function placementOf(characterId: string | null) {
    return characterId ? objects.value.find(object => object.character_id === characterId) : undefined;
  }

  function selectTurnCreature(entries: InitiativeEntry[]) {
    if (viewOnly || builderMode.value || multiCount.value) return;
    const placements = entries
      .filter(entry => entry.is_current)
      .map(entry => placementOf(entry.character_id))
      .filter((placement): placement is SceneObjectDTO => Boolean(placement?.canEdit));
    const pick = placements.find(placement => ownsCharacter(placement.character_id)) ?? placements[0];
    if (pick) activeObjectId.value = pick.id;
  }

  function announceTurn(entries: InitiativeEntry[], round: number) {
    const current = entries.find(entry => entry.is_current);

    if (initiativePrimed) {
      if (current && !lastCurrentEntryId) playSfx('combat-start');
      if (current && current.id !== lastCurrentEntryId) {
        const mine = ownsCharacter(current.character_id);
        const placement = placementOf(current.character_id);

        pushToast({
          tone: mine ? 'mine' : 'turn',
          title: mine ? 'Ваш ход!' : 'Ход',
          value: current.name,
          detail: round !== lastCombatRound ? `Раунд ${round}` : undefined,
          focus: placement ? { x: placement.world_x, z: placement.world_z } : null,
        }, mine ? 9000 : 5000);
        if (mine && !viewOnly) alertMyTurn(current.name);

        if (followTurn.value && placement) table()?.focusOn({ x: placement.world_x, z: placement.world_z });
        if (selectTurn.value) selectTurnCreature(entries);
      } else if (!entries.length && lastCurrentEntryId) {
        pushToast({ tone: 'info', title: 'Бой завершён' });
        playSfx('combat-end');
      }
    }

    lastCurrentEntryId = current?.id ?? '';
    lastCombatRound = round;
    initiativePrimed = true;
  }

  return { ownsCharacter, rollToast, takeFreshRolls, resetTurnAnnouncements, announceTurn };
}
