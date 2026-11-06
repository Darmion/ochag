import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import {
  FACTION_BONUS_KINDS, FACTION_COLORS, FACTION_NAME_MAX, FACTION_RESTRICTIONS, FACTION_RIGHTS,
  cleanBonuses, cleanRestrictions, cleanRights, effectiveFactions, factionBonus, pairKey, relationBetween, restrictedBetween, sharedRight,
  type CreatureRelation, type FactionBonusKind, type FactionInfo, type FactionPair, type FactionRestriction, type FactionRight,
} from '../../../../packages/domain/world/factions.ts';

export type FactionRow = FactionInfo & { color: string; sort: number };
export type FactionMatrix = {
  factions: Map<string, FactionRow>;
  pairs: Map<string, FactionPair>;
  party: string | null;
  enemies: string | null;
};

const matrixCache = new Map<string, FactionMatrix>();
export function forgetFactions(campaignId: string) {
  matrixCache.delete(campaignId);
}

async function ensureSystemFactions(q: Queryable, campaignId: string): Promise<boolean> {
  const present = new Set(
    (await q.query(`SELECT system FROM factions WHERE campaign_id=$1 AND system IS NOT NULL`, [campaignId])).rows.map(row => row.system as string),
  );
  if (present.has('party') && present.has('enemies')) return false;
  if (!present.has('party')) {
    await q.query(
      `INSERT INTO factions (campaign_id, name, color, system, rights, sort) VALUES ($1, 'Отряд', '#5ea764', 'party', ARRAY['shared-vision', 'see-hp'], 0)
       ON CONFLICT (campaign_id, system) DO NOTHING`,
      [campaignId],
    );
  }
  if (!present.has('enemies')) {
    await q.query(
      `INSERT INTO factions (campaign_id, name, color, system, rights, sort) VALUES ($1, 'Враги', '#cf4a3d', 'enemies', '{}', 1)
       ON CONFLICT (campaign_id, system) DO NOTHING`,
      [campaignId],
    );
  }
  await q.query(
    `INSERT INTO faction_relations (campaign_id, faction_a, faction_b, relation)
     SELECT p.campaign_id, LEAST(p.id, e.id), GREATEST(p.id, e.id), 'enemy'
     FROM factions p JOIN factions e ON e.campaign_id = p.campaign_id AND e.system = 'enemies'
     WHERE p.campaign_id = $1 AND p.system = 'party'
     ON CONFLICT DO NOTHING`,
    [campaignId],
  );
  return true;
}

export async function loadFactionMatrix(q: Queryable, campaignId: string): Promise<FactionMatrix> {
  const cached = matrixCache.get(campaignId);
  if (cached) return cached;
  const created = await ensureSystemFactions(q, campaignId);
  const rows = (
    await q.query('SELECT id, name, color, system, rights, bonuses, sort FROM factions WHERE campaign_id=$1 ORDER BY sort, created_at, id', [campaignId])
  ).rows as any[];
  const factions = new Map<string, FactionRow>(rows.map(row => [row.id, {
    id: row.id, name: row.name, color: row.color, system: row.system, sort: row.sort,
    rights: cleanRights(row.rights), bonuses: cleanBonuses(row.bonuses),
  }]));
  const pairs = new Map<string, FactionPair>(
    (await q.query('SELECT faction_a, faction_b, relation, restrictions FROM faction_relations WHERE campaign_id=$1', [campaignId])).rows
      .map((row: any) => [pairKey(row.faction_a, row.faction_b), { relation: row.relation, restrictions: cleanRestrictions(row.restrictions) }]),
  );
  const matrix: FactionMatrix = {
    factions, pairs,
    party: rows.find(row => row.system === 'party')?.id ?? null,
    enemies: rows.find(row => row.system === 'enemies')?.id ?? null,
  };
  if (!created) matrixCache.set(campaignId, matrix);
  return matrix;
}

type Creature = { id: string; kind: string | null; disposition: string | null; factions_explicit?: boolean | null };

export class Relations {
  readonly matrix: FactionMatrix;
  private readonly groups: Map<string, string[]>;

  constructor(matrix: FactionMatrix, groups: Map<string, string[]>) {
    this.matrix = matrix;
    this.groups = groups;
  }

  factionsOf(id: string | null | undefined): string[] {
    return id ? this.groups.get(id) ?? [] : [];
  }

  between(a: string | null | undefined, b: string | null | undefined): CreatureRelation {
    if (!a || !b) return 'neutral';
    if (a === b) return 'self';
    return relationBetween(this.factionsOf(a), this.factionsOf(b), this.matrix.pairs);
  }

  allies(a: string | null | undefined, b: string | null | undefined) {
    const relation = this.between(a, b);
    return relation === 'self' || relation === 'ally';
  }

  enemies(a: string | null | undefined, b: string | null | undefined) {
    return this.between(a, b) === 'enemy';
  }

  restricted(a: string | null | undefined, b: string | null | undefined, restriction: FactionRestriction) {
    return Boolean(a && b && a !== b) && restrictedBetween(this.factionsOf(a), this.factionsOf(b), this.matrix.pairs, restriction);
  }

  shares(a: string | null | undefined, b: string | null | undefined, right: FactionRight) {
    return Boolean(a && b) && sharedRight(this.factionsOf(a), this.factionsOf(b), this.matrix.factions, right);
  }

  bonus(id: string | null | undefined, kind: FactionBonusKind) {
    return factionBonus(this.factionsOf(id), this.matrix.factions, kind);
  }

  withParty(id: string | null | undefined): CreatureRelation {
    if (!id || !this.matrix.party) return 'neutral';
    return relationBetween(this.factionsOf(id), [this.matrix.party], this.matrix.pairs);
  }
}

export async function relationsOf(q: Queryable, campaignId: string, creatures: Creature[], matrix?: FactionMatrix): Promise<Relations> {
  const loaded = matrix ?? await loadFactionMatrix(q, campaignId);
  const ids = [...new Set(creatures.filter(creature => creature.factions_explicit === true).map(creature => creature.id))];
  const own = new Map<string, string[]>();
  if (ids.length) {
    for (const row of (await q.query('SELECT character_id, faction_id FROM faction_members WHERE campaign_id=$1 AND character_id = ANY($2::uuid[])', [campaignId, ids])).rows as any[]) {
      own.set(row.character_id, [...(own.get(row.character_id) ?? []), row.faction_id]);
    }
  }
  const groups = new Map<string, string[]>();
  for (const creature of creatures) {
    const mine = (own.get(creature.id) ?? []).filter(id => loaded.factions.has(id));
    groups.set(creature.id, effectiveFactions(mine, creature, loaded, creature.factions_explicit === true));
  }
  return new Relations(loaded, groups);
}

export async function relationsFor(q: Queryable, campaignId: string, ids: Array<string | null | undefined>): Promise<Relations> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const rows = wanted.length
    ? (await q.query('SELECT id, kind, disposition, factions_explicit FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, wanted])).rows as Creature[]
    : [];
  return relationsOf(q, campaignId, rows);
}

export async function factionBonusOf(q: Queryable, campaignId: string, characterId: string | null | undefined, kind: FactionBonusKind) {
  if (!characterId) return { value: 0, reasons: [] as string[] };
  const matrix = await loadFactionMatrix(q, campaignId);
  if (![...matrix.factions.values()].some(faction => faction.bonuses.some(bonus => bonus.kind === kind && bonus.value))) return { value: 0, reasons: [] as string[] };
  return (await relationsFor(q, campaignId, [characterId])).bonus(characterId, kind);
}

export async function guardFriendlyFire(q: Queryable, campaignId: string, actorId: string, targetIds: Array<string | null | undefined>, harmful: boolean) {
  const others = [...new Set(targetIds.filter((id): id is string => Boolean(id) && id !== actorId))];
  if (!others.length) return;
  const relations = await relationsFor(q, campaignId, [actorId, ...others]);
  if (!relations.factionsOf(actorId).length) return;
  const wrong = others.filter(id => (harmful ? relations.allies(actorId, id) : relations.enemies(actorId, id)));
  if (!wrong.length) return;
  const targets = (
    await q.query('SELECT id, name FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[]) ORDER BY name', [campaignId, wrong])
  ).rows as Array<{ id: string; name: string }>;
  const list = targets.map(target => `«${target.name}»`).join(', ');
  throw Object.assign(
    new Error(harmful ? `${list} — ${targets.length > 1 ? 'ваши союзники' : 'ваш союзник'}. Всё равно ударить?` : `${list} — ${targets.length > 1 ? 'ваши враги' : 'ваш враг'}. Всё равно помочь?`),
    { statusCode: 409, errorCode: 'FRIENDLY_FIRE', details: { harmful, targets } },
  );
}

const RELATIONS = Symbol('relations');
export function attachRelations<T extends { character_id: string }>(placements: T[], relations: Relations) {
  for (const placement of placements) Object.defineProperty(placement, RELATIONS, { value: relations, enumerable: false, configurable: true });
}
function relationsOfPlacements(a: object, b: object): Relations {
  const relations = (a as any)[RELATIONS] ?? (b as any)[RELATIONS];
  if (!relations) throw new Error('Размещение без фракций: оно не из loadPlacements.');
  return relations;
}
export function placementRelation(a: { character_id: string }, b: { character_id: string }): CreatureRelation {
  return relationsOfPlacements(a, b).between(a.character_id, b.character_id);
}
export const placementsAllied = (a: { character_id: string }, b: { character_id: string }) => {
  const relation = placementRelation(a, b);
  return relation === 'self' || relation === 'ally';
};
export const placementsHostile = (a: { character_id: string }, b: { character_id: string }) => placementRelation(a, b) === 'enemy';
export const placementsRestricted = (a: { character_id: string }, b: { character_id: string }, restriction: FactionRestriction) =>
  relationsOfPlacements(a, b).restricted(a.character_id, b.character_id, restriction);
export function placementFactions(placement: { character_id: string }): string[] {
  return ((placement as any)[RELATIONS] as Relations | undefined)?.factionsOf(placement.character_id) ?? [];
}
export function placementRelations(placement: object): Relations | null {
  return (placement as any)[RELATIONS] ?? null;
}

const CREATURE_COLUMNS = 'id, kind, disposition, factions_explicit';

export type ViewerRights = {
  owned: string[];
  shares: (characterId: string, right: FactionRight) => boolean;
  relation: (characterId: string) => CreatureRelation;
};
export async function viewerRights(q: Queryable, campaignId: string, userId: string, others: Creature[]): Promise<ViewerRights> {
  const matrix = await loadFactionMatrix(q, campaignId);
  const owned = (
    await q.query(`SELECT ${CREATURE_COLUMNS} FROM characters WHERE campaign_id=$1 AND owner_user_id=$2 AND kind <> 'object'`, [campaignId, userId])
  ).rows as Creature[];
  const relations = await relationsOf(q, campaignId, [...owned, ...others], matrix);
  const partyHas = (right: FactionRight) => Boolean(matrix.party && matrix.factions.get(matrix.party)?.rights.includes(right));
  const ownedIds = new Set(owned.map(creature => creature.id));
  return {
    owned: [...ownedIds],
    shares: (characterId, right) => owned.length
      ? owned.some(creature => relations.shares(creature.id, characterId, right))
      : partyHas(right) && relations.factionsOf(characterId).includes(matrix.party!),
    relation: characterId => {
      if (ownedIds.has(characterId)) return 'self';
      if (!owned.length) return relations.withParty(characterId);
      const toMine = owned.map(creature => relations.between(creature.id, characterId));
      return toMine.includes('ally') ? 'ally' : toMine.includes('enemy') ? 'enemy' : 'neutral';
    },
  };
}

const anyRight = (matrix: FactionMatrix, right: FactionRight) => [...matrix.factions.values()].some(faction => faction.rights.includes(right));

export async function teamControls(q: Queryable, campaignId: string, userId: string, characterId: string): Promise<boolean> {
  const matrix = await loadFactionMatrix(q, campaignId);
  if (!anyRight(matrix, 'control')) return false;
  const target = (await q.query(`SELECT ${CREATURE_COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2`, [campaignId, characterId])).rows[0] as Creature | undefined;
  if (!target || target.kind === 'object') return false;
  const rights = await viewerRights(q, campaignId, userId, [target]);
  return rights.owned.length > 0 && rights.shares(characterId, 'control');
}

export async function teamControlledIds(q: Queryable, campaignId: string, userId: string): Promise<string[]> {
  const matrix = await loadFactionMatrix(q, campaignId);
  if (!anyRight(matrix, 'control')) return [];
  const creatures = (await q.query(`SELECT ${CREATURE_COLUMNS} FROM characters WHERE campaign_id=$1 AND kind <> 'object'`, [campaignId])).rows as Creature[];
  const rights = await viewerRights(q, campaignId, userId, creatures);
  if (!rights.owned.length) return [];
  return creatures.filter(creature => rights.shares(creature.id, 'control')).map(creature => creature.id);
}

export function registerFactionRoutes(ctx: SceneFeatureContext) {
  const { app, db, auth, membership, canManage, notifyCampaign } = ctx;
  const campaignParams = objectSchema({ campaignId: uuid });
  const factionParams = objectSchema({ campaignId: uuid, factionId: uuid });
  const characterParams = objectSchema({ campaignId: uuid, characterId: uuid });
  const name = { type: 'string', minLength: 1, maxLength: FACTION_NAME_MAX, pattern: '\\S' };
  const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
  const rights = { type: 'array', maxItems: FACTION_RIGHTS.length, items: { type: 'string', enum: FACTION_RIGHTS.map(item => item.id) } };
  const restrictions = { type: 'array', maxItems: FACTION_RESTRICTIONS.length, items: { type: 'string', enum: FACTION_RESTRICTIONS.map(item => item.id) } };
  const bonuses = {
    type: 'array', maxItems: FACTION_BONUS_KINDS.length,
    items: objectSchema({ kind: { type: 'string', enum: FACTION_BONUS_KINDS.map(item => item.id) }, value: { type: 'integer', minimum: -10, maximum: 10 } }, ['kind', 'value']),
  };

  async function manager(q: Queryable, campaignId: string, userId: string) {
    const member = await membership(q, campaignId, userId, true);
    if (!(await canManage(q, member, userId))) reject(403, 'Фракциями распоряжается мастер.');
    return member;
  }
  const changed = (campaignId: string) => {
    forgetFactions(campaignId);
    void notifyCampaign(campaignId, { type: 'factions' });
    void notifyCampaign(campaignId, { type: 'changed' });
  };

  app.get<{ Params: { campaignId: string } }>('/campaigns/:campaignId/factions', { schema: { params: campaignParams } }, async request => {
    const userId = await auth(request);
    const { campaignId } = request.params;
    return db.transaction(async q => {
      const member = await membership(q, campaignId, userId, true);
      const manage = await canManage(q, member, userId);
      const matrix = await loadFactionMatrix(q, campaignId);
      const creatures = (
        await q.query(`SELECT id, name, kind, disposition, owner_user_id, factions_explicit FROM characters WHERE campaign_id=$1 AND kind <> 'object' ORDER BY name`, [campaignId])
      ).rows as Array<Creature & { name: string; owner_user_id: string | null }>;
      const relations = await relationsOf(q, campaignId, creatures, matrix);
      const mine = new Set(creatures.filter(creature => creature.owner_user_id === userId).flatMap(creature => relations.factionsOf(creature.id)));
      const shown = [...matrix.factions.values()].filter(faction => manage || mine.has(faction.id));
      return {
        manage,
        factions: shown.map(faction => ({
          ...faction,
          members: creatures.filter(creature => relations.factionsOf(creature.id).includes(faction.id))
            .map(creature => ({ id: creature.id, name: creature.name, kind: creature.kind, explicit: creature.factions_explicit === true })),
        })),
        relations: manage
          ? [...matrix.pairs.entries()].map(([key, pair]) => {
            const [a, b] = key.split('|');
            return { a, b, ...pair };
          })
          : [],
        rights: FACTION_RIGHTS, restrictions: FACTION_RESTRICTIONS, bonusKinds: FACTION_BONUS_KINDS,
      };
    });
  });

  app.post<{ Params: { campaignId: string }; Body: { name: string; color?: string } }>(
    '/campaigns/:campaignId/factions',
    { schema: { params: campaignParams, body: objectSchema({ name, color }, ['name']) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const created = await db.transaction(async q => {
        await manager(q, campaignId, userId);
        const matrix = await loadFactionMatrix(q, campaignId);
        if (matrix.factions.size >= 60) reject(400, 'Фракций уже 60 — больше нельзя.');
        const color = request.body.color ?? FACTION_COLORS[matrix.factions.size % FACTION_COLORS.length];
        return (
          await q.query(
            `INSERT INTO factions (campaign_id, name, color, sort) VALUES ($1,$2,$3, (SELECT COALESCE(max(sort), 0) + 1 FROM factions WHERE campaign_id=$1))
             RETURNING id, name, color, system, rights, bonuses, sort`,
            [campaignId, request.body.name.trim(), color],
          )
        ).rows[0];
      });
      changed(campaignId);
      return reply.code(201).send(created);
    },
  );

  app.patch<{ Params: { campaignId: string; factionId: string }; Body: { name?: string; color?: string; rights?: string[]; bonuses?: unknown[] } }>(
    '/campaigns/:campaignId/factions/:factionId',
    { schema: { params: factionParams, body: objectSchema({ name, color, rights, bonuses }, []) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, factionId } = request.params;
      const body = request.body ?? {};
      const updated = await db.transaction(async q => {
        await manager(q, campaignId, userId);
        const row = (await q.query('SELECT id FROM factions WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, factionId])).rows[0];
        if (!row) reject(404, 'Фракции нет.');
        return (
          await q.query(
            `UPDATE factions SET name = COALESCE($3, name), color = COALESCE($4, color), rights = COALESCE($5::text[], rights), bonuses = COALESCE($6::jsonb, bonuses)
             WHERE campaign_id=$1 AND id=$2 RETURNING id, name, color, system, rights, bonuses, sort`,
            [
              campaignId, factionId, body.name?.trim() ?? null, body.color ?? null,
              body.rights ? cleanRights(body.rights) : null, body.bonuses ? JSON.stringify(cleanBonuses(body.bonuses)) : null,
            ],
          )
        ).rows[0];
      });
      changed(campaignId);
      return updated;
    },
  );

  app.delete<{ Params: { campaignId: string; factionId: string } }>(
    '/campaigns/:campaignId/factions/:factionId',
    { schema: { params: factionParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, factionId } = request.params;
      await db.transaction(async q => {
        await manager(q, campaignId, userId);
        const row = (await q.query('SELECT system FROM factions WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, factionId])).rows[0];
        if (!row) reject(404, 'Фракции нет.');
        if (row.system) reject(400, 'Встроенную фракцию не удалить — только переименовать.');
        await q.query('DELETE FROM faction_relations WHERE campaign_id=$1 AND (faction_a=$2 OR faction_b=$2)', [campaignId, factionId]);
        await q.query('DELETE FROM faction_members WHERE campaign_id=$1 AND faction_id=$2', [campaignId, factionId]);
        await q.query('DELETE FROM factions WHERE campaign_id=$1 AND id=$2', [campaignId, factionId]);
      });
      changed(campaignId);
      return reply.code(204).send();
    },
  );

  app.put<{ Params: { campaignId: string }; Body: { a: string; b: string; relation: 'ally' | 'neutral' | 'enemy'; restrictions?: string[] } }>(
    '/campaigns/:campaignId/factions/relations',
    {
      schema: {
        params: campaignParams,
        body: objectSchema({ a: uuid, b: uuid, relation: { type: 'string', enum: ['ally', 'neutral', 'enemy'] }, restrictions }, ['a', 'b', 'relation']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { a, b, relation } = request.body;
      if (a === b) reject(400, 'Отношение — между двумя разными фракциями.');
      const kept = cleanRestrictions(request.body.restrictions ?? []);
      await db.transaction(async q => {
        await manager(q, campaignId, userId);
        const found = (await q.query('SELECT count(*)::int AS n FROM factions WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, [a, b]])).rows[0].n;
        if (found !== 2) reject(404, 'Фракции нет.');
        const [first, second] = a < b ? [a, b] : [b, a];
        if (relation === 'neutral' && !kept.length) {
          await q.query('DELETE FROM faction_relations WHERE campaign_id=$1 AND faction_a=$2 AND faction_b=$3', [campaignId, first, second]);
        } else {
          await q.query(
            `INSERT INTO faction_relations (campaign_id, faction_a, faction_b, relation, restrictions) VALUES ($1,$2,$3,$4,$5::text[])
             ON CONFLICT (campaign_id, faction_a, faction_b) DO UPDATE SET relation=$4, restrictions=$5::text[]`,
            [campaignId, first, second, relation, kept],
          );
        }
      });
      changed(campaignId);
      return { a, b, relation, restrictions: kept };
    },
  );

  app.put<{ Params: { campaignId: string; characterId: string }; Body: { factionIds: string[] } }>(
    '/campaigns/:campaignId/characters/:characterId/factions',
    { schema: { params: characterParams, body: objectSchema({ factionIds: { type: 'array', maxItems: 30, uniqueItems: true, items: uuid } }, ['factionIds']) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const ids = request.body.factionIds;
      const result = await db.transaction(async q => {
        await manager(q, campaignId, userId);
        const creature = (await q.query('SELECT id, kind FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, characterId])).rows[0];
        if (!creature) reject(404, 'Существо не найдено.');
        if (creature.kind === 'object') reject(400, 'Во фракциях — существа, не предметы.');
        if (ids.length) {
          const found = (await q.query('SELECT count(*)::int AS n FROM factions WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, ids])).rows[0].n;
          if (found !== ids.length) reject(404, 'Фракции нет.');
        }
        await q.query('DELETE FROM faction_members WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId]);
        for (const id of ids) await q.query('INSERT INTO faction_members (campaign_id, faction_id, character_id) VALUES ($1,$2,$3)', [campaignId, id, characterId]);
        await q.query('UPDATE characters SET factions_explicit=true, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, characterId]);
        forgetFactions(campaignId);
        return (await relationsFor(q, campaignId, [characterId])).factionsOf(characterId);
      });
      changed(campaignId);
      void notifyCampaign(campaignId, { type: 'character', characterId });
      return { characterId, factionIds: result, explicit: true };
    },
  );

  app.delete<{ Params: { campaignId: string; characterId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/factions',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const result = await db.transaction(async q => {
        await manager(q, campaignId, userId);
        const creature = (await q.query('SELECT id FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, characterId])).rows[0];
        if (!creature) reject(404, 'Существо не найдено.');
        await q.query('DELETE FROM faction_members WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId]);
        await q.query('UPDATE characters SET factions_explicit=false, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, characterId]);
        forgetFactions(campaignId);
        return (await relationsFor(q, campaignId, [characterId])).factionsOf(characterId);
      });
      changed(campaignId);
      void notifyCampaign(campaignId, { type: 'character', characterId });
      return { characterId, factionIds: result, explicit: false };
    },
  );
}
