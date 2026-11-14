import type { Queryable } from '../../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../scene-feature.ts';
import { canManageCharacter, controls, rightsOf } from './placements.ts';
import { creatureTypeOf } from '../spells/rules.ts';
import { rollSkillAgainst } from '../rolls/checks.ts';
import { findSrdSkill } from '../../rules/srd-data.ts';
import { findMonster } from '../../../../../packages/domain/world/bestiary.ts';
import {
  EXAMINE_PARTS, EXAMINE_SKILLS, cleanDcs, defaultExamine, partDc, revealedParts, type ExaminePart, type ExamineSettings,
} from '../../../../../packages/domain/world/examine.ts';

// «Осмотреть» from a figure's menu (complaint list 2026-11-11, item 2). The GM sets the skill and the DCs; a hero rolls once
// per creature or object and keeps what the roll revealed. The card never carries a part the roll did not reach.
const params = objectSchema({ campaignId: uuid, characterId: uuid });

const CARD_COLUMNS = `id, name, kind, size, level, class_name, challenge_rating::float8 AS challenge_rating, hp_current, hp_max, hp_temp, armor_class,
  strength, dexterity, constitution, intelligence, wisdom, charisma, damage_resistances, damage_immunities, damage_vulnerabilities,
  sheet_extra, item_note, weight_lb::float8 AS weight_lb, price_cp, owner_user_id`;

const list = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

async function settingsOf(q: Queryable, campaignId: string, row: any): Promise<{ settings: ExamineSettings; own: boolean; creatureType: string | null }> {
  const creatureType = row.kind === 'object' ? null : await creatureTypeOf(q, campaignId, row.id);
  const saved = (await q.query('SELECT skill, dc, dcs, text FROM character_examine WHERE campaign_id=$1 AND character_id=$2', [campaignId, row.id])).rows[0];
  if (!saved) return { settings: defaultExamine(row.kind === 'object', creatureType), own: false, creatureType };
  return { settings: { skill: saved.skill, dc: Number(saved.dc), dcs: cleanDcs(saved.dcs), text: saved.text ?? '' }, own: true, creatureType };
}

async function cardOf(q: Queryable, campaignId: string, row: any, settings: ExamineSettings, creatureType: string | null, parts: readonly ExaminePart[]) {
  const object = row.kind === 'object';
  const monster = typeof row.sheet_extra?.srdMonster === 'string' ? findMonster(row.sheet_extra.srdMonster) : undefined;
  const known = new Set(parts);
  const card: Record<string, unknown> = { name: row.name, object, known: [...known] };
  if (known.has('kind')) {
    card.kind = object
      ? { weightLb: row.weight_lb ?? null, priceCp: row.price_cp ?? null }
      : { creatureType, size: row.size ?? null, level: row.kind === 'character' ? Number(row.level ?? 1) : null, className: row.class_name || null,
          cr: row.kind === 'npc' && row.challenge_rating !== null ? Number(row.challenge_rating) : null };
  }
  if (known.has('hp') && Number(row.hp_max) > 0) card.hp = { current: Number(row.hp_current), max: Number(row.hp_max), temp: Number(row.hp_temp ?? 0) };
  if (known.has('ac')) card.ac = Number(row.armor_class);
  if (known.has('abilities') && !object) {
    card.abilities = [row.strength, row.dexterity, row.constitution, row.intelligence, row.wisdom, row.charisma].map(Number);
  }
  if (known.has('defenses')) {
    card.defenses = {
      resistant: list(row.damage_resistances), immune: list(row.damage_immunities), vulnerable: list(row.damage_vulnerabilities),
      conditionImmunities: [row.sheet_extra?.conditionImmunities, monster?.conditionImmunities].filter(Boolean).join(', ') || null,
    };
  }
  if (known.has('conditions') && !object) {
    card.conditions = (await q.query(
      `SELECT DISTINCT effect_code FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active ORDER BY effect_code`, [campaignId, row.id],
    )).rows.map(effect => String(effect.effect_code));
  }
  if (known.has('text')) card.text = settings.text || (object ? row.item_note ?? '' : '') || null;
  return card;
}

export function registerExamineRoutes(ctx: SceneFeatureContext) {
  const { app, db, auth, membership, notifyCampaign } = ctx;

  async function load(q: Queryable, campaignId: string, characterId: string, userId: string) {
    const member = await membership(q, campaignId, userId, true);
    const row = (await q.query(`SELECT ${CARD_COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2 AND container_id IS NULL`, [campaignId, characterId])).rows[0];
    if (!row) reject(404, 'Объект не найден.');
    const rights = await rightsOf(q, member, userId);
    const full = rights.sceneManager || controls(rights, userId, row.id, row.owner_user_id);
    if (!full) {
      const visible = (await q.query(
        `SELECT 1 FROM scene_objects p LEFT JOIN object_states s ON s.campaign_id=p.campaign_id AND s.character_id=p.character_id
          WHERE p.campaign_id=$1 AND p.character_id=$2 AND NOT p.hidden AND (s.secret_dc IS NULL OR s.secret_found) LIMIT 1`,
        [campaignId, characterId],
      )).rows[0];
      if (!visible) reject(404, 'Объект не найден.');
    }
    return { member, row, rights, full };
  }

  app.get<{ Params: { campaignId: string; characterId: string }; Querystring: { heroId?: string } }>(
    '/campaigns/:campaignId/characters/:characterId/examine',
    { schema: { params, querystring: objectSchema({ heroId: uuid }, []) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      return db.transaction(async q => {
        const { row, rights, full } = await load(q, campaignId, characterId, userId);
        const { settings, own, creatureType } = await settingsOf(q, campaignId, row);
        const heroes = (await q.query(
          `SELECT id, name FROM characters WHERE campaign_id=$1 AND kind='character' AND ($3 OR owner_user_id=$2) ORDER BY name, id LIMIT 300`,
          [campaignId, userId, rights.sceneManager],
        )).rows.map(hero => ({ id: String(hero.id), name: String(hero.name) }));
        const skill = { id: settings.skill, name: findSrdSkill(settings.skill)?.nameRu ?? settings.skill };
        if (rights.sceneManager) {
          const results = (await q.query(
            `SELECT e.examiner_id, c.name, e.total FROM character_examinations e JOIN characters c ON c.campaign_id=e.campaign_id AND c.id=e.examiner_id
              WHERE e.campaign_id=$1 AND e.character_id=$2 ORDER BY c.name`, [campaignId, characterId],
          )).rows.map(result => ({ heroId: String(result.examiner_id), name: String(result.name), total: Number(result.total) }));
          return {
            manager: true, skill, settings, own, skills: EXAMINE_SKILLS.map(id => ({ id, name: findSrdSkill(id)?.nameRu ?? id })),
            partDcs: Object.fromEntries(EXAMINE_PARTS.map(part => [part, partDc(settings, part)])),
            card: await cardOf(q, campaignId, row, settings, creatureType, EXAMINE_PARTS), results, heroes,
          };
        }
        if (full) return { manager: false, skill, card: await cardOf(q, campaignId, row, settings, creatureType, EXAMINE_PARTS), heroes, own: true };
        const heroId = request.query.heroId;
        const done = heroId ? (await q.query(
          'SELECT total FROM character_examinations WHERE campaign_id=$1 AND character_id=$2 AND examiner_id=$3', [campaignId, characterId, heroId],
        )).rows[0] : null;
        return {
          manager: false, skill, heroes,
          ...(done ? { total: Number(done.total), card: await cardOf(q, campaignId, row, settings, creatureType, revealedParts(settings, Number(done.total))) } : { card: null }),
        };
      });
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { heroId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/examine',
    { schema: { params, body: objectSchema({ heroId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { heroId } = request.body;
      const result = await db.transaction(async q => {
        const { member, row } = await load(q, campaignId, characterId, userId);
        const hero = (await q.query(`SELECT id, name, owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2 AND kind<>'object'`, [campaignId, heroId])).rows[0];
        if (!hero) reject(404, 'Герой не найден.');
        if (!(await canManageCharacter(q, member, userId, hero.owner_user_id, hero.id))) reject(403, 'Осматривать можно своим героем.');
        if (hero.id === row.id) reject(400, 'Себя осматривать не нужно — всё есть в листе.');
        const { settings, creatureType } = await settingsOf(q, campaignId, row);
        const done = (await q.query(
          'SELECT total FROM character_examinations WHERE campaign_id=$1 AND character_id=$2 AND examiner_id=$3 FOR UPDATE', [campaignId, characterId, heroId],
        )).rows[0];
        // One look per hero: a second try would only fish for a better roll. The GM can let everyone look again.
        if (done) return { rolled: false, total: Number(done.total), card: await cardOf(q, campaignId, row, settings, creatureType, revealedParts(settings, Number(done.total))) };
        const skillName = findSrdSkill(settings.skill)?.nameRu ?? settings.skill;
        const rolled = await rollSkillAgainst(q, campaignId, userId, hero.id, settings.skill, `${skillName}: осмотр «${row.name}»`, settings.dc);
        await q.query(
          'INSERT INTO character_examinations (campaign_id, character_id, examiner_id, total) VALUES ($1,$2,$3,$4)', [campaignId, characterId, heroId, rolled.total],
        );
        return { rolled: true, total: rolled.total, card: await cardOf(q, campaignId, row, settings, creatureType, revealedParts(settings, rolled.total)) };
      });
      if (result.rolled) void notifyCampaign(campaignId, { type: 'rolls' });
      return result;
    },
  );

  app.put<{ Params: { campaignId: string; characterId: string }; Body: { skill: string; dc: number; dcs: Record<string, number | null>; text: string } }>(
    '/campaigns/:campaignId/characters/:characterId/examine',
    {
      schema: {
        params,
        body: objectSchema({
          skill: { type: 'string', enum: [...EXAMINE_SKILLS] }, dc: { type: 'integer', minimum: 1, maximum: 40 },
          dcs: { type: 'object', additionalProperties: false, properties: Object.fromEntries(EXAMINE_PARTS.map(part => [part, { anyOf: [{ type: 'integer', minimum: 1, maximum: 40 }, { type: 'null' }] }])) },
          text: { type: 'string', maxLength: 2000 },
        }),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { skill, dc, dcs, text } = request.body;
      await db.transaction(async q => {
        const { rights } = await load(q, campaignId, characterId, userId);
        if (!rights.sceneManager) reject(403, 'Осмотр настраивает мастер.');
        await q.query(
          `INSERT INTO character_examine (campaign_id, character_id, skill, dc, dcs, text) VALUES ($1,$2,$3,$4,$5::jsonb,$6)
           ON CONFLICT (campaign_id, character_id) DO UPDATE SET skill=EXCLUDED.skill, dc=EXCLUDED.dc, dcs=EXCLUDED.dcs, text=EXCLUDED.text, updated_at=now()`,
          [campaignId, characterId, skill, dc, JSON.stringify(cleanDcs(dcs)), text.trim()],
        );
      });
      return { ok: true };
    },
  );

  app.delete<{ Params: { campaignId: string; characterId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/examine',
    { schema: { params } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const cleared = await db.transaction(async q => {
        const { rights } = await load(q, campaignId, characterId, userId);
        if (!rights.sceneManager) reject(403, 'Разрешить новый осмотр может мастер.');
        return (await q.query('DELETE FROM character_examinations WHERE campaign_id=$1 AND character_id=$2 RETURNING examiner_id', [campaignId, characterId])).rows.length;
      });
      return { cleared };
    },
  );
}
