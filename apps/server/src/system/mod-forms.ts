import type { Queryable } from '../db.ts';
import type { TableContext } from '../tabletop/context.ts';
import { canManageCharacter } from '../tabletop/scene/placements.ts';
import { objectSchema, reject, uuid } from '../tabletop/shared.ts';

export type ModFormField =
  | { key: string; label: string; hint: string; type: 'text' | 'textarea'; maxLength: number; placeholder: string; required: boolean; default: string }
  | { key: string; label: string; hint: string; type: 'number'; min: number; max: number; step: number; required: boolean; default: number | null }
  | { key: string; label: string; hint: string; type: 'select'; options: Array<{ value: string; label: string }>; required: boolean; default: string }
  | { key: string; label: string; hint: string; type: 'checkbox'; required: false; default: boolean }
  | { key: string; label: string; hint: string; type: 'character'; who: 'any' | 'character' | 'npc'; required: boolean; default: null };

export type ModFormCall = {
  q: Queryable; ctx: TableContext; kit: unknown; campaignId: string; userId: string; characterId: string | null;
  values: Record<string, string | number | boolean | null>;
};

export type ModForm = {
  id: string; modId: string; modName: string; title: string; description: string; icon: string;
  who: 'gm' | 'everyone'; scope: 'campaign' | 'character'; submit: string; fields: ModFormField[];
  run: (call: ModFormCall) => Promise<{ message?: unknown } | void> | { message?: unknown } | void;
};

const FORM_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const FIELD_KEY = /^[a-z][a-zA-Z0-9_]{0,30}$/;
const OPTION_VALUE = /^[a-z0-9_-]{1,40}$/;
const RESERVED = new Set(['characterId']);

const line = (value: unknown, limit: number) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '');
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

function fieldOf(raw: unknown, index: number, form: string): ModFormField {
  const entry = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const at = `окно «${form}», поле ${index + 1}`;
  const key = typeof entry.key === 'string' ? entry.key : '';
  if (!FIELD_KEY.test(key) || RESERVED.has(key)) throw new Error(`${at}: key — латинская буква, затем буквы, цифры, «_» (не characterId)`);
  const label = line(entry.label, 80);
  if (!label) throw new Error(`${at}: нужна label`);
  const hint = line(entry.hint, 200);
  const required = entry.required === true;
  switch (entry.type) {
    case 'text':
    case 'textarea': {
      const maxLength = entry.maxLength === undefined ? (entry.type === 'text' ? 120 : 1000) : entry.maxLength;
      if (!Number.isInteger(maxLength) || (maxLength as number) < 1 || (maxLength as number) > 4000) throw new Error(`${at}: maxLength — от 1 до 4000`);
      const fallback = typeof entry.default === 'string' ? entry.default.slice(0, maxLength as number) : '';
      return { key, label, hint, type: entry.type, maxLength: maxLength as number, placeholder: line(entry.placeholder, 120), required, default: fallback };
    }
    case 'number': {
      const min = entry.min === undefined ? 0 : entry.min;
      const max = entry.max === undefined ? 100 : entry.max;
      const step = entry.step === undefined ? 1 : entry.step;
      if (!finite(min) || !finite(max) || (min as number) > (max as number) || !finite(step) || (step as number) <= 0) throw new Error(`${at}: min ≤ max и step больше 0`);
      const fallback = entry.default === undefined ? null : entry.default;
      if (fallback !== null && (!finite(fallback) || (fallback as number) < (min as number) || (fallback as number) > (max as number))) throw new Error(`${at}: default — между min и max`);
      return { key, label, hint, type: 'number', min: min as number, max: max as number, step: step as number, required, default: fallback as number | null };
    }
    case 'select': {
      const options = (Array.isArray(entry.options) ? entry.options : []).slice(0, 30).map(option => {
        const item = (option && typeof option === 'object' ? option : {}) as Record<string, unknown>;
        return { value: typeof item.value === 'string' ? item.value : '', label: line(item.label, 120) };
      });
      if (options.length < 2 || options.some(option => !OPTION_VALUE.test(option.value) || !option.label) || new Set(options.map(option => option.value)).size !== options.length) {
        throw new Error(`${at}: options — хотя бы два разных { value, label }`);
      }
      const fallback = typeof entry.default === 'string' && options.some(option => option.value === entry.default) ? entry.default : options[0]!.value;
      return { key, label, hint, type: 'select', options, required: false, default: fallback };
    }
    case 'checkbox':
      return { key, label, hint, type: 'checkbox', required: false, default: entry.default === true };
    case 'character': {
      const who = entry.who === undefined ? 'any' : entry.who;
      if (who !== 'any' && who !== 'character' && who !== 'npc') throw new Error(`${at}: who — any, character или npc`);
      return { key, label, hint, type: 'character', who, required, default: null };
    }
    default:
      throw new Error(`${at}: type — text, textarea, number, select, checkbox или character`);
  }
}

export function normalizeModForm(input: unknown, modId: string, modName: string): ModForm {
  if (!input || typeof input !== 'object') throw new Error('нужен объект окна');
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!FORM_ID.test(id)) throw new Error(`окно «${id}»: id — строчные латинские буквы, цифры, дефис`);
  const title = line(raw.title, 60);
  if (!title) throw new Error(`окно «${id}»: нужен title`);
  if (typeof raw.run !== 'function') throw new Error(`окно «${title}»: нужна функция run`);
  const who = raw.who === undefined ? 'gm' : raw.who;
  if (who !== 'gm' && who !== 'everyone') throw new Error(`окно «${title}»: who — gm или everyone`);
  const scope = raw.scope === undefined ? 'campaign' : raw.scope;
  if (scope !== 'campaign' && scope !== 'character') throw new Error(`окно «${title}»: scope — campaign или character`);
  if (raw.fields !== undefined && (!Array.isArray(raw.fields) || raw.fields.length > 12)) throw new Error(`окно «${title}»: fields — список до 12 полей`);
  const fields = ((raw.fields as unknown[] | undefined) ?? []).map((field, index) => fieldOf(field, index, title));
  if (new Set(fields.map(field => field.key)).size !== fields.length) throw new Error(`окно «${title}»: key полей повторяются`);
  const icon = line(raw.icon, 40);
  return {
    id, modId, modName, title, description: line(raw.description, 400), icon: /^[A-Za-z0-9]+$/.test(icon) ? icon : '',
    who, scope, submit: line(raw.submit, 40) || 'Выполнить', fields, run: raw.run as ModForm['run'],
  };
}

export function formView(form: ModForm) {
  const { run: _run, ...view } = form;
  return view;
}

async function valuesOf(q: Queryable, campaignId: string, form: ModForm, body: Record<string, unknown>) {
  const unknown = Object.keys(body).filter(key => key !== 'characterId' && !form.fields.some(field => field.key === key));
  if (unknown.length) reject(400, `Лишние поля: ${unknown.join(', ')}.`);
  const values: ModFormCall['values'] = {};
  for (const field of form.fields) {
    const given = body[field.key];
    const missing = given === undefined || given === null || given === '';
    if (missing && field.required) reject(400, `Заполните «${field.label}».`);
    if (field.type === 'text' || field.type === 'textarea') {
      if (!missing && typeof given !== 'string') reject(400, `«${field.label}» — текст.`);
      const text = missing ? field.default : String(given).trim();
      if (text.length > field.maxLength) reject(400, `«${field.label}» — не длиннее ${field.maxLength} знаков.`);
      values[field.key] = text;
    } else if (field.type === 'number') {
      if (!missing && (!finite(given) || (given as number) < field.min || (given as number) > field.max)) reject(400, `«${field.label}» — число от ${field.min} до ${field.max}.`);
      values[field.key] = missing ? field.default : given as number;
    } else if (field.type === 'select') {
      if (!missing && !field.options.some(option => option.value === given)) reject(400, `«${field.label}» — один из вариантов: ${field.options.map(option => option.label).join(', ')}.`);
      values[field.key] = missing ? field.default : given as string;
    } else if (field.type === 'checkbox') {
      if (!missing && typeof given !== 'boolean') reject(400, `«${field.label}» — да или нет.`);
      values[field.key] = missing ? field.default : given as boolean;
    } else if (field.type === 'character') {
      if (missing) { values[field.key] = null; continue; }
      const row = typeof given === 'string' && /^[0-9a-f-]{36}$/i.test(given)
        ? (await q.query('SELECT kind FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, given])).rows[0] as { kind: string } | undefined
        : undefined;
      if (!row || row.kind === 'object' || (field.who !== 'any' && row.kind !== field.who)) reject(400, `«${field.label}»: такого существа в кампании нет.`);
      values[field.key] = given as string;
    }
  }
  return values;
}

export function registerModFormRoutes(ctx: TableContext, kit: unknown, forms: ModForm[]) {
  const { app, db, auth, membership } = ctx;
  const byKey = new Map(forms.map(form => [`${form.modId}/${form.id}`, form]));

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/mod-forms',
    { schema: { params: objectSchema({ campaignId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        const gm = await ctx.feature.canManage(q, member, userId);
        return { forms: forms.filter(form => form.who === 'everyone' || gm).map(formView) };
      });
    },
  );

  app.post<{ Params: { campaignId: string; modId: string; formId: string }; Body: Record<string, unknown> }>(
    '/campaigns/:campaignId/mods/:modId/forms/:formId',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, modId: { type: 'string', maxLength: 64 }, formId: { type: 'string', maxLength: 40 } }),
        body: { type: 'object', maxProperties: 13 },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, modId, formId } = request.params;
      const form = byKey.get(`${modId}/${formId}`);
      if (!form) reject(404, 'Такого окна мода нет — мод выключен или не подключился.');
      const body = (request.body ?? {}) as Record<string, unknown>;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (form.who === 'gm' && !(await ctx.feature.canManage(q, member, userId))) reject(403, `«${form.title}» открывает мастер.`);
        let characterId: string | null = null;
        if (form.scope === 'character') {
          const id = typeof body.characterId === 'string' ? body.characterId : '';
          const row = /^[0-9a-f-]{36}$/i.test(id)
            ? (await q.query('SELECT id, kind, owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, id])).rows[0] as any
            : undefined;
          if (!row || row.kind === 'object') reject(400, `«${form.title}»: выберите существо на столе.`);
          if (!(await canManageCharacter(q, member, userId, row.owner_user_id, row.id))) reject(403, `«${form.title}» — для своего существа или мастеру.`);
          characterId = row.id;
        } else if (body.characterId !== undefined) reject(400, 'Лишние поля: characterId.');
        const values = await valuesOf(q, campaignId, form, body);
        let result: { message?: unknown } | void;
        try {
          result = await form.run({ q, ctx, kit, campaignId, userId, characterId, values });
        } catch (error) {
          if ((error as { statusCode?: number })?.statusCode) throw error;
          const text = (error instanceof Error ? error.message : String(error)).slice(0, 300);
          request.log.error({ mod: form.modId, form: form.id, error: text }, 'Mod form failed');
          reject(424, `Мод «${form.modName}» не справился: ${text}`);
        }
        const message = result && typeof result.message === 'string' ? result.message.slice(0, 1000) : null;
        return { message };
      });
    },
  );
}
