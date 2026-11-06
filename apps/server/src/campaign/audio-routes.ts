import type { Queryable } from '../db.ts';
import { bumpScene, objectSchema, reject, sceneParams, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';

type AudioState = {
  asset_id: string | null;
  queue: string[];
  playing: boolean;
  loop: boolean;
  volume: number;
  started_at: string | null;
  paused_at_seconds: number;
  revision: number;
  mood?: Mood;
  resume?: Record<string, unknown> | null;
  scene_id?: string | null;
};

const MOODS = ['explore', 'combat', 'tension'] as const;
export type Mood = typeof MOODS[number];

const EMPTY: AudioState = {
  asset_id: null, queue: [], playing: false, loop: true, volume: 0.8, started_at: null, paused_at_seconds: 0, revision: 0, scene_id: null,
};

type LoadedState = AudioState & { asset_name: string | null; scene_name: string | null };

async function loadState(q: Queryable, campaignId: string): Promise<LoadedState> {
  const row = (
    await q.query(
      `SELECT a.asset_id, a.queue, a.playing, a.loop, a.volume::float8 AS volume, a.started_at,
              a.paused_at_seconds, a.revision, a.mood, a.resume, s.original_filename AS asset_name,
              a.scene_id, sc.name AS scene_name
       FROM campaign_audio a
       LEFT JOIN assets s ON s.campaign_id = a.campaign_id AND s.id = a.asset_id
       LEFT JOIN scenes sc ON sc.campaign_id = a.campaign_id AND sc.id = a.scene_id
       WHERE a.campaign_id=$1`,
      [campaignId],
    )
  ).rows[0];

  return row ? (row as LoadedState) : { ...EMPTY, asset_name: null, scene_name: null };
}

async function assertAudioAsset(q: Queryable, campaignId: string, assetId: string) {
  const asset = (
    await q.query(`SELECT 1 FROM assets WHERE campaign_id=$1 AND id=$2 AND kind='audio'`, [campaignId, assetId])
  ).rows[0];
  if (!asset) reject(400, 'Аудиофайл не найден в этой кампании.');
}

const MAX_TRACKS = 50;

function positionOf(state: AudioState) {
  if (state.playing && state.started_at) return Math.max(0, (Date.now() - new Date(state.started_at).getTime()) / 1000);
  return state.paused_at_seconds;
}

async function writeState(
  q: Queryable, campaignId: string, userId: string,
  next: { asset_id: string | null; queue: string[]; playing: boolean; loop: boolean; volume: number; startedAt: Date | null; pausedAt: number; mood: Mood; resume: Record<string, unknown> | null; sceneId: string | null },
) {
  await q.query(
    `INSERT INTO campaign_audio (campaign_id, asset_id, queue, playing, loop, volume, started_at, paused_at_seconds, updated_by, updated_at, mood, resume, scene_id)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9, now(), $10, $11::jsonb, $12)
     ON CONFLICT (campaign_id) DO UPDATE SET
       asset_id=$2, queue=$3::jsonb, playing=$4, loop=$5, volume=$6, started_at=$7, paused_at_seconds=$8,
       updated_by=$9, updated_at=now(), revision=campaign_audio.revision+1, mood=$10, resume=$11::jsonb, scene_id=$12`,
    [campaignId, next.asset_id, JSON.stringify(next.queue), next.playing, next.loop, next.volume, next.startedAt, next.pausedAt, userId, next.mood, next.resume ? JSON.stringify(next.resume) : null, next.sceneId],
  );
}

async function moodTracks(q: Queryable, campaignId: string, sceneId: string, mood: Mood): Promise<string[]> {
  const scene = (await q.query('SELECT playlist, mood_playlists FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId])).rows[0];
  if (!scene) return [];
  const list = mood === 'explore' ? scene.playlist : scene.mood_playlists?.[mood];
  return Array.isArray(list) ? list.filter((id: unknown) => typeof id === 'string') : [];
}

export async function playMood(q: Queryable, campaignId: string, sceneId: string, mood: Mood, userId: string, remember: boolean): Promise<boolean> {
  const tracks = await moodTracks(q, campaignId, sceneId, mood);
  if (!tracks.length) return false;
  const current = await loadState(q, campaignId);
  const resume = remember && current.mood !== mood && current.asset_id
    ? { asset_id: current.asset_id, queue: current.queue, playing: current.playing, position: positionOf(current), mood: current.mood ?? 'explore', scene_id: current.scene_id ?? null }
    : remember ? current.resume ?? null : null;
  await writeState(q, campaignId, userId, {
    asset_id: tracks[0]!, queue: tracks, playing: true, loop: true, volume: current.volume, startedAt: new Date(), pausedAt: 0, mood, resume, sceneId,
  });
  return true;
}

export async function endCombatMusic(q: Queryable, campaignId: string, userId: string): Promise<boolean> {
  const current = await loadState(q, campaignId);
  if (current.mood !== 'combat') return false;
  const resume = current.resume as { asset_id?: string; queue?: string[]; playing?: boolean; position?: number; mood?: Mood; scene_id?: string | null } | null;
  if (resume?.asset_id) {
    const position = Number(resume.position ?? 0);
    const sceneId = typeof resume.scene_id === 'string'
      && (await q.query('SELECT 1 FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, resume.scene_id])).rows.length ? resume.scene_id : null;
    await writeState(q, campaignId, userId, {
      asset_id: resume.asset_id, queue: resume.queue ?? [resume.asset_id], playing: resume.playing !== false, loop: current.loop, volume: current.volume,
      startedAt: resume.playing !== false ? new Date(Date.now() - position * 1000) : null, pausedAt: resume.playing !== false ? 0 : position,
      mood: resume.mood && MOODS.includes(resume.mood) ? resume.mood : 'explore', resume: null, sceneId,
    });
  } else {
    await writeState(q, campaignId, userId, {
      asset_id: current.asset_id, queue: current.queue, playing: false, loop: current.loop, volume: current.volume,
      startedAt: null, pausedAt: 0, mood: 'explore', resume: null, sceneId: current.scene_id ?? null,
    });
  }
  return true;
}
const trackList = { type: 'array', maxItems: MAX_TRACKS, uniqueItems: true, items: uuid };

async function assertAudioAssets(q: Queryable, campaignId: string, assetIds: string[]) {
  for (const assetId of assetIds) await assertAudioAsset(q, campaignId, assetId);
}

export function registerAudioRoutes(ctx: SceneFeatureContext) {
  const { app, db, auth, membership, canManage, getScene, notify, notifyCampaign } = ctx;
  const params = objectSchema({ campaignId: uuid });

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/audio',
    { schema: { params } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const member = await membership(db, campaignId, userId);
      const manager = await canManage(db, member, userId);
      const state = await loadState(db, campaignId);
      if (!manager) state.scene_name = null;

      return {
        state,
        canManage: manager,
        // Server time lets clients correct their clocks so the music stays in sync.
        serverNow: new Date().toISOString(),
      };
    },
  );

  app.put<{
    Params: { campaignId: string };
    Body: {
      action: 'play' | 'pause' | 'stop' | 'next' | 'previous';
      assetId?: string;
      queue?: string[];
      revision?: number;
      loop?: boolean;
      volume?: number;
      fromSeconds?: number;
      sceneId?: string | null;
    };
  }>(
    '/campaigns/:campaignId/audio',
    {
      schema: {
        params,
        body: objectSchema({
          action: { type: 'string', enum: ['play', 'pause', 'stop', 'next', 'previous'] },
          assetId: uuid,
          queue: { ...trackList, minItems: 1 },
          revision: { type: 'integer', minimum: 0 },
          loop: { type: 'boolean' },
          volume: { type: 'number', minimum: 0, maximum: 1 },
          fromSeconds: { type: 'number', minimum: 0, maximum: 86400 },
          sceneId: { anyOf: [uuid, { type: 'null' }] },
        }, ['action']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { action, assetId, loop, volume, fromSeconds, revision, sceneId } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Музыкой управляет мастер.');
        if (assetId) await assertAudioAsset(q, campaignId, assetId);
        if (request.body.queue) await assertAudioAssets(q, campaignId, request.body.queue);
        if (sceneId) await getScene(q, campaignId, sceneId);

        const current = await loadState(q, campaignId);

        // A «track ended» from a stale state was already handled by another GM: change nothing.
        if (revision !== undefined && revision !== current.revision) return { state: current, changed: false };

        let queue = request.body.queue
          ?? (assetId && !current.queue.includes(assetId) ? [assetId] : current.queue);
        let track = assetId ?? (request.body.queue ? queue[0]! : current.asset_id);
        let effective: 'play' | 'pause' | 'stop' = action === 'next' || action === 'previous' ? 'play' : action;
        let restart = false;

        if (action === 'next' || action === 'previous') {
          if (!queue.length && current.asset_id) queue = [current.asset_id];
          const index = Math.max(0, queue.indexOf(current.asset_id ?? ''));
          const shouldLoop = loop ?? current.loop;

          if (action === 'next') {
            const next = queue[index + 1] ?? (shouldLoop ? queue[0] : undefined);
            if (next) track = next;
            else effective = 'stop';
          } else {
            track = queue[index - 1] ?? (shouldLoop ? queue[queue.length - 1]! : queue[0]!);
          }

          restart = true;
        }

        let playing = current.playing;
        let startedAt: Date | null = current.started_at ? new Date(current.started_at) : null;
        let pausedAt = current.paused_at_seconds;
        const now = new Date();

        if (effective === 'play') {
          if (!track) reject(400, 'Выберите трек.');
          const offset = fromSeconds ?? (restart || track !== current.asset_id ? 0 : (current.playing ? null : pausedAt));
          if (offset !== null) startedAt = new Date(now.getTime() - offset * 1000);
          playing = true;
          pausedAt = 0;
        } else if (effective === 'pause') {
          if (current.playing && startedAt) pausedAt = Math.max(0, (now.getTime() - startedAt.getTime()) / 1000);
          playing = false;
          startedAt = null;
        } else {
          playing = false;
          startedAt = null;
          pausedAt = 0;
        }

        await writeState(q, campaignId, userId, {
          asset_id: track, queue, playing, loop: loop ?? current.loop, volume: volume ?? current.volume, startedAt, pausedAt,
          mood: current.mood ?? 'explore', resume: effective === 'stop' ? null : current.resume ?? null,
          sceneId: sceneId === undefined ? current.scene_id ?? null : sceneId,
        });

        return { state: await loadState(q, campaignId), changed: true };
      });

      if (result.changed) void notifyCampaign(campaignId, { type: 'audio' });
      return { state: result.state, serverNow: new Date().toISOString() };
    },
  );

  app.put<{ Params: { campaignId: string; sceneId: string }; Body: { tracks: string[] } }>(
    '/campaigns/:campaignId/scenes/:sceneId/playlist',
    { schema: { params: sceneParams, body: objectSchema({ tracks: trackList }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { tracks } = request.body;

      const playlist = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Музыку сцены собирает мастер.');
        await getScene(q, campaignId, sceneId, true);
        await assertAudioAssets(q, campaignId, tracks);

        await q.query('UPDATE scenes SET playlist=$3::jsonb WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId, JSON.stringify(tracks)]);
        await bumpScene(q, sceneId);
        return tracks;
      });

      void notify(campaignId, sceneId);
      return { playlist };
    },
  );

  app.put<{ Params: { campaignId: string; sceneId: string }; Body: { mood: 'combat' | 'tension'; tracks: string[] } }>(
    '/campaigns/:campaignId/scenes/:sceneId/playlists',
    { schema: { params: sceneParams, body: objectSchema({ mood: { type: 'string', enum: ['combat', 'tension'] }, tracks: trackList }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { mood, tracks } = request.body;
      const playlists = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Музыку сцены собирает мастер.');
        await getScene(q, campaignId, sceneId, true);
        await assertAudioAssets(q, campaignId, tracks);
        const updated = await q.query(
          `UPDATE scenes SET mood_playlists = jsonb_set(mood_playlists, ARRAY[$3::text], $4::jsonb) WHERE campaign_id=$1 AND id=$2 RETURNING mood_playlists`,
          [campaignId, sceneId, mood, JSON.stringify(tracks)],
        );
        await bumpScene(q, sceneId);
        return updated.rows[0].mood_playlists;
      });
      void notify(campaignId, sceneId);
      return { playlists };
    },
  );

  app.post<{ Params: { campaignId: string }; Body: { sceneId: string; mood: Mood } }>(
    '/campaigns/:campaignId/audio/mood',
    { schema: { params, body: objectSchema({ sceneId: uuid, mood: { type: 'string', enum: [...MOODS] } }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { sceneId, mood } = request.body;
      const state = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Музыкой управляет мастер.');
        await getScene(q, campaignId, sceneId);
        const label = { explore: 'исследования', combat: 'боя', tension: 'напряжения' }[mood];
        if (!(await playMood(q, campaignId, sceneId, mood, userId, mood === 'combat'))) reject(400, `Для ${label} на этой сцене музыки нет — соберите плейлист.`);
        return loadState(q, campaignId);
      });
      void notifyCampaign(campaignId, { type: 'audio' });
      return { state, serverNow: new Date().toISOString() };
    },
  );

  app.post<{ Params: { campaignId: string }; Body: { assetId: string; volume?: number; mode?: 'overlap' | 'interrupt'; userIds?: string[] } }>(
    '/campaigns/:campaignId/audio/effects',
    {
      schema: {
        params,
        body: objectSchema({
          assetId: uuid,
          volume: { type: 'number', minimum: 0, maximum: 1 },
          mode: { type: 'string', enum: ['overlap', 'interrupt'] },
          userIds: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: uuid },
        }, ['assetId']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { assetId, volume, mode, userIds } = request.body;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Звуки включает мастер.');
        await assertAudioAsset(q, campaignId, assetId);
        if (userIds) {
          const members = (
            await q.query('SELECT user_id FROM campaign_members WHERE campaign_id=$1 AND user_id = ANY($2::uuid[])', [campaignId, userIds])
          ).rows;
          if (members.length !== userIds.length) reject(400, 'Звук можно отправить только участникам кампании.');
        }
      });

      const at = new Date().toISOString();
      const message = { type: 'sound', assetId, at, volume: volume ?? 1, mode: mode ?? 'overlap' };
      if (userIds && ctx.notifyUsers) void ctx.notifyUsers(campaignId, [...userIds, userId], message);
      else void notifyCampaign(campaignId, message);
      return { played: true, at, to: userIds ?? null };
    },
  );

  app.post<{ Params: { campaignId: string }; Body: { userIds?: string[] } | undefined }>(
    '/campaigns/:campaignId/audio/effects/stop',
    { schema: { params } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const userIds = request.body?.userIds;
      if (userIds !== undefined && (!Array.isArray(userIds) || userIds.some(id => typeof id !== 'string'))) reject(400, 'userIds — список участников.');
      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Звуки останавливает мастер.');
      });
      const message = { type: 'soundStop', at: new Date().toISOString() };
      if (userIds?.length && ctx.notifyUsers) void ctx.notifyUsers(campaignId, [...userIds, userId], message);
      else void notifyCampaign(campaignId, message);
      return { stopped: true };
    },
  );
}
