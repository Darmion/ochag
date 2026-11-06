import type { TableContext } from '../context.ts';
import { liveMember } from './socket.ts';
import { canManage, type Subscription } from '../shared.ts';

export async function validSubscription(ctx: TableContext, sub: Subscription) {
  const { db } = ctx;
  if (!sub.sceneId) {
    const member = await db.query(
      `SELECT 1 FROM auth_sessions session
         JOIN campaign_members member ON member.user_id=session.user_id
         WHERE session.token_hash=$1 AND session.expires_at>now() AND member.campaign_id=$2`,
      [sub.hash, sub.campaignId],
    );
    return member.rows.length > 0;
  }

  const { rows } = await db.query(
    `SELECT 1
       FROM auth_sessions session
       JOIN campaign_members member
         ON member.user_id=session.user_id
       JOIN scenes scene
         ON scene.campaign_id=member.campaign_id
       WHERE session.token_hash=$1
         AND session.expires_at>now()
         AND member.campaign_id=$2
         AND scene.id=$3
         AND scene.scene_document->>'kind'='shared-grid-v1'`,
    [sub.hash, sub.campaignId, sub.sceneId],
  );

  return rows.length > 0;
}

export async function notify(ctx: TableContext, campaignId: string, sceneId: string) {
  const { subscriptions } = ctx;
  for (const sub of subscriptions) {
    if (
      sub.campaignId !== campaignId ||
      sub.sceneId !== sceneId
    ) {
      continue;
    }

    try {
      if (!(await validSubscription(ctx, sub))) {
        sub.socket.close(1008, 'Access expired');
        continue;
      }

      if (sub.socket.readyState === 1) {
        sub.socket.send(JSON.stringify({ type: 'changed' }));
      }
    } catch {
      sub.socket.close(1011, 'Server error');
    }
  }
}

// Matches only campaignId and reuses the open scene subscription: an open connection already proves membership.
export async function notifyCampaign(ctx: TableContext, campaignId: string, message: Record<string, unknown>) {
  const { subscriptions } = ctx;
  for (const sub of subscriptions) {
    if (sub.campaignId !== campaignId) continue;

    try {
      if (!(await validSubscription(ctx, sub))) {
        sub.socket.close(1008, 'Access expired');
        continue;
      }

      if (sub.socket.readyState === 1) {
        sub.socket.send(JSON.stringify(message));
      }
    } catch {
      sub.socket.close(1011, 'Server error');
    }
  }
}

export async function notifyUsers(ctx: TableContext, campaignId: string, userIds: Iterable<string>, message: Record<string, unknown>) {
  const { subscriptions } = ctx;
  const wanted = new Set(userIds);
  for (const sub of subscriptions) {
    if (sub.campaignId !== campaignId || !sub.userId || !wanted.has(sub.userId)) continue;
    try {
      if (!(await validSubscription(ctx, sub))) continue;
      if (sub.socket.readyState === 1) sub.socket.send(JSON.stringify(message));
    } catch {
    }
  }
}

export async function notifyManagers(ctx: TableContext, campaignId: string, message: Record<string, unknown>) {
  const { db, subscriptions } = ctx;
  for (const sub of subscriptions) {
    if (sub.campaignId !== campaignId || !sub.userId) continue;
    try {
      const member = await liveMember(ctx, sub);
      if (!member || !(await canManage(db, member, sub.userId))) continue;
      if (sub.socket.readyState === 1) sub.socket.send(JSON.stringify(message));
    } catch {
    }
  }
}
