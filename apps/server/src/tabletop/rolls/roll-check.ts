import { smiteOffer, stunOffer, maneuverOffer, quiveringOffer, hurlOffer } from '../../rules/class-features.ts';
import type { ActionUse } from '../../rules/action-economy.ts';
import { type Advantage } from '../../../../../packages/domain/dice/dice.ts';

import { announceHpChange } from '../combat/hp.ts';
import { type Opportunity, reactionAttackers, settleOpportunities, takeOpportunity } from '../combat/opportunity.ts';
import { offerRebukes, tryRetaliation, tryRiposte, tryStandAgainstTide } from '../combat/reactions.ts';
import { announceVisible, breakInvisibility } from '../combat/sight.ts';
import { announceRevealed } from '../combat/stealth.ts';
import type { TableContext } from '../context.ts';
import { notifyCampaign } from '../live/notify.ts';
import { insertRoll } from './dice.ts';
import { type CheckKind, d20Formula, rulingOutcome } from './modifiers.ts';
import { reject } from '../shared.ts';
import { prepareCheck } from './check-prepare.ts';
import { rollD20 } from './check-roll.ts';
import { applyHitDamage, resolveHit, type CheckRun } from './check-hit.ts';

export type CheckBody = {
  characterId: string;
  kind: CheckKind;
  key: string;
  advantage?: Advantage;
  bonusFormula?: string;
  hidden?: boolean;
  targetCharacterId?: string;
  sceneId?: string;
  inspiration?: boolean;
  warnFriendly?: boolean;
  using?: ActionUse;
  twoHanded?: boolean;
  opportunity?: boolean;
  sense?: 'sight' | 'hearing';
  bardic?: boolean;
  precision?: boolean;
  power?: boolean;
  lucky?: boolean;
  strokeOfLuck?: boolean;
  peerless?: boolean;
};

export type CheckInternal = { free?: boolean; riposte?: boolean; tide?: boolean; reacted?: boolean };
export async function rollCheckAs(ctx: TableContext, userId: string, campaignId: string, body: CheckBody, internal: CheckInternal = {}) {
  const { db, membership } = ctx;
  const { characterId, kind, key, hidden, targetCharacterId, sceneId, inspiration, opportunity, sense } = body;
  if (sense && kind !== 'skill' && kind !== 'ability') reject(400, 'Зрением или слухом бывает проверка навыка или характеристики.');
  let opportunityEntry: Opportunity | undefined;
  if (opportunity) {
    if (kind !== 'attack' || !targetCharacterId || !sceneId) reject(400, 'Атака при уходе — это атака по цели на сцене.');
  }
  const using = opportunity ? 'reaction' as const : body.using;
  if (targetCharacterId && kind !== 'attack') reject(400, 'Цель бывает только у атаки.');
  if (using && kind !== 'attack') reject(400, 'Действие тратит атака, а не проверка или спасбросок.');
  let economyScene: string | null = null;
  let ammoSpent = false;
  let extraGuard: { id: string; name: string } | null = null;
  let deflected: { name: string; value: number; id: string } | null = null;
  let dodged: { name: string; id: string } | null = null;
  let parried: { name: string; value: number; id: string } | null = null;
  let cutWords: { name: string; value: number; id: string } | null = null;
  let riposteFrom: string | null = null;
  let tideFrom: string | null = null;
  const blessings: Array<{ characterId: string; name: string; value: number }> = [];
  let revealed = false;
  let becameVisible: string | null = null;

  const result = await db.transaction(async q => {
    const member = await membership(q, campaignId, userId, true);
    if (opportunity) {
      opportunityEntry = await takeOpportunity(q, campaignId, sceneId!, characterId, targetCharacterId!);
      if (!opportunityEntry) reject(400, 'Атаки при уходе нет: цель не уходила из досягаемости в этот ход.');
    }
    const prep = await prepareCheck(ctx, q, member, userId, campaignId, body, internal, using, opportunityEntry);
    economyScene = prep.economyScene;
    ammoSpent = prep.ammoSpent;
    extraGuard = prep.extraGuard;
    if (prep.done) return prep.done;
    const {
      character, label, target,
    } = prep;
    let { modifier } = prep;
    const roll = await rollD20(ctx, q, campaignId, body, prep);
    modifier = roll.modifier;
    revealed = roll.revealed;
    const {
      ruling, riders, extra, attackWeapon, melee,
    } = roll;
    let { results, kept, total } = roll;
    let hitResult: { hit: boolean; critical: boolean } | null = null;
    let sneak: { dice: number; reason: string } | null = null;
    const run: CheckRun = { ctx, q, member, userId, campaignId, body, internal, using, opportunityEntry, prep, roll };
    if (target) {
      ({ hitResult, kept, total, results, cutWords, riposteFrom, tideFrom, sneak } = await resolveHit(run, { hitResult, kept, total, modifier, results, cutWords, riposteFrom, tideFrom, sneak }));
    }

    const attackRow = await insertRoll(
      q, campaignId, userId, characterId, target ? `${label} → ${target.name}`.slice(0, 100) : label,
      `${d20Formula(modifier, ruling.advantage)}${riders.formula}`.slice(0, 20), results, modifier, total, hidden ?? false, null,
      rulingOutcome(kind, ruling, extra),
    );

    let damage: any = null;
    let extraDamage: any = null;
    let divineDamage: any = null;
    let improvedSmite: any = null;
    let damageMissing: string | null = null;
    if (target && hitResult?.hit) {
      ({ damageMissing, dodged, deflected, parried, damage, extraDamage, divineDamage, improvedSmite } = await applyHitDamage(run, { damageMissing, hitResult, blessings, sneak, dodged, deflected, parried, damage, extraDamage, divineDamage, improvedSmite }));
    }

    const smite = target && hitResult?.hit && melee ? await smiteOffer(q, campaignId, character as any) : null;
    const stun = target && hitResult?.hit && melee ? await stunOffer(q, campaignId, character as any, target.id) : null;
    const maneuver = target && hitResult?.hit && kind === 'attack' ? await maneuverOffer(q, campaignId, character as any) : null;
    const quivering = target && hitResult?.hit && melee ? await quiveringOffer(q, campaignId, character as any, attackWeapon?.name === 'Безоружный удар') : null;
    const hurl = target && hitResult?.hit && kind === 'attack' ? await hurlOffer(q, campaignId, character as any) : null;
    if (kind === 'attack' && (await breakInvisibility(q, campaignId, characterId))) becameVisible = character.name;
    return {
      ...attackRow, damage, extraDamage, ...(damageMissing ? { damageMissing } : {}), ...(divineDamage ? { divineDamage } : {}), ...(improvedSmite ? { improvedSmite } : {}), ...(smite ? { smite: { rollId: attackRow.id, targetName: target!.name, ...smite } } : {}),
      ...(stun ? { stun: { rollId: attackRow.id, targetName: target!.name, ...stun } } : {}),
      ...(maneuver ? { maneuver: { rollId: attackRow.id, targetName: target!.name, ...maneuver } } : {}),
      ...(quivering ? { quivering: { rollId: attackRow.id, targetName: target!.name, ...quivering } } : {}),
      ...(hurl ? { hurl: { rollId: attackRow.id, targetName: target!.name, ...hurl } } : {}),
      ...(deflected ? { deflected: { name: (deflected as { name: string }).name, value: (deflected as { value: number }).value } } : {}),
      ...(dodged ? { uncannyDodge: { name: (dodged as { name: string }).name } } : {}),
      ...(parried ? { parried: { name: (parried as { name: string }).name, value: (parried as { value: number }).value } } : {}),
      ...(blessings.length ? { blessing: blessings[0] } : {}),
    };
  });

  void notifyCampaign(ctx, campaignId, { type: 'rolls' });
  if (economyScene) void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId: economyScene });
  if (dodged) {
    const who = dodged as { name: string; id: string };
    if (sceneId) void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
    void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${who.name}: «Невероятное уклонение»`, detail: 'Реакцией — урон этой атаки вдвое меньше.', tone: 'info' });
  }
  if (deflected) {
    const shot = deflected as { name: string; value: number; id: string };
    if (sceneId) void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
    void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${shot.name}: «Отражение снарядов»`, detail: `Реакцией — урон меньше на ${shot.value}.`, tone: 'info' });
    void notifyCampaign(ctx, campaignId, { type: 'float', characterId: shot.id, text: `отражено ${shot.value}`, tone: 'info' });
  }
  if (extraGuard && sceneId) {
    void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
    void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${(extraGuard as { name: string }).name}: «Защита»`, detail: 'Реакцией — помеха атаке по союзнику рядом.', tone: 'info' });
  }
  if (parried) {
    const who = parried as { name: string; value: number; id: string };
    if (sceneId) void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
    void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${who.name}: «Парирование»`, detail: `Реакцией — урон меньше на ${who.value}.`, tone: 'info' });
    void notifyCampaign(ctx, campaignId, { type: 'float', characterId: who.id, text: `парировано ${who.value}`, tone: 'info' });
  }
  if (cutWords) {
    const who = cutWords as { name: string; value: number; id: string };
    if (sceneId) void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
    void notifyCampaign(ctx, campaignId, { type: 'character', characterId: who.id });
    void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${who.name}: «Острое словцо»`, detail: `Реакцией — −${who.value} к броску атаки.`, tone: 'info' });
  }
  for (const blessing of blessings) {
    void notifyCampaign(ctx, campaignId, { type: 'character', characterId: blessing.characterId });
    void notifyCampaign(ctx, campaignId, { type: 'float', characterId: blessing.characterId, text: `+${blessing.value} врем. хитов`, tone: 'info' });
  }
  if (riposteFrom && sceneId) {
    const answer = await tryRiposte(ctx, campaignId, sceneId, riposteFrom, characterId);
    if (answer) (result as any).riposte = answer;
  }
  if (tideFrom && sceneId) {
    const tide = await tryStandAgainstTide(ctx, campaignId, sceneId, tideFrom, characterId, key);
    if (tide) (result as any).tide = tide;
  }
  const dealt = (result as any).damage;
  if (sceneId && dealt?.targetId && Number(dealt.applied ?? 0) > 0) {
    const answer = await tryRetaliation(ctx, campaignId, sceneId, dealt.targetId, characterId);
    if (answer) (result as any).retaliation = answer;
  }
  const attackOutcomeView = (result as any).outcome;
  if (kind === 'attack' && sceneId && attackOutcomeView?.target) {
    void notifyCampaign(ctx, campaignId, {
      type: 'attack', sceneId, attackerId: characterId, targetId: attackOutcomeView.target.id, source: 'weapon',
      effect: attackOutcomeView.critical ? 'crit' : attackOutcomeView.hit ? 'hit' : 'miss', ranged: attackOutcomeView.ranged === true,
    });
  }
  if (kind === 'attack' && sceneId && attackOutcomeView?.target) {
    try {
      await settleOpportunities(ctx, campaignId, await db.transaction(q => reactionAttackers(q, campaignId, sceneId, characterId, 'sentinel', [attackOutcomeView.target.id])));
    } catch {
    }
  }
  if (ammoSpent) void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
  if (revealed) announceRevealed(ctx, campaignId, characterId, sceneId ?? null);
  if (becameVisible) announceVisible(ctx, campaignId, characterId, becameVisible);
  if (inspiration) {
    void notifyCampaign(ctx, campaignId, { type: 'changed' });
    void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
    void notifyCampaign(ctx, campaignId, { type: 'float', characterId, text: 'вдохновение', tone: 'xp' });
  }
  if ((result as any).damage) {
    const damage = (result as any).damage;
    announceHpChange(ctx, campaignId, damage.targetId, 'damage', damage);
    const extraDamage = (result as any).extraDamage;
    if (extraDamage) announceHpChange(ctx, campaignId, extraDamage.targetId, 'damage', extraDamage);
    const divineDamage = (result as any).divineDamage;
    if (divineDamage) announceHpChange(ctx, campaignId, divineDamage.targetId, 'damage', divineDamage);
    const improvedSmite = (result as any).improvedSmite;
    if (improvedSmite) announceHpChange(ctx, campaignId, improvedSmite.targetId, 'damage', improvedSmite);
    if (Number(damage.applied ?? 0) + Number(extraDamage?.applied ?? 0) + Number(divineDamage?.applied ?? 0) + Number(improvedSmite?.applied ?? 0) > 0) void offerRebukes(ctx, campaignId, sceneId ?? null, characterId, [damage.targetId]);
  } else if ((result as any).outcome?.hit === false && (result as any).outcome?.target) {
    void notifyCampaign(ctx, campaignId, { type: 'hp', characterId: (result as any).outcome.target.id, mode: 'miss', amount: 0, blocked: null, modified: null, critical: false });
  }

  return result;
}
