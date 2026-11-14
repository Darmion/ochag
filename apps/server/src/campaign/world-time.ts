import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { clockText, dayPhase } from '../../../../packages/domain/world/clock.ts';

function timeView(minutes: number) {
  return { minutes, text: clockText(minutes), phase: dayPhase(minutes) };
}

type TimeNotice = { title: string; detail: string };
type TimeCourse = (q: Queryable, campaignId: string, userId: string, before: number, after: number) => Promise<TimeNotice[]>;
let timeCourse: TimeCourse | null = null;
// What passing time did (a poison ran out, a disease worsened), told once the clock is announced after the transaction.
const told = new Map<string, TimeNotice[]>();

export function setTimeCourse(course: TimeCourse) {
  timeCourse = course;
}

async function timePassed(q: Queryable, campaignId: string, userId: string | null, before: number, after: number) {
  if (!timeCourse || !userId || after <= before) return;
  const notices = await timeCourse(q, campaignId, userId, before, after);
  if (notices.length) told.set(campaignId, [...(told.get(campaignId) ?? []), ...notices]);
}

export async function advanceWorldTime(q: Queryable, campaignId: string, minutes: number, userId: string | null = null): Promise<number> {
  const row = (
    await q.query(
      `UPDATE campaigns SET world_minutes = GREATEST(0, world_minutes + $2) WHERE id=$1
       RETURNING world_minutes, GREATEST(0, world_minutes - $2) AS before_minutes`,
      [campaignId, Math.round(minutes)],
    )
  ).rows[0];
  const after = Number(row?.world_minutes ?? 0);
  await timePassed(q, campaignId, userId, Number(row?.before_minutes ?? after), after);
  return after;
}

export function announceTime(ctx: Pick<SceneFeatureContext, 'notifyCampaign'>, campaignId: string, minutes: number) {
  void ctx.notifyCampaign(campaignId, { type: 'time', ...timeView(minutes) });
  void ctx.notifyCampaign(campaignId, { type: 'changed' });
  const notices = told.get(campaignId) ?? [];
  told.delete(campaignId);
  if (notices.length) void ctx.notifyCampaign(campaignId, { type: 'rolls' });
  for (const notice of notices) void ctx.notifyCampaign(campaignId, { type: 'notice', title: notice.title, detail: notice.detail });
}

export function registerWorldTimeRoutes(ctx: SceneFeatureContext) {
  const { app, db, auth, membership, canManage } = ctx;
  const params = objectSchema({ campaignId: uuid });

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/time',
    { schema: { params } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      await membership(db, campaignId, userId);
      const row = (await db.query('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0];
      return timeView(Number(row?.world_minutes ?? 0));
    },
  );

  app.put<{ Params: { campaignId: string }; Body: { minutes?: number; advanceMinutes?: number } }>(
    '/campaigns/:campaignId/time',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          maxProperties: 1,
          properties: {
            minutes: { type: 'integer', minimum: 0, maximum: 100_000_000 },
            advanceMinutes: { type: 'integer', minimum: -1_000_000, maximum: 1_000_000 },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { minutes, advanceMinutes } = request.body;
      const next = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Время кампании двигает мастер сцен.');
        if (minutes !== undefined) {
          const before = Number((await q.query('SELECT world_minutes FROM campaigns WHERE id=$1 FOR UPDATE', [campaignId])).rows[0]?.world_minutes ?? 0);
          await q.query('UPDATE campaigns SET world_minutes=$2 WHERE id=$1', [campaignId, minutes]);
          await timePassed(q, campaignId, userId, before, minutes);
          return minutes;
        }
        return advanceWorldTime(q, campaignId, advanceMinutes ?? 0, userId);
      });
      announceTime(ctx, campaignId, next);
      return timeView(next);
    },
  );
}
