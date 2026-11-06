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

**Server to client.** Most messages tell the client what changed so that it reloads it through the API: `changed` (the scene), `rolls`, `initiative`, `notes`, `character` (with `characterId`), `characters`, `quests`, `handout`, `chat` and `chatRemoved`, `dialogue`, `art`, `audio`, `sound` and `soundStop`, `hp`, `time`, `factions`, `experience`. Others carry an event: `attack`, `float`, `notice`, `combatSummary`, `passage`, the reaction prompts `opportunity`, `counterspell`, `counterspell-closed`, `reaction-offer` and `spell-special`. The payloads are read in `apps/client/src/tabletop/live.ts`.

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
| GET | `/campaigns/:campaignId/assets/:assetId` | `system/asset-routes.ts` |
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
| POST | `/srd/spells/:index/mechanics` | `spells/srd-routes.ts` |
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

### Conditions and rules

| Method | Path | Source |
|---|---|---|
| POST | `/campaigns/:campaignId/characters/:characterId/death-save` | `rules/condition-routes.ts` |
| POST | `/campaigns/:campaignId/characters/:characterId/stand` | `rules/condition-routes.ts` |
| POST | `/campaigns/:campaignId/characters/revive` | `rules/condition-routes.ts` |
| POST | `/campaigns/:campaignId/conditions/apply` | `rules/condition-routes.ts` |

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
| GET | `/campaigns/:campaignId/scenes` | `tabletop/scene/routes/list.ts` |
| POST | `/campaigns/:campaignId/scenes` | `tabletop/scene/routes/create.ts` |
| GET | `/campaigns/:campaignId/scenes/:sceneId` | `tabletop/scene/routes/view.ts` |
| PATCH | `/campaigns/:campaignId/scenes/:sceneId` | `tabletop/scene/routes/update.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/counters` | `tabletop/scene/scene-counters.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/counters/:counterId` | `tabletop/scene/scene-counters.ts` |
| PATCH | `/campaigns/:campaignId/scenes/:sceneId/counters/:counterId` | `tabletop/scene/scene-counters.ts` |
| POST | `/campaigns/:campaignId/scenes/:sceneId/drawings` | `tabletop/scene/scene-drawings.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/drawings/:drawingId` | `tabletop/scene/scene-drawings.ts` |
| PATCH | `/campaigns/:campaignId/scenes/:sceneId/drawings/:drawingId` | `tabletop/scene/scene-drawings.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/drawings/all` | `tabletop/scene/scene-drawings.ts` |
| DELETE | `/campaigns/:campaignId/scenes/:sceneId/drawings/mine` | `tabletop/scene/scene-drawings.ts` |
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

### Rolls

| Method | Path | Source |
|---|---|---|
| GET | `/campaigns/:campaignId/rolls` | `tabletop/rolls/routes.ts` |
| POST | `/campaigns/:campaignId/rolls` | `tabletop/rolls/routes.ts` |
| POST | `/campaigns/:campaignId/rolls/:rollId/apply` | `tabletop/rolls/routes.ts` |
| GET | `/campaigns/:campaignId/rolls/attack-preview` | `tabletop/rolls/routes.ts` |
| POST | `/campaigns/:campaignId/rolls/check` | `tabletop/rolls/routes.ts` |

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

