import { critRange } from '../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { factionBonusOf } from '../../campaign/factions.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { incapacitatedReason, d20Ruling, type Ability as ConditionAbility } from '../../../../../packages/domain/combat/conditions.ts';
import { type Advantage, hitChance, parseFormula } from '../../../../../packages/domain/dice/dice.ts';
import { type FormulaContext, resolveFormula } from '../../../../../packages/domain/dice/formula.ts';
import { MAX_FORMULA_LENGTH, parseExpression, hasTokens, rollExpression, rollCriticalExtra } from '../../../../../packages/domain/dice/expression.ts';

import { attackSituation, weaponDamageText, weaponRanges } from '../combat/attack.ts';
import { announceHpChange, applyHpChange, multiattackGuard } from '../combat/hp.ts';
import { offerRebukes, shieldBonus } from '../combat/reactions.ts';
import { invisibilitySeen } from '../combat/sight.ts';
import { stealthAttack } from '../combat/stealth.ts';
import type { TableContext } from '../context.ts';
import { notifyCampaign } from '../live/notify.ts';
import { characterFormulaContext, DAMAGE_TYPES, insertRoll, rollDie } from './dice.ts';
import { alertTarget, CHECK_KINDS, checkModifier, elusiveTarget, featSituation, feralSenses, ownRollState, unseenAdvantages, unseenDisadvantages, weaponStyles } from './modifiers.ts';
import { type CheckBody, rollCheckAs } from './roll-check.ts';
import { withinFeet } from '../scene/movement.ts';
import { canManageCharacter, sheetContext } from '../scene/placements.ts';
import { campaignParams, type CampaignParams, reject, rollParams, type RollParams, uuid, uuidPattern } from '../shared.ts';


export function registerRollRoutes(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.post<{
    Params: CampaignParams;
    Body: { formula: string; label?: string; characterId?: string; hidden?: boolean };
  }>(
    '/campaigns/:campaignId/rolls',
    {
      schema: {
        params: campaignParams,
        body: {
          type: 'object',
          required: ['formula'],
          additionalProperties: false,
          properties: {
            formula: { type: 'string', minLength: 1, maxLength: MAX_FORMULA_LENGTH },
            label: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
            characterId: uuid,
            hidden: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { formula, label, characterId, hidden } = request.body;

      const parsedExpression = parseExpression(formula);

      if (!parsedExpression.ok) {
        reject(400, parsedExpression.reason === 'unknown-token'
          ? `Неизвестная переменная @${parsedExpression.token}. Можно: @str @dex @con @int @wis @cha @prof.`
          : parsedExpression.reason === 'too-many-dice'
            ? 'В одной части формулы — не больше 50 костей (50d6), во всём броске — не больше 100. Разбейте бросок на несколько.'
            : 'Некорректная формула броска. Примеры: 1d20+5, 1d8+1d6+3, 4d6kh3, d20+@str.');
      }

      const expression = parsedExpression.expression;

      const result = await db.transaction(async q => {
        await membership(q, campaignId, userId, true);

        let context: FormulaContext = {};

        if (characterId) {
          const character = (
            await q.query(
              `SELECT id, level, challenge_rating::float8 AS challenge_rating, sheet_extra, strength, dexterity, constitution, intelligence, wisdom, charisma
               FROM characters WHERE campaign_id=$1 AND id=$2`,
              [campaignId, characterId],
            )
          ).rows[0];

          if (!character) reject(400, 'Персонаж не найден в этой кампании.');
          context = characterFormulaContext(character);
        } else if (hasTokens(expression)) {
          reject(400, 'Переменные @str, @prof и т. п. берутся из листа — выберите, от чьего имени бросок.');
        }

        const rolled = rollExpression(expression, rollDie, context);
        if (!rolled.ok) {
          reject(400, rolled.reason === 'missing-value'
            ? `У персонажа нет значения для @${rolled.token} — укажите уровень (бонус мастерства).`
            : 'Некорректная формула броска.');
        }

        return insertRoll(
          q, campaignId, userId, characterId ?? null, label?.trim() ?? null,
          formula.trim(), rolled.dice, rolled.modifier, rolled.total, hidden ?? false, rolled.groups,
        );
      });

      void notifyCampaign(ctx, campaignId, { type: 'rolls' });

      return reply.code(201).send(result);
    },
  );

  app.post<{ Params: CampaignParams; Body: CheckBody }>(
    '/campaigns/:campaignId/rolls/check',
    {
      schema: {
        params: campaignParams,
        body: {
          type: 'object',
          required: ['characterId', 'kind', 'key'],
          additionalProperties: false,
          properties: {
            characterId: uuid,
            kind: { type: 'string', enum: CHECK_KINDS as unknown as string[] },
            key: { type: 'string', minLength: 1, maxLength: 64 },
            advantage: { type: 'string', enum: ['none', 'adv', 'disadv'] },
            bonusFormula: { type: 'string', maxLength: 20 },
            hidden: { type: 'boolean' },
            targetCharacterId: uuid,
            sceneId: uuid,
            inspiration: { type: 'boolean' },
            using: { type: 'string', enum: ['action', 'bonus', 'reaction'] },
            twoHanded: { type: 'boolean' },
            opportunity: { type: 'boolean' },
            sense: { type: 'string', enum: ['sight', 'hearing'] },
            bardic: { type: 'boolean' },
            precision: { type: 'boolean' },
            power: { type: 'boolean' },
            lucky: { type: 'boolean' },
            strokeOfLuck: { type: 'boolean' },
            peerless: { type: 'boolean' },
            warnFriendly: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => reply.code(201).send(await rollCheckAs(ctx, await auth(request), request.params.campaignId, request.body)),
  );

  app.get<{
    Params: CampaignParams;
    Querystring: {
      characterId: string; key: string; targetCharacterId?: string; sceneId?: string;
      advantage?: Advantage; twoHanded?: string; power?: string;
    };
  }>(
    '/campaigns/:campaignId/rolls/attack-preview',
    {
      schema: {
        params: campaignParams,
        querystring: {
          type: 'object',
          required: ['characterId', 'key'],
          additionalProperties: false,
          properties: {
            characterId: uuid,
            key: { type: 'string', minLength: 1, maxLength: 64 },
            targetCharacterId: uuid,
            sceneId: uuid,
            advantage: { type: 'string', enum: ['none', 'adv', 'disadv'] },
            twoHanded: { type: 'string', enum: ['true', 'false'] },
            power: { type: 'string', enum: ['true', 'false'] },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { characterId, key, targetCharacterId, sceneId, advantage, twoHanded, power } = request.query;
      if (!uuidPattern.test(key)) reject(404, 'Оружие не найдено у этого персонажа.');

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        const character = (
          await q.query(
            `SELECT id, name, owner_user_id, level, challenge_rating::float8 AS challenge_rating, sheet_extra, class_name,
                    strength, dexterity, constitution, intelligence, wisdom, charisma
             FROM characters WHERE campaign_id=$1 AND id=$2`,
            [campaignId, characterId],
          )
        ).rows[0];
        if (!character) reject(404, 'Персонаж не найден.');
        if (!(await canManageCharacter(q, member, userId, character.owner_user_id, character.id))) {
          reject(403, 'Шанс попадания виден тому, чей это персонаж, или мастеру.');
        }

        const check = await checkModifier(q, campaignId, character, 'attack', key);
        const own = await ownRollState(q, campaignId, characterId);
        const unable = incapacitatedReason(own);

        let target: { id: string; name: string; armor_class: number } | null = null;
        let situation: Awaited<ReturnType<typeof attackSituation>> = null;
        let targetState = null;
        let within5ft: boolean | null = null;
        let tooFar: string | null = null;
        const weapon = (
          await q.query(
            'SELECT name, range_feet, weapon_kind, long_range_feet, thrown_range_feet, damage_formula, versatile_formula, extra_damage_formula, properties, srd_index FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND id=$3',
            [campaignId, characterId, key],
          )
        ).rows[0] as any;
        if (!weapon) reject(404, 'Оружие не найдено у этого персонажа.');

        if (targetCharacterId) {
          target = (
            await q.query('SELECT id, name, armor_class FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetCharacterId])
          ).rows[0] as any ?? null;
          if (target) {
            targetState = await loadConditionState(q, campaignId, target.id);
            if (sceneId) {
              within5ft = await withinFeet(q, campaignId, sceneId, characterId, target.id, 5);
              try {
                situation = await attackSituation(q, campaignId, sceneId, characterId, target.id, {
                  kind: 'weapon', name: weapon.name, ranges: weaponRanges(weapon),
                });
              } catch (cause) {
                tooFar = cause instanceof Error ? cause.message : 'Цель вне досягаемости.';
              }
            }
          }
        }

        const stealth = target && sceneId ? await stealthAttack(q, campaignId, sceneId, characterId, target.id) : null;
        const seenStates = target ? await invisibilitySeen(q, campaignId, sceneId ?? null, characterId, target.id, own, targetState) : null;
        const recklessly = [
          ...(own.codes.has('reckless') && check.ability === 'strength' && weapon.weapon_kind !== 'ranged' && !situation?.ranged ? ['безрассудная атака'] : []),
          ...(targetState?.codes.has('reckless') ? ['цель атакует безрассудно'] : []),
        ];
        const situationNotes = featSituation(character, weapon, situation);
        const alerted = await alertTarget(q, campaignId, target?.id);
        const styles = weaponStyles(character, weapon, { power: power === 'true', twoHanded: twoHanded === 'true' });
        const feral = target ? await feralSenses(q, campaignId, characterId) : false;
        const ruling = d20Ruling({
          kind: 'attack', ability: check.ability as ConditionAbility, own: seenStates?.own ?? own, target: seenStates ? seenStates.target : targetState, targetWithin5ft: within5ft,
          requested: advantage ?? 'none',
          extraDisadvantages: [...(situation?.disadvantages ?? []), ...unseenDisadvantages(stealth?.disadvantages ?? [], feral)],
          extraAdvantages: [...unseenAdvantages(stealth?.advantages ?? [], alerted), ...(situation?.advantages ?? []), ...recklessly],
          noAdvantage: target ? await elusiveTarget(q, campaignId, target.id, targetState) : null,
          unseenNoAdvantage: alerted,
          ignoreUnseen: feral,
        });

        ruling.reasons.push(...styles.reasons, ...situationNotes);
        const factionAttack = await factionBonusOf(q, campaignId, characterId, 'attack');
        const targetFaction = target ? await factionBonusOf(q, campaignId, target.id, 'ac') : { value: 0, reasons: [] };
        ruling.reasons.push(...factionAttack.reasons, ...targetFaction.reasons.map(reason => `КД цели: ${reason}`));
        const ac = target ? target.armor_class + (situation?.acBonus ?? 0) + await shieldBonus(q, campaignId, target.id) + await multiattackGuard(q, campaignId, target.id, characterId) + targetFaction.value : null;
        const chance = !unable && !tooFar && ac !== null ? hitChance(check.modifier + styles.attack + factionAttack.value, ac, ruling.advantage, critRange(characterClassLevels(character).classes)) : null;

        const damageText = twoHanded === 'true' && weapon.versatile_formula ? weapon.versatile_formula : weapon.damage_formula;
        let averageDamage: number | null = null;
        if (damageText) {
          const context = sheetContext(character, check.proficiencyBonus);
          const resolved = resolveFormula(weaponDamageText(damageText, check), context);
          if (resolved.ok) {
            averageDamage = Math.max(0, Math.floor(resolved.parsed.count * (resolved.parsed.sides + 1) / 2) + resolved.parsed.modifier + styles.damage);
            if (weapon.extra_damage_formula) {
              const extra = resolveFormula(weapon.extra_damage_formula, context);
              if (extra.ok) averageDamage += Math.max(0, Math.floor(extra.parsed.count * (extra.parsed.sides + 1) / 2) + extra.parsed.modifier);
            }
          }
        }

        return {
          hitChance: chance, averageDamage, advantage: ruling.advantage, reasons: ruling.reasons, unable, tooFar, ...(styles.powerBy ? { power: styles.powerBy } : {}),
          ...(situation ? { distance: situation.distance, ranged: situation.ranged, cover: situation.cover } : {}),
        };
      });
    },
  );

  app.get<{ Params: CampaignParams }>(
    '/campaigns/:campaignId/rolls',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;

      const member = await membership(db, campaignId, userId);
      const isGm = member.owner_user_id === userId || member.is_full_gm;

      const { rows } = await db.query(
        `SELECT roll.id, roll.user_id, roll.character_id, roll.label, roll.formula,
                roll.dice_results, roll.modifier, roll.total, roll.hidden, roll.breakdown, roll.outcome,
                roll.created_at, u.display_name AS user_display_name,
                COALESCE(
                  (SELECT array_agg(ra.character_id::text) FROM roll_applications ra WHERE ra.roll_id = roll.id),
                  '{}'::text[]
                ) AS applied_to
         FROM roll_log roll
         LEFT JOIN users u ON u.id = roll.user_id
         WHERE roll.campaign_id=$1
           AND (NOT roll.hidden OR roll.user_id=$2 OR $3::boolean)
         ORDER BY roll.created_at DESC
         LIMIT 50`,
        [campaignId, userId, isGm],
      );

      return { rolls: rows };
    },
  );

  app.post<{
    Params: RollParams;
    Body: { characterId: string; mode: 'damage' | 'heal'; critical?: boolean; damageType?: string };
  }>(
    '/campaigns/:campaignId/rolls/:rollId/apply',
    {
      schema: {
        params: rollParams,
        body: {
          type: 'object',
          required: ['characterId', 'mode'],
          additionalProperties: false,
          properties: {
            characterId: uuid,
            mode: { type: 'string', enum: ['damage', 'heal'] },
            critical: { type: 'boolean' },
            damageType: { type: 'string', enum: DAMAGE_TYPES as unknown as string[] },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, rollId } = request.params;
      const { characterId, mode, critical, damageType } = request.body;

      if (damageType && mode !== 'damage') reject(400, 'Тип бывает только у урона.');

      if (critical && mode !== 'damage') reject(400, 'Крит применим только к урону.');

      const applied: any = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        const roll = (
          await q.query(
            `SELECT formula, dice_results, modifier, total, character_id FROM roll_log WHERE campaign_id=$1 AND id=$2`,
            [campaignId, rollId],
          )
        ).rows[0];

        if (!roll) reject(404, 'Бросок не найден.');

        const character = (
          await q.query(
            `SELECT id, name, kind, owner_user_id, hp_current, hp_max, hp_temp, damage_threshold FROM characters
             WHERE campaign_id=$1 AND id=$2
             FOR UPDATE`,
            [campaignId, characterId],
          )
        ).rows[0];

        if (!character) reject(404, 'Персонаж не найден.');

        if (!(await canManageCharacter(q, member, userId, character.owner_user_id, character.id))) {
          reject(403, 'Недостаточно прав, чтобы применить бросок к этому персонажу.');
        }

        const claimed = await q.query(
          `INSERT INTO roll_applications (campaign_id, roll_id, character_id, mode)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (roll_id, character_id) DO NOTHING
           RETURNING roll_id`,
          [campaignId, rollId, characterId, mode],
        );
        if (claimed.rows.length === 0) reject(409, 'Этот бросок уже применён этому персонажу.');

        let baseTotal = roll.total;
        let criticalDice: number[] | null = null;

        if (critical) {
          const rule = (
            await q.query(
              `SELECT value FROM campaign_rules WHERE campaign_id=$1 AND key='crit_doubles_dice' AND kind='flag'`,
              [campaignId],
            )
          ).rows[0];
          const critEnabled = rule ? rule.value === true : true;

          if (critEnabled) {
            const parsedExpression = parseExpression(roll.formula);
            if (!parsedExpression.ok) reject(400, 'Этот бросок — не формула урона, крит к нему не применить.');

            const extra = rollCriticalExtra(parsedExpression.expression, rollDie);
            criticalDice = extra.dice;
            baseTotal = roll.total + extra.total;
          }
        }

        if (mode === 'heal' && (await loadConditionState(q, campaignId, characterId)).codes.has('beacon_of_hope')) {
          const parsed = parseFormula(String(roll.formula));
          if (parsed) baseTotal = Math.max(baseTotal, parsed.count * parsed.sides + parsed.modifier);
        }
        const change = await applyHpChange(ctx, q, campaignId, userId, characterId, {
          mode, amount: Math.max(0, baseTotal), damageType: damageType ?? null, critical: criticalDice !== null,
        });
        await q.query(
          'UPDATE roll_applications SET applied=$3, dropped=$4 WHERE roll_id=$1 AND character_id=$2',
          [rollId, characterId, change.applied, Boolean(change.dropped)],
        );

        return {
          ...change.row,
          applied: change.applied,
          blocked: change.blocked,
          modified: change.modified,
          critical: criticalDice !== null,
          ...(criticalDice !== null ? { criticalDice } : {}),
          notices: change.notices,
          experience: change.experience,
          damagerId: roll.character_id as string | null,
        };
      });
      const { damagerId, ...appliedView } = applied;
      if (mode === 'damage' && damagerId && Number(appliedView.applied ?? 0) > 0) void offerRebukes(ctx, campaignId, null, damagerId, [characterId]);

      announceHpChange(ctx, campaignId, characterId, mode, applied);
      // Notify every client so the Damage/Heal buttons for this target go grey everywhere, not only for the one who pressed.
      void notifyCampaign(ctx, campaignId, { type: 'rolls' });
      return appliedView;
    },
  );
}
