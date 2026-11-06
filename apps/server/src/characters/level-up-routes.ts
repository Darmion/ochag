import { FEATS, FEAT_ABILITIES, hasFeat, knownFeats } from '../../../../packages/domain/character/feats.ts';
import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { applyClassSlots } from './class-slots.ts';
import { srdSpellList } from '../rules/srd-spells.ts';
import { srdSkills, srdSpellName } from '../rules/srd-data.ts';
import { weaponGained } from '../../../../packages/domain/character/multiclass-gains.ts';
import { abilityModifier } from '../../../../packages/domain/dice/dice.ts';
import {
  ABILITIES, applyIncreases, featOf, levelHp, levelUpPlan, levelUpProblems, subclassFeatureNote, type Ability, type LevelUpChoice,
} from '../../../../packages/domain/character/level-up.ts';
import { classResources, mergedClassResources } from '../../../../packages/domain/srd/progression.ts';
import { CLASS_IDS, characterClassLevels, withSubclassText, type ClassId } from '../../../../packages/domain/character/classes.ts';
import { primalChampionScores, unarmoredAfterLevel } from '../../../../packages/domain/character/class-features.ts';
import { FIGHTING_STYLES } from '../../../../packages/domain/srd/heroes.ts';

export type LevelUpContext = SceneFeatureContext & {
  rollDie: (sides: number) => number;
  canManageCharacter: (q: Queryable, member: any, userId: string, ownerUserId: string | null, characterId?: string | null) => Promise<boolean>;
  isCharacterManager: (q: Queryable, member: any, userId: string) => Promise<boolean>;
  insertRoll: (
    q: Queryable, campaignId: string, userId: string, characterId: string | null, label: string | null, formula: string,
    results: number[], modifier: number, total: number, hidden: boolean, breakdown?: unknown[] | null, outcome?: Record<string, unknown> | null,
  ) => Promise<any>;
};

const COLUMNS = `id, name, kind, owner_user_id, level, experience, class_name, sheet_extra, hit_die,
  strength, dexterity, constitution, intelligence, wisdom, charisma, hp_max, hp_current, armor_class`;

const stringList = { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 64 } };

export function registerLevelUpRoutes(ctx: LevelUpContext) {
  const { app, db, auth, membership, notifyCampaign, rollDie, canManageCharacter, isCharacterManager, insertRoll } = ctx;
  const params = objectSchema({ campaignId: uuid, characterId: uuid });

  async function load(q: Queryable, campaignId: string, characterId: string, userId: string, lock = false) {
    const member = await membership(q, campaignId, userId, true);
    const row = (await q.query(`SELECT ${COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [campaignId, characterId])).rows[0] as any;
    if (!row || row.kind === 'object') reject(404, 'Существо не найдено.');
    if (!(await canManageCharacter(q, member, userId, row.owner_user_id))) reject(403, 'Уровень повышает тот, чей это персонаж, или мастер.');
    const manager = await isCharacterManager(q, member, userId);
    return { row, manager };
  }

  async function contextOf(q: Queryable, campaignId: string, row: any) {
    const skills = (await q.query('SELECT skill_index, proficient, expertise FROM character_skills WHERE campaign_id=$1 AND character_id=$2', [campaignId, row.id])).rows;
    const spells = (await q.query(`SELECT srd_index, granted FROM character_spells WHERE campaign_id=$1 AND character_id=$2 AND srd_index IS NOT NULL`, [campaignId, row.id])).rows;
    const book = srdSpellList();
    const levelOf = new Map(book.map(spell => [spell.index, spell.level]));
    return {
      scores: Object.fromEntries(ABILITIES.map(ability => [ability, Number(row[ability])])) as Record<Ability, number>,
      proficientSkills: skills.filter(skill => skill.proficient).map(skill => skill.skill_index as string),
      expertiseSkills: skills.filter(skill => skill.expertise).map(skill => skill.skill_index as string),
      knownSpells: spells.map(spell => spell.srd_index as string),
      swappableSpells: [...new Set(spells.filter(spell => !spell.granted && (levelOf.get(spell.srd_index) ?? 0) >= 1).map(spell => spell.srd_index as string))],
      knownFeats: knownFeats(row.sheet_extra),
      spellBook: book,
      skillIndexes: srdSkills.map(skill => skill.index),
    };
  }

  app.get<{ Params: { campaignId: string; characterId: string }; Querystring: { classId?: ClassId } }>(
    '/campaigns/:campaignId/characters/:characterId/level-up',
    { schema: { params, querystring: objectSchema({ classId: { type: 'string', enum: CLASS_IDS } }, []) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const classId = request.query.classId ?? null;
      return db.transaction(async q => {
        const { row, manager } = await load(q, campaignId, characterId, userId);
        const plan = levelUpPlan(row, false, classId);
        const context = await contextOf(q, campaignId, row);
        return {
          plan,
          milestone: manager && !plan ? levelUpPlan(row, true, classId) : null,
          name: row.name,
          scores: context.scores,
          proficientSkills: context.proficientSkills,
          expertiseSkills: context.expertiseSkills,
          knownSpells: context.knownSpells,
          swappableSpells: context.swappableSpells,
          fightingStyles: FIGHTING_STYLES,
          feats: FEATS.map(feat => ({
            id: feat.id, nameRu: feat.nameRu, en: feat.en, text: feat.text,
            abilities: FEAT_ABILITIES[feat.id] ?? null, known: context.knownFeats.includes(feat.id),
          })),
        };
      });
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string }; Body: LevelUpChoice & { milestone?: boolean; classId?: ClassId } }>(
    '/campaigns/:campaignId/characters/:characterId/level-up',
    {
      schema: {
        params,
        body: objectSchema({
          hp: { type: 'string', enum: ['average', 'roll'] },
          asi: {
            oneOf: [
              { type: 'null' },
              objectSchema({ kind: { type: 'string', enum: ['asi'] }, increases: objectSchema(Object.fromEntries(ABILITIES.map(ability => [ability, { type: 'integer', minimum: 0, maximum: 2 }])), []) }),
              objectSchema({
                kind: { type: 'string', enum: ['feat'] }, name: { type: 'string', minLength: 1, maxLength: 100 }, text: { type: 'string', maxLength: 2000 },
                id: { type: 'string', maxLength: 64 }, increase: { type: 'string', enum: ABILITIES },
              }, ['kind', 'name']),
            ],
          },
          subclass: { oneOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
          replace: { oneOf: [{ type: 'null' }, objectSchema({ from: { type: 'string', maxLength: 64 }, to: { type: 'string', maxLength: 64 } })] },
          cantrips: stringList,
          spells: stringList,
          expertise: stringList,
          skills: stringList,
          fightingStyle: { oneOf: [{ type: 'string', maxLength: 32 }, { type: 'null' }] },
          milestone: { type: 'boolean' },
          classId: { type: 'string', enum: CLASS_IDS },
        }, ['hp']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const choice = request.body;

      const result = await db.transaction(async q => {
        const { row, manager } = await load(q, campaignId, characterId, userId, true);
        if (choice.milestone && !manager) reject(403, 'Уровень по вехе, без опыта, даёт мастер.');
        const plan = levelUpPlan(row, choice.milestone === true, choice.classId ?? null);
        if (!plan) reject(400, 'Опыта на новый уровень пока не хватает.');
        if (plan.classProblem && plan.newClass) reject(400, `Сначала поправьте запись класса в листе: ${plan.classProblem}.`);
        const context = await contextOf(q, campaignId, row);
        const problems = levelUpProblems(plan, choice, context);
        if (problems.length) reject(400, problems.slice(0, 4).join(' '));

        let roll: number | null = null;
        if (choice.hp === 'roll') {
          roll = rollDie(plan.hitDie);
          await insertRoll(q, campaignId, userId, characterId, `Хиты за ${plan.to} уровень — ${row.name}`.slice(0, 100), `1d${plan.hitDie}`, [roll], 0, roll, false, null, { kind: 'levelHp' });
        }
        let hpGain = levelHp(plan, row.constitution, roll);
        const asi = choice.asi;
        const listedFeat = featOf(asi);
        const featName = asi?.kind === 'feat' ? listedFeat?.nameRu ?? asi.name.trim() : '';
        const toughNow = asi?.kind === 'feat' && (listedFeat ? listedFeat.id === 'tough' : FEATS.find(feat => feat.id === 'tough')!.pattern.test(featName));
        if (toughNow) hpGain += 2 * plan.to;
        else if (hasFeat(row.sheet_extra, 'tough')) hpGain += 2;

        let scores = context.scores;
        const increases = asi?.kind === 'asi' ? asi.increases : asi?.kind === 'feat' && asi.increase ? { [asi.increase]: 1 } : null;
        if (increases) scores = applyIncreases(scores, increases);
        const primal = plan.classId === 'barbarian' && plan.classLevel === 20;
        if (primal) scores = primalChampionScores(scores);
        hpGain += Math.max(0, abilityModifier(scores.constitution) - abilityModifier(row.constitution)) * plan.to;
        const subclass = plan.subclass && choice.subclass ? plan.subclass.options.find(option => option.value === choice.subclass) ?? null : null;
        const spellNames = new Map<string, string>();
        if (choice.replace) for (const index of [choice.replace.from, choice.replace.to]) spellNames.set(index, srdSpellName(index));

        const style = choice.fightingStyle ? FIGHTING_STYLES.find(entry => entry.id === choice.fightingStyle) : null;
        const lines = [
          ...(plan.newClass && plan.className ? [`Новый класс: ${plan.className} (мультикласс)`] : []),
          ...(subclass ? [`Подкласс: ${subclass.label}`] : []),
          ...plan.features.filter(feature => feature !== 'Улучшение характеристик' && feature !== 'Боевой стиль'),
          ...(subclass && plan.subclass && plan.classId
            ? subclass.value === plan.subclass.srd ? plan.subclass.srdFeatures
              : plan.subclass.srdFeatures.length ? [subclassFeatureNote(plan.classId, subclass.value, plan.classLevel)] : []
            : []),
          ...(asi?.kind === 'feat' ? [`Черта: ${featName}${asi.increase ? ` (${ABILITY_RU[asi.increase]} +1)` : ''}${asi.text?.trim() ? ` — ${asi.text.trim()}` : ''}`] : []),
          ...(asi?.kind === 'asi' ? [`Улучшение характеристик: ${Object.entries(asi.increases).filter(([, v]) => v).map(([a, v]) => `${ABILITY_RU[a as Ability]} +${v}`).join(', ')}`] : []),
          ...(style ? [`Боевой стиль: ${style.nameRu} — ${style.text}`] : []),
          ...(choice.replace ? [`Замена заклинания: ${spellNames.get(choice.replace.from)} → ${spellNames.get(choice.replace.to)}`] : []),
        ];
        const classText = subclass && plan.classId ? withSubclassText(plan.classText ?? row.class_name, plan.to, plan.classId, subclass.label) : plan.classText;
        const unarmored = unarmoredAfterLevel({
          ac: Number(row.armor_class),
          before: { classes: characterClassLevels(row).classes, scores: context.scores },
          after: { classes: characterClassLevels({ ...row, level: plan.to, class_name: classText ?? row.class_name }).classes, scores },
        });
        const extra = { ...(row.sheet_extra ?? {}) };
        if (subclass && plan.classId) extra.subclasses = { ...(extra.subclasses ?? {}), [plan.classId]: subclass.value };
        if (listedFeat && Array.isArray(extra.feats) && !extra.feats.includes(listedFeat.id)) extra.feats = [...extra.feats, listedFeat.id];
        const text = { ...(extra.text ?? {}) };
        const previous = text.levels && typeof text.levels === 'object' ? String(text.levels.value ?? '') : '';
        if (lines.length) {
          text.levels = { name: 'Умения по уровням', value: `${previous ? `${previous}\n\n` : ''}Уровень ${plan.to}${plan.multiclass && plan.className ? ` (${plan.className} ${plan.classLevel})` : ''}. ${lines.join('; ')}.` };
        }
        if (plan.multiclassGain && plan.className) {
          const prof = text.prof && typeof text.prof === 'object' ? String(text.prof.value ?? '') : '';
          const chosenSkills = (choice.skills ?? []).map(skill => srdSkills.find(entry => entry.index === skill)?.nameRu ?? skill);
          const gained = `Мультикласс — ${plan.className}: ${plan.multiclassGain.text}${chosenSkills.length ? `; навык: ${chosenSkills.join(', ')}` : ''}.`;
          text.prof = { name: 'Владения и языки', value: prof ? `${prof}\n${gained}` : gained };
        }
        extra.text = text;

        await q.query(
          `UPDATE characters SET level=$3, hp_max=hp_max+$4, hp_current = CASE WHEN hp_current > 0 THEN hp_current + $4 ELSE hp_current END,
             strength=$5, dexterity=$6, constitution=$7, intelligence=$8, wisdom=$9, charisma=$10,
             armor_class = armor_class + $11, sheet_extra=$12::jsonb, class_name=COALESCE($13, class_name), revision=revision+1
           WHERE campaign_id=$1 AND id=$2`,
          [campaignId, characterId, plan.to, hpGain, scores.strength, scores.dexterity, scores.constitution, scores.intelligence, scores.wisdom, scores.charisma,
            (unarmored !== null ? unarmored - Number(row.armor_class) : 0) + (style?.id === 'defense' ? 1 : 0), JSON.stringify(extra), classText],
        );

        for (const skill of choice.skills ?? []) {
          await q.query(
            `INSERT INTO character_skills (campaign_id, character_id, skill_index, proficient, expertise) VALUES ($1,$2,$3,true,false)
             ON CONFLICT (campaign_id, character_id, skill_index) DO UPDATE SET proficient=true`,
            [campaignId, characterId, skill],
          );
        }
        if (plan.multiclassGain && plan.classId) {
          const gainedClass = plan.classId;
          const weapons = (await q.query('SELECT id, name FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND NOT proficient', [campaignId, characterId])).rows;
          for (const weapon of weapons) {
            if (weaponGained(gainedClass, weapon.name)) await q.query('UPDATE character_weapons SET proficient=true WHERE id=$1', [weapon.id]);
          }
        }
        for (const skill of choice.expertise ?? []) {
          await q.query('UPDATE character_skills SET expertise=true WHERE campaign_id=$1 AND character_id=$2 AND skill_index=$3', [campaignId, characterId, skill]);
        }
        for (const index of choice.cantrips ?? []) {
          await q.query(`INSERT INTO character_spells (campaign_id, character_id, source, srd_index, prepared) VALUES ($1,$2,'srd',$3,true)`, [campaignId, characterId, index]);
        }
        for (const index of choice.spells ?? []) {
          await q.query(`INSERT INTO character_spells (campaign_id, character_id, source, srd_index, prepared) VALUES ($1,$2,'srd',$3,$4)`, [campaignId, characterId, index, plan.classId !== 'wizard']);
        }
        if (choice.replace) {
          await q.query(
            `DELETE FROM character_spells WHERE id = (SELECT id FROM character_spells WHERE campaign_id=$1 AND character_id=$2 AND srd_index=$3 AND NOT granted LIMIT 1)`,
            [campaignId, characterId, choice.replace.from],
          );
          await q.query(`INSERT INTO character_spells (campaign_id, character_id, source, srd_index, prepared) VALUES ($1,$2,'srd',$3,true)`, [campaignId, characterId, choice.replace.to]);
        }
        if (style?.id === 'archery') {
          await q.query(`UPDATE character_weapons SET attack_bonus = attack_bonus + 2 WHERE campaign_id=$1 AND character_id=$2 AND weapon_kind='ranged'`, [campaignId, characterId]);
        }
        if (style?.id === 'dueling') {
          await q.query(
            `UPDATE character_weapons SET damage_formula = damage_formula || '+2'
             WHERE campaign_id=$1 AND character_id=$2 AND weapon_kind='melee' AND damage_formula IS NOT NULL AND NOT (properties ? 'two-handed')`,
            [campaignId, characterId],
          );
        }

        const mods = { charisma: abilityModifier(scores.charisma) };
        const own = plan.classId ? classResources(plan.classId, plan.classLevel, mods).map(rule => rule.name) : [];
        const resources = mergedClassResources(characterClassLevels({ ...row, level: plan.to, class_name: classText ?? row.class_name, sheet_extra: extra }).classes, mods)
          .filter(rule => own.includes(rule.name));
        for (const resource of resources) {
          const existing = (await q.query('SELECT id, current, max FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3', [campaignId, characterId, resource.name])).rows[0];
          if (existing) {
            await q.query('UPDATE character_resources SET max=$2, current=LEAST($2, current + GREATEST(0, $2 - max)), recharge=$3 WHERE id=$1', [existing.id, resource.max, resource.recharge]);
          } else {
            await q.query('INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,$3,$4,$4,$5)', [campaignId, characterId, resource.name, resource.max, resource.recharge]);
          }
        }
        const slots = await applyClassSlots(q, campaignId, characterId);
        return {
          name: row.name as string, level: plan.to, className: classText, hpGain, roll, features: lines, slotsUpdated: Boolean(slots?.slots),
          ...(unarmored !== null ? { armorClass: unarmored + (style?.id === 'defense' ? 1 : 0) } : {}),
          next: levelUpPlan({ ...row, level: plan.to, class_name: classText ?? row.class_name, sheet_extra: extra }),
        };
      });

      void notifyCampaign(campaignId, { type: 'character', characterId });
      void notifyCampaign(campaignId, { type: 'characters' });
      void notifyCampaign(campaignId, { type: 'changed' });
      if (result.roll !== null) void notifyCampaign(campaignId, { type: 'rolls' });
      void notifyCampaign(campaignId, { type: 'float', characterId, text: `Уровень ${result.level}!`, tone: 'xp' });
      return reply.code(201).send(result);
    },
  );
}

const ABILITY_RU: Record<Ability, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение', intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};
