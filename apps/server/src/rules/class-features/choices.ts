import { reject, objectSchema, uuid } from '../../tabletop/scene-feature.ts';
import { characterClassLevels, type ClassId, SUBCLASSES, CLASS_LABELS } from '../../../../../packages/domain/character/classes.ts';
import { type ClassFeature, INVOCATIONS, knownInvocations, METAMAGIC, knownMetamagic, MANEUVERS, knownManeuvers, HUNTERS_PREY, knownHuntersPrey, knownAncestry, DEFENSIVE_TACTICS, knownDefensiveTactics, HUNTER_MULTIATTACK, knownHunterMultiattack, FIENDISH_RESILIENCE_TYPES, knownFiendishResilience, SUPERIOR_HUNTERS_DEFENSE, knownSuperiorDefense, FAVORED_ENEMY_TYPES, knownFavoredEnemies, favoredEnemyLimit, classLevelOf, spellPicks } from '../../../../../packages/domain/character/class-features.ts';
import { characterRace } from '../../../../../packages/domain/character/races.ts';
import { FEATS, knownFeats, STYLE_PATTERNS, knownFightingStyles } from '../../../../../packages/domain/character/feats.ts';
import { DRAGON_ANCESTRIES } from '../../../../../packages/domain/srd/heroes.ts';

import type { ClassFeatureContext } from '../class-features.ts';
import { characterParams, cleansable, entryOf, loadActor, requireFeature, spellsOf } from './helpers.ts';

export function choiceRoute(
  ctx: ClassFeatureContext, path: string, key: 'invocations' | 'metamagic' | 'maneuvers' | 'huntersPrey' | 'draconicAncestry' | 'defensiveTactics' | 'hunterMultiattack' | 'fiendishResilience' | 'superiorDefense' | 'favoredEnemies',
  list: ReadonlyArray<{ id: string }>, featureId: ClassFeature['id'], known: (sheetExtra: any) => string[], single = false,
  outOfCombat = false,
  limit?: (row: any, classes: ReturnType<typeof characterClassLevels>['classes']) => number,
) {
  const { app, auth, db, notifyCampaign } = ctx;
  app.put<{ Params: { campaignId: string; characterId: string }; Body: Record<string, boolean> }>(
    `/campaigns/:campaignId/characters/:characterId/${path}`,
    {
      schema: {
        params: characterParams,
        body: {
          type: 'object', minProperties: 1, additionalProperties: false,
          properties: Object.fromEntries(list.map(entry => [entry.id, { type: 'boolean' }])),
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const result = await db.transaction(async q => {
        const { row, classes } = await loadActor(ctx, q, campaignId, characterId, userId, true);
        requireFeature(row, classes, featureId);
        if (outOfCombat && await entryOf(q, campaignId, characterId, null)) reject(400, `${row.name} в бою — сменить выбор можно после отдыха.`);
        const current = new Set(known(row.sheet_extra));
        for (const [id, value] of Object.entries(request.body)) {
          if (value && single) current.clear();
          if (value) current.add(id);
          else current.delete(id);
        }
        const chosen = list.map(entry => entry.id).filter(id => current.has(id));
        if (limit && chosen.length > limit(row, classes)) reject(400, `Можно выбрать не больше ${limit(row, classes)} — сначала снимите другой.`);
        await q.query(
          `UPDATE characters SET sheet_extra = jsonb_set(COALESCE(sheet_extra, '{}'::jsonb), $3::text[], $4::jsonb), revision=revision+1 WHERE campaign_id=$1 AND id=$2`,
          [campaignId, characterId, [key], JSON.stringify(chosen)],
        );
        return chosen;
      });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      return { [key]: result };
    },
  );
}

export function markRoute(ctx: ClassFeatureContext, path: string, key: 'feats' | 'fightingStyles', list: ReadonlyArray<{ id: string }>, known: (sheetExtra: any) => string[]) {
  const { app, auth, db, notifyCampaign } = ctx;
  app.put<{ Params: { campaignId: string; characterId: string }; Body: Record<string, boolean> }>(
    `/campaigns/:campaignId/characters/:characterId/${path}`,
    {
      schema: {
        params: characterParams,
        body: { type: 'object', minProperties: 1, additionalProperties: false, properties: Object.fromEntries(list.map(entry => [entry.id, { type: 'boolean' }])) },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const result = await db.transaction(async q => {
        const { row } = await loadActor(ctx, q, campaignId, characterId, userId, true);
        const current = new Set(known(row.sheet_extra));
        for (const [id, value] of Object.entries(request.body)) {
          if (value) current.add(id);
          else current.delete(id);
        }
        const chosen = list.map(entry => entry.id).filter(id => current.has(id));
        await q.query(
          `UPDATE characters SET sheet_extra = jsonb_set(COALESCE(sheet_extra, '{}'::jsonb), $3::text[], $4::jsonb), revision=revision+1 WHERE campaign_id=$1 AND id=$2`,
          [campaignId, characterId, [key], JSON.stringify(chosen)],
        );
        return chosen;
      });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      return { [key]: result };
    },
  );
}

export function spellPickRoute(ctx: ClassFeatureContext, path: 'spell-mastery' | 'signature-spells', featureId: 'spell-mastery' | 'signature-spells', key: 'mastery' | 'signature') {
  const { app, auth, db, notifyCampaign } = ctx;
  app.put<{ Params: { campaignId: string; characterId: string }; Body: Record<string, boolean> }>(
    `/campaigns/:campaignId/characters/:characterId/${path}`,
    {
      schema: {
        params: characterParams,
        body: { type: 'object', minProperties: 1, maxProperties: 6, propertyNames: { format: 'uuid' }, additionalProperties: { type: 'boolean' } },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const result = await db.transaction(async q => {
        const { row, classes } = await loadActor(ctx, q, campaignId, characterId, userId, true);
        requireFeature(row, classes, featureId);
        const spells = await spellsOf(q, campaignId, characterId);
        const levelOf = new Map(spells.map(spell => [spell.id, spell.level]));
        const picks = spellPicks(row.sheet_extra);
        let current = picks[key].filter(id => levelOf.has(id));
        for (const [id, value] of Object.entries(request.body)) {
          if (!value) {
            current = current.filter(entry => entry !== id);
            continue;
          }
          const level = levelOf.get(id);
          if (level === undefined) reject(404, 'Такого заклинания у персонажа нет.');
          const name = spells.find(spell => spell.id === id)!.name;
          if (key === 'mastery') {
            if (level !== 1 && level !== 2) reject(400, `«Мастерство заклинаний» — заклинания 1-го и 2-го уровня; «${name}» — ${level === 0 ? 'заговор' : `${level} уровня`}.`);
            current = [...current.filter(entry => levelOf.get(entry) !== level), id];
          } else {
            if (level !== 3) reject(400, `«Фирменные заклинания» — заклинания 3-го уровня; «${name}» — ${level === 0 ? 'заговор' : `${level} уровня`}.`);
            if (!current.includes(id) && current.length >= 2) reject(400, 'Фирменных заклинаний — два: сначала уберите одно.');
            if (!current.includes(id)) current.push(id);
          }
        }
        const next = { ...picks, [key]: current };
        await q.query(
          `UPDATE characters SET sheet_extra = jsonb_set(COALESCE(sheet_extra, '{}'::jsonb), '{spellPicks}', $3::jsonb), revision=revision+1 WHERE campaign_id=$1 AND id=$2`,
          [campaignId, characterId, JSON.stringify(next)],
        );
        return current;
      });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      return { [key]: result };
    },
  );
}

export function registerChoiceRoutes(ctx: ClassFeatureContext) {
  const { app, auth, db, notifyCampaign } = ctx;

  choiceRoute(ctx, 'invocations', 'invocations', INVOCATIONS, 'eldritch-invocations', knownInvocations);

  choiceRoute(ctx, 'metamagic', 'metamagic', METAMAGIC, 'metamagic', knownMetamagic);
  choiceRoute(ctx, 'maneuvers', 'maneuvers', MANEUVERS, 'combat-superiority', knownManeuvers);
  choiceRoute(ctx, 'hunters-prey', 'huntersPrey', HUNTERS_PREY, 'hunters-prey', knownHuntersPrey, true);
  choiceRoute(ctx, 'draconic-ancestry', 'draconicAncestry', DRAGON_ANCESTRIES, 'elemental-affinity', knownAncestry, true);
  choiceRoute(ctx, 'defensive-tactics', 'defensiveTactics', DEFENSIVE_TACTICS, 'defensive-tactics', knownDefensiveTactics, true);
  choiceRoute(ctx, 'hunter-multiattack', 'hunterMultiattack', HUNTER_MULTIATTACK, 'hunter-multiattack', knownHunterMultiattack, true);
  choiceRoute(ctx, 'fiendish-resilience', 'fiendishResilience', FIENDISH_RESILIENCE_TYPES, 'fiendish-resilience', knownFiendishResilience, true, true);
  choiceRoute(ctx, 'superior-hunters-defense', 'superiorDefense', SUPERIOR_HUNTERS_DEFENSE, 'superior-hunters-defense', knownSuperiorDefense, true);
  choiceRoute(ctx, 'favored-enemy', 'favoredEnemies', FAVORED_ENEMY_TYPES.map(id => ({ id })), 'favored-enemy', knownFavoredEnemies, false, false,
    (row, classes) => favoredEnemyLimit(classLevelOf(classes, 'ranger', row.level)));
  markRoute(ctx, 'feats', 'feats', FEATS, knownFeats);
  markRoute(ctx, 'fighting-styles', 'fightingStyles', STYLE_PATTERNS, sheetExtra => knownFightingStyles(sheetExtra).ids);

  app.get<{ Params: { campaignId: string; characterId: string }; Querystring: { targetId?: string } }>(
    '/campaigns/:campaignId/characters/:characterId/cleansing-touch',
    { schema: { params: characterParams, querystring: objectSchema({ targetId: uuid }, []) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      return db.transaction(async q => {
        await loadActor(ctx, q, campaignId, characterId, userId);
        const targetId = request.query.targetId ?? characterId;
        const target = (await q.query('SELECT id, kind FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0];
        if (!target || target.kind === 'object') reject(404, 'Существо не найдено.');
        const spells = await cleansable(q, campaignId, targetId);
        return { spells: spells.map(spell => ({ value: spell.key, label: spell.name, level: spell.level, harmful: spell.harmful })) };
      });
    },
  );
  spellPickRoute(ctx, 'spell-mastery', 'spell-mastery', 'mastery');
  spellPickRoute(ctx, 'signature-spells', 'signature-spells', 'signature');

  app.put<{ Params: { campaignId: string; characterId: string }; Body: { ancestry: string } }>(
    '/campaigns/:campaignId/characters/:characterId/dragon-ancestry',
    { schema: { params: characterParams, body: objectSchema({ ancestry: { type: 'string', enum: DRAGON_ANCESTRIES.map(entry => entry.id) } }, ['ancestry']) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      await db.transaction(async q => {
        const { row } = await loadActor(ctx, q, campaignId, characterId, userId, true);
        if (characterRace(row) !== 'dragonborn') reject(400, `Дракон-предок — у драконорождённых; «${row.name}» не из них.`);
        await q.query(
          `UPDATE characters SET sheet_extra = jsonb_set(COALESCE(sheet_extra, '{}'::jsonb), '{dragonAncestry}', to_jsonb($3::text)), revision=revision+1 WHERE campaign_id=$1 AND id=$2`,
          [campaignId, characterId, request.body.ancestry],
        );
      });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      return { ancestry: request.body.ancestry };
    },
  );

  app.put<{ Params: { campaignId: string; characterId: string }; Body: { classId: ClassId; subclass: string } }>(
    '/campaigns/:campaignId/characters/:characterId/subclass',
    {
      schema: {
        params: characterParams,
        body: objectSchema({ classId: { type: 'string', enum: Object.keys(SUBCLASSES) }, subclass: { type: 'string', minLength: 1, maxLength: 40 } }, ['classId', 'subclass']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { classId, subclass } = request.body;
      await db.transaction(async q => {
        const { row, classes } = await loadActor(ctx, q, campaignId, characterId, userId, true);
        const rule = SUBCLASSES[classId]!;
        const own = classes.find(item => item.id === classId);
        if (!own || own.level < rule.level) reject(400, `У «${row.name}» нет класса «${CLASS_LABELS[classId]}» ${rule.level}-го уровня — подкласса ещё нет.`);
        if (!rule.list.some(item => item.id === subclass)) reject(400, 'Такого подкласса в списке нет.');
        await q.query(
          `UPDATE characters SET sheet_extra = jsonb_set(COALESCE(sheet_extra, '{}'::jsonb), '{subclasses}', COALESCE(sheet_extra->'subclasses', '{}'::jsonb) || jsonb_build_object($3::text, $4::text)),
             revision=revision+1 WHERE campaign_id=$1 AND id=$2`,
          [campaignId, characterId, classId, subclass],
        );
      });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      return { classId, subclass };
    },
  );
}
