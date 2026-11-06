import type { FastifyPluginAsync } from 'fastify';

import { registerDrawingRoutes } from './scene/scene-drawings.ts';
import { registerPinRoutes } from './scene/scene-pins.ts';
import { registerAudioRoutes } from '../campaign/audio-routes.ts';
import { registerEncounterRoutes } from '../campaign/encounter-routes.ts';
import { registerBestiaryRoutes } from '../campaign/bestiary-routes.ts';
import { registerDifficultyRoutes } from '../campaign/difficulty-routes.ts';
import { registerRollTableRoutes } from '../campaign/roll-table-routes.ts';
import { registerHeroRoutes } from '../characters/hero-routes.ts';
import { registerLevelUpRoutes } from '../characters/level-up-routes.ts';
import { registerClassFeatureRoutes } from '../rules/class-features.ts';
import { registerMagicItemRoutes } from '../characters/magic-items.ts';
import { registerInventoryRoutes } from '../characters/inventory-routes.ts';
import { registerObjectStateRoutes } from './scene/object-states.ts';
import { registerRestRoutes } from '../characters/rest-routes.ts';
import { createExperience, registerExperienceRoutes } from '../characters/experience.ts';
import { registerLootRoutes } from './combat/loot-routes.ts';
import { registerInspirationRoutes } from '../characters/inspiration-routes.ts';
import { registerQuestRoutes } from '../campaign/quest-routes.ts';
import { createActionEconomy } from '../rules/action-economy.ts';
import { registerFactionRoutes } from '../campaign/factions.ts';
import { registerCounterRoutes } from './scene/scene-counters.ts';
import { registerTemplateRoutes } from './scene/scene-templates.ts';
import { createTriggerEngine } from './scene/scene-triggers.ts';
import { addCondition, setFallHandler, setConditionGuard } from '../rules/conditions.ts';
import { createConditionEngine } from '../rules/condition-engine.ts';
import { registerConditionRoutes } from '../rules/condition-routes.ts';
import { registerWorldTimeRoutes } from '../campaign/world-time.ts';
import { registerHandoutRoutes } from '../campaign/handout-routes.ts';
import { registerArtRoutes } from '../campaign/art-routes.ts';
import { registerDialogueRoutes } from '../campaign/dialogue-routes.ts';
import { registerChatRoutes } from '../campaign/chat-routes.ts';
import { registerShopRoutes } from '../characters/shop-routes.ts';
import { registerChronicleRoutes } from '../campaign/chronicle-routes.ts';

import { legendaryStrike } from './auto-turn/legendary.ts';
import { averageDamage } from './auto-turn/planner.ts';
import { unarmedStrike } from './combat/attack.ts';
import { courageAura, devotionAura } from './combat/auras.ts';
import { areaCoverBonus, areaCovers } from './combat/cover.ts';
import { announceHpChange, applyHpChange } from './combat/hp.ts';
import { sharedScene } from './combat/reactions.ts';
import { withTable } from './context.ts';
import { notify, notifyCampaign, notifyManagers, notifyUsers } from './live/notify.ts';
import { rollCheckFor, rollSaveAgainst, rollSkill } from './rolls/checks.ts';
import { campaignFlag, insertRoll, rollDie } from './rolls/dice.ts';
import { rollCheckAs } from './rolls/roll-check.ts';
import { feetBetween, getScene } from './scene/board.ts';
import { pushAway, spendStandUp, withinFeet, withinFeetDistance } from './scene/movement.ts';
import { canManageCharacter, detachChildren, loadPlacements, rightsOf } from './scene/placements.ts';
import { canManage, reject, type Subscription } from './shared.ts';
import type { CounterWindow } from './spells/counterspell.ts';
import { creatureTypeOf } from './spells/rules.ts';
import type { Options } from './shared.ts';
import { type TableContext } from './context.ts';
import { registerLiveRoutes } from './live/socket.ts';
import { registerSceneRoutes } from './scene/routes.ts';
import { registerWallRoutes } from './scene/walls.ts';
import { registerObjectRoutes } from './scene/objects.ts';
import { registerRollRoutes } from './rolls/routes.ts';
import { registerStealthRoutes } from './combat/stealth.ts';
import { registerInitiativeRoutes } from './combat/initiative.ts';
import { registerTurnRoutes } from './combat/turn.ts';
import { registerTurnActionRoutes } from './combat/turn-actions.ts';
import { registerCombatEndRoutes } from './combat/combat-end.ts';
import { registerCombatActionRoutes } from './combat/actions.ts';
import { registerCastRoutes } from './spells/cast.ts';
import { registerCounterspellRoutes } from './spells/counterspell.ts';
import { registerAutoTurnRoutes } from './auto-turn/routes.ts';
import { registerModRoutes } from '../system/mods.ts';

export const tabletopRoutes: FastifyPluginAsync<Options> =
async (app, options) => {
  const { db, auth, membership, presence } = options;
  const subscriptions = new Set<Subscription>();
  const reactionWindowMs = options.reactionWindowMs ?? 20_000;
  const counterWindows = new Map<string, CounterWindow>();

  const ctx = { app, db, auth, membership, presence, subscriptions, counterWindows, reactionWindowMs } as TableContext;

  const stopEvents = options.events?.listen((campaignId, event) => { void notifyCampaign(ctx, campaignId, event); });
  app.addHook('onClose', async () => { stopEvents?.(); });

  const feature = { app, db, auth, membership, canManage, getScene, notify: withTable(ctx, notify), notifyCampaign: withTable(ctx, notifyCampaign), notifyUsers: withTable(ctx, notifyUsers) };
  registerDrawingRoutes(feature);
  registerPinRoutes(feature);
  registerAudioRoutes(feature);
  registerCounterRoutes(feature);
  registerWorldTimeRoutes(feature);
  registerHandoutRoutes(feature);
  registerArtRoutes(feature);
  registerChronicleRoutes(feature);
  registerRollTableRoutes({ ...feature, rollDie, insertRoll });
  registerHeroRoutes({ ...feature, rollDie, insertRoll });
  registerLevelUpRoutes({
    ...feature, rollDie, insertRoll, canManageCharacter,
    isCharacterManager: async (q, member, userId) => (await rightsOf(q, member, userId)).characterManager,
  });
  registerShopRoutes({
    ...feature,
    canActAs: async (q, member, userId, characterId) => {
      const owner = (await q.query('SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [member.campaign_id, characterId])).rows[0];
      return Boolean(owner) && canManageCharacter(q, member, userId, owner.owner_user_id, characterId);
    },
  });
  registerChatRoutes({
    ...feature,
    canActAs: async (q, member, userId, characterId) => {
      const owner = (await q.query('SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [member.campaign_id, characterId])).rows[0];
      return Boolean(owner) && canManageCharacter(q, member, userId, owner.owner_user_id, characterId);
    },
  });
  registerDialogueRoutes({
    ...feature,
    rollSkillCheck: async (q, campaignId, userId, characterId, skill, label, dc) => {
      const rolled = await rollCheckFor(ctx, q, campaignId, userId, characterId, 'skill', skill, label, false, true, dc);
      return { total: rolled.total, success: rolled.success === true, roll: rolled.roll };
    },
    canActAs: async (q, member, userId, characterId) => {
      const owner = (await q.query('SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [member.campaign_id, characterId])).rows[0];
      return Boolean(owner) && canManageCharacter(q, member, userId, owner.owner_user_id, characterId);
    },
  });
  registerInventoryRoutes({ ...feature, rightsOf, loadPlacements, detachChildren });
  registerObjectStateRoutes({
    ...feature, rightsOf, rollSkill,
    canActAs: async (q, member, userId, characterId) => {
      const owner = (await q.query('SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [member.campaign_id, characterId])).rows[0];
      return Boolean(owner) && canManageCharacter(q, member, userId, owner.owner_user_id, characterId);
    },
    fireOpen: (q, campaignId, userId, objectId, actor) => triggers.fireOpen(q, campaignId, userId, objectId, actor),
    sendNotices: (campaignId, notices) => triggers.send(campaignId, notices),
  });
  registerTemplateRoutes({ ...feature, loadPlacements, rollSaveAgainst: withTable(ctx, rollSaveAgainst), addCondition, areaCovers, areaCoverBonus });
  const conditionContext = { ...feature, insertRoll, rollDie, canManageCharacter, rollSaveAgainst: withTable(ctx, rollSaveAgainst) };
  const conditionEngine = createConditionEngine(conditionContext);
  registerConditionRoutes({ ...conditionContext, engine: conditionEngine, spendStandUp: withTable(ctx, spendStandUp) });
  registerRestRoutes({ ...feature, insertRoll, rollDie, canManageCharacter, applyHpChange: withTable(ctx, applyHpChange), announceHpChange: withTable(ctx, announceHpChange), campaignFlag });
  const experience = createExperience({ campaignFlag });
  const actionEconomy = createActionEconomy({ campaignFlag });
  registerExperienceRoutes({
    ...feature, experience,
    isCharacterManager: async (q, member, userId) => (await rightsOf(q, member, userId)).characterManager,
  });
  registerQuestRoutes({
    ...feature, experience,
    isCharacterManager: async (q, member, userId) => (await rightsOf(q, member, userId)).characterManager,
  });
  registerLootRoutes({ ...feature, rightsOf, withinFeet });
  registerFactionRoutes(feature);
  registerInspirationRoutes({
    ...feature, canManageCharacter,
    isCharacterManager: async (q, member, userId) => (await rightsOf(q, member, userId)).characterManager,
  });

  setFallHandler(async (q, campaignId, characterId, feet) => {
    const owner = (await q.query('SELECT owner_user_id FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.owner_user_id as string;
    const fell = await featureApi.fall(q, campaignId, owner, characterId, feet, false);
    if (fell?.change) announceHpChange(ctx, campaignId, characterId, 'damage', fell.change);
  });
  const triggers = createTriggerEngine({
    ...feature, rollCheckFor: withTable(ctx, rollCheckFor), insertRoll, rollDie, notifyManagers: withTable(ctx, notifyManagers),
    hpChange: (q, campaignId, userId, characterId, change) => applyHpChange(ctx, q, campaignId, userId, characterId, change),
    fall: (q, campaignId, userId, characterId, feet, hidden) => featureApi.fall(q, campaignId, userId, characterId, feet, hidden),
  });
  registerEncounterRoutes({
    ...feature,
    loadPlacements,
    isCharacterManager: async (q, member, userId) => (await rightsOf(q, member, userId)).characterManager,
  });
  registerBestiaryRoutes({
    ...feature,
    loadPlacements,
    rollDie,
    isCharacterManager: async (q, member, userId) => (await rightsOf(q, member, userId)).characterManager,
  });
  registerDifficultyRoutes({
    ...feature,
    loadPlacements,
    isCharacterManager: async (q, member, userId) => (await rightsOf(q, member, userId)).characterManager,
  });
  registerMagicItemRoutes({
    ...feature, rollDie, insertRoll, canManageCharacter,
    isCharacterManager: async (q, member, userId) => (await rightsOf(q, member, userId)).characterManager,
  });
  const featureApi = registerClassFeatureRoutes({
    ...feature, rollDie, insertRoll, canManageCharacter, actionEconomy, applyHpChange: withTable(ctx, applyHpChange), announceHpChange: withTable(ctx, announceHpChange), campaignFlag,
    isCharacterManager: async (q, member, userId) => (await rightsOf(q, member, userId)).characterManager,
    legendaryStrike: (campaignId, sceneId, bossId, option, preferred) => legendaryStrike(ctx, campaignId, sceneId, bossId, option, preferred),
    creaturesNear: async (q, campaignId, sceneId, characterId, feet) => {
      const scene = await getScene(q, campaignId, sceneId, false);
      const placements = await loadPlacements(q, campaignId, sceneId);
      const self = placements.find(entry => entry.character_id === characterId && !entry.parent_object_id);
      if (!self) return [];
      return placements
        .filter(entry => !entry.parent_object_id && entry.kind !== 'object' && entry.character_id !== characterId && feetBetween(scene, self, entry) <= feet)
        .map(entry => ({ id: entry.character_id, name: entry.name }));
    },
    feetApart: async (q, campaignId, sceneId, a, b) => {
      const where = sceneId ?? await sharedScene(q, campaignId, a, b);
      if (!where) return null;
      const scene = await getScene(q, campaignId, where, false);
      const placements = await loadPlacements(q, campaignId, where);
      const first = placements.find(entry => entry.character_id === a && !entry.parent_object_id);
      const second = placements.find(entry => entry.character_id === b && !entry.parent_object_id);
      return first && second ? feetBetween(scene, first, second) : null;
    },
    isUndead: async (q, campaignId, characterId) => (await creatureTypeOf(q, campaignId, characterId)) === 'undead',
    creatureType: (q, campaignId, characterId) => creatureTypeOf(q, campaignId, characterId),
    unarmedStrike: (campaignId, sceneId, characterId, targetId, userId, die) => unarmedStrike(ctx, campaignId, sceneId, characterId, targetId, userId, die),
    rollSaveAgainst: (q, campaignId, userId, characterId, ability, dc, label, hidden, against) => rollSaveAgainst(ctx, q, campaignId, userId, characterId, ability, dc, label, hidden, null, [], against ?? null),
    pushAway: (q, campaignId, sceneId, fromId, targetId, feet) => pushAway(q, campaignId, sceneId, fromId, targetId, feet),
    weaponAttack: async (campaignId, sceneId, characterId, weaponId, targetId, userId) => {
      let key = weaponId;
      if (!key) {
        const weapons = (
          await db.query(`SELECT id, damage_formula, range_feet FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND weapon_kind IS DISTINCT FROM 'ranged'`, [campaignId, characterId])
        ).rows as any[];
        const feet = sceneId ? await withinFeetDistance(ctx, campaignId, sceneId, characterId, targetId) : null;
        key = weapons.filter(item => feet === null || Number(item.range_feet ?? 5) >= feet)
          .sort((a, b) => averageDamage(b.damage_formula) - averageDamage(a.damage_formula))[0]?.id ?? null;
      }
      if (!key) reject(400, 'Нечем бить: нет рукопашного оружия, что достаёт.');
      return rollCheckAs(ctx, userId, campaignId, { characterId, kind: 'attack', key, targetCharacterId: targetId, ...(sceneId ? { sceneId } : {}) }, { free: true });
    },
  });
  setConditionGuard(async (q, campaignId, characterId, code) => (
    code === 'charmed' ? devotionAura(q, campaignId, characterId) : code === 'frightened' ? courageAura(q, campaignId, characterId) : null
  ));

  Object.assign(ctx, { feature, conditionEngine, experience, actionEconomy, triggers, featureApi });

  registerLiveRoutes(ctx);
  registerSceneRoutes(ctx);
  registerWallRoutes(ctx);
  registerObjectRoutes(ctx);
  registerRollRoutes(ctx);
  registerStealthRoutes(ctx);
  registerInitiativeRoutes(ctx);
  registerTurnRoutes(ctx);
  registerTurnActionRoutes(ctx);
  registerCombatEndRoutes(ctx);
  registerCombatActionRoutes(ctx);
  registerCastRoutes(ctx);
  registerCounterspellRoutes(ctx);
  registerAutoTurnRoutes(ctx);

  registerModRoutes(ctx, options.mods);
};
