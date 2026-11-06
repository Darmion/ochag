import { loadEffects } from '../conditions.ts';
import { uuid } from '../../tabletop/scene-feature.ts';
import { CLASS_LABELS, SUBCLASSES } from '../../../../../packages/domain/character/classes.ts';
import { classFeaturesFor, unarmoredDefense, hasProtectionStyle, PROTECTION_STYLE } from '../../../../../packages/domain/character/class-features.ts';
import { characterRace, raceTraits, dragonAncestry, breathWeaponDice, INFERNAL_LEGACY } from '../../../../../packages/domain/character/races.ts';
import { knownFeats, FEATS, knownFightingStyles, STYLE_PATTERNS } from '../../../../../packages/domain/character/feats.ts';
import { proficiencyBonusForLevel, abilityModifier } from '../../../../../packages/domain/dice/dice.ts';
import { conditionState, incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';
import { DRAGON_ANCESTRIES } from '../../../../../packages/domain/srd/heroes.ts';

import { ANCESTRY_DAMAGE_RU, type ClassFeatureContext, RECHARGE_TEXT } from '../class-features.ts';
import { characterParams, entryOf, loadActor, resourceOf } from './helpers.ts';
import { FEATURE_VIEWS } from './classes/index.ts';


export function registerFeatureListRoutes(ctx: ClassFeatureContext) {
  const { app, auth, db } = ctx;

  app.get<{ Params: { campaignId: string; characterId: string }; Querystring: { sceneId?: string } }>(
    '/campaigns/:campaignId/characters/:characterId/features',
    { schema: { params: characterParams, querystring: { type: 'object', additionalProperties: false, properties: { sceneId: uuid } } } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      return db.transaction(async q => {
        const { row, classId, classes } = await loadActor(ctx, q, campaignId, characterId, userId);
        const list = classFeaturesFor(classes);
        const effects = await loadEffects(q, campaignId, characterId);
        const state = conditionState(effects.map(effect => effect.effect_code));
        const rage = effects.find(effect => effect.effect_code === 'raging');
        const entry = await entryOf(q, campaignId, characterId, request.query.sceneId);
        const unable = incapacitatedReason(state);
        const bonusReason = !entry ? null : !entry.is_current ? 'не ваш ход' : entry.bonus_used ? 'бонусное действие уже потрачено' : null;
        const actionReason = !entry ? null : !entry.is_current ? 'не ваш ход' : entry.action_used ? 'действие уже потрачено' : null;
        const unarmored = unarmoredDefense(classes, row);

        const features = [];
        const wildShape = effects.find(effect => effect.effect_code === 'wild_shape');
        const all = hasProtectionStyle(row.sheet_extra) ? [...list, PROTECTION_STYLE] : list;
        const look = { ctx, q, campaignId, characterId, request, row, classes, state, rage, wildShape, effects, entry, unable, bonusReason, actionReason, unarmored };
        for (const feature of all) {
          let choices: Array<{ value: string; label: string; active?: boolean; count?: number; hint?: string }> | null = null;
          let limit: number | null = null;
          const ready = feature.id === 'combat-superiority' ? (row.auto_reactions ?? []).filter((entry: string) => entry === 'parry' || entry === 'riposte') : null;
          const resource = feature.resource ? await resourceOf(q, campaignId, row, feature.resource, false)
            : feature.id === 'relentless-rage' ? await resourceOf(q, campaignId, row, 'Непреклонная ярость', false) : null;
          const empty = resource && resource.current <= 0 ? `потрачено — до ${RECHARGE_TEXT[resource.recharge] ?? 'долгого'} отдыха` : null;
          let reason: string | null = null;
          let detail = '';
          let active = false;
          const view = FEATURE_VIEWS[feature.id];
          if (view) {
            const shown = await view({ ...look, feature, resource, empty });
            detail = shown.detail ?? detail;
            reason = shown.reason ?? reason;
            active = shown.active ?? active;
            choices = shown.choices ?? choices;
            limit = shown.limit ?? limit;
          }
          features.push({
            id: feature.id, name: feature.name, text: feature.text, use: feature.use, detail, active,
            resource: resource ? { name: resource.name, current: resource.current, max: resource.max } : null,
            available: reason === null, reason, ...(choices ? { choices } : {}), ...(limit !== null ? { limit } : {}), ...(ready ? { ready } : {}),
          });
        }
        const race = characterRace(row);
        for (const trait of raceTraits(race)) {
          let detail = '';
          let traitResource: { name: string; current: number; max: number } | null = null;
          let use: 'action' | 'passive' = 'passive';
          let reason: string | null = null;
          let choices: Array<{ value: string; label: string; active?: boolean }> | undefined;
          let legacy: Array<{ index: string; name: string; minLevel: number; castAt: number; open: boolean; entryId: string | null; charge: { current: number; max: number } | null }> | undefined;
          const ancestry = dragonAncestry(row);
          if (trait.id === 'breath-weapon') {
            use = 'action';
            const kept = (await q.query(`SELECT current, max FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name='Оружие дыхания'`, [campaignId, characterId])).rows[0] as any;
            traitResource = { name: 'Оружие дыхания', current: kept ? Number(kept.current) : 1, max: kept ? Number(kept.max) : 1 };
            choices = DRAGON_ANCESTRIES.map(item => ({ value: item.id, label: `${item.nameRu} (${ANCESTRY_DAMAGE_RU[item.damage] ?? item.damage}, ${item.breath})`, ...(ancestry?.id === item.id ? { active: true } : {}) }));
            const dc = 8 + abilityModifier(Number(row.constitution ?? 10)) + proficiencyBonusForLevel(Math.max(1, row.level ?? 1));
            detail = ancestry
              ? `${ancestry.breath}, ${ANCESTRY_DAMAGE_RU[ancestry.damage] ?? ancestry.damage}, ${breathWeaponDice(row.level)}d6, СЛ ${dc} ${ancestry.save === 'dexterity' ? 'ЛОВ' : 'ТЕЛ'} — в сторону выбранной цели`
              : 'выберите дракона-предка';
            reason = unable ?? (ancestry ? null : 'предок не выбран') ?? (traitResource.current > 0 ? null : 'потрачено — до короткого отдыха') ?? actionReason;
          } else if (trait.id === 'draconic-resistance') {
            detail = ancestry ? `сопротивление: ${ANCESTRY_DAMAGE_RU[ancestry.damage] ?? ancestry.damage}` : 'предок не выбран';
          } else if (trait.id === 'hellish-resistance') {
            detail = 'сопротивление огню';
          } else if (trait.id === 'infernal-legacy') {
            const entries = (
              await q.query(`SELECT id, srd_index FROM character_spells WHERE campaign_id=$1 AND character_id=$2 AND source='srd' AND srd_index = ANY($3::text[])`, [campaignId, characterId, INFERNAL_LEGACY.map(spell => spell.index)])
            ).rows as Array<{ id: string; srd_index: string }>;
            legacy = [];
            for (const spell of INFERNAL_LEGACY) {
              const kept = spell.resource
                ? (await q.query(`SELECT current, max FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3`, [campaignId, characterId, spell.resource])).rows[0] as any
                : null;
              legacy.push({
                index: spell.index, name: spell.nameRu, minLevel: spell.minLevel, castAt: spell.castAt, open: (row.level ?? 1) >= spell.minLevel,
                entryId: entries.find(entry => entry.srd_index === spell.index)?.id ?? null,
                charge: spell.resource ? { current: kept ? Number(kept.current) : 1, max: kept ? Number(kept.max) : 1 } : null,
              });
            }
            detail = legacy.filter(spell => spell.open).map(spell => `${spell.name}${spell.charge ? ` ${spell.charge.current}/${spell.charge.max}` : ''}`).join(', ');
          } else if (trait.id === 'dwarven-resilience') {
            detail = 'сопротивление яду';
          }
          if (trait.id === 'relentless-endurance') {
            const kept = (await q.query(`SELECT current, max FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name='Непоколебимость'`, [campaignId, characterId])).rows[0] as any;
            traitResource = { name: 'Непоколебимость', current: kept ? Number(kept.current) : 1, max: kept ? Number(kept.max) : 1 };
            detail = traitResource.current > 0 ? 'наготове' : 'потрачено — до долгого отдыха';
          }
          features.push({
            id: trait.id, name: `Раса: ${trait.name}`, text: trait.text, use, detail, active: false,
            resource: traitResource, available: reason === null, reason, ...(choices ? { choices } : {}), ...(legacy ? { legacy } : {}),
          });
        }
        const feats = knownFeats(row.sheet_extra);
        if (row.kind === 'character' || feats.length) {
          features.push({
            id: 'feats', name: 'Черты', text: 'Черты, которые считает автоматика. Отмеченное — сильнее текста листа.', use: 'passive' as const,
            detail: feats.length ? FEATS.filter(feat => feats.includes(feat.id)).map(feat => feat.nameRu).join(', ') : 'не отмечены', active: false,
            resource: null, available: true, reason: null,
            choices: FEATS.map(feat => ({ value: feat.id, label: feat.nameRu, hint: feat.en, ...(feats.includes(feat.id) ? { active: true } : {}) })),
            ready: (row.auto_reactions ?? []).filter((entry: string) => entry === 'lucky'),
          });
        }
        const styles = knownFightingStyles(row.sheet_extra);
        const styleClass = classes.some(entry => entry.id === 'fighter' || ((entry.id === 'paladin' || entry.id === 'ranger') && entry.level >= 2));
        if (styleClass || styles.ids.length) {
          features.push({
            id: 'fighting-styles', name: 'Боевые стили',
            text: '«Стрельба», «Дуэлянт», «Сражение большим оружием», «Сражение двумя оружиями» — в атаке сами; «Защита» — реакцией. Из мастера создания «Стрельба» и «Дуэлянт» уже в оружии.',
            use: 'passive' as const,
            detail: styles.ids.length ? STYLE_PATTERNS.filter(style => styles.ids.includes(style.id)).map(style => style.nameRu).join(', ') : 'не отмечены', active: false,
            resource: null, available: true, reason: null,
            choices: STYLE_PATTERNS.map(style => ({ value: style.id, label: style.nameRu, ...(styles.ids.includes(style.id) ? { active: true } : {}) })),
          });
        }
        const subclasses = classes.flatMap(item => {
          const rule = SUBCLASSES[item.id];
          if (!rule || item.level < rule.level) return [];
          return [{ classId: item.id, className: CLASS_LABELS[item.id], value: item.subclass ?? rule.default, options: rule.list.map(option => ({ value: option.id, label: option.nameRu })) }];
        });
        return { classId, className: classId ? CLASS_LABELS[classId] : null, level: row.level, inCombat: Boolean(entry), features, subclasses };
      });
    },
  );
}
