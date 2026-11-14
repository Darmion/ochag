# API

The server listens on port 3000: `http://127.0.0.1:3000` locally, or `https://` with the server's own certificate when the desktop app shares it on a network (see [TLS on a network](#tls-on-a-network)). Requests and responses are JSON, except file uploads (multipart), downloads and the `/live` WebSocket. Protected routes take the header `Authorization: Bearer <token>`.

The complete list of routes, generated from the source, is at the end of this document. The handlers' schemas in `apps/server/src` are the reference for request bodies.

## Conventions

- **Sessions.** `POST /auth/register` and `POST /auth/login` return `{ user, token, expiresAt }`; a session lasts 12 hours. `POST /auth/logout` revokes it. An invalid or expired token gets 401.
- **Errors** are `{ error, message }` with a status code; a schema violation is 400 `{ error: 'INVALID_REQUEST', message, field }`, a duplicate row is 409 `CONFLICT`, and an unexpected failure is 500 with a generic message. Messages are in Russian, the source language; the client translates them ([I18N.md](I18N.md)).
- **Schemas** reject unknown fields and wrong types (`additionalProperties: false`, no type coercion).
- **Not a member means not found.** A request for a campaign, scene, character, object or file of a campaign the user does not belong to gets 404, not a description of what exists.
- **Limits.** A request body is up to 64 KB, except imports (2 MB), file uploads (see [Files](#files)) and campaign files (1 GB). A request may take up to 10 minutes to arrive.
- **Rate limits** are kept in the process memory. A session whose token exists in the database gets 600 requests a minute; any other request counts against its address, 120 a minute, with IPv6 addresses grouped by /64. Sign-in and registration allow 10 requests a minute per address, whatever token the request carries. After 20 failed sign-ins to one login name within 15 minutes from computers other than the server's own, signing in to that name waits (429). Failures from the internet and from the home network are counted apart, so guessing from the internet never locks out players on the LAN. A successful sign-in clears its own count; one from the server's computer clears both. The installer (`GET /update/installer`) can be downloaded 6 times an hour per address. Static files under `/phone/` have no limit on the LAN and the normal address limit from the internet.
- **Headers.** Every response carries `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Cross-Origin-Resource-Policy: same-origin`.
- **Host header.** A request from the server's own computer whose `Host` is a domain name (not an IP address, `localhost`, `*.localhost` or the computer's name) gets 421 `FOREIGN_HOST`. This stops DNS rebinding: a web page in the GM's browser cannot reach the server under its own domain and pass as the host.
- **`GET /health`** returns `{ status, apiVersion, appVersion, serverId, hostName, registration }`. `apiVersion` is 15. `serverId` is the database's permanent id, so the client can tell servers apart; `hostName` is `null` for requests from the internet. `registration` is `'open'` or `'invite'` for the asking connection.

## Accounts

- A login name is 1–64 characters; it is trimmed and compared without case. A password is 1–200 characters. There are no further rules: the account only tells players apart.
- `displayName` is optional at registration and defaults to the login.
- **From the internet** (through the tunnel or from a public address) registration needs a valid `inviteCode` unless the host has opened registration. Such a registration spends the invitation: the new account joins its campaign in the same transaction, and the response adds `joinedCampaignId`. A later `POST /campaigns/join` with that code answers `alreadyMember: true`. A wrong login and a wrong password then return the same message and take the same time; on a home or virtual LAN the messages say which one is wrong.
- `GET /me` returns the user, `isServerHost`, `canCreateCampaigns` and `connection: { clientAddress, serverAddress, serverPort, network, internet }`. The client calls it every 20 seconds while signed in, which also marks the player as online.
- **The host** is a request from the server's own computer (loopback, not through the tunnel). Only the host may call `/host/*`: the connection list and recent sign-in attempts, the account list, the right to create campaigns and the open-registration switch. These routes take no token and answer 403 to anyone else.
- **Creating campaigns** (`POST /campaigns`, `POST /campaigns/import`) is open to the host and to accounts the host has allowed.

## Campaigns and rights

- The **main GM** is the campaign owner (`campaigns.owner_user_id`) and passes every check inside the campaign. A **full GM** (`isFullGm`) has the same game control, but cannot appoint GMs, change rights or transfer ownership.
- Other members get **permission codes**: `scenes.manage`, `characters.manage`, `notes.manage`, `vision.manage` and `rules.manage`. `PUT /campaigns/:campaignId/members/:userId/permissions` replaces them with `{ isFullGm, permissions }`.
- **Invitations** (`POST /campaigns/:campaignId/invites`) are single-use codes valid for 24 hours; `POST /campaigns/join` with `{ code }` uses one. An unknown, used or expired code gets 404 with a message saying which.
- **Characters** are owned by a player or by the GM. A player may edit their own characters and those whose owner granted them edit access; the GM may edit everything. Fields can be hidden from chosen members; hidden fields and hidden objects never leave the server.

## Live channel

`GET /live` opens a WebSocket. The first message must arrive within 5 seconds:

```json
{ "token": "<session token>", "campaignId": "<uuid>", "sceneId": "<uuid or null>" }
```

The server checks the session and the membership, answers `{ "type": "ready" }` and rechecks access periodically, closing the socket when it lapses. The token is never part of the URL. A message is limited to 4 KB. One account keeps at most 24 live connections: a new one closes the oldest with code 4001, after which the client reconnects as after any other drop.

**Server to client.** Most messages tell the client what changed so that it reloads it through the API: `changed` (the scene), `rolls`, `initiative`, `notes`, `character` (with `characterId`), `characters`, `quests`, `handout`, `chat` and `chatRemoved`, `dialogue`, `art`, `audio`, `sound` and `soundStop`, `hp`, `time`, `factions`, `experience`, `minigame` (with `kind`). Others carry an event: `attack`, `float`, `notice`, `combatSummary`, `passage`, `scene-removed` (with `sceneId` and `name`), the reaction prompts `opportunity`, `counterspell`, `counterspell-closed`, `reaction-offer` and `spell-special`. The payloads are read in `apps/client/src/tabletop/live.ts`.

**Client to server**, after `ready`:

| Message | Meaning |
|---|---|
| `{ type: 'grab', kind: 'object', id }` | take an object on the scene; the rights are checked on every grab |
| `{ type: 'pull', kind, id, x, y, z, rotationY?, scale? }` | where this participant pulls it, in world coordinates, up to about 30 times a second |
| `{ type: 'release', kind, id }` | let go |
| `{ type: 'ping', x, z }` | point at a place; others receive it with `userId` and `displayName` |
| `{ type: 'measure', from: { x, z }, to: { x, z } }`, `{ type: 'measure-clear' }` | share the ruler, or remove it |
| `{"type":"rtt","t":<number>}` | latency probe; the server echoes it |

While an object is held, the server sends `pose` 20 times a second to everyone who can see the object. When several participants hold one object, their pulls add up as forces. When the last one lets go, the server stores the final position in one transaction and sends `pose` with `final: true`, then `changed`. A refused grab gets `grab-denied` with a message. A participant who sends nothing for 10 seconds releases the object; a connection may send up to 80 manipulation messages a second, 3 pings and 30 ruler steps. Pings and rulers are not stored and are not filtered by fog of war; a GM who wants to measure in secret turns off "everyone sees" in the client.

## Files

`POST /campaigns/:campaignId/assets?kind=<kind>` uploads one file (multipart, field `file`). The type comes from the file's leading bytes, never from its name or `Content-Type`, and the server chooses the stored name.

| Kind | Formats | Limit | Who |
|---|---|---|---|
| `scene_background` | PNG, JPEG, WebP | 10 MB | scene managers |
| `object_image` | PNG, JPEG, WebP | 5 MB | members |
| `object_model` | GLB | 25 MB | members |
| `audio` | MP3, OGG, WAV, FLAC, M4A | 25 MB | scene managers |
| `art_sprite` | PNG, JPEG, WebP | 2 MB | scene managers |
| `campaign_avatar`, `campaign_banner` | PNG, JPEG, WebP | 5 MB, 10 MB | the main GM |

A player who is neither the main GM nor a full GM may store up to 200 MB of files in one campaign, including the files of imported objects; past that the upload gets 413. `GET /campaigns/:campaignId/assets/:assetId` serves a file to members only. `GET /campaigns/:campaignId/assets` lists every file to scene managers; anyone else sees the shared `object_model` library and their own uploads, not the maps, music and handouts the GM keeps back.

`system/asset-usage.ts` lists every place that can hold a file id (`assetUsage`) and empties those places (`detachAsset`). Besides the foreign-key columns these are JSON: scene playlists, the player's queue and resume, spell templates and their revisions, picture replacements (`campaign_art`) and deleted scenes in the bin. `asset-delete.test.ts` checks the schema for file columns the list misses.

- `GET /campaigns/:campaignId/assets/usage` — scene managers only: every file with `uses: [{place, name}]` and `cleanupKinds`.
- `DELETE /campaigns/:campaignId/assets/:assetId` — a scene manager or the uploader; 409 while the file is in use. With `?everywhere=1` (scene managers only) the file first leaves every place: a scene loses its map and music, image walls turn to stone, figures lose the picture or model, the player stops, a handout keeps its title and text, a spell falls back to its school's art; live clients get `changed`. Deleted scenes in the bin keep their packages, and a restored one drops the ids of files that are gone (`scene-package.ts`).
- `POST /campaigns/:campaignId/assets/cleanup` — scene managers only: deletes the unused files of `cleanupKinds` (scene backgrounds, object pictures, campaign avatar and banner), answers `{deleted, bytes}`. Models, music and sprites stay in their libraries until deleted one by one.

## Campaign transfer

`GET /campaigns/:campaignId/export` (main GM) returns a `.ochag-campaign` file: gzip of the container `TTRPG-CAMPAIGN\n`, a 32-bit length, a JSON header and the asset files one after another. `POST /campaigns/import` (multipart, up to 1 GB) creates a **new** campaign owned by the importing user.

The import does not trust the file:

- every id is created anew;
- column names are checked against the database schema, and tables come from a fixed list;
- rows of other campaigns are skipped;
- members are matched by login name only;
- asset files are checked by their leading bytes and stored under new names, so an asset row must have a UUID id;
- unpacking is limited to 1.5 GB;
- a file from another schema version is rejected.

Older `.ttrpg-campaign` files open too.

## Level-up

- `GET …/characters/:characterId/level-up` returns the plan of the next level (`plan`, or `milestone` for the GM when experience is short), a complete suggested choice (`suggestion`) and a card for each new feature (`featureTexts`: its text and `automation`, one of `auto`, `partial` and `manual`).
- `POST …/level-up` with `dryRun: true` applies the choice inside a transaction that is then rolled back, and returns `before` and `after` (level, class, hit points, AC, proficiency bonus, attacks, ability scores, spell slots, resources and spell count), `problems`, `hpGain` and, for a rolled hit die, `hpRange`. Unfinished or invalid parts of the choice are left out of the preview instead of refusing it. A dry run rolls no die and writes nothing.
- The heroes list (`GET /campaigns/:campaignId/characters`) sets `level_ready` on a hero whose experience reaches the next level, and only for viewers who may level that hero up. The level and experience themselves stay out of the list.
- Every applied level-up, and every automatic one, is recorded in `characters.level_steps`: what that level changed (hit points, ability scores, AC, subclass, feat, sheet notes, skills, expertise, spells, weapon bonuses, class resources). `GET …/level-down` previews lowering the last level; `POST …/level-down` undoes the recorded step exactly; send `expectedLevel` (the level the preview showed) and a level that has changed in the meantime is refused with 409. A level without a record loses the average hit points of the class (`classId` picks the class of a multiclass hero) and the player fixes the rest. Experience never changes on a level-down.
- `POST /campaigns/:campaignId/experience` takes a negative `amount` to take experience away (the GM only, without `split`). Experience stops at zero and the level does not drop by itself.

## Inventory

Items are `characters` rows with `kind = 'object'` inside a holder (`container_id`). An item has `quantity` (a stack), `item_category`, `item_srd` (`gear:<index>` or `weapon:<index>`), `item_wear` (where a custom item is worn), `equipped_slot`, `item_grip` (`one` or `two` for a versatile weapon), `infinite` (set by the GM; never spent) and `item_note`. Price and weight are per unit: reference packs (arrows, bolts, bullets) are bought by the pack and stored by the piece.

- `GET …/characters/:characterId/inventory` returns the holder, every item it carries (nested containers included, with `depth`), the carried weight and load level, the AC worn gear gives (`gearAc`), and the campaign rules `encumbrance`, `encumbrance_speed` and `ammo_use`.
- `POST …/inventory` adds an item from the reference (`ref`, `quantity` in packs) or a custom one (`custom`), free or bought with the holder's wallet (`buy: true`, checked and paid in the same transaction). Plain stackable items join an equal stack.
- `POST …/characters/:itemId/equip-slot` with `slot` (or `null`) equips an item the holder carries directly. A two-handed weapon takes both hands and sends what it displaces back into the bag. Armor cannot be changed in combat except by the GM. A weapon in a hand gets a linked attack (`character_weapons.source_item_id`): an existing attack of the same weapon is linked, otherwise a new one is made (`source_auto`) with proficiency from the hero's classes. A linked versatile weapon held in two hands attacks two-handed unless the request says otherwise. A magic item in a slot counts as equipped.
- `PATCH …/item`, `POST …/use`, `POST …/split` and `POST …/give` edit, use up, split and hand over a stack; the last unit used removes the item. A magic item is never split. Stacks join only when both are plain equal items (no note, no magic, no contents, not infinite). Whenever an item leaves its holder — moved, given, sold, looted, dropped or deleted — the attack made for it goes, a linked hand-made attack is unlinked, and the former holder's AC is recounted; worn armor cannot leave its holder in combat except by the GM.
- `PUT …/doll` saves the paper doll layout: points in the coordinates of the source picture, a preset (`humanoid`, `beast` or `list`) and a dimming value.
- `PUT …/ac-mode` with `manual` or `gear`. In `gear` mode the server keeps AC equal to the worn armor and shield, Dexterity and unarmored defense, the Defense fighting style and applied magic bonuses, and recounts it after equipment changes, level changes and sheet edits. Typing an AC by hand switches the hero back to `manual`.
- `PUT …/container` with `nearHolder: true` drops the item on the scene next to the holder's figure.
- With `ammo_use` on, an attack by a player hero's weapon with the ammunition property spends one matching unit from the inventory (the quiver first). A weapon that already uses an ammunition resource keeps spending that resource only.
- With `encumbrance` and `encumbrance_speed` on, the load lowers the movement speed by 10 or 20 feet, or limits it to 5 feet when overloaded. Heavy armor without the required Strength always costs 10 feet.
- An object can have a second picture for when it is open: `imageOpenAssetId` in `POST …/characters` and `PATCH …/characters/:id` (an `object_image` of the campaign, `null` removes it). The scene shows it while the object state is open; object files and copies keep it.
- A hero built in the creation wizard gets the kit as items: gear as stacks, each kit weapon as an item linked to its attack (`source_auto`). Armor, the first weapon, a shield beside a one-handed weapon and ammunition are worn, and the hero switches to `gear` AC when the worn gear gives the AC the wizard counted.

## Area templates

- `POST` and `PATCH …/scenes/:sceneId/templates` take `heightFeet` for a circle (`null` makes it a sphere again). With a height the circle is a cylinder: a flying creature above that height is not caught. Other shapes drop the height.

## Spell templates at the table

- A campaign spell, or an SRD spell the GM edited, runs its whole mechanics table: the main action as before, then the other outcomes, the other actions at casting, actions at the start or end of a turn (stored as `spell_action` effects), every action inside its zone (`scene_triggers.spell`), commands and actions at the end.
- `GET …/characters/:characterId/spell-commands?sceneId=` lists the caster's active spells with commands: `effectId`, `spellName`, and for each command `aim` (`none`, `target` or `place`) and `blocked` (why it cannot be used now).
- `POST …/characters/:characterId/spell-commands/:effectId` with `commandId`, `sceneId`, and `targetIds` or `place` runs a command: an action of the table, moving the zone (no farther than the command allows) or ending the spell. The command's cost is spent from the action economy.
- A chain spell takes its targets in jump order; a jump longer than the template allows is refused with 400. A wall spell raises a wall along the drawn line, snapped to grid nodes, and removes it when the spell ends.

## Alternating wall looks

- `POST …/scenes/:sceneId/walls/alternate` with `ids`, `styles` (two to six looks, not `image`), `mode` (`cycle` or `mix`) and `length` (cells per section, 1–20, default 1). GM only. The server orders the walls along their chain by shared ends and counts cells across joints and corners. Each chain starts with the first look. In `mix` mode neighbouring sections never match.
- A wall whose cells fall into several sections is replaced by one wall per section. The new walls keep kind, state, hit points and damage. A door or a window is never cut; it takes the look of its first section. The answer gives `ids`, the walls that now make up the selection, and `split`, the number of walls that were cut.

## Scatter and pictures for many objects

- `POST /campaigns/:campaignId/characters/:characterId/duplicate` also takes `spots` (up to 60, one per copy, on the board): `{ x, z, rotationY?, scale? }`. Copies land exactly there; without `rotationY` and `scale` they keep the original's. Without `spots` the old limit of 20 copies next to the original stays.
- `POST /campaigns/:campaignId/characters/pictures` (GM) sets `imageAssetId` (an `object_image` of the campaign) for up to 60 objects in one request: `{ items: [{ characterId, imageAssetId }] }`. Only objects change (creatures keep their look); the open picture and the crop are cleared. The answer is `{ updated }`.

## Condition rules

Every condition is a list of clauses (`packages/domain/combat/condition-rules.ts`): own rolls, a roll modifier, attacks against, crits against, an attack ban (weapons and harmful spells), no approach to the source, speed, no actions or no reactions, resistance, another condition it brings along, a repeat save, a duration on the campaign clock, a note. A condition can also have up to six `stages`, each with its own clauses added to the common ones; the stage a creature is at is `parameters.stage` of its effect. The SRD rules are the defaults; the engine reads only clauses, so a campaign's change applies to every roll, move and attack.

A repeat save rolls at the end or start of the creature's turn, after a long rest, or every hour or day on the campaign clock (`PUT /campaigns/:campaignId/time`, rests, the end of combat and rituals move it). A success ends the condition after N wins, eases the stage, lowers the DC by a die or removes a level of exhaustion; a failure adds exhaustion, worsens the stage or deals damage. A condition with a duration ends when the clock passes `parameters.untilMinute`.

- `GET /campaigns/:campaignId/condition-rules` (members) lists the campaign's rules: the 14 SRD conditions, the 3 SRD diseases and 10 SRD poisons, those of mechanics mods (`origin: 'mod'` with `modName`), then the GM's own. Each has `clauses`, `stages`, a sentence `summary`, `origin` (`srd`, `mod` or `campaign`), `icon`, `iconAssetId` (a picture of the campaign or `null`), `standard`, `changed` (the rules differ from the SRD), `iconChanged`, `inUse` (creatures that have it) and, for SRD conditions, `srd` with the original clauses, stages and icon.
- `PUT …/condition-rules/:code` (GM) saves `clauses`, `stages`, `description`, `icon` and `iconAssetId` (an `object_image` asset of the campaign, or `null` to drop it); a condition of the GM also takes `name` and `kind` (`condition`, `disease`, `poison`, `curse`, `effect`). Unknown clauses are dropped and unknown values fall back to the default.
- `POST …/condition-rules` (GM) creates a condition with a code `custom_…`; up to 60 per campaign. `POST /campaigns/:campaignId/conditions/apply` takes such codes too.
- `DELETE …/condition-rules/:code` returns an SRD condition to the SRD rules (its icon stays), or deletes a condition of the GM; while creatures have it, the answer is 409.
- `POST /campaigns/:campaignId/conditions/apply` takes `stage` (0–5) to start a staged condition further on.
- `PUT /campaigns/:campaignId/characters/:characterId/effects/:effectId/stage` (GM) moves a staged condition on a creature to `{ stage }` and answers `{ stage, name }`.
- Saving sends the live message `conditions`.
- A repeat save (`repeat-save`: ability, DC 8–25, at the end or the start of the bearer's turn or after a long rest, 1–3 successes, a failure adds exhaustion or nothing) is rolled by the server; the long rest answer lists the result in `result.conditions`.

## Scene removal, copies, files and presets

- `GET …/scenes/:sceneId/contents` (GM) counts what is on a scene: walls, doors, windows, items, NPCs, player characters, traps, pins, drawings and counters, and says whether a fight is going on.
- `DELETE …/scenes/:sceneId` (GM) is refused with 409 while the scene has an initiative order. Otherwise one transaction saves the scene to `scene_backups` and clears every table that points at it (`SCENE_ROWS_REMOVED` in `tabletop/scene/scene-removal.ts`; a test compares the list with the schema). Objects stay in the campaign, fights in the chronicle keep the scene name, and passages that led to the scene are cleared. Everyone in the campaign gets the live message `scene-removed`. A campaign keeps its last 10 removed scenes.
- `GET /campaigns/:campaignId/scene-backups` lists them. `POST /campaigns/:campaignId/scene-backups/:backupId/restore` creates the scene again with the same objects, fog and trap states; `missing` counts the objects deleted from the campaign since.
- `POST …/scenes/:sceneId/copy` with `name` and `creatures`. Walls, terrain, light and sound settings, traps, pins, drawings, counters and items are copied. Items become new objects together with what they hold; NPCs are copied as new objects when `creatures` is true. Player characters, spell zones, area templates, fog and combat are not copied. Traps are armed again and hidden from players again.
- `GET …/scenes/:sceneId/export?creatures=yes|no` (GM) returns a `.ochag-scene` file: gzip of the container `OCHAG-SCENE\n`, a 32-bit length, a JSON header and the files of the map, wall pictures, objects and music, up to 300 MB. `POST /campaigns/:campaignId/scenes/import` (multipart) creates a new scene. The import does not trust the file:
  - files are checked by their leading bytes and size and stored under new ids;
  - references to anything the file did not bring are dropped;
  - walls must end on grid corners inside the map, objects must stand on it;
  - a row the database refuses is skipped and counted in `skipped`;
  - notes pinned to the map come along as new GM notes.
- `POST /campaigns/:campaignId/scenes` takes `preset`: `tavern`, `cave`, `glade` or `road` (`packages/domain/map/scene-presets.ts`). The preset sets the size, walls, terrain, light, sky and ambient sound.

## Terrain and water

`PUT …/scenes/:sceneId/terrain` (GM) takes `cells`, the difficult cells as `[col, row]`, and optionally `water`, cells as `[col, row, depth]` where depth 1 is shallow water and 2 is deep water. Without `water` the water stays as it is. A cell has one kind: water replaces difficult terrain in the same cell. The scene returns them as `difficult_cells` and `water_cells`.

- Shallow water is difficult terrain.
- In deep water each cell costs one more, as swimming, unless the creature has a swimming speed (`sheet_extra.swimSpeedFeet` or a bestiary entry with one) or flies. Difficult terrain in deep water adds one more again.
- A creature without a swimming speed that enters deep water while wearing armor makes the server send the GM a `notice`: the rules leave a Strength (Athletics) check to the GM.

## Relief

`PUT …/scenes/:sceneId/terrain` also takes `heights`: cells as `[col, row, feet]`, from −100 to 100 in steps of 5; 0 removes the height. Without `heights` they stay as they are. The scene returns them as `elevation_cells`. The rules live in `packages/domain/map/relief.ts`:

- A creature stands on the highest cell under it, and that height adds to its flying height in every distance and area.
- Going up, or down by 10 feet or more, costs climbing: double without a climbing speed. Flyers ignore heights.
- A forced move (a shove, a knock-back, a pull) that lands a creature 10 feet or more lower is a fall: 1d6 per 10 feet and prone. The texts say «падает с уступа (N фт.)».
- A viewer 10 feet above a blocking object's ground sees over it and gets no cover from it.
- The lip of a change in height between attacker and target may give the target half, three-quarters or total cover; the attacker's own cells never do.

## Climbing

- `PUT …/characters/:characterId/climbing` with `on`, `height` and `sceneId`. The creature must stand next to a wall or obstacle and must not be prone, grappled, restrained, incapacitated or flying. The height counts like flight height for reach and areas. A climbing creature moves only along a wall; knocked prone or similar, it falls. Without a climbing speed each foot up costs two feet of movement.

## Movement routes

- After a creature moves, `GET …/scenes/:sceneId` gives its scene object a `walk`: the route as `[x, z]` points, from the old position to the new one, round walls, closed obstacles and hostile creatures. Allies are passed round too when that costs no extra movement. The route is kept in memory for the object's current revision only, so it disappears after the next change or a server restart. A viewer under fog of war gets it only when every point is in sight. A straight move has no `walk`.
- `GET …/objects/:objectId/reach?mode=drag` out of combat (or for a creature not in the fight) returns `limited: false`, no `cells`, and `trail` and `costs` within 30 cells, so a drag can draw the way round. A player under fog of war gets only the cells they have explored. The GM in free movement (`gm_free_move`) gets none.

## Campaign rules from mods

`GET /campaigns/:campaignId/rules` also returns `modRules`: the switches (`kind: 'flag'`) and choices (`kind: 'choice'` with `options`) that mechanics mods define, each with `default`, `modName` and an optional `topic`. A campaign stores them as ordinary rules: a switch as a `flag`, a choice as `text` holding one of the option values; another kind or an unknown option is refused.

## Races, subraces and feats from mods

`GET /srd/heroes` lists the races of mechanics mods after the SRD ones and before «своя раса»; a mod's race, and a mod's subrace of any race, carries `modName`, and a race may carry `icon`, `tagline` and `names`. A subrace may set its own `speed`, `darkvision`, `resistances` and `hpPerLevel`. `GET …/characters/:characterId/level-up` lists the mods' feats in `feats` with `modName`; `PUT …/characters/:characterId/feats` accepts their ids; in `GET …/features` a mod's feat has the hint `мод «…»`, and the traits of a mod's race and subrace are listed as «Раса: …».

## Ready-made adventures

- `GET /adventures` returns `{ canCreate, adventures }`: the adventure mods in the server's mods folder, each `{ id, name, version, description, author, bundled, translations, title, levels, players, duration, intro, cover, counts, problems, error }`. `cover` is a `data:` URL; `counts` tells how many scenes, notes, quests, handouts, roll tables and creatures the campaign will get; `problems` lists what was skipped while reading; an adventure with `error` cannot be used.
- `POST /adventures/:adventureId/campaign` with an optional `name` makes a new campaign owned by the caller (who must be allowed to create campaigns) and returns 201 `{ campaignId, name, counts, problems }`. Scenes are imported like `POST …/scenes/import`; a broken scene is skipped and named in `problems`. An unknown adventure answers 404, one with `error` 400.

## Windows from mods

- `GET /campaigns/:campaignId/mod-forms` returns `{ forms }`: the windows of the mechanics mods the caller may open (`who: 'everyone'`, and for the GM also `who: 'gm'`). A window is `{ id, modId, modName, title, description, icon, who, scope, submit, fields }`; a field is `{ key, label, hint, type, required, default }` plus `maxLength`/`placeholder` (`text`, `textarea`), `min`/`max`/`step` (`number`), `options` (`select`) or `who` (`character`). Without mods the list is empty.
- `POST /campaigns/:campaignId/mods/:modId/forms/:formId` takes the field values by key, plus `characterId` for a window with `scope: 'character'`, and returns `{ message }`. An unknown field, an empty required one or a wrong value answers 400; a GM window opened by a player and a creature the caller does not control answer 403; an unknown window 404. When the mod itself fails without its own status, the answer is 424 with «Мод «…» не справился: …».

## Bestiary creatures from mods

`GET /srd/monsters` lists the creatures of mechanics mods after the SRD ones, each with `modName`; their index starts with `mod_`. `POST …/bestiary/spawn`, `POST …/encounters/bestiary`, `POST …/difficulty` and roll tables take these indexes like SRD ones. A spawned creature's «Источник» text names the mod, and `sheet_extra.srdMonster` holds its index. A saving throw total in the description is kept: the part above the ability modifier and proficiency goes into the save's `custom_bonus`.

## Dice formulas and own roll buttons

A formula (`POST /campaigns/:campaignId/rolls`, roll buttons, spell and trap damage) is dice groups, numbers and sheet variables joined by `+` and `-`. After `NdM` a group takes modifiers, each at most once: `kh3`/`kl1` keep the highest or lowest, `!` explodes, `r1` or `r<3` rerolls once (`ro` is the same), `rr<3` rerolls while the die still meets the condition, `min2` and `max5` limit each die, `cs>=8` counts successes and `cf=1` takes failures away. Comparisons are `=`, `<`, `>`, `<=` and `>=`. In the roll's `breakdown` a group has `rerolled` (the values that were replaced) and, for a pool, `successes` and `failures`.

- `GET /campaigns/:campaignId/roll-macros` lists the caller's own roll buttons in the campaign: `{ id, label, formula, characterId, hidden }`. Nobody else sees them.
- `POST …/roll-macros` adds one (`label` up to 40 characters, `formula`, optional `characterId` of a creature in the campaign, `hidden`); up to 30. A formula the dice cannot read is refused.
- `PUT …/roll-macros/:macroId` changes any of these fields; `DELETE …/roll-macros/:macroId` removes the button. Another player's button answers 404.

## Death saves

- `PUT …/characters/:characterId/death-saves` with `auto` sets whether the app rolls the hero's death saving throws at the start of their turn (the default). With `auto: false` the player rolls on their turn, and the app rolls when the turn ends without a roll.
- `POST /campaigns/:campaignId/death-saves` with `sceneId` lets the GM roll one death saving throw for every dying hero on the scene who is not in combat.

## Mini-games

- Each campaign keeps one game of each kind in `campaign_minigames` (migration 108): `dragon-dice`, `rune-lock`, `seal-ritual`, `alchemy`, `chase`, `duel`, `map-fragments`. A game outlives a server restart. A move locks the game's row, so two moves at once are applied one after the other, and a stale `revision` is refused with 409.
- Every accepted `POST …/minigames/:kind` sends the live message `minigame` with `kind`. Each player then reads the game back with `GET`, because some games show players different things (the duel hides the other side's move). An open window also reloads every 30 seconds in case the socket missed a change.
- A picture on a rune of the rune lock counts as used in the campaign files (place `runeSymbols`). Deleting it everywhere leaves the rune with its name and no picture.
- Mini-games are not part of a campaign transfer; they are part of a backup.
- A game can reach the map or a sheet (`campaign/minigame-links.ts`). `GET` gives the GM what a new game can be tied to: `lockables` for the rune lock (objects on scenes that open), `secrets` for the map (objects with a detection DC), `heroes` for the cauldron. Players never get a game's `target`.
- Rune lock `create` takes `targetId` (an object of the campaign) or `door` (`sceneId`, `x1`, `z1`, `x2`, `z2`), not both. The target is locked at once; every door piece on the segment counts, so a door cut into tiles later stays one target. When the lock opens, the target is unlocked and the game's `effect` says so. While the lock is active or jammed, `interact` `open` names it, `pick` answers `impossible`, and a player opening the door gets 400 with the reason. Forcing still works.
- Alchemy `create` takes `heroId`. A flawless potion goes into that hero's bag as a consumable (0.5 lb, its description as the note).
- Map `create` takes `targetId`, an object with a detection DC. The found route (or the GM's `solve`) marks it found, so every player sees it.
- Each of these sends `changed` (and `character` with `characters` for the potion) and a `notice` to the table.
- Hero checks (`packages/domain/minigames/skill-checks.ts`). Rune lock `create` takes `checkSkill` (`arcana` or `investigation`) and `checkDc` (5–30); map `create` takes `checkSkill` (`history`, `survival` or `investigation`) and `checkDc`. Then `{ action: 'skill', heroId }` (plus `ring` for the lock) rolls the hero's check with the usual modifiers into the roll log (`rollSkillAgainst`, live message `rolls`). Success fixes the chosen ring or opens the map's hint. Each hero tries once per game; a refused try rolls nothing. The player must control the hero.
- Dragon dice `create` takes `cheatDc` from the GM only (403 for a player; the default is 13). `{ action: 'cheat', heroId }` on one's own turn with one dragon showing rolls Sleight of Hand: success removes the dragon, failure burns the pot and passes the turn. Once per player per game.
- `GET` of the rune lock, the map, the dice and the duel gives `actors`: the heroes the viewer may roll or pay for (the GM gets every hero).
- (Examine, migration 109) `GET …/characters/:characterId/examine?heroId=` — for the GM: the settings (`skill`, `dc`, `dcs` per part, `text`), the DC of every part, the full card and who has examined; for a player: the skill and, if that hero has examined, the card of what was revealed. `PUT` (GM) saves the settings; `POST { heroId }` rolls the hero's skill once and stores the total (`character_examine`, `character_examinations`); `DELETE` (GM) lets everyone look again. A player sees only figures that are placed, not hidden and not an unfound secret. Parts: `kind`, `hp`, `ac`, `abilities`, `defenses`, `conditions`, `text`; an empty part DC is the base DC −5/+0/+2/+5 by part (`packages/domain/world/examine.ts`). The desktop route list allows `?heroId=`.
- (Spells) `GET …/characters/:characterId/spells` gives each spell `castTime` (`action`, `bonus`, `reaction`, `1m`, `10m`, `1h`, `8h`, `12h`, `24h` or `custom`) and `concentration`, from the campaign's template or the built-in SRD table template. The cast summary on the table uses them.
- (Class features) `GET …/characters/:characterId/features` gives each pool as `resource: { name, current, max, recharge }`, where `recharge` is `short`, `long` or `null`. Features that share a pool (ki, channel divinity, sorcery points) carry the same `name`; the table's resource strip shows each name once.
- Wagers in dragon dice and the duel (`packages/domain/minigames/wagers.ts`, `campaign/minigame-wagers.ts`). In the lobby the host sends `{ action: 'stake', stakeCp }` (0 removes the stake, at most 100 000 cp); a new stake clears every consent. Each player sends `{ action: 'agree', heroId }` with a hero they control, or `withdraw`. `start` is refused with 409 until every player has agreed. On the start the stakes leave the heroes' purses in the same transaction; a purse that cannot pay stops the start with 409 and nothing is taken. When the game ends, the winners split the pot (the odd copper goes to the first); a draw or a game called off after the start returns the stakes. The game's `effect` says who got what; the table gets `character`, `characters` and a `notice`.

## Internet play

With `TUNNEL_PORT` the server opens a second, HTTP-only listener on `127.0.0.1` for the Cloudflare tunnel, serving the same routes and the WebSocket. Requests that arrive there are never the host. The client address comes from `CF-Connecting-IP`, which is trusted on that listener only. A request counts as **from the internet** when it comes through the tunnel or from a public address; the private, link-local, CGNAT and virtual-LAN ranges (`25.0.0.0/8`, `26.0.0.0/8`) are not public.

## TLS on a network

Given `TLS_CERT_PATH` and `TLS_KEY_PATH`, the server speaks HTTPS and WSS on its port; plain HTTP does not answer there. Without TLS the server listens on a non-loopback address only with `ALLOW_INSECURE_LAN=true`.

The desktop app creates a self-signed ECDSA P-256 certificate once (`apps/desktop/host/certificate.cjs`) and turns TLS on by default ("Secure TLS connections").

- The certificate code is the first 8 bytes of its SHA-256 fingerprint. The GM sees it in the Server tab, and it is part of the invitation text.
- A player's app trusts a certificate once its code matches. Pinned fingerprints are kept per host name.
- If a pinned server answers without TLS, or with a different certificate, the app stops with a warning instead of trusting it.

## Trust boundaries

- The acting user is taken only from a verified server session. The client never receives password hashes and never sets the owner of a campaign or a character.
- SQL uses parameters. Identifiers that reach the query text come from fixed lists or, during campaign import, from the database schema.
- Invitation codes and session tokens are stored as SHA-256 hashes of random tokens. Passwords are hashed with scrypt and a per-user salt.
- Changes to rights, visibility, characters, import drafts, scenes and placed objects lock the affected rows (`FOR UPDATE`) in one transaction, so concurrent requests stay consistent. Joining with an invitation marks it used atomically.
- Dice are rolled on the server with `node:crypto`. Hidden rolls are filtered in the response itself.
- An installer runs on the player's computer, so the player's app does not take the GM's word for it. Before downloading from `/update/installer` it compares the SHA-256 the GM's server reports with the digest of the same version's installer in the official GitHub release (`apps/desktop/host/update-core.cjs`, `officialInstaller`). A different checksum, or a version GitHub has never released, is refused. When GitHub cannot be reached (a LAN without internet) or the release has no checksum, the player has to confirm the download first. Installers from GitHub are checked against the same digest.
- The server computes fog of war, sight, light, stealth and hidden objects. A participant never receives what they cannot see.
- `POST .../rolls/:rollId/apply` checks the rights to the **target** character, not to the roll's author.
- Attaching an object to another requires the right to control the parent and is checked for cycles. Only the GM changes an object's kind or an NPC's disposition.
- A GM note is absent from `GET .../notes` for members without explicit access.
- An import file is only a draft until `POST .../confirm`, which writes it in one transaction.
- The desktop app's player view window may send only `GET` requests, with the token the main window gave it.

## Routes

### Accounts and sessions

| Method | Path | Source |
|---|---|---|
| POST | `/auth/login` | `app/auth-routes.ts` |
| POST | `/auth/logout` | `app/auth-routes.ts` |
| POST | `/auth/register` | `app/auth-routes.ts` |
| GET | `/health` | `app/auth-routes.ts` |
| GET | `/me` | `app/auth-routes.ts` |
| GET | `/mods` | `app/auth-routes.ts` |

### Host

| Method | Path | Source |
|---|---|---|
| GET | `/host/accounts` | `app/host-routes.ts` |
| PUT | `/host/accounts/:userId/can-create-campaigns` | `app/host-routes.ts` |
| GET | `/host/connections` | `app/host-routes.ts` |
| GET | `/host/settings` | `app/host-routes.ts` |
| PUT | `/host/settings` | `app/host-routes.ts` |

### Campaigns and members

| Method | Path | Source |
|---|---|---|
| GET | `/campaigns` | `app/campaign-routes.ts` |
| POST | `/campaigns` | `app/campaign-routes.ts` |
| GET | `/campaigns/:campaignId` | `app/campaign-routes.ts` |
| PUT | `/campaigns/:campaignId/appearance` | `app/campaign-routes.ts` |
| POST | `/campaigns/:campaignId/invites` | `app/member-routes.ts` |
| PUT | `/campaigns/:campaignId/me/vision` | `app/member-routes.ts` |
| GET | `/campaigns/:campaignId/members` | `app/member-routes.ts` |
| PUT | `/campaigns/:campaignId/members/:userId/permissions` | `app/member-routes.ts` |
| PATCH | `/campaigns/:campaignId/members/:userId/vision` | `app/member-routes.ts` |
| GET | `/campaigns/:campaignId/members/roster` | `app/member-routes.ts` |
| GET | `/campaigns/:campaignId/overview` | `app/campaign-routes.ts` |
| POST | `/campaigns/join` | `app/member-routes.ts` |
| GET | `/campaigns/online` | `app/campaign-routes.ts` |

### Campaign transfer

| Method | Path | Source |
|---|---|---|
| GET | `/campaigns/:campaignId/export` | `system/transfer-routes.ts` |
| POST | `/campaigns/import` | `system/transfer-routes.ts` |

### Files

| Method | Path | Source |
|---|---|---|
| GET | `/campaigns/:campaignId/assets` | `system/asset-routes.ts` |
| POST | `/campaigns/:campaignId/assets` | `system/asset-routes.ts` |
| GET | `/campaigns/:campaignId/assets/usage` | `system/asset-routes.ts` |
| GET | `/campaigns/:campaignId/assets/:assetId` | `system/asset-routes.ts` |
| DELETE | `/campaigns/:campaignId/assets/:assetId` | `system/asset-routes.ts` |
| POST | `/campaigns/:campaignId/assets/cleanup` | `system/asset-routes.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/export` | `system/object-file-routes.ts` |
| POST | `/campaigns/:campaignId/objects/import` | `system/object-file-routes.ts` |

### Updates

| Method | Path | Source |
|---|---|---|
| GET | `/update/info` | `system/update-routes.ts` |
| GET | `/update/installer` | `system/update-routes.ts` |

### Character import

| Method | Path | Source |
|---|---|---|
| POST | `/campaigns/:campaignId/imports` | `characters/import/create-draft.ts` |
| DELETE | `/campaigns/:campaignId/imports/:draftId` | `characters/import/delete-draft.ts` |
| PUT | `/campaigns/:campaignId/imports/:draftId` | `characters/import/update-draft.ts` |
| POST | `/campaigns/:campaignId/imports/:draftId/confirm` | `characters/import/confirm-draft.ts` |
| GET | `/importers` | `characters/import-routes.ts` |

### Characters

| Method | Path | Source |
|---|---|---|
| GET | `/campaigns/:campaignId/characters` | `characters/roster-route.ts` |
| POST | `/campaigns/:campaignId/characters` | `characters/sheet/create.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId` | `characters/sheet/read.ts` |
| PATCH | `/campaigns/:campaignId/characters/:characterId` | `characters/sheet/update.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/access` | `characters/sheet/access.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/access/:userId` | `characters/sheet/access.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/attune` | `characters/magic-items.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/charges` | `characters/magic-items.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/coins/give` | `characters/shop-routes.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/container` | `characters/inventory-routes.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/contents` | `characters/inventory-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/effects` | `characters/sheet/effects.ts` |
| DELETE | `/campaigns/:campaignId/characters/:characterId/effects/:effectId` | `characters/sheet/effects.ts` |
| PATCH | `/campaigns/:campaignId/characters/:characterId/effects/:effectId` | `characters/sheet/effects.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/equip` | `characters/magic-items.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/gear` | `characters/shop-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/inspiration` | `characters/inspiration-routes.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/items` | `characters/magic-items.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/items` | `characters/magic-items.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/level-up` | `characters/level-up-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/level-up` | `characters/level-up-routes.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/level-down` | `characters/level-down-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/level-down` | `characters/level-down-routes.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/inventory` | `characters/item-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/inventory` | `characters/item-routes.ts` |
| PATCH | `/campaigns/:campaignId/characters/:characterId/item` | `characters/item-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/equip-slot` | `characters/item-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/use` | `characters/item-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/use-magic` | `characters/magic-use.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/split` | `characters/item-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/give` | `characters/item-routes.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/doll` | `characters/item-routes.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/ac-mode` | `characters/item-routes.ts` |
| DELETE | `/campaigns/:campaignId/characters/:characterId/magic` | `characters/magic-items.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/magic` | `characters/magic-items.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/reactions` | `characters/sheet/reactions.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/resources` | `characters/sheet/resources.ts` |
| DELETE | `/campaigns/:campaignId/characters/:characterId/resources/:resourceId` | `characters/sheet/resources.ts` |
| PATCH | `/campaigns/:campaignId/characters/:characterId/resources/:resourceId` | `characters/sheet/resources.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/rest` | `characters/rest-routes.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/saves` | `characters/sheet/saves.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/saves/:ability` | `characters/sheet/saves.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/skills` | `characters/sheet/skills.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/skills/:skillIndex` | `characters/sheet/skills.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/visibility` | `characters/sheet/visibility.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/visibility/:fieldKey` | `characters/sheet/visibility.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/weapons` | `characters/sheet/weapons.ts` |
| DELETE | `/campaigns/:campaignId/characters/:characterId/weapons/:weaponId` | `characters/sheet/weapons.ts` |
| PATCH | `/campaigns/:campaignId/characters/:characterId/weapons/:weaponId` | `characters/sheet/weapons.ts` |
| POST | `/campaigns/:campaignId/characters/:merchantId/buy` | `characters/shop-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:merchantId/goods` | `characters/shop-routes.ts` |
| PUT | `/campaigns/:campaignId/characters/:merchantId/goods/:itemId` | `characters/shop-routes.ts` |
| GET | `/campaigns/:campaignId/characters/:merchantId/offers/:sellerId` | `characters/shop-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:merchantId/sell` | `characters/shop-routes.ts` |
| GET | `/campaigns/:campaignId/characters/:merchantId/shop` | `characters/shop-routes.ts` |
| POST | `/campaigns/:campaignId/characters/ability-roll` | `characters/hero-routes.ts` |
| POST | `/campaigns/:campaignId/characters/build` | `characters/hero-routes.ts` |
| POST | `/campaigns/:campaignId/experience` | `characters/experience.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/rest` | `characters/rest-routes.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/rest/begin` | `characters/rest-routes.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/rest/cancel` | `characters/rest-routes.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/rest/finish` | `characters/rest-routes.ts` |
| GET | `/srd/gear` | `characters/shop-routes.ts` |
| GET | `/srd/heroes` | `characters/hero-routes.ts` |
| GET | `/srd/magic-items` | `characters/magic-items.ts` |

### Spells

| Method | Path | Source |
|---|---|---|
| GET | `/campaigns/:campaignId/characters/:characterId/spell-slots` | `spells/slots.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/spell-slots/:level` | `spells/slots.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/spell-slots/by-class` | `spells/slots.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/spellcasting` | `spells/spellcasting.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/spellcasting` | `spells/spellcasting.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/spells` | `spells/character-spells.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/spells` | `spells/character-spells.ts` |
| DELETE | `/campaigns/:campaignId/characters/:characterId/spells/:spellId` | `spells/character-spells.ts` |
| PATCH | `/campaigns/:campaignId/characters/:characterId/spells/:spellId` | `spells/character-spells.ts` |
| PUT | `/campaigns/:campaignId/spell-refs/:ref` | `spells/refs.ts` |
| GET | `/campaigns/:campaignId/spell-packs` | `spells/spell-pack-routes.ts` |
| POST | `/campaigns/:campaignId/spell-packs/:packId` | `spells/spell-pack-routes.ts` |
| DELETE | `/campaigns/:campaignId/spell-packs/:packId` | `spells/spell-pack-routes.ts` |
| POST | `/campaigns/:campaignId/spell-templates` | `spells/spell-template-routes.ts` |
| GET | `/campaigns/:campaignId/spell-templates/:spellId` | `spells/spell-template-routes.ts` |
| PUT | `/campaigns/:campaignId/spell-templates/:spellId` | `spells/spell-template-routes.ts` |
| POST | `/campaigns/:campaignId/spell-templates/:spellId/apply` | `spells/spell-template-routes.ts` |
| POST | `/campaigns/:campaignId/spell-templates/:spellId/review` | `spells/spell-template-routes.ts` |
| PATCH | `/campaigns/:campaignId/spell-templates/:spellId/special` | `spells/spell-template-routes.ts` |
| GET | `/campaigns/:campaignId/spell-templates/other-campaigns` | `spells/spell-template-routes.ts` |
| POST | `/campaigns/:campaignId/spell-templates/suggest` | `spells/spell-template-routes.ts` |
| GET | `/campaigns/:campaignId/spells` | `spells/campaign-spells.ts` |
| POST | `/campaigns/:campaignId/spells` | `spells/campaign-spells.ts` |
| DELETE | `/campaigns/:campaignId/spells/:spellId` | `spells/campaign-spells.ts` |
| PATCH | `/campaigns/:campaignId/spells/:spellId` | `spells/campaign-spells.ts` |
| PUT | `/campaigns/:campaignId/spells/:spellId/mechanics` | `spells/campaign-spells.ts` |
| PATCH | `/campaigns/:campaignId/spells/:spellId/review` | `spells/campaign-spells.ts` |
| GET | `/campaigns/:campaignId/srd-templates` | `spells/spell-template-routes.ts` |
| DELETE | `/campaigns/:campaignId/srd-templates/:index` | `spells/spell-template-routes.ts` |
| GET | `/campaigns/:campaignId/srd-templates/:index` | `spells/spell-template-routes.ts` |
| PUT | `/campaigns/:campaignId/srd-templates/:index` | `spells/spell-template-routes.ts` |
| PATCH | `/campaigns/:campaignId/srd-templates/:index/special` | `spells/spell-template-routes.ts` |
| GET | `/srd/skills` | `spells/srd-routes.ts` |
| GET | `/srd/spells` | `spells/srd-routes.ts` |
| GET | `/srd/weapons` | `spells/srd-routes.ts` |

### Class features

| Method | Path | Source |
|---|---|---|
| GET | `/campaigns/:campaignId/characters/:characterId/boss` | `rules/class-features/boss.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/boss` | `rules/class-features/boss.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/cleansing-touch` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/defensive-tactics` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/draconic-ancestry` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/dragon-ancestry` | `rules/class-features/choices.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/fall` | `rules/class-features/fall.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/favored-enemy` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/feats` | `rules/class-features/choices.ts` |
| GET | `/campaigns/:campaignId/characters/:characterId/features` | `rules/class-features/list.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/features/:feature` | `rules/class-features/use.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/fiendish-resilience` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/fighting-styles` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/hunter-multiattack` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/hunters-prey` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/invocations` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/maneuvers` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/metamagic` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/signature-spells` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/spell-mastery` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/subclass` | `rules/class-features/choices.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/superior-hunters-defense` | `rules/class-features/choices.ts` |
| POST | `/campaigns/:campaignId/rolls/:rollId/hurl-through-hell` | `rules/class-features/strikes.ts` |
| POST | `/campaigns/:campaignId/rolls/:rollId/maneuver` | `rules/class-features/strikes.ts` |
| POST | `/campaigns/:campaignId/rolls/:rollId/quivering-palm` | `rules/class-features/strikes.ts` |
| POST | `/campaigns/:campaignId/rolls/:rollId/smite` | `rules/class-features/strikes.ts` |
| POST | `/campaigns/:campaignId/rolls/:rollId/stunning-strike` | `rules/class-features/strikes.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId/legendary` | `rules/class-features/boss.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId/event` | `tabletop/combat/initiative-events.ts` |

### Conditions and rules

| Method | Path | Source |
|---|---|---|
| POST | `/campaigns/:campaignId/characters/:characterId/death-save` | `rules/condition-routes.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/death-saves` | `rules/condition-routes.ts` |
| POST | `/campaigns/:campaignId/death-saves` | `rules/condition-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/stand` | `rules/condition-routes.ts` |
| POST | `/campaigns/:campaignId/characters/revive` | `rules/condition-routes.ts` |
| POST | `/campaigns/:campaignId/conditions/apply` | `rules/condition-routes.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/effects/:effectId/stage` | `rules/condition-routes.ts` |

### Mini-games

| Method | Path | Source |
|---|---|---|
| GET | `/campaigns/:campaignId/minigames/alchemy` | `campaign/minigame-routes.ts` |
| POST | `/campaigns/:campaignId/minigames/alchemy` | `campaign/minigame-routes.ts` |
| GET | `/campaigns/:campaignId/minigames/chase` | `campaign/minigame-routes.ts` |
| POST | `/campaigns/:campaignId/minigames/chase` | `campaign/minigame-routes.ts` |
| GET | `/campaigns/:campaignId/minigames/dragon-dice` | `campaign/minigame-routes.ts` |
| POST | `/campaigns/:campaignId/minigames/dragon-dice` | `campaign/minigame-routes.ts` |
| GET | `/campaigns/:campaignId/minigames/duel` | `campaign/minigame-routes.ts` |
| POST | `/campaigns/:campaignId/minigames/duel` | `campaign/minigame-routes.ts` |
| GET | `/campaigns/:campaignId/minigames/map-fragments` | `campaign/minigame-routes.ts` |
| POST | `/campaigns/:campaignId/minigames/map-fragments` | `campaign/minigame-routes.ts` |
| GET | `/campaigns/:campaignId/minigames/rune-lock` | `campaign/minigame-routes.ts` |
| POST | `/campaigns/:campaignId/minigames/rune-lock` | `campaign/minigame-routes.ts` |
| GET | `/campaigns/:campaignId/minigames/seal-ritual` | `campaign/minigame-routes.ts` |
| POST | `/campaigns/:campaignId/minigames/seal-ritual` | `campaign/minigame-routes.ts` |

### Campaign tools

| Method | Path | Source |
|---|---|---|
| DELETE | `/campaigns/:campaignId/art` | `campaign/art-routes.ts` |
| GET | `/campaigns/:campaignId/art` | `campaign/art-routes.ts` |
| PUT | `/campaigns/:campaignId/art` | `campaign/art-routes.ts` |
| DELETE | `/campaigns/:campaignId/art/sprites/:assetId` | `campaign/art-routes.ts` |
| GET | `/campaigns/:campaignId/audio` | `campaign/audio-routes.ts` |
| PUT | `/campaigns/:campaignId/audio` | `campaign/audio-routes.ts` |
| POST | `/campaigns/:campaignId/audio/effects` | `campaign/audio-routes.ts` |
| POST | `/campaigns/:campaignId/audio/effects/stop` | `campaign/audio-routes.ts` |
| POST | `/campaigns/:campaignId/audio/mood` | `campaign/audio-routes.ts` |
| POST | `/campaigns/:campaignId/bestiary/spawn` | `campaign/bestiary-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/duplicate` | `campaign/encounter-routes.ts` |
| DELETE | `/campaigns/:campaignId/characters/:characterId/factions` | `campaign/factions.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/factions` | `campaign/factions.ts` |
| GET | `/campaigns/:campaignId/chat` | `campaign/chat-routes.ts` |
| POST | `/campaigns/:campaignId/chat` | `campaign/chat-routes.ts` |
| DELETE | `/campaigns/:campaignId/chat/:messageId` | `campaign/chat-routes.ts` |
| GET | `/campaigns/:campaignId/chronicle` | `campaign/chronicle-routes.ts` |
| DELETE | `/campaigns/:campaignId/chronicle/:entryId` | `campaign/chronicle-routes.ts` |
| PATCH | `/campaigns/:campaignId/chronicle/:entryId` | `campaign/chronicle-routes.ts` |
| POST | `/campaigns/:campaignId/chronicle/:entryId/show` | `campaign/chronicle-routes.ts` |
| GET | `/campaigns/:campaignId/dialogue` | `campaign/dialogue-routes.ts` |
| POST | `/campaigns/:campaignId/dialogue/choose` | `campaign/dialogue-routes.ts` |
| POST | `/campaigns/:campaignId/dialogue/end` | `campaign/dialogue-routes.ts` |
| GET | `/campaigns/:campaignId/dialogues` | `campaign/dialogue-routes.ts` |
| POST | `/campaigns/:campaignId/dialogues` | `campaign/dialogue-routes.ts` |
| DELETE | `/campaigns/:campaignId/dialogues/:dialogueId` | `campaign/dialogue-routes.ts` |
| PUT | `/campaigns/:campaignId/dialogues/:dialogueId` | `campaign/dialogue-routes.ts` |
| POST | `/campaigns/:campaignId/dialogues/:dialogueId/start` | `campaign/dialogue-routes.ts` |
| POST | `/campaigns/:campaignId/difficulty` | `campaign/difficulty-routes.ts` |
| GET | `/campaigns/:campaignId/encounters` | `campaign/encounter-routes.ts` |
| POST | `/campaigns/:campaignId/encounters` | `campaign/encounter-routes.ts` |
| DELETE | `/campaigns/:campaignId/encounters/:encounterId` | `campaign/encounter-routes.ts` |
| POST | `/campaigns/:campaignId/encounters/:encounterId/deploy` | `campaign/encounter-routes.ts` |
| POST | `/campaigns/:campaignId/encounters/bestiary` | `campaign/bestiary-routes.ts` |
| GET | `/campaigns/:campaignId/factions` | `campaign/factions.ts` |
| POST | `/campaigns/:campaignId/factions` | `campaign/factions.ts` |
| DELETE | `/campaigns/:campaignId/factions/:factionId` | `campaign/factions.ts` |
| PATCH | `/campaigns/:campaignId/factions/:factionId` | `campaign/factions.ts` |
| PUT | `/campaigns/:campaignId/factions/relations` | `campaign/factions.ts` |
| GET | `/campaigns/:campaignId/handouts` | `campaign/handout-routes.ts` |
| POST | `/campaigns/:campaignId/handouts` | `campaign/handout-routes.ts` |
| DELETE | `/campaigns/:campaignId/handouts/:handoutId` | `campaign/handout-routes.ts` |
| POST | `/campaigns/:campaignId/handouts/:handoutId/show` | `campaign/handout-routes.ts` |
| GET | `/campaigns/:campaignId/notes` | `campaign/note-routes.ts` |
| POST | `/campaigns/:campaignId/notes` | `campaign/note-routes.ts` |
| DELETE | `/campaigns/:campaignId/notes/:noteId` | `campaign/note-routes.ts` |
| GET | `/campaigns/:campaignId/notes/:noteId` | `campaign/note-routes.ts` |
| PATCH | `/campaigns/:campaignId/notes/:noteId` | `campaign/note-routes.ts` |
| POST | `/campaigns/:campaignId/notes/:noteId/grants` | `campaign/note-routes.ts` |
| DELETE | `/campaigns/:campaignId/notes/:noteId/grants/:userId` | `campaign/note-routes.ts` |
| GET | `/campaigns/:campaignId/quests` | `campaign/quest-routes.ts` |
| POST | `/campaigns/:campaignId/quests` | `campaign/quest-routes.ts` |
| DELETE | `/campaigns/:campaignId/quests/:questId` | `campaign/quest-routes.ts` |
| PATCH | `/campaigns/:campaignId/quests/:questId` | `campaign/quest-routes.ts` |
| POST | `/campaigns/:campaignId/quests/:questId/objectives` | `campaign/quest-routes.ts` |
| DELETE | `/campaigns/:campaignId/quests/:questId/objectives/:objectiveId` | `campaign/quest-routes.ts` |
| PATCH | `/campaigns/:campaignId/quests/:questId/objectives/:objectiveId` | `campaign/quest-routes.ts` |
| GET | `/campaigns/:campaignId/rules` | `campaign/rules-routes.ts` |
| POST | `/campaigns/:campaignId/rules` | `campaign/rules-routes.ts` |
| DELETE | `/campaigns/:campaignId/rules/:ruleId` | `campaign/rules-routes.ts` |
| PUT | `/campaigns/:campaignId/rules/:ruleId` | `campaign/rules-routes.ts` |
| PUT | `/campaigns/:campaignId/scenes/:sceneId/playlist` | `campaign/audio-routes.ts` |
| PUT | `/campaigns/:campaignId/scenes/:sceneId/playlists` | `campaign/audio-routes.ts` |
| POST | `/campaigns/:campaignId/session/end` | `campaign/chronicle-routes.ts` |
| POST | `/campaigns/:campaignId/session/start` | `campaign/chronicle-routes.ts` |
| GET | `/campaigns/:campaignId/tables` | `campaign/roll-table-routes.ts` |
| POST | `/campaigns/:campaignId/tables` | `campaign/roll-table-routes.ts` |
| DELETE | `/campaigns/:campaignId/tables/:tableId` | `campaign/roll-table-routes.ts` |
| PUT | `/campaigns/:campaignId/tables/:tableId` | `campaign/roll-table-routes.ts` |
| POST | `/campaigns/:campaignId/tables/:tableId/roll` | `campaign/roll-table-routes.ts` |
| GET | `/campaigns/:campaignId/time` | `campaign/world-time.ts` |
| PUT | `/campaigns/:campaignId/time` | `campaign/world-time.ts` |
| GET | `/srd/monsters` | `campaign/bestiary-routes.ts` |

### Scenes

| Method | Path | Source |
|---|---|---|
| DELETE | `/campaigns/:campaignId/characters/:characterId` | `tabletop/scene/objects/remove.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/flying` | `tabletop/scene/objects/flight.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/interact` | `tabletop/scene/object-states.ts` |
| PATCH | `/campaigns/:campaignId/characters/:characterId/shared` | `tabletop/scene/objects/shared-flag.ts` |
| PUT | `/campaigns/:campaignId/characters/:characterId/state` | `tabletop/scene/object-states.ts` |
| PUT | `/campaigns/:campaignId/fog` | `tabletop/scene/routes/fog.ts` |
| GET | `/campaigns/:campaignId/scene-backups` | `tabletop/scene/routes/manage.ts` |
| POST | `/campaigns/:campaignId/scene-backups/:backupId/restore` | `tabletop/scene/routes/manage.ts` |
| GET | `/campaigns/:campaignId/scenes` | `tabletop/scene/routes/list.ts` |
| POST | `/campaigns/:campaignId/scenes` | `tabletop/scene/routes/create.ts` |
| GET | `/campaigns/:campaignId/scenes/:sceneId` | `tabletop/scene/routes/view.ts` |
| PATCH | `/campaigns/:campaignId/scenes/:sceneId` | `tabletop/scene/routes/update.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId` | `tabletop/scene/routes/manage.ts` |
| GET | `/campaigns/:campaignId/scenes/:sceneId/contents` | `tabletop/scene/routes/manage.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/copy` | `tabletop/scene/routes/manage.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/counters` | `tabletop/scene/scene-counters.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/counters/:counterId` | `tabletop/scene/scene-counters.ts` |
| PATCH | `/campaigns/:campaignId/scenes/:sceneId/counters/:counterId` | `tabletop/scene/scene-counters.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/drawings` | `tabletop/scene/scene-drawings.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/drawings/:drawingId` | `tabletop/scene/scene-drawings.ts` |
| PATCH | `/campaigns/:campaignId/scenes/:sceneId/drawings/:drawingId` | `tabletop/scene/scene-drawings.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/drawings/all` | `tabletop/scene/scene-drawings.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/drawings/mine` | `tabletop/scene/scene-drawings.ts` |
| GET | `/campaigns/:campaignId/scenes/:sceneId/export` | `tabletop/scene/routes/file.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/objects` | `tabletop/scene/objects/place.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/objects/:objectId` | `tabletop/scene/objects/unplace.ts` |
| PUT | `/campaigns/:campaignId/scenes/:sceneId/objects/:objectId` | `tabletop/scene/objects/move.ts` |
| GET | `/campaigns/:campaignId/scenes/:sceneId/objects/:objectId/reach` | `tabletop/scene/objects/reach.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/pins` | `tabletop/scene/scene-pins.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/pins/:pinId` | `tabletop/scene/scene-pins.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/templates` | `tabletop/scene/scene-templates.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/templates/:templateId` | `tabletop/scene/scene-templates.ts` |
| PATCH | `/campaigns/:campaignId/scenes/:sceneId/templates/:templateId` | `tabletop/scene/scene-templates.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/templates/:templateId/saves` | `tabletop/scene/scene-templates.ts` |
| PUT | `/campaigns/:campaignId/scenes/:sceneId/terrain` | `tabletop/scene/routes/terrain.ts` |
| GET | `/campaigns/:campaignId/scenes/:sceneId/triggers` | `tabletop/scene/scene-triggers.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/triggers` | `tabletop/scene/scene-triggers.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/triggers/:triggerId` | `tabletop/scene/scene-triggers.ts` |
| PATCH | `/campaigns/:campaignId/scenes/:sceneId/triggers/:triggerId` | `tabletop/scene/scene-triggers.ts` |
| PATCH | `/campaigns/:campaignId/scenes/:sceneId/walls` | `tabletop/scene/walls.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/walls` | `tabletop/scene/walls.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/walls/:wallId` | `tabletop/scene/walls.ts` |
| PATCH | `/campaigns/:campaignId/scenes/:sceneId/walls/:wallId` | `tabletop/scene/walls.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/walls/:wallId/strike` | `tabletop/scene/walls.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/walls/batch` | `tabletop/scene/walls.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/walls/remove` | `tabletop/scene/walls.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/walls/alternate` | `tabletop/scene/wall-alternate.ts` |
| POST | `/campaigns/:campaignId/scenes/import` | `tabletop/scene/routes/file.ts` |

### Rolls

| Method | Path | Source |
|---|---|---|
| GET | `/campaigns/:campaignId/rolls` | `tabletop/rolls/routes.ts` |
| POST | `/campaigns/:campaignId/rolls` | `tabletop/rolls/routes.ts` |
| POST | `/campaigns/:campaignId/rolls/:rollId/apply` | `tabletop/rolls/routes.ts` |
| GET | `/campaigns/:campaignId/rolls/attack-preview` | `tabletop/rolls/routes.ts` |
| POST | `/campaigns/:campaignId/rolls/check` | `tabletop/rolls/routes.ts` |
| GET | `/campaigns/:campaignId/roll-macros` | `campaign/roll-macro-routes.ts` |
| POST | `/campaigns/:campaignId/roll-macros` | `campaign/roll-macro-routes.ts` |
| PUT | `/campaigns/:campaignId/roll-macros/:macroId` | `campaign/roll-macro-routes.ts` |
| DELETE | `/campaigns/:campaignId/roll-macros/:macroId` | `campaign/roll-macro-routes.ts` |

### Combat

| Method | Path | Source |
|---|---|---|
| GET | `/campaigns/:campaignId/characters/:characterId/attack-options` | `tabletop/combat/actions.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/breath-weapon` | `tabletop/combat/actions.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/combat-action` | `tabletop/combat/actions.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/inspiring-leader` | `tabletop/combat/actions.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/travel` | `tabletop/combat/actions.ts` |
| GET | `/campaigns/:campaignId/scenes/:sceneId/combat-summary` | `tabletop/combat/combat-end.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/hide` | `tabletop/combat/stealth.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/initiative` | `tabletop/combat/combat-end.ts` |
| GET | `/campaigns/:campaignId/scenes/:sceneId/initiative` | `tabletop/combat/initiative.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId` | `tabletop/combat/initiative.ts` |
| PATCH | `/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId` | `tabletop/combat/initiative.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId/act` | `tabletop/combat/turn-actions.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId/dash` | `tabletop/combat/turn-actions.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId/economy` | `tabletop/combat/turn-actions.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/initiative/advance` | `tabletop/combat/turn.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/initiative/join` | `tabletop/combat/initiative.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/initiative/npc` | `tabletop/combat/initiative.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/initiative/start` | `tabletop/combat/initiative.ts` |
| GET | `/campaigns/:campaignId/scenes/:sceneId/loot/:corpseId` | `tabletop/combat/loot-routes.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/loot/:corpseId` | `tabletop/combat/loot-routes.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/search` | `tabletop/combat/stealth.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/unhide` | `tabletop/combat/stealth.ts` |

### Casting

| Method | Path | Source |
|---|---|---|
| POST | `/campaigns/:campaignId/characters/:characterId/spells/:characterSpellId/cast` | `tabletop/spells/cast.ts` |
| POST | `/campaigns/:campaignId/counterspell/:windowId` | `tabletop/spells/counterspell.ts` |
| POST | `/campaigns/:campaignId/counterspell/:windowId/decline` | `tabletop/spells/counterspell.ts` |

### NPC turns

| Method | Path | Source |
|---|---|---|
| POST | `/campaigns/:campaignId/scenes/:sceneId/initiative/auto` | `tabletop/auto-turn/routes.ts` |

### Live channel

| Method | Path | Source |
|---|---|---|
| GET | `/live` | `tabletop/live/socket.ts` |

### Phone page

| Method | Path | Source |
|---|---|---|
| GET | `/phone` | `app.ts` |
| GET | `/phone/` | `app.ts` |

