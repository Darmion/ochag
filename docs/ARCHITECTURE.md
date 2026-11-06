# Architecture

Ochag is a desktop app built from three parts that run on the GM's computer, plus the players' copies of the app.

| Part | Where | Role |
|---|---|---|
| Server | `apps/server` | Fastify API and the `/live` WebSocket over PostgreSQL. The source of truth: it checks every permission and applies the game rules |
| Client | `apps/client` | Vue 3 and TypeScript; the 3D table is built on Babylon.js. Runs in the Electron window, and a reduced phone version runs in a browser |
| Desktop shell | `apps/desktop` | Electron main process: starts the embedded PostgreSQL and the server, keeps settings, opens windows and Windows dialogs |
| Rules | `packages/domain` | game rules and SRD 5.1 data, with no server, database or DOM |
| Import format | `packages/importer` | the common character sheet format that import mods produce |
| Mods | `mods`, the mods folder | optional mechanics, visual and art mods (see [MODS.md](MODS.md)) |

## Trust boundaries

- **The server decides.** The client never talks to the database. Every route authenticates the session, checks membership in the campaign and then the specific right; hidden data (fog of war, hidden sheet fields, secret rolls) is filtered on the server before it is sent.
- **The window is sandboxed.** The renderer runs with `sandbox`, `contextIsolation` and no Node.js. Its only bridge is the `window.desktop` object from `apps/desktop/preload.cjs`. API calls go through the main process (`api:request` in `apps/desktop/main/api-request.cjs`), which accepts only routes on the allowlist in `apps/desktop/main/api-routes.cjs` and limits body and file sizes. The page's Content Security Policy allows only its own scripts.
- **The main process checks the sender.** Every IPC handler accepts commands only from the main window, or, where allowed, from the read-only player view window (`apps/desktop/main/senders.cjs`).
- **Certificates are pinned.** On a network the server speaks HTTPS and WSS with a self-signed certificate. The player's app trusts it after comparing the certificate code with the GM's screen or the invitation, and remembers it per address.
- **Over the internet.** Requests from public addresses or through the tunnel register only with an invitation, and the registration spends it. Rate limits count real addresses, and failed sign-ins are capped per login name, separately for the internet and the home network.
- **The host is the server's own computer.** The tokenless `/host/*` routes answer only loopback requests that did not come through the tunnel and whose `Host` is not a foreign domain name, so a web page in the GM's browser cannot use them through DNS rebinding.
- **Updates are checked against GitHub.** A player's app takes an installer from the GM's server only when its checksum matches the official release of that version on GitHub; without internet the player has to confirm.

## Server

`apps/server/src/app.ts` builds the Fastify app: the rate limiter, WebSocket and multipart plugins, the error handler, and then the route plugins. Shared services (`auth`, `membership`, `requirePermission`, sessions) are created once in `app/deps.ts`.

| Folder | Contents |
|---|---|
| `app/` | parts of the app: errors and schemas, shared dependencies, sign-in, host, campaign and member routes |
| `system/` | security, network addresses, presence, rate-limit keys, campaign events, assets, object files, campaign transfer, updates, mods |
| `campaign/` | what the GM keeps for the campaign: notes, quests, handouts, chronicle, chat, dialogues, roll tables, art, house rules, factions, audio, world time, encounters, bestiary, mini-games |
| `characters/` | the character sheet by sections (`sheet/`), hero creation, level-up, import drafts and the importer registry, inventory, shops, rests, experience, magic items, multiclassing |
| `rules/` | rules shared by several places: conditions, the action economy, class features, summons, shape changes |
| `spells/` | SRD and campaign spells, character spells, slots, spellcasting, spell templates |
| `tabletop/` | scenes and combat: `scene/`, `rolls/`, `combat/`, `spells/` (casting in stages), `auto-turn/` (NPC turns), `live/` (the WebSocket) |

Where new code goes: a rule shared by several places in `rules/`; something a character owns in `characters/`; something the GM keeps for the whole campaign in `campaign/`; anything on a scene or in combat in `tabletop/`; pure rules with no database or network in `packages/domain`.

### Errors and messages

A route rejects a request by throwing an error with a status code (`reject(400, '…')` or `fail(…)`); the error handler sends `{ error, message }` as JSON, and unexpected errors become a generic 500 without details. Messages are written in Russian, the source language; the client shows them translated (see [I18N.md](I18N.md)). Every error tells the user what to do next.

### The table context

Functions that only work with a connection and data take the connection `q` (the database or a transaction) as their first parameter, for example `loadPlacements(q, campaignId, sceneId)`. Functions that need shared application state (the database for their own transaction, `/live` notifications, the condition, trigger and class-feature engines) take the table context first:

```ts
export async function applyHpChange(ctx: TableContext, q: Queryable, campaignId: string, …) {
  const { conditionEngine, experience } = ctx;
  …
}
```

`TableContext` is defined in `apps/server/src/tabletop/context.ts`. `withTable(ctx, fn)` turns such a function into one without the context, for engines and modules that expect a plain function. There is one context per app instance (every test builds its own app), so state lives in the context, never in module variables.

### Route modules

A module registers its routes in one function:

```ts
export function registerWallRoutes(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;
  app.post('/campaigns/:campaignId/scenes/:sceneId/walls', { schema: … }, async request => {
    const userId = await auth(request);
    return db.transaction(async q => {
      const member = await membership(q, request.params.campaignId, userId, true);
      …
    });
  });
}
```

To add a module:

1. Create the file in the right folder, for example `tabletop/combat/morale.ts`.
2. Write functions that take `q` as usual; give a function `ctx: TableContext` as its first parameter when it needs the database, notifications or an engine.
3. Register routes in `registerMoraleRoutes(ctx)`. Follow the order the other routes use: `auth`, then `membership`, then the right (`canManage`, `rightsOf`), the work inside `db.transaction`, and `notify(ctx, campaignId, sceneId)` so that every table updates.
4. Call it from `apps/server/src/tabletop/index.ts`.
5. Add a test next to the others, for example `apps/server/test/tabletop/combat/morale.test.ts`: the server runs in memory and requests go through `app.inject`. `npm test` finds it by its name.
6. Describe the route in [API.md](API.md), and add it to the desktop allowlist when it introduces a new path segment or query parameter.

Do not:

- call functions of other table modules at the top level of a file: modules refer to each other in a cycle, which is fine only while calls happen inside functions;
- keep state in module variables;
- call `db.query` inside `db.transaction`; use `q`.

A route can also come from a mechanics mod, without changing the app (see [MODS.md](MODS.md)).

### Class features

`apps/server/src/rules/class-features.ts` holds what features share and registers their routes; the routes are in `rules/class-features/`. Each class has a file in `rules/class-features/classes/` with two registries:

- **actions** — `async function myFeature(use: FeatureUse): Promise<FeatureResult>` and a line `'my-feature': myFeature` in the class's table. `use` carries the connection, the sheet, the classes, the conditions, the target and scene, `enforce` (whether the action economy applies) and `use.ctx`; the result is `{ message, float, economyScene, heal }`. Work to do after the transaction goes into `use.after`, and the creatures hurt and healed into `use.changed` and `use.healed`;
- **views** — a function that returns only the fields it sets for the feature's button: `detail`, `reason` (`null` when the feature can be used), `active`, `choices`, `limit`.

The feature itself (id, class, level) is described in `packages/domain/character/class-features.ts`. The list of accepted ids in the route schema comes from the registry, so it needs no separate update.

## Rules package

`packages/domain` has no server, database or DOM, and its tests sit next to the modules.

| Folder | Contents |
|---|---|
| `character/` | classes, features, levels, rests, equipment, feats, races |
| `combat/` | the action economy, conditions, target choice, turn order |
| `dice/` | dice and formulas |
| `map/` | distances, areas, walls, line of sight, light, path finding |
| `spells/` | spell mechanics and templates, slots, summons |
| `world/` | bestiary, chronicle, clock, dialogues, factions, roll tables |
| `minigames/` | the rules of the mini-games |
| `i18n/` | the translation core (copied into the client) |
| `srd/` | SRD 5.1 data and its attribution |

## Database

PostgreSQL. The migrations are numbered SQL files in `db/migrations`; `scripts/migrations.ts` lists them, `scripts/migrate.ts` applies them, and the server checks the schema version at startup. The app connects as the restricted role `ttrpg_app` (`db/provision_runtime.sql`). The desktop app runs an embedded PostgreSQL and applies missing migrations itself. Its Windows binaries need the Microsoft Visual C++ runtime, so `apps/desktop/host/vc-runtime.cjs` checks for it before the database starts and the window offers Microsoft's installer when it is missing. Tests run against an in-memory PostgreSQL (PGlite) and never touch a real database.

## Client

The root of `apps/client/src` holds only the entry points (`main.ts`, `phoneMain.ts`, `App.vue`, `PhoneApp.vue`, `PlayerViewApp.vue`), the `desktop.d.ts` declarations and the shared styles. Logic without windows lives in folders by area, and windows in `components/` by the same areas.

| Folder | Contents |
|---|---|
| `art/` | pictures: items, portraits, spells, the picture library, cropping, icons, art packs |
| `campaign/` | campaign events, rights, house rules, chat, members, objects, world clock, music |
| `connection/` | the server connection, the host, latency, updates |
| `i18n/` | `t()`, the page translation layer and the texts for Windows dialogs |
| `rules/` | rule catalogues: conditions, dice, classes, object materials, glossary |
| `settings/` | settings: theme, scale, interface, hotkeys, cursor, grid, camera, text, visual mods |
| `tabletop/` | the table: `view/` (the table tab, split into composables), `board/` (the Babylon.js scene, split into modules), `layout/` (window layout) |
| `actionBar/`, `characterSheet/`, `characterWizard/`, `personalization/`, `phone/`, `spellBuilder/`, `spellsPanel/` | the logic of the large windows of the same names |

Two patterns repeat:

- **A large window is a thin component over composables.** `components/tabletop/TabletopView.vue` keeps the state and wiring; each part of its logic is a `useX()` function in `tabletop/view/`. The action bar, the character sheet, the spell panel, the spell builder and the hero wizard follow the same split.
- **The 3D table is assembled from modules.** `tabletop/scene.ts` creates the engine, the scene and the camera and assembles the `createX()` modules from `tabletop/board/` in creation order: weather, light, fog, walls, figures and their labels, areas, the ruler, the pointer, selection and the rest.

The client receives changes over the `/live` WebSocket (`tabletop/live.ts`) and reloads what changed through the API.

## Desktop shell

`apps/desktop/main.cjs` sets the data folder (`%APPDATA%\ttrpg-foundation`), creates the shared state `ctx` (paths, windows, settings), registers the IPC handlers and starts the app. Functions that need that state take `ctx` first.

- `apps/desktop/main/` holds the IPC handlers by area: the connection and the server address, API requests and their allowlist, saved sign-ins, campaign and object files, languages and mods, updates, the GM's server, backups, internet play, windows, and the Windows dialog texts. Each module exports `registerXHandlers(ctx)`.
- `apps/desktop/host/` runs the GM's side: the embedded database and the server process, configuration and saved credentials, the TLS certificate, network addresses and the firewall rule, the Cloudflare tunnel and port forwarding, backups, updates, and the loading of bundled, visual and art mods.

## Checks and conventions

- `npm run typecheck` and `npm --prefix apps/client exec vue-tsc -- -b` check types. Unused imports, variables and parameters are errors (`noUnusedLocals`, `noUnusedParameters`), so code that nothing reads cannot stay. When a feature is removed, its styles, strings and tests go with it.
- `npm test` runs every `*.test.ts` under `packages`, `apps/client/test`, `apps/server/test` and `mods`. Server tests build the app in memory; client tests import modules without Vue or the DOM.
- `npm run i18n:extract` updates the string list and `en.json` after any text change, and `npm run i18n:check` fails while any string has no English (see [I18N.md](I18N.md)).
- `.github/workflows/ci.yml` runs on every push and pull request, on Windows: the type checks, the tests, the client build, and checks that the strings are extracted and all have English.
- Comments are rare and in English, only where the code alone cannot explain a decision: a workaround for Chromium, Electron or PostgreSQL, a race, a security check, an unusual edge case.
