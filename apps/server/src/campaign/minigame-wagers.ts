import type { Queryable } from '../db.ts';
import { reject } from '../tabletop/scene-feature.ts';
import type { CampaignEvent } from '../system/campaign-events.ts';
import { COINS, addToWallet, payFromWallet, priceText, type Wallet } from '../../../../packages/domain/character/coins.ts';
import { stakesDue, wagerPayouts, type Payment, type Wager } from '../../../../packages/domain/minigames/wagers.ts';

// Stakes move between sheet purses in the move's transaction (roadmap 4.6): a purse short of the stake stops the start.
type WagerGame = { phase: string; hostId: string; players: { id: string; name: string }[]; wager?: Wager | null; revision: number; effect?: string | null };

async function purse(q: Queryable, campaignId: string, heroId: string) {
  const row = (await q.query(`SELECT cp, sp, ep, gp, pp FROM characters WHERE campaign_id=$1 AND id=$2 AND kind<>'object' FOR UPDATE`, [campaignId, heroId])).rows[0];
  return row ? Object.fromEntries(COINS.map(coin => [coin, Number(row[coin] ?? 0)])) as Wallet : null;
}

async function store(q: Queryable, campaignId: string, heroId: string, wallet: Wallet) {
  await q.query('UPDATE characters SET cp=$3, sp=$4, ep=$5, gp=$6, pp=$7, revision=revision+1 WHERE campaign_id=$1 AND id=$2',
    [campaignId, heroId, ...COINS.map(coin => wallet[coin])]);
}

const touched = (payments: Payment[]): CampaignEvent[] => [
  ...payments.map(payment => ({ type: 'character', characterId: payment.heroId })), { type: 'characters' },
];

async function chargeStakes(q: Queryable, campaignId: string, payments: Payment[]) {
  for (const payment of payments) {
    const wallet = await purse(q, campaignId, payment.heroId);
    if (!wallet) reject(409, `«${payment.heroName}» больше нет в кампании — ставку не с кого взять.`);
    const left = payFromWallet(wallet!, payment.cp);
    if (!left) reject(409, `У «${payment.heroName}» не хватает денег на ставку ${priceText(payment.cp)}.`);
    await store(q, campaignId, payment.heroId, left!);
  }
  return touched(payments);
}

async function payOut(q: Queryable, campaignId: string, payments: Payment[], refund: boolean) {
  const paid: Payment[] = [];
  for (const payment of payments) {
    const wallet = await purse(q, campaignId, payment.heroId);
    if (!wallet) continue;
    await store(q, campaignId, payment.heroId, addToWallet(wallet, payment.cp));
    paid.push(payment);
  }
  const list = paid.map(payment => `«${payment.heroName}» — ${priceText(payment.cp)}`).join(', ');
  const text = refund
    ? `Ставки вернулись в кошельки: ${list}.`
    : paid.length === 1 ? `«${paid[0]!.heroName}» забирает банк: ${priceText(paid[0]!.cp)}.` : `Банк поделён: ${list}.`;
  return { text, events: [...touched(paid), { type: 'notice', title: refund ? 'Ставки возвращены' : 'Банк выплачен', detail: text, tone: 'good' }] as CampaignEvent[] };
}

// Starting a game takes the stakes; a game that ends after it started pays the winners, or everyone back without one.
export async function settleWager<T extends WagerGame>(
  q: Queryable, campaignId: string, before: T | null, after: T, winnerIds: () => string[], sent: CampaignEvent[],
): Promise<T> {
  const wager = after.wager;
  if (!wager) return after;
  if (before?.phase === 'lobby' && after.phase === 'playing' && !wager.paid) {
    sent.push(...await chargeStakes(q, campaignId, stakesDue(after)));
    return { ...after, wager: { ...wager, paid: true } };
  }
  const ended = before?.phase === 'playing' && (after.phase === 'finished' || after.phase === 'cancelled');
  if (!ended || !wager.paid || wager.settled) return after;
  const winners = after.phase === 'finished' ? winnerIds() : [];
  const outcome = await payOut(q, campaignId, wagerPayouts(after, winners), !wager.seats.some(seat => winners.includes(seat.userId)));
  sent.push(...outcome.events);
  return { ...after, wager: { ...wager, settled: true }, effect: outcome.text };
}
