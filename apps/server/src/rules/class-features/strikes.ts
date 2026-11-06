import type { Queryable } from '../../db.ts';
import { addCondition } from '../conditions.ts';
import { objectSchema, uuid, reject } from '../../tabletop/scene-feature.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { isUndeadOrFiend, smiteDice, type ManeuverId, HIT_MANEUVERS, MANEUVERS, knownManeuvers, superiorityDie, classLevelOf, maneuverDc, kiSaveDc, type ClassFeature, QUIVERING_PALM_KI, HURL_THROUGH_HELL_DAMAGE } from '../../../../../packages/domain/character/class-features.ts';
import { proficiencyBonusForLevel, abilityModifier, rollDice } from '../../../../../packages/domain/dice/dice.ts';

import { CHARACTER_COLUMNS, type ClassFeatureContext, creatureTypeText, darkOnesBlessing, type HpResult } from '../class-features.ts';
import { entryOf, requireFeature, spendResource } from './helpers.ts';

export async function lastHit(ctx: ClassFeatureContext, q: Queryable, campaignId: string, rollId: string, userId: string, featureId: ClassFeature['id'], what: string) {
  const { canManageCharacter, membership } = ctx;
  const member = await membership(q, campaignId, userId, true);
  const attack = (await q.query('SELECT id, character_id, outcome, created_at, hidden FROM roll_log WHERE campaign_id=$1 AND id=$2', [campaignId, rollId])).rows[0] as any;
  if (!attack) reject(404, 'Броска нет.');
  const outcome = attack.outcome ?? {};
  if (outcome.kind !== 'attack' || !outcome.target || !attack.character_id || !outcome.hit) reject(400, `${what} — после попадания атакой.`);
  const attacker = (await q.query(`SELECT ${CHARACTER_COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE`, [campaignId, attack.character_id])).rows[0] as any;
  if (!attacker) reject(404, 'Атакующего нет.');
  if (!(await canManageCharacter(q, member, userId, attacker.owner_user_id, attacker.id))) reject(403, 'Умением пользуется тот, чей это персонаж, или мастер.');
  const classes = characterClassLevels(attacker).classes;
  requireFeature(attacker, classes, featureId);
  const later = (
    await q.query(`SELECT 1 FROM roll_log WHERE campaign_id=$1 AND character_id=$2 AND outcome->>'kind'='attack' AND created_at > $3 LIMIT 1`, [campaignId, attacker.id, attack.created_at])
  ).rows[0];
  if (later) reject(400, `${what} — сразу после попадания: с тех пор была другая атака.`);
  const target = (await q.query('SELECT id, name, kind FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, outcome.target.id])).rows[0] as any;
  if (!target) reject(404, 'Цели больше нет.');
  return { attack, outcome, attacker, classes, target };
}

export async function hurlBack(ctx: ClassFeatureContext, q: Queryable, campaignId: string, userId: string, warlockId: string, targetId: string) {
  const { applyHpChange, insertRoll, rollDie } = ctx;
  const type = ctx.creatureType ? await ctx.creatureType(q, campaignId, targetId) : null;
  if (type === 'fiend') return { text: 'возвращается невредимым: исчадию ад — дом.', change: null as HpResult | null };
  const rolled = rollDice({ count: 10, sides: 10, modifier: 0 }, rollDie);
  const name = (await q.query('SELECT name FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0]?.name ?? '';
  await insertRoll(q, campaignId, userId, warlockId, `Урон: «Бросок через ад» — ${name}`.slice(0, 100), HURL_THROUGH_HELL_DAMAGE, rolled.results, 0, rolled.total, false);
  const change = await applyHpChange(q, campaignId, userId, targetId, { mode: 'damage', amount: rolled.total, damageType: 'psychic', critical: false, sourceId: warlockId });
  return { text: `возвращается, пережив ад: ${change.applied} психического урона.`, change };
}

export function registerStrikeRoutes(ctx: ClassFeatureContext) {
  const { announceHpChange, app, applyHpChange, auth, campaignFlag, canManageCharacter, db, insertRoll, membership, notifyCampaign, rollDie } = ctx;

  app.post<{ Params: { campaignId: string; rollId: string }; Body: { slotLevel: number } }>(
    '/campaigns/:campaignId/rolls/:rollId/smite',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, rollId: uuid }),
        body: objectSchema({ slotLevel: { type: 'integer', minimum: 1, maximum: 9 } }),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, rollId } = request.params;
      const { slotLevel } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const attack = (await q.query('SELECT id, character_id, outcome, created_at, hidden FROM roll_log WHERE campaign_id=$1 AND id=$2', [campaignId, rollId])).rows[0] as any;
        if (!attack) reject(404, 'Броска нет.');
        const outcome = attack.outcome ?? {};
        if (outcome.kind !== 'attack' || !outcome.target || !attack.character_id) reject(400, 'Кара — после атаки по цели.');
        if (!outcome.hit) reject(400, 'Кара — только после попадания.');
        if (outcome.melee !== true) reject(400, 'Кара — после попадания рукопашным оружием.');

        const attacker = (await q.query(`SELECT ${CHARACTER_COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE`, [campaignId, attack.character_id])).rows[0] as any;
        if (!attacker) reject(404, 'Атакующего нет.');
        if (!(await canManageCharacter(q, member, userId, attacker.owner_user_id, attacker.id))) reject(403, 'Кару выбирает тот, чей это персонаж, или мастер.');
        requireFeature(attacker, characterClassLevels(attacker).classes, 'divine-smite');
        const latest = (
          await q.query(`SELECT id FROM roll_log WHERE campaign_id=$1 AND character_id=$2 AND outcome->>'kind'='attack' ORDER BY created_at DESC LIMIT 1`, [campaignId, attacker.id])
        ).rows[0];
        if (latest?.id !== rollId) reject(400, 'Кара — сразу после попадания: с тех пор была другая атака.');
        const already = (
          await q.query(`SELECT 1 FROM roll_log WHERE campaign_id=$1 AND character_id=$2 AND created_at >= $3 AND outcome->>'smiteFor' = $4`, [campaignId, attacker.id, attack.created_at, rollId])
        ).rows[0];
        if (already) reject(400, 'Этим попаданием кара уже была.');

        const slot = (
          await q.query('SELECT current FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND level=$3 FOR UPDATE', [campaignId, attacker.id, slotLevel])
        ).rows[0];
        if (!slot || slot.current <= 0) reject(400, `Ячеек ${slotLevel}-го уровня не осталось.`);
        await q.query('UPDATE character_spell_slots SET current=current-1 WHERE campaign_id=$1 AND character_id=$2 AND level=$3', [campaignId, attacker.id, slotLevel]);

        const target = (await q.query('SELECT id, name, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, outcome.target.id])).rows[0] as any;
        if (!target) reject(404, 'Цели больше нет.');
        const undead = isUndeadOrFiend(creatureTypeText(target.sheet_extra));
        const critical = outcome.critical === true && (await campaignFlag(q, campaignId, 'crit_doubles_dice')) !== false;
        const count = smiteDice(slotLevel, undead) * (critical ? 2 : 1);
        const dice = Array.from({ length: count }, () => rollDie(8));
        const total = dice.reduce((sum, value) => sum + value, 0);
        const change = await applyHpChange(q, campaignId, userId, target.id, { mode: 'damage', amount: total, damageType: 'radiant', critical: outcome.critical === true });
        const blessing = change.dropped ? await darkOnesBlessing(q, campaignId, attacker.id, target.id) : null;
        const roll = await insertRoll(
          q, campaignId, userId, attacker.id, `Божественная кара → ${target.name}`.slice(0, 100), `${count}d8`, dice, 0, total, attack.hidden === true, null,
          {
            kind: 'damage', target: { id: target.id, name: target.name }, critical: outcome.critical === true, damageType: 'radiant',
            applied: change.applied, blocked: change.blocked, modified: change.modified, dropped: change.dropped,
            smiteFor: rollId, slotLevel, ...(undead ? { undead: true } : {}),
          },
        );
        return { roll, change, targetId: target.id as string, attackerId: attacker.id as string, critical: outcome.critical === true, undead, blessing };
      });

      void notifyCampaign(campaignId, { type: 'rolls' });
      void notifyCampaign(campaignId, { type: 'character', characterId: result.attackerId });
      void notifyCampaign(campaignId, { type: 'float', characterId: result.attackerId, text: 'божественная кара', tone: 'crit' });
      if (result.blessing) void notifyCampaign(campaignId, { type: 'float', characterId: result.blessing.characterId, text: `+${result.blessing.value} врем. хитов`, tone: 'info' });
      announceHpChange(campaignId, result.targetId, 'damage', { ...result.change, critical: result.critical });
      return reply.code(201).send({
        roll: result.roll, applied: result.change.applied, blocked: result.change.blocked, modified: result.change.modified,
        undead: result.undead, notices: result.change.notices,
      });
    },
  );

  app.post<{ Params: { campaignId: string; rollId: string }; Body: { maneuver: ManeuverId } }>(
    '/campaigns/:campaignId/rolls/:rollId/maneuver',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, rollId: uuid }),
        body: objectSchema({ maneuver: { type: 'string', enum: HIT_MANEUVERS } }, ['maneuver']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, rollId } = request.params;
      const { maneuver } = request.body;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const attack = (await q.query('SELECT id, character_id, outcome, created_at, hidden FROM roll_log WHERE campaign_id=$1 AND id=$2', [campaignId, rollId])).rows[0] as any;
        if (!attack) reject(404, 'Броска нет.');
        const outcome = attack.outcome ?? {};
        if (outcome.kind !== 'attack' || !outcome.target || !attack.character_id) reject(400, 'Приём — после атаки по цели.');
        if (!outcome.hit) reject(400, 'Приём — только после попадания.');
        const attacker = (await q.query(`SELECT ${CHARACTER_COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE`, [campaignId, attack.character_id])).rows[0] as any;
        if (!attacker) reject(404, 'Атакующего нет.');
        if (!(await canManageCharacter(q, member, userId, attacker.owner_user_id, attacker.id))) reject(403, 'Приём выбирает тот, чей это персонаж, или мастер.');
        const classes = characterClassLevels(attacker).classes;
        requireFeature(attacker, classes, 'combat-superiority');
        const name = MANEUVERS.find(entry => entry.id === maneuver)!.nameRu;
        if (!knownManeuvers(attacker.sheet_extra).includes(maneuver)) reject(400, `«${name}» у «${attacker.name}» не отмечен — отметьте в «Умениях».`);
        const latest = (
          await q.query(`SELECT id FROM roll_log WHERE campaign_id=$1 AND character_id=$2 AND outcome->>'kind'='attack' ORDER BY created_at DESC LIMIT 1`, [campaignId, attacker.id])
        ).rows[0];
        if (latest?.id !== rollId) reject(400, 'Приём — сразу после попадания: с тех пор была другая атака.');
        const already = (
          await q.query(`SELECT 1 FROM roll_log WHERE campaign_id=$1 AND character_id=$2 AND created_at >= $3 AND outcome->>'maneuverFor' = $4`, [campaignId, attacker.id, attack.created_at, rollId])
        ).rows[0];
        if (already) reject(400, 'Этим попаданием приём уже был.');
        await spendResource(q, campaignId, attacker, 'Кости превосходства');

        const target = (await q.query('SELECT id, name, size FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, outcome.target.id])).rows[0] as any;
        if (!target) reject(404, 'Цели больше нет.');
        const hitRoll = (
          await q.query(
            `SELECT outcome->>'damageType' AS damage_type FROM roll_log WHERE campaign_id=$1 AND character_id=$2 AND created_at >= $3 AND outcome->>'kind'='damage'
             AND outcome->'target'->>'id' = $4 ORDER BY created_at LIMIT 1`,
            [campaignId, attacker.id, attack.created_at, target.id],
          )
        ).rows[0] as any;
        const die = superiorityDie(classLevelOf(classes, 'fighter', attacker.level));
        const critical = outcome.critical === true && (await campaignFlag(q, campaignId, 'crit_doubles_dice')) !== false;
        const dice = Array.from({ length: critical ? 2 : 1 }, () => rollDie(die));
        const total = dice.reduce((sum, value) => sum + value, 0);
        const change = await applyHpChange(q, campaignId, userId, target.id, { mode: 'damage', amount: total, damageType: hitRoll?.damage_type ?? null, critical: outcome.critical === true });
        const roll = await insertRoll(
          q, campaignId, userId, attacker.id, `${name} → ${target.name}`.slice(0, 100), `${dice.length}d${die}`, dice, 0, total, attack.hidden === true, null,
          {
            kind: 'damage', target: { id: target.id, name: target.name }, critical: outcome.critical === true, damageType: hitRoll?.damage_type ?? null,
            applied: change.applied, blocked: change.blocked, modified: change.modified, dropped: change.dropped, maneuverFor: rollId, maneuver,
          },
        );
        const blessing = change.dropped ? await darkOnesBlessing(q, campaignId, attacker.id, target.id) : null;
        const dc = maneuverDc(proficiencyBonusForLevel(Math.max(1, attacker.level ?? 1)), abilityModifier(attacker.strength), abilityModifier(attacker.dexterity));
        const sizes = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
        const tooBig = sizes.indexOf(String(target.size ?? 'medium')) > sizes.indexOf('large');
        const standing = Number(change.row?.hp_current ?? 1) > 0;
        const entry = (await q.query('SELECT scene_id, is_current FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 ORDER BY is_current DESC LIMIT 1', [campaignId, attacker.id])).rows[0] as any;
        let effect = '';
        let save: { total: number; success: boolean } | null = null;
        const saveOf = async (ability: string, ru: string, condition: string | null = null) => {
          if (!ctx.rollSaveAgainst) return null;
          return ctx.rollSaveAgainst(q, campaignId, userId, target.id, ability, dc, `Спасбросок ${ru} (СЛ ${dc}) против «${name}» — ${target.name}`.slice(0, 100), attack.hidden === true, { condition });
        };
        if (!standing) effect = 'цель повержена';
        else if ((maneuver === 'trip' || maneuver === 'pushing') && tooBig) effect = 'цель больше Большой — без эффекта';
        else if (maneuver === 'trip') {
          save = await saveOf('strength', 'СИЛ');
          if (save && !save.success) await addCondition(q, campaignId, target.id, 'prone', { source: 'feature', sourceCharacterId: attacker.id, sourceName: name });
          effect = save?.success ? 'устоял на ногах' : 'сбит с ног';
        } else if (maneuver === 'pushing') {
          save = await saveOf('strength', 'СИЛ');
          const moved = save && !save.success && entry?.scene_id && ctx.pushAway ? await ctx.pushAway(q, campaignId, entry.scene_id, attacker.id, target.id, 15) : 0;
          effect = save?.success ? 'устоял' : moved ? `отброшен на ${moved} фт.` : 'отбросить некуда';
        } else if (maneuver === 'menacing') {
          save = await saveOf('wisdom', 'МДР', 'frightened');
          if (save && !save.success) {
            await addCondition(q, campaignId, target.id, 'frightened', {
              source: 'feature', sourceCharacterId: attacker.id, sourceName: name, expires: { at: 'end', of: attacker.id, skip: entry?.is_current ? 1 : 0 },
            });
          }
          effect = save?.success ? 'не испугался' : `испуган до конца следующего хода «${attacker.name}»`;
        } else {
          await addCondition(q, campaignId, target.id, 'guided', {
            source: 'feature', sourceCharacterId: attacker.id, sourceName: name, notBy: attacker.id, expires: { at: 'start', of: attacker.id },
          });
          effect = 'следующая атака по нему (не ваша) — с преимуществом';
        }
        return { roll, change, targetId: target.id as string, attackerId: attacker.id as string, critical: outcome.critical === true, name, total, die, effect, save, sceneId: entry?.scene_id ?? null, blessing };
      });

      void notifyCampaign(campaignId, { type: 'rolls' });
      void notifyCampaign(campaignId, { type: 'character', characterId: result.attackerId });
      void notifyCampaign(campaignId, { type: 'character', characterId: result.targetId });
      void notifyCampaign(campaignId, { type: 'float', characterId: result.attackerId, text: result.name.toLowerCase(), tone: 'info' });
      if (result.sceneId) void notifyCampaign(campaignId, { type: 'changed' });
      if (result.blessing) void notifyCampaign(campaignId, { type: 'float', characterId: result.blessing.characterId, text: `+${result.blessing.value} врем. хитов`, tone: 'info' });
      announceHpChange(campaignId, result.targetId, 'damage', { ...result.change, critical: result.critical });
      return reply.code(201).send({
        maneuver: request.body.maneuver, name: result.name, value: result.total, die: result.die, applied: result.change.applied,
        effect: result.effect, ...(result.save ? { save: { total: result.save.total, success: result.save.success } } : {}),
        message: `${result.name}: +${result.total} урона (${result.change.applied} прошло) — ${result.effect}.`,
      });
    },
  );

  app.post<{ Params: { campaignId: string; rollId: string } }>(
    '/campaigns/:campaignId/rolls/:rollId/stunning-strike',
    { schema: { params: objectSchema({ campaignId: uuid, rollId: uuid }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, rollId } = request.params;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const attack = (await q.query('SELECT id, character_id, outcome, created_at, hidden FROM roll_log WHERE campaign_id=$1 AND id=$2', [campaignId, rollId])).rows[0] as any;
        if (!attack) reject(404, 'Броска нет.');
        const outcome = attack.outcome ?? {};
        if (outcome.kind !== 'attack' || !outcome.target || !attack.character_id || !outcome.hit || outcome.melee !== true) reject(400, '«Ошеломляющий удар» — после попадания рукопашной атакой.');
        const attacker = (await q.query(`SELECT ${CHARACTER_COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE`, [campaignId, attack.character_id])).rows[0] as any;
        if (!attacker) reject(404, 'Атакующего нет.');
        if (!(await canManageCharacter(q, member, userId, attacker.owner_user_id, attacker.id))) reject(403, 'Умением пользуется тот, чей это персонаж, или мастер.');
        const classes = characterClassLevels(attacker).classes;
        requireFeature(attacker, classes, 'stunning-strike');
        const latest = (
          await q.query(`SELECT id FROM roll_log WHERE campaign_id=$1 AND character_id=$2 AND outcome->>'kind'='attack' ORDER BY created_at DESC LIMIT 1`, [campaignId, attacker.id])
        ).rows[0];
        if (latest?.id !== rollId) reject(400, '«Ошеломляющий удар» — сразу после попадания: с тех пор была другая атака.');
        const already = (
          await q.query(`SELECT 1 FROM roll_log WHERE campaign_id=$1 AND character_id=$2 AND created_at >= $3 AND label LIKE '%«Ошеломляющего удара»%'`, [campaignId, outcome.target.id, attack.created_at])
        ).rows[0];
        if (already) reject(400, 'Этим попаданием «Ошеломляющий удар» уже был.');
        await spendResource(q, campaignId, attacker, 'Ци');
        const dc = kiSaveDc(proficiencyBonusForLevel(Math.max(1, attacker.level ?? 1)), abilityModifier(attacker.wisdom));
        if (!ctx.rollSaveAgainst) reject(400, 'Спасбросок недоступен.');
        const target = (await q.query('SELECT id, name FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, outcome.target.id])).rows[0] as any;
        if (!target) reject(404, 'Цели больше нет.');
        const save = await ctx.rollSaveAgainst(q, campaignId, userId, target.id, 'constitution', dc, `Спасбросок ТЕЛ (СЛ ${dc}) против «Ошеломляющего удара» — ${target.name}`.slice(0, 100), attack.hidden === true, { condition: 'stunned' });
        if (!save.success) {
          const entry = await entryOf(q, campaignId, attacker.id, null);
          await addCondition(q, campaignId, target.id, 'stunned', {
            source: 'apply', sourceCharacterId: attacker.id, sourceName: '«Ошеломляющий удар»',
            expires: { at: 'end', of: attacker.id, skip: entry?.is_current ? 1 : 0 },
          });
        }
        return { stunned: !save.success, total: save.total, dc, targetId: target.id as string, targetName: target.name as string, attackerId: attacker.id as string };
      });
      void notifyCampaign(campaignId, { type: 'rolls' });
      void notifyCampaign(campaignId, { type: 'character', characterId: result.attackerId });
      void notifyCampaign(campaignId, { type: 'character', characterId: result.targetId });
      void notifyCampaign(campaignId, { type: 'changed' });
      void notifyCampaign(campaignId, { type: 'float', characterId: result.targetId, text: result.stunned ? 'ошеломлён!' : 'устоял', tone: result.stunned ? 'crit' : 'info' });
      return reply.code(201).send(result);
    },
  );

  app.post<{ Params: { campaignId: string; rollId: string } }>(
    '/campaigns/:campaignId/rolls/:rollId/quivering-palm',
    { schema: { params: objectSchema({ campaignId: uuid, rollId: uuid }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, rollId } = request.params;
      const result = await db.transaction(async q => {
        const { outcome, attacker, target } = await lastHit(ctx, q, campaignId, rollId, userId, 'quivering-palm', '«Дрожащая ладонь»');
        if (outcome.unarmed !== true) reject(400, '«Дрожащая ладонь» — после попадания безоружным ударом.');
        if (target.kind === 'object') reject(400, 'Дрожь — в живом существе, не в предмете.');
        await spendResource(q, campaignId, attacker, 'Ци', QUIVERING_PALM_KI);
        await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND effect_code='quivering_palm' AND parameters->>'sourceCharacterId' = $2`, [campaignId, attacker.id]);
        await addCondition(q, campaignId, target.id, 'quivering_palm', { source: 'feature', sourceCharacterId: attacker.id, sourceName: 'Дрожащая ладонь' });
        return { attackerId: attacker.id as string, attackerName: attacker.name as string, targetId: target.id as string, targetName: target.name as string };
      });
      void notifyCampaign(campaignId, { type: 'character', characterId: result.attackerId });
      void notifyCampaign(campaignId, { type: 'character', characterId: result.targetId });
      void notifyCampaign(campaignId, { type: 'changed' });
      return reply.code(201).send({ ...result, message: `${result.attackerName}: «Дрожащая ладонь» — дрожь в «${result.targetName}». Оборвать — действием в «Умениях».` });
    },
  );

  app.post<{ Params: { campaignId: string; rollId: string } }>(
    '/campaigns/:campaignId/rolls/:rollId/hurl-through-hell',
    { schema: { params: objectSchema({ campaignId: uuid, rollId: uuid }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, rollId } = request.params;
      const result = await db.transaction(async q => {
        const { attacker, target } = await lastHit(ctx, q, campaignId, rollId, userId, 'hurl-through-hell', '«Бросок через ад»');
        if (target.kind === 'object') reject(400, '«Бросок через ад» — по существу, не по предмету.');
        if ((await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='hurled' AND active`, [campaignId, target.id])).rows[0]) {
          reject(400, `«${target.name}» уже в аду.`);
        }
        await spendResource(q, campaignId, attacker, 'Бросок через ад');
        const entry = await entryOf(q, campaignId, attacker.id, null);
        if (!entry) {
          const back = await hurlBack(ctx, q, campaignId, userId, attacker.id, target.id);
          return { attackerId: attacker.id as string, targetId: target.id as string, message: `${attacker.name}: «Бросок через ад» — «${target.name}» ${back.text}`, change: back.change };
        }
        const placements = (
          await q.query('UPDATE scene_objects SET hidden=true, revision=revision+1 WHERE campaign_id=$1 AND character_id=$2 AND hidden=false RETURNING id', [campaignId, target.id])
        ).rows.map(row => row.id as string);
        await addCondition(q, campaignId, target.id, 'hurled', {
          source: 'feature', sourceCharacterId: attacker.id, sourceName: 'Бросок через ад', placements,
          returnsAfter: entry.is_current ? 2 : 1,
        });
        await addCondition(q, campaignId, target.id, 'incapacitated', { source: 'feature', sourceCharacterId: attacker.id, sourceName: 'Бросок через ад' });
        await q.query('UPDATE scenes SET revision=revision+1 WHERE campaign_id=$1 AND id IN (SELECT scene_id FROM scene_objects WHERE campaign_id=$1 AND character_id=$2)', [campaignId, target.id]);
        return {
          attackerId: attacker.id as string, targetId: target.id as string, change: null as HpResult | null,
          message: `${attacker.name}: «Бросок через ад» — «${target.name}» исчезает в нижних планах до конца следующего хода ${attacker.name}.`,
        };
      });
      if (result.change) announceHpChange(campaignId, result.targetId, 'damage', result.change);
      void notifyCampaign(campaignId, { type: 'rolls' });
      void notifyCampaign(campaignId, { type: 'character', characterId: result.attackerId });
      void notifyCampaign(campaignId, { type: 'character', characterId: result.targetId });
      void notifyCampaign(campaignId, { type: 'changed' });
      void notifyCampaign(campaignId, { type: 'notice', title: '«Бросок через ад»', detail: result.message, tone: 'info' });
      return reply.code(201).send({ message: result.message, ...(result.change ? { damage: result.change.applied } : {}) });
    },
  );
}
