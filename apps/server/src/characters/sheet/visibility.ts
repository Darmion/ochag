import type { Queryable } from '../../db.ts';
import { findSrdSkill } from '../../rules/srd-data.ts';

import { characterForViewing } from './access.ts';
import { classView, experienceView, hitDiceView } from './views.ts';
import { ABILITY_NAMES, characterParams, type CharacterParams, reject, uuid } from './shared.ts';
import type { RouteContext } from '../../system/route-context.ts';

export const visibilityFieldParams = {
  type: 'object',
  required: ['campaignId', 'characterId', 'fieldKey'],
  additionalProperties: false,
  properties: { campaignId: uuid, characterId: uuid, fieldKey: { type: 'string', minLength: 1, maxLength: 100 } },
};

// Hidden scalar fields come back as null and are listed in hiddenFields, so the sheet still renders.
export const PLACEHOLDER_SCALAR_FIELDS = [
  'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma',
  'hp_current', 'hp_max', 'hp_temp', 'armor_class', 'speed_feet',
] as const;

export const OMIT_SHEET_EXTRA: Record<string, string[]> = {
  weapons: ['weapons'],
  misc: ['text', 'coins', 'resources'],
  legacy_skills: ['skills'],
  legacy_spells: ['spellsInfo', 'spellSlots'],
  legacy_saves: ['saves'],
};

export const KNOWN_FIELD_KEYS: readonly string[] = [
  ...PLACEHOLDER_SCALAR_FIELDS,
  ...Object.keys(OMIT_SHEET_EXTRA),
];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidFieldKey(fieldKey: string): boolean {
  if (KNOWN_FIELD_KEYS.includes(fieldKey)) return true;
  const colonAt = fieldKey.indexOf(':');
  if (colonAt === -1) return false;
  const prefix = fieldKey.slice(0, colonAt);
  const rest = fieldKey.slice(colonAt + 1);
  if (!rest) return false;
  if (prefix === 'effect' || prefix === 'resource' || prefix === 'spell') return UUID_RE.test(rest);
  if (prefix === 'skill') return findSrdSkill(rest) !== undefined;
  if (prefix === 'save') return ABILITY_NAMES.has(rest);
  return false;
}

export type VisibilityRow = { field_key: string; mode: 'hidden' | 'allowlist' };
export type GrantRow = { field_key: string; user_id: string };

export async function loadVisibilityRows(q: Queryable, campaignId: string, characterId: string) {
  const visibilityRows = (
    await q.query<VisibilityRow>(
      'SELECT field_key, mode FROM character_field_visibility WHERE campaign_id=$1 AND character_id=$2',
      [campaignId, characterId],
    )
  ).rows;
  const grantRows = (
    await q.query<GrantRow>(
      'SELECT field_key, user_id FROM character_field_visibility_grants WHERE campaign_id=$1 AND character_id=$2',
      [campaignId, characterId],
    )
  ).rows;
  return { visibilityRows, grantRows };
}

export function isFieldVisible(
  fieldKey: string, viewerUserId: string,
  visByField: Map<string, VisibilityRow>, grantsByField: Map<string, Set<string>>,
): boolean {
  const setting = visByField.get(fieldKey);
  if (!setting) return true;
  if (setting.mode === 'hidden') return false;
  return grantsByField.get(fieldKey)?.has(viewerUserId) ?? false;
}

export function applyVisibility(
  character: any, extras: { effects: any[]; resources: any[]; weapons: any[] },
  viewerUserId: string, visibilityRows: VisibilityRow[], grantRows: GrantRow[],
) {
  const visByField = new Map(visibilityRows.map(r => [r.field_key, r]));
  const grantsByField = new Map<string, Set<string>>();
  for (const g of grantRows) {
    if (!grantsByField.has(g.field_key)) grantsByField.set(g.field_key, new Set());
    grantsByField.get(g.field_key)!.add(g.user_id);
  }
  const visible = (key: string) => isFieldVisible(key, viewerUserId, visByField, grantsByField);

  const result: any = { ...character };
  const hiddenFields: string[] = [];

  for (const field of PLACEHOLDER_SCALAR_FIELDS) {
    if (!visible(field)) {
      result[field] = null;
      hiddenFields.push(field);
    }
  }

  const sheetExtra = { ...(character.sheet_extra ?? {}) };
  for (const [fieldKey, keys] of Object.entries(OMIT_SHEET_EXTRA)) {
    if (!visible(fieldKey)) {
      for (const key of keys) delete sheetExtra[key];
    }
  }
  result.sheet_extra = sheetExtra;

  result.effects = extras.effects.filter((e: any) => visible(`effect:${e.id}`));
  result.resources = extras.resources.filter((r: any) => visible(`resource:${r.id}`));
  result.weapons = extras.weapons.filter((w: any) => visible(`weapon:${w.id}`));
  result.hit_dice = hitDiceView(character);
  result.experience_info = experienceView(character);
  result.class_info = classView(character);
  result.hiddenFields = hiddenFields;
  result.privileged = false;

  return result;
}

export function summarizeVisibility(visibilityRows: VisibilityRow[], grantRows: GrantRow[]) {
  const grantsByField = new Map<string, string[]>();
  for (const g of grantRows) {
    if (!grantsByField.has(g.field_key)) grantsByField.set(g.field_key, []);
    grantsByField.get(g.field_key)!.push(g.user_id);
  }
  const fields: Record<string, { mode: string; allowedUserIds: string[] }> = {};
  for (const row of visibilityRows) {
    fields[row.field_key] = { mode: row.mode, allowedUserIds: grantsByField.get(row.field_key) ?? [] };
  }
  return fields;
}

export async function loadVisibleSet(
  q: Queryable, campaignId: string, characterId: string, prefix: 'skill' | 'spell' | 'save', viewerUserId: string,
): Promise<Set<string> | null> {
  const visRows = (
    await q.query<{ field_key: string; mode: string }>(
      `SELECT field_key, mode FROM character_field_visibility
       WHERE campaign_id=$1 AND character_id=$2 AND field_key LIKE $3`,
      [campaignId, characterId, `${prefix}:%`],
    )
  ).rows;
  if (!visRows.length) return null;

  const hidden = new Set(visRows.filter(r => r.mode === 'hidden').map(r => r.field_key));
  const allowlisted = new Set(visRows.filter(r => r.mode === 'allowlist').map(r => r.field_key));

  if (allowlisted.size) {
    const grantRows = (
      await q.query<{ field_key: string }>(
        `SELECT field_key FROM character_field_visibility_grants
         WHERE campaign_id=$1 AND character_id=$2 AND field_key LIKE $3 AND user_id=$4`,
        [campaignId, characterId, `${prefix}:%`, viewerUserId],
      )
    ).rows;
    const grantedToViewer = new Set(grantRows.map(r => r.field_key));
    for (const key of allowlisted) {
      if (!grantedToViewer.has(key)) hidden.add(key);
    }
  }

  return hidden;
}

export function registerVisibilityRoutes(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.get<{ Params: CharacterParams }>(
    '/campaigns/:campaignId/characters/:characterId/visibility',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const { privileged } = await characterForViewing(ctx, q, campaignId, characterId, userId, member);
        if (!privileged) reject(403, 'Недостаточно прав.');

        const { visibilityRows, grantRows } = await loadVisibilityRows(q, campaignId, characterId);
        return { fields: summarizeVisibility(visibilityRows, grantRows) };
      });
    },
  );

  app.put<{
    Params: CharacterParams & { fieldKey: string };
    Body: { mode: 'public' | 'hidden' | 'allowlist'; allowedUserIds?: string[] };
  }>(
    '/campaigns/:campaignId/characters/:characterId/visibility/:fieldKey',
    {
      schema: {
        params: visibilityFieldParams,
        body: {
          type: 'object',
          required: ['mode'],
          additionalProperties: false,
          properties: {
            mode: { type: 'string', enum: ['public', 'hidden', 'allowlist'] },
            allowedUserIds: { type: 'array', items: uuid, maxItems: 50 },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId, fieldKey } = request.params;
      const { mode, allowedUserIds } = request.body;

      if (!isValidFieldKey(fieldKey)) reject(400, 'Неизвестное поле.');
      if (mode === 'allowlist' && (!allowedUserIds || allowedUserIds.length === 0)) {
        reject(400, 'Укажите хотя бы одного игрока.');
      }

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const { privileged } = await characterForViewing(ctx, q, campaignId, characterId, userId, member);
        if (!privileged) reject(403, 'Недостаточно прав.');

        if (mode === 'public') {
          await q.query(
            'DELETE FROM character_field_visibility WHERE campaign_id=$1 AND character_id=$2 AND field_key=$3',
            [campaignId, characterId, fieldKey],
          );
          return { fieldKey, mode: 'public', allowedUserIds: [] };
        }

        const uniqueAllowedUserIds = [...new Set(allowedUserIds ?? [])];

        if (mode === 'allowlist') {
          const memberRows = (
            await q.query(
              'SELECT user_id FROM campaign_members WHERE campaign_id=$1 AND user_id = ANY($2::uuid[])',
              [campaignId, uniqueAllowedUserIds],
            )
          ).rows;
          if (memberRows.length !== uniqueAllowedUserIds.length) {
            reject(400, 'Список игроков содержит участника не из этой кампании.');
          }
        }

        await q.query(
          `INSERT INTO character_field_visibility (campaign_id, character_id, field_key, mode)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (campaign_id, character_id, field_key) DO UPDATE SET mode=$4`,
          [campaignId, characterId, fieldKey, mode],
        );
        await q.query(
          'DELETE FROM character_field_visibility_grants WHERE campaign_id=$1 AND character_id=$2 AND field_key=$3',
          [campaignId, characterId, fieldKey],
        );
        if (mode === 'allowlist') {
          for (const allowedUserId of uniqueAllowedUserIds) {
            await q.query(
              `INSERT INTO character_field_visibility_grants (campaign_id, character_id, field_key, user_id)
               VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
              [campaignId, characterId, fieldKey, allowedUserId],
            );
          }
        }

        return { fieldKey, mode, allowedUserIds: mode === 'allowlist' ? uniqueAllowedUserIds : [] };
      });
    },
  );
}
