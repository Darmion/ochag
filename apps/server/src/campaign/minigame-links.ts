import type { Queryable } from '../db.ts';
import { reject } from '../tabletop/scene-feature.ts';
import { canManageCharacter } from '../tabletop/scene/placements.ts';
import type { CampaignEvent } from '../system/campaign-events.ts';
import { onSegment, type DoorLink, type HeroLink, type LockTarget, type ObjectLink } from '../../../../packages/domain/minigames/links.ts';

// A mini-game that ends well reaches the map or a sheet (roadmap 4.3). Each change runs in the move's transaction and
// returns the line the game window shows; the live messages go out after the commit.
export type Door = { sceneId: string; x1: number; z1: number; x2: number; z2: number };
export type Outcome = { text: string; events: CampaignEvent[] };

export async function objectLink(q: Queryable, campaignId: string, id: string): Promise<ObjectLink> {
  const row = (await q.query(
    `SELECT id, name FROM characters WHERE campaign_id=$1 AND id=$2 AND kind='object' AND container_id IS NULL`, [campaignId, id],
  )).rows[0];
  if (!row) reject(400, 'Предмет для мини-игры не найден в этой кампании.');
  return { kind: 'object', id: String(row.id), name: String(row.name) };
}

async function doorPieces(q: Queryable, campaignId: string, door: Door) {
  const rows = (await q.query(
    `SELECT id, x1, z1, x2, z2 FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 AND kind='door'`, [campaignId, door.sceneId],
  )).rows;
  return rows
    .filter(row => onSegment(door, { x1: Number(row.x1), z1: Number(row.z1), x2: Number(row.x2), z2: Number(row.z2) }))
    .map(row => String(row.id));
}

export async function doorLink(q: Queryable, campaignId: string, door: Door): Promise<DoorLink> {
  const scene = (await q.query('SELECT name FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, door.sceneId])).rows[0];
  if (!scene || !(await doorPieces(q, campaignId, door)).length) reject(400, 'На этой сцене нет такой двери.');
  return { kind: 'door', sceneId: door.sceneId, sceneName: String(scene.name), x1: door.x1, z1: door.z1, x2: door.x2, z2: door.z2 };
}

export async function heroLink(q: Queryable, campaignId: string, id: string): Promise<HeroLink> {
  const row = (await q.query(`SELECT id, name FROM characters WHERE campaign_id=$1 AND id=$2 AND kind='character'`, [campaignId, id])).rows[0];
  if (!row) reject(400, 'Герой не найден в этой кампании.');
  return { id: String(row.id), name: String(row.name) };
}

async function touchScenesOf(q: Queryable, campaignId: string, objectId: string) {
  await q.query(
    `UPDATE scenes SET revision=revision+1 WHERE campaign_id=$1 AND id IN (SELECT scene_id FROM scene_objects WHERE campaign_id=$1 AND character_id=$2)`,
    [campaignId, objectId],
  );
}

async function present(q: Queryable, campaignId: string, id: string) {
  return Boolean((await q.query('SELECT 1 FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, id])).rows[0]);
}

// Hanging the lock shuts the chest or the door at once: until the runes are solved, only the GM or brute force opens it.
export async function lockTarget(q: Queryable, campaignId: string, target: LockTarget) {
  if (target.kind === 'object') {
    await q.query(
      `INSERT INTO object_states (campaign_id, character_id, openable, locked) VALUES ($1,$2,true,true)
       ON CONFLICT (campaign_id, character_id) DO UPDATE SET openable=true, is_open=false, locked=NOT object_states.broken,
         revision=object_states.revision+1, updated_at=now()`,
      [campaignId, target.id],
    );
    await touchScenesOf(q, campaignId, target.id);
  } else {
    await q.query(`UPDATE scene_walls SET locked=true, open=false WHERE campaign_id=$1 AND id=ANY($2::uuid[]) AND NOT broken`,
      [campaignId, await doorPieces(q, campaignId, target)]);
    await q.query('UPDATE scenes SET revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, target.sceneId]);
  }
}

export async function unlockTarget(q: Queryable, campaignId: string, target: LockTarget): Promise<Outcome> {
  if (target.kind === 'object') {
    if (!(await present(q, campaignId, target.id))) return { text: `«${target.name}» уже убран с карты — отпирать нечего.`, events: [] };
    await q.query(
      `UPDATE object_states SET locked=false, lock_known=true, revision=revision+1, updated_at=now() WHERE campaign_id=$1 AND character_id=$2`,
      [campaignId, target.id],
    );
    await touchScenesOf(q, campaignId, target.id);
    const text = `«${target.name}» отперт.`;
    return { text, events: [{ type: 'changed' }, { type: 'notice', title: 'Рунный замок открыт', detail: text, tone: 'good' }] };
  }
  const pieces = await doorPieces(q, campaignId, target);
  if (!pieces.length) return { text: `Двери на сцене «${target.sceneName}», на которой висел замок, больше нет.`, events: [] };
  await q.query('UPDATE scene_walls SET locked=false WHERE campaign_id=$1 AND id=ANY($2::uuid[])', [campaignId, pieces]);
  await q.query('UPDATE scenes SET revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, target.sceneId]);
  const text = `Дверь на сцене «${target.sceneName}» отперта.`;
  return { text, events: [{ type: 'changed' }, { type: 'notice', title: 'Рунный замок открыт', detail: text, tone: 'good' }] };
}

export async function revealSecret(q: Queryable, campaignId: string, target: ObjectLink): Promise<Outcome> {
  if (!(await present(q, campaignId, target.id))) return { text: `«${target.name}» уже убран с карты.`, events: [] };
  await q.query(
    `UPDATE object_states SET secret_found=true, revision=revision+1, updated_at=now() WHERE campaign_id=$1 AND character_id=$2 AND secret_dc IS NOT NULL`,
    [campaignId, target.id],
  );
  await touchScenesOf(q, campaignId, target.id);
  const text = `Найдено тайное: «${target.name}». Теперь его видят все.`;
  return { text, events: [{ type: 'changed' }, { type: 'notice', title: 'Путь по карте найден', detail: text, tone: 'good' }] };
}

// A potion weighs half a pound, like the SRD potion of healing; its note keeps it out of other stacks.
export async function givePotion(q: Queryable, campaignId: string, hero: HeroLink, potion: { name: string; description: string }): Promise<Outcome> {
  const holder = (await q.query(
    `SELECT id, name, owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2 AND kind<>'object'`, [campaignId, hero.id],
  )).rows[0];
  if (!holder) return { text: `«${hero.name}» больше нет в кампании — зелье осталось в котле.`, events: [] };
  await q.query(
    `INSERT INTO characters (campaign_id, owner_user_id, name, kind, size, container_id, weight_lb, quantity, item_category, item_note)
     VALUES ($1,$2,$3,'object','tiny',$4,0.5,1,'consumable',$5)`,
    [campaignId, holder.owner_user_id, potion.name, holder.id, potion.description],
  );
  const text = `«${holder.name}» получает зелье «${potion.name}».`;
  return {
    text,
    events: [{ type: 'character', characterId: String(holder.id) }, { type: 'characters' }, { type: 'notice', title: 'Зелье готово', detail: text, tone: 'good' }],
  };
}

// While its rune lock is unsolved (or jammed), a chest or a door tells players why it stays shut and cannot be picked.
export async function runeLockHolds(q: Queryable, campaignId: string, at: { objectId: string } | { sceneId: string; wall: Omit<Door, 'sceneId'> }) {
  const game = (await q.query(`SELECT state FROM campaign_minigames WHERE campaign_id=$1 AND kind='rune-lock'`, [campaignId])).rows[0]?.state;
  const target = game?.target as LockTarget | null | undefined;
  if (!target || (game.phase !== 'active' && game.phase !== 'jammed')) return false;
  if ('objectId' in at) return target.kind === 'object' && target.id === at.objectId;
  return target.kind === 'door' && target.sceneId === at.sceneId && onSegment(target, at.wall);
}

// The heroes a viewer may roll a mini-game check for: the GM any hero, a player their own.
export async function actableHeroes(q: Queryable, campaignId: string, userId: string, manager: boolean) {
  return (await q.query(
    `SELECT id, name FROM characters WHERE campaign_id=$1 AND kind='character' AND ($3 OR owner_user_id=$2) ORDER BY name, id LIMIT 300`,
    [campaignId, userId, manager],
  )).rows.map(row => ({ id: String(row.id), name: String(row.name) }));
}

export async function checkActor(q: Queryable, member: any, campaignId: string, userId: string, heroId: string) {
  const hero = (await q.query(
    `SELECT id, name, owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2 AND kind<>'object'`, [campaignId, heroId],
  )).rows[0];
  if (!hero) reject(404, 'Герой не найден в этой кампании.');
  if (!(await canManageCharacter(q, member, userId, hero.owner_user_id, hero.id))) reject(403, 'Бросать проверку можно за своего героя.');
  return { id: String(hero.id), name: String(hero.name) };
}

// What the GM can tie a new game to: chests and other things that open, secrets on scenes, heroes.
export async function linkChoices(q: Queryable, campaignId: string, kind: 'lockable' | 'secret' | 'hero') {
  if (kind === 'hero') {
    return (await q.query(`SELECT id, name FROM characters WHERE campaign_id=$1 AND kind='character' ORDER BY name, id LIMIT 300`, [campaignId]))
      .rows.map(row => ({ id: String(row.id), name: String(row.name) }));
  }
  const rows = (await q.query(
    `SELECT DISTINCT ON (c.id) c.id, c.name, s.name AS scene
       FROM characters c
       JOIN object_states o ON o.campaign_id=c.campaign_id AND o.character_id=c.id
       JOIN scene_objects p ON p.campaign_id=c.campaign_id AND p.character_id=c.id
       JOIN scenes s ON s.id=p.scene_id
      WHERE c.campaign_id=$1 AND c.kind='object' AND c.container_id IS NULL AND ${kind === 'lockable' ? 'o.openable' : 'o.secret_dc IS NOT NULL'}
      ORDER BY c.id, s.name
      LIMIT 300`,
    [campaignId],
  )).rows;
  return rows
    .map(row => ({ id: String(row.id), name: String(row.name), scene: String(row.scene) }))
    .sort((a, b) => a.scene.localeCompare(b.scene, 'ru') || a.name.localeCompare(b.name, 'ru'));
}
