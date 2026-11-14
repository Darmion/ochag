import { GAME_ICONS, type GameIconName } from '../ui/gameIcons.ts';

export type ModFormField =
  | { key: string; label: string; hint: string; type: 'text' | 'textarea'; maxLength: number; placeholder: string; required: boolean; default: string }
  | { key: string; label: string; hint: string; type: 'number'; min: number; max: number; step: number; required: boolean; default: number | null }
  | { key: string; label: string; hint: string; type: 'select'; options: Array<{ value: string; label: string }>; required: boolean; default: string }
  | { key: string; label: string; hint: string; type: 'checkbox'; required: false; default: boolean }
  | { key: string; label: string; hint: string; type: 'character'; who: 'any' | 'character' | 'npc'; required: boolean; default: null };

export type ModForm = {
  id: string; modId: string; modName: string; title: string; description: string; icon: string;
  who: 'gm' | 'everyone'; scope: 'campaign' | 'character'; submit: string; fields: ModFormField[];
};

export type ModFormValues = Record<string, string | number | boolean | null>;

export function modFormIcon(form: Pick<ModForm, 'icon'>): GameIconName {
  return form.icon && form.icon in GAME_ICONS ? form.icon as GameIconName : 'puzzle';
}

export function modFormDefaults(form: Pick<ModForm, 'fields'>): ModFormValues {
  return Object.fromEntries(form.fields.map(field => [field.key, field.default]));
}

export function modFormPath(campaignId: string, form: Pick<ModForm, 'modId' | 'id'>): string {
  return `/campaigns/${campaignId}/mods/${form.modId}/forms/${form.id}`;
}

export function modFormProblems(form: Pick<ModForm, 'fields'>, values: ModFormValues): string[] {
  const problems: string[] = [];
  for (const field of form.fields) {
    const value = values[field.key];
    const empty = value === null || value === undefined || value === '';
    if (field.required && empty) problems.push(field.label);
    else if (field.type === 'number' && !empty && (typeof value !== 'number' || value < field.min || value > field.max)) problems.push(field.label);
  }
  return problems;
}

export function modFormBody(form: Pick<ModForm, 'fields' | 'scope'>, values: ModFormValues, characterId: string | null): ModFormValues {
  const body: ModFormValues = {};
  for (const field of form.fields) {
    const value = values[field.key];
    if (value !== null && value !== undefined && value !== '') body[field.key] = value;
  }
  if (form.scope === 'character' && characterId) body.characterId = characterId;
  return body;
}
