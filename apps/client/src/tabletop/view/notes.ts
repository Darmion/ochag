import type { Ref } from 'vue';
import type { TabletopProps, NoteSummary } from './types';

export type NotesDeps = {
  props: TabletopProps;
  notes: Ref<NoteSummary[]>;
  notesCanManage: Ref<boolean>;
  disposed: () => boolean;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function useNotes({ props, notes, notesCanManage, disposed, run }: NotesDeps) {
  function notesPath() {
    return `/campaigns/${props.campaignId}/notes`;
  }

  async function loadNotes() {
    const result = await props.request(notesPath());
    if (disposed()) return;
    notes.value = result.notes;
    notesCanManage.value = result.canManage;
  }

  function loadNoteBody(noteId: string) {
    return props.request(`${notesPath()}/${noteId}`);
  }

  function createNote(payload: { title: string; body: string }) {
    return run(async () => {
      await props.request(notesPath(), 'POST', payload);
      await loadNotes();
    });
  }

  function saveNote(payload: { noteId: string; body: string; revision: number }) {
    return run(async () => {
      await props.request(`${notesPath()}/${payload.noteId}`, 'PATCH', {
        body: payload.body,
        revision: payload.revision,
      });
      await loadNotes();
    });
  }

  function deleteNote(noteId: string) {
    return run(async () => {
      await props.request(`${notesPath()}/${noteId}`, 'DELETE');
      await loadNotes();
    });
  }

  function grantNoteAccess(payload: { noteId: string; username: string }) {
    return run(async () => {
      await props.request(`${notesPath()}/${payload.noteId}/grants`, 'POST', { username: payload.username });
      await loadNotes();
    });
  }

  function revokeNoteAccess(payload: { noteId: string; userId: string }) {
    return run(async () => {
      await props.request(`${notesPath()}/${payload.noteId}/grants/${payload.userId}`, 'DELETE');
      await loadNotes();
    });
  }

  return { loadNotes, loadNoteBody, createNote, saveNote, deleteNote, grantNoteAccess, revokeNoteAccess };
}
