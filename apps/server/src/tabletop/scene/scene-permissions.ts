import type { Queryable } from '../../db.ts';

export async function canManageScenes(
  q: Queryable,
  member: any,
  userId: string,
): Promise<boolean> {
  if (member.owner_user_id === userId || member.is_full_gm) {
    return true;
  }

  const { rows } = await q.query(
    `SELECT 1 FROM member_permissions
     WHERE campaign_id=$1
       AND user_id=$2
       AND permission='scenes.manage'`,
    [member.campaign_id, userId],
  );

  return rows.length > 0;
}
