import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid } from '../tabletop/scene-feature.ts';
import { applyClassSlots } from './class-slots.ts';
import { refreshGearAc } from './inventory-state.ts';
import { LEVEL_COLUMNS, type LevelUpContext } from './level-up-routes.ts';
import { srdSkills, srdSpellName } from '../rules/srd-data.ts';
import { abilityModifier } from '../../../../packages/domain/dice/dice.ts';
import { featEffects } from '../../../../packages/domain/character/feats.ts';
import { traitHpPerLevel } from '../../../../packages/domain/character/traits.ts';
import { guessHitDie } from '../../../../packages/domain/character/rest.ts';
import { levelForExperience } from '../../../../packages/domain/character/experience.ts';
import { ABILITIES, type Ability } from '../../../../packages/domain/character/level-up.ts';
import { mergedClassResources } from '../../../../packages/domain/srd/progression.ts';
import {
  CLASS_IDS, CLASS_LABELS, characterClassLevels, characterClassText, hitDieForClass, reduceClassText, type ClassId,
} from '../../../../packages/domain/character/classes.ts';
import {
  averageLevelHp, hpAfterLevelDown, lastLevelStep, withoutLastLevelStep, type LevelStep,
} from '../../../../packages/domain/character/level-steps.ts';

const ABILITY_RU: Record<Ability, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение', intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};

type Row = Record<string, any>;

function stepLines(step: LevelStep): string[] {
  const scores = Object.entries(step.scores).filter(([, delta]) => delta);
  const skill = (index: string) => srdSkills.find(entry => entry.index === index)?.nameRu ?? index;
  return [
    ...(step.hpGain ? [`Хиты: −${step.hpGain} к максимуму`] : []),
    ...(scores.length ? [`Характеристики: ${scores.map(([ability, delta]) => `${ABILITY_RU[ability as Ability]} −${delta}`).join(', ')}`] : []),
    ...(step.armorClass ? [`КД: −${step.armorClass}`] : []),
    ...(step.subclass ? ['Подкласс, выбранный на этом уровне, снимется'] : []),
    ...(step.feat ? ['Черта этого уровня снимется'] : []),
    ...(step.skills.length ? [`Навыки: ${step.skills.map(entry => skill(entry.index)).join(', ')} — без владения`] : []),
    ...(step.expertise.length ? [`Компетентность снимется: ${step.expertise.map(skill).join(', ')}`] : []),
    ...(step.spells.length ? [`Заклинания уберутся: ${step.spells.map(srdSpellName).join(', ')}`] : []),
    ...(step.restoreSpell ? [`Вернётся заклинание: ${srdSpellName(step.restoreSpell)}`] : []),
    ...(step.weapons.archery.length || step.weapons.dueling.length ? ['Бонус боевого стиля к оружию снимется'] : []),
    ...(step.resources.length ? ['Ресурсы класса — как на прошлом уровне'] : []),
  ];
}

function fallbackHp(row: Row, classId: ClassId, multiclass: boolean) {
  const die = multiclass ? hitDieForClass(classId) : row.hit_die ?? guessHitDie(characterClassText(row));
  return averageLevelHp(die, abilityModifier(Number(row.constitution ?? 10)), traitHpPerLevel(featEffects(row.sheet_extra)));
}

export function registerLevelDownRoutes(ctx: LevelUpContext) {
  const { app, db, auth, membership, notifyCampaign, canManageCharacter } = ctx;
  const params = objectSchema({ campaignId: uuid, characterId: uuid });

  async function load(q: Queryable, campaignId: string, characterId: string, userId: string, lock = false) {
    const member = await membership(q, campaignId, userId, true);
    const row = (await q.query(`SELECT ${LEVEL_COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [campaignId, characterId])).rows[0] as Row | undefined;
    if (!row || row.kind === 'object') reject(404, 'Существо не найдено.');
    if (!(await canManageCharacter(q, member, userId, row!.owner_user_id))) reject(403, 'Уровень понижает тот, чей это персонаж, или мастер.');
    if (Number(row!.level ?? 1) <= 1) reject(400, `${row!.name}: уже 1-й уровень, ниже некуда.`);
    return row!;
  }

  function plan(row: Row, classId: ClassId | null) {
    const level = Number(row.level ?? 1);
    const step = lastLevelStep(row.level_steps, level);
    const parsed = characterClassLevels(row);
    const classes = parsed.multiclass ? parsed.classes.map(entry => ({ id: entry.id, name: CLASS_LABELS[entry.id], level: entry.level })) : [];
    const lowered = step ? null : parsed.multiclass ? classId : parsed.classes[0]?.id ?? null;
    const hpLoss = step ? step.hpGain : lowered ? fallbackHp(row, lowered, parsed.multiclass) : 0;
    const stillReady = levelForExperience(Number(row.experience ?? 0)) >= level;
    return {
      name: row.name as string, from: level, to: level - 1, recorded: Boolean(step), step, hpLoss,
      classes, needsClass: !step && parsed.multiclass && !classId, lowered,
      lines: step ? stepLines(step) : [
        `Хиты: −${hpLoss} к максимуму (в среднем за уровень)`,
        'Как этот уровень был взят, не записано: характеристики, черту и заклинания этого уровня поправьте в листе сами',
      ],
      stillReady,
    };
  }

  app.get<{ Params: { campaignId: string; characterId: string }; Querystring: { classId?: ClassId } }>(
    '/campaigns/:campaignId/characters/:characterId/level-down',
    { schema: { params, querystring: objectSchema({ classId: { type: 'string', enum: CLASS_IDS } }, []) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      return db.transaction(async q => {
        const shown = plan(await load(q, campaignId, characterId, userId), request.query.classId ?? null);
        return {
          name: shown.name, from: shown.from, to: shown.to, recorded: shown.recorded, hpLoss: shown.hpLoss, classes: shown.classes,
          needsClass: shown.needsClass, lines: shown.lines, stillReady: shown.stillReady,
        };
      });
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { classId?: ClassId; expectedLevel?: number } }>(
    '/campaigns/:campaignId/characters/:characterId/level-down',
    { schema: { params, body: objectSchema({ classId: { type: 'string', enum: CLASS_IDS }, expectedLevel: { type: 'integer', minimum: 2, maximum: 20 } }, []) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const result = await db.transaction(async q => {
        const row = await load(q, campaignId, characterId, userId, true);
        const expected = request.body?.expectedLevel;
        if (expected !== undefined && Number(row.level ?? 1) !== expected) reject(409, `Уровень уже изменился: сейчас ${row.level}-й. Посмотрите, что изменится, ещё раз.`);
        const shown = plan(row, request.body?.classId ?? null);
        if (shown.needsClass) reject(400, 'Выберите, у какого класса снять уровень.');
        if (!shown.step && !shown.lowered) reject(400, 'Класс героя не распознан — поправьте запись класса в листе.');
        if (shown.lowered && !shown.recorded && characterClassLevels(row).multiclass && !shown.classes.some(entry => entry.id === shown.lowered)) {
          reject(400, 'У героя нет такого класса.');
        }
        if (shown.step) await undoStep(q, campaignId, row, shown.step);
        else await lowerUnrecorded(q, campaignId, row, shown.lowered!, shown.hpLoss);
        await applyClassSlots(q, campaignId, characterId);
        await refreshGearAc(q, campaignId, characterId);
        return { name: shown.name, level: shown.to, lines: shown.lines, recorded: shown.recorded, stillReady: shown.stillReady };
      });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      void notifyCampaign(campaignId, { type: 'characters' });
      void notifyCampaign(campaignId, { type: 'changed' });
      void notifyCampaign(campaignId, { type: 'float', characterId, text: `Уровень ${result.level}`, tone: 'info' });
      return reply.code(200).send(result);
    },
  );

  async function undoStep(q: Queryable, campaignId: string, row: Row, step: LevelStep) {
    const characterId = row.id as string;
    const hp = hpAfterLevelDown(Number(row.hp_current), Number(row.hp_max), step.hpGain);
    const scores = Object.fromEntries(ABILITIES.map(ability => [ability, Math.max(1, Number(row[ability]) - (step.scores[ability] ?? 0))])) as Record<Ability, number>;
    const extra = { ...(row.sheet_extra ?? {}) };
    if (step.subclass) {
      const subclasses = { ...(extra.subclasses ?? {}) };
      if (step.subclass.before) subclasses[step.subclass.classId] = step.subclass.before;
      else delete subclasses[step.subclass.classId];
      extra.subclasses = subclasses;
    }
    if (step.feat && Array.isArray(extra.feats)) extra.feats = extra.feats.filter((id: unknown) => id !== step.feat);
    const text = { ...(extra.text ?? {}) };
    for (const [key, before, name] of [['levels', step.levelsText, 'Умения по уровням'], ['prof', step.profText, 'Владения и языки']] as const) {
      if (before === null) continue;
      if (before) text[key] = { ...(text[key] ?? {}), name: text[key]?.name ?? name, value: before };
      else delete text[key];
    }
    extra.text = text;

    await q.query(
      `UPDATE characters SET level=$3, hp_max=$4, hp_current=$5,
         strength=$6, dexterity=$7, constitution=$8, intelligence=$9, wisdom=$10, charisma=$11,
         armor_class = GREATEST(0, armor_class - $12), sheet_extra=$13::jsonb, class_name=COALESCE($14, class_name),
         level_steps=$15::jsonb, revision=revision+1
       WHERE campaign_id=$1 AND id=$2`,
      [campaignId, characterId, step.from, hp.max, hp.current, scores.strength, scores.dexterity, scores.constitution, scores.intelligence,
        scores.wisdom, scores.charisma, step.armorClass, JSON.stringify(extra), step.classBefore, JSON.stringify(withoutLastLevelStep(row.level_steps, Number(row.level)))],
    );

    for (const skill of step.skills) {
      if (skill.created) await q.query('DELETE FROM character_skills WHERE campaign_id=$1 AND character_id=$2 AND skill_index=$3', [campaignId, characterId, skill.index]);
      else await q.query('UPDATE character_skills SET proficient=false, expertise=false WHERE campaign_id=$1 AND character_id=$2 AND skill_index=$3', [campaignId, characterId, skill.index]);
    }
    for (const skill of step.expertise) {
      await q.query('UPDATE character_skills SET expertise=false WHERE campaign_id=$1 AND character_id=$2 AND skill_index=$3', [campaignId, characterId, skill]);
    }
    for (const index of step.spells) {
      await q.query(
        `DELETE FROM character_spells WHERE id = (SELECT id FROM character_spells WHERE campaign_id=$1 AND character_id=$2 AND srd_index=$3 AND NOT granted LIMIT 1)`,
        [campaignId, characterId, index],
      );
    }
    if (step.restoreSpell) {
      await q.query(`INSERT INTO character_spells (campaign_id, character_id, source, srd_index, prepared) VALUES ($1,$2,'srd',$3,true)`, [campaignId, characterId, step.restoreSpell]);
    }
    if (step.weapons.proficient.length) {
      await q.query('UPDATE character_weapons SET proficient=false WHERE campaign_id=$1 AND character_id=$2 AND id = ANY($3::uuid[])', [campaignId, characterId, step.weapons.proficient]);
    }
    if (step.weapons.archery.length) {
      await q.query('UPDATE character_weapons SET attack_bonus = attack_bonus - 2 WHERE campaign_id=$1 AND character_id=$2 AND id = ANY($3::uuid[])', [campaignId, characterId, step.weapons.archery]);
    }
    if (step.weapons.dueling.length) {
      await q.query(
        `UPDATE character_weapons SET damage_formula = left(damage_formula, length(damage_formula) - 2)
         WHERE campaign_id=$1 AND character_id=$2 AND id = ANY($3::uuid[]) AND right(damage_formula, 2) = '+2'`,
        [campaignId, characterId, step.weapons.dueling],
      );
    }
    for (const resource of step.resources) {
      if (!resource.before) {
        await q.query('DELETE FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3', [campaignId, characterId, resource.name]);
      } else {
        await q.query(
          'UPDATE character_resources SET max=$4, current=LEAST($4, current), recharge=COALESCE($5, recharge) WHERE campaign_id=$1 AND character_id=$2 AND name=$3',
          [campaignId, characterId, resource.name, resource.before.max, resource.before.recharge],
        );
      }
    }
  }

  async function lowerUnrecorded(q: Queryable, campaignId: string, row: Row, classId: ClassId, hpLoss: number) {
    const characterId = row.id as string;
    const level = Number(row.level);
    const parsed = characterClassLevels(row);
    const classText = parsed.multiclass ? reduceClassText(row.class_name, level, classId) : null;
    const hp = hpAfterLevelDown(Number(row.hp_current), Number(row.hp_max), hpLoss);
    await q.query(
      `UPDATE characters SET level=$3, hp_max=$4, hp_current=$5, class_name=COALESCE($6, class_name), level_steps=$7::jsonb, revision=revision+1
       WHERE campaign_id=$1 AND id=$2`,
      [campaignId, characterId, level - 1, hp.max, hp.current, classText, JSON.stringify(withoutLastLevelStep(row.level_steps, level))],
    );
    const mods = { charisma: abilityModifier(Number(row.charisma ?? 10)) };
    const before = mergedClassResources(parsed.classes, mods);
    const after = new Map(mergedClassResources(characterClassLevels({ ...row, level: level - 1, class_name: classText ?? row.class_name }).classes, mods)
      .map(rule => [rule.name, rule]));
    for (const rule of before) {
      const next = after.get(rule.name);
      if (!next) await q.query('DELETE FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3', [campaignId, characterId, rule.name]);
      else if (next.max !== rule.max) {
        await q.query('UPDATE character_resources SET max=$4, current=LEAST($4, current) WHERE campaign_id=$1 AND character_id=$2 AND name=$3', [campaignId, characterId, rule.name, next.max]);
      }
    }
  }
}
