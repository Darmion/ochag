import type { Ref } from 'vue';
import { confirmAction } from '../../ui/confirmDialog';
import type { MapPin, TableTool } from '../scene';
import { roundCoordinate, type Position } from '../grid';
import { openGameWindow } from '../layout/gameHud';
import type { TabletopProps } from './types';

export type PinsDeps = {
  props: TabletopProps;
  pins: Ref<MapPin[]>;
  pendingPinPoint: Ref<Position | null>;
  pendingPinNoteId: Ref<string>;
  noteOpenRequest: Ref<{ noteId: string; nonce: number } | null>;
  tool: Ref<TableTool>;
  basePath: () => string;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function usePins({ props, pins, pendingPinPoint, pendingPinNoteId, noteOpenRequest, tool, basePath, refresh, run }: PinsDeps) {
  async function onPinClick(pinId: string) {
    const pin = pins.value.find(p => p.id === pinId);
    if (!pin) return;

    if (tool.value === 'pin') {
      if (!(await confirmAction(`Снять булавку «${pin.title}» с карты? Сама заметка останется.`, { title: 'Снять булавку', confirmLabel: 'Снять' }))) return;
      void run(async () => {
        await props.request(`${basePath()}/pins/${pinId}`, 'DELETE');
        await refresh();
      });
      return;
    }

    openGameWindow('gmNotes');
    noteOpenRequest.value = { noteId: pin.note_id, nonce: Date.now() };
  }

  function placePin() {
    const point = pendingPinPoint.value;
    if (!point || !pendingPinNoteId.value) return;

    return run(async () => {
      await props.request(`${basePath()}/pins`, 'POST', { noteId: pendingPinNoteId.value, x: roundCoordinate(point.x), z: roundCoordinate(point.z) });
      pendingPinPoint.value = null;
      await refresh();
    });
  }

  return { onPinClick, placePin };
}
