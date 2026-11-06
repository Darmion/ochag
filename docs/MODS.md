# Mods

A mod changes Ochag without changing its code. A mod is a folder with a `mod.json` file inside the **mods folder**; the app picks it up by itself. There are three kinds of mods.

| | Mechanics | Visual | Art pack |
|---|---|---|---|
| Changes | rules: class features, spell effects, new table actions | appearance only: colours, backgrounds, pictures, fonts | portraits, crests, race signs, item and scenery pictures |
| Contains | code (JavaScript or TypeScript) | `.css` files and images, no code | images and their captions, no code |
| Installed by | the GM, on the computer that runs the server | any player, for themselves | any player, for themselves, section by section |
| Applies to | everyone at the table: the GM's server computes it | only the player who installed it | only the player who installed it |
| Takes effect | after the server restarts | at once, with "Refresh list" | at once, with a checkbox in the Mods window |

The mods folder is `%APPDATA%\ttrpg-foundation\mods`; the "Mods" button in the top bar has "Open the mods folder". Every participant sees the server's mechanics mods in the same window, so players know when the rules at the table differ from the built-in ones.

## Precedence

Mods are registered after the built-in code. When a mod replaces a feature or an effect with the same id, the mod's version is used. Mods load in alphabetical order of their folders; when two mods replace the same thing, the last one wins, and the Mods window shows which mod replaced which.

A broken mod changes nothing: whatever it registered before the error is discarded, and the Mods window shows why it did not load.

## Bundled mods

Some features ship as mods in the `mods` folder next to the program. They stay off until someone turns them on:

- **Art pack** — [mods/ai-art](../mods/ai-art/mod.json). Each player turns it on for themselves in the "Pictures — mine" section of the Mods window.
- **Mechanics** — [mods/lss-import](../mods/lss-import/mod.json), the Long Story Short sheet import. The GM ticks it in the Mods window and clicks "Restart the server". The choice is stored in `%APPDATA%\ttrpg-foundation\mods-enabled.json`; the app passes the folder and the list to the server as `BUNDLED_MODS_DIR` and `MODS_ENABLED` (comma-separated).

## Security

A mechanics mod is a program that runs on the GM's computer with the same rights as the server: it can read files, use the network and change the database. **Install mechanics mods only from people you trust.** Mods never travel over the network: a player cannot send code to the GM; only the GM can put a mod folder on their own computer.

A visual mod contains no code. The app reads only `.css` files and the images and fonts in the mod folder and embeds them in the page. Network links and files outside the mod folder are not loaded.

## mod.json

```json
{
  "id": "stronger-second-wind",
  "name": "Второе дыхание с Телосложением",
  "version": "1.0.0",
  "kind": "mechanics",
  "author": "Author name",
  "description": "What the mod does, in a sentence or two.",
  "entry": "index.js",
  "translations": {
    "en": { "name": "Second Wind with Constitution", "description": "…", "author": "…" }
  }
}
```

| Field | Meaning |
|---|---|
| `id` | lowercase Latin letters, digits and hyphens, 2–64 characters, starting with a letter or digit; unique |
| `kind` | `"mechanics"` (the default), `"visual"` or `"art"` |
| `entry` | the main file of a mechanics mod: `index.js` by default; `.mjs` and `.ts` also work |
| `styles` | a visual mod's list of `.css` files |
| `enabled` | `false` turns the mod off without deleting the folder |
| `translations` | the name, description and author in other languages, keyed by language code; an art pack can also translate its section names with `"sections": { "<section id>": "…" }`. The Mods window shows the text in the interface language and falls back to `name` and `description` |

The game's source language is Russian. Texts a mechanics mod produces at run time (messages, captions) are shown as written: the interface translation does not cover them.

## Mechanics mods

The main file exports a function. The server calls it at startup with `api`:

```js
export default function (api) {
  // Wrap a built-in feature: take it and add to it.
  const builtIn = api.features.actionOf('second-wind');
  api.features.action('second-wind', async use => {
    const done = await builtIn(use);
    return { ...done, message: `${done.message} (modded)` };
  });
}
```

A complete example is [examples/mods/stronger-second-wind](../examples/mods/stronger-second-wind/index.js): Second Wind also heals the Constitution modifier, and the fighter gains a new feature, Battle Cry. Copy the folder into the mods folder and restart the server.

### The api object

| Call | What it does |
|---|---|
| `api.features.action(id, fn)` | the function behind "use feature" for this id; replaces a built-in feature or adds a new one |
| `api.features.view(id, fn)` | how the feature's button looks on the sheet |
| `api.features.define({ id, classId, level, name, use, resource, text })` | a class feature: who gets it and from which level; also redefines a built-in description |
| `api.features.actionOf(id)`, `api.features.viewOf(id)` | what is registered under the id now, so that a mod can wrap it instead of rewriting it |
| `api.spellEffect(index, { code, rounds, self?, parameters? })` | the effect of an SRD spell by its index (`'longstrider'`, `'bless'` and so on) |
| `api.importers.define({ id, name, description, extensions, translations, parse })` | a character sheet import format. `parse(original)` returns `{ proposal, mapping, warnings }` in the format of [packages/importer/proposal.ts](../packages/importer/proposal.ts). The import buttons appear only when at least one importer exists |
| `api.routes((ctx, kit) => { … })` | table routes, registered after the built-in ones |
| `api.log(text)` | a line in the server log |
| `api.mod` | this mod's `id`, `name`, `version` and folder |

**A feature function** receives `use` and returns `{ message, float, economyScene, heal }`, like the built-in features in [apps/server/src/rules/class-features/classes/](../apps/server/src/rules/class-features/classes/). `use` holds:

- the database connection `q`, inside a transaction;
- `campaignId`, `characterId`, `userId`, `sceneId` and `targetId`;
- the sheet `row`, the character's `classes` and the conditions `state`;
- `enforce`: whether the action economy applies (it does not for the GM);
- the request body `request.body`;
- `ctx`, the server's checks and engines: `ctx.actionEconomy`, `ctx.applyHpChange`, `ctx.rollDie`, `ctx.insertRoll`, `ctx.notifyCampaign` and others.

**A view function** receives `look` and returns only the fields it sets: `detail` (a hint), `reason` (why the feature cannot be used now; `null` when it can), `active`, `choices` and `limit`. `look` holds the sheet, the classes, the conditions, the initiative entry `entry`, the ready-made reasons `unable`, `bonusReason` and `actionReason`, the feature itself `feature` and its resource `resource`.

**A route** receives `ctx`, the table context ([apps/server/src/tabletop/context.ts](../apps/server/src/tabletop/context.ts): `app`, `db`, `auth`, `membership` and the engines), and `kit`, helpers that already have the context: `getScene`, `loadPlacements`, `notify`, `notifyCampaign`, `applyHpChange`, `rollDie`, `insertRoll`, `reject`, `uuid` and `objectSchema`. Check access the way built-in routes do: `await ctx.auth(request)`, then `await ctx.membership(...)`.

The api cannot yet add conditions, campaign rules, race features or feats, change the bestiary, or add client-side parts (windows and buttons for a mod's own routes). A new class feature appears in the sheet's feature list and is used with its button, but the client does not know it in advance; for example, the level-up window does not show it.

## Visual mods

```json
{ "id": "forest-night", "name": "Лесная ночь", "version": "1.0.0", "kind": "visual", "styles": ["theme.css"] }
```

A style changes the theme variables of the app. There are two sets:

- the interface colours `--g-*` from [apps/client/src/styles/game.css](../apps/client/src/styles/game.css): stone `--g-stone-1` to `--g-stone-3`, the frame gold `--g-gold`, the text `--g-text` and the accent `--g-accent`;
- the shared variables from [apps/client/src/styles/fantasy.css](../apps/client/src/styles/fantasy.css): `--ink`, `--brass`, `--parchment-background` and others.

The built-in skins in [apps/client/src/styles/skins.css](../apps/client/src/styles/skins.css) change the same variables. To take precedence over any skin, use the selector `html:root[data-ui][data-skin]`, as the example does. Some small details are coloured directly rather than through variables; a mod recolours them only by naming the element.

Images and fonts are files next to the style, referenced as `url("leaves.svg")`, and the app embeds them itself. Allowed are PNG, JPEG, WebP, GIF, SVG, WOFF2, WOFF, TTF and OTF, up to 2 MB each; a style file is limited to 1 MB.

The example is [examples/mods/forest-night](../examples/mods/forest-night/theme.css). A player can turn a visual mod off for themselves with its checkbox in the Mods window. Visual mods work in the desktop app; the browser and phone versions do not load them.

## Art packs

```json
{
  "id": "ai-art", "name": "Картинки, нарисованные ИИ", "version": "1.0.0", "kind": "art", "library": "library.json",
  "sections": [{ "id": "bestiary", "name": "Портреты бестиария", "paths": ["portraits/bestiary/"] }]
}
```

The pictures live in the mod's `art/` folder: WebP, PNG, JPEG or GIF, up to 2 MB each. A picture's path is its place in the game, the same as the paths of the game's own pictures in `apps/client/public/art`; a pack's picture replaces the game's picture with the same path.

| Path | Where it shows |
|---|---|
| `portraits/bestiary/<SRD index>` | the creature's portrait in the bestiary, and for NPCs with its name |
| `portraits/heroes/<race>-male`, `-female` | portraits to choose from when creating a hero |
| `portraits/npc/merchant-male`, `townsperson-female`, `guard-female` and so on | townsfolk by the start of their name («Торговец», «Горожанка», «Стражница») |
| `ui/classes/<class>`, `ui/races/<race>` | class crests and race signs |
| `items/…`, `scene/…`, `ui/symbols/…` | items and scenery; the paths are listed in [apps/client/src/art/itemArt.ts](../apps/client/src/art/itemArt.ts) |

- `sections` are the pack's parts; each one is turned on separately. `paths` are path prefixes inside `art/`; a section is limited to 64 MB.
- `library` holds the captions for the picture chooser, in the format of [apps/client/src/art/artLibrary.json](../apps/client/src/art/artLibrary.json), up to 4 MB. A portrait can list `names` (`["Гоблин", "goblin"]`): an NPC with that name on the table gets the portrait by itself. Without the file, the picture's name becomes its caption.

A pack in the mods folder is on at once. A pack bundled with the app stays off until it is turned on in the Mods window. Without any pack, a portrait shows the first letter of the name, and an item shows the game's picture or none.

## Where this is in the code

- Server: [apps/server/src/system/mods.ts](../apps/server/src/system/mods.ts) (loading, the api, the `GET /mods` route); startup in `apps/server/src/main.ts`, which reads `MODS_DIR`; the desktop app sets it in `apps/desktop/host/server.cjs`.
- Visual mods: [apps/desktop/host/visual-mods.cjs](../apps/desktop/host/visual-mods.cjs) and [apps/client/src/settings/visualMods.ts](../apps/client/src/settings/visualMods.ts); the window is `apps/client/src/components/settings/ModsDialog.vue`.
- Art packs: [apps/desktop/host/art-packs.cjs](../apps/desktop/host/art-packs.cjs) reads the packs, [apps/client/src/art/artPacks.ts](../apps/client/src/art/artPacks.ts) turns sections on, and [apps/client/src/art/artSource.ts](../apps/client/src/art/artSource.ts) decides where the game takes a picture for a path.
- Tests: `apps/server/test/system/mods.test.ts`, `mods-examples.test.ts`, `visual-mods.test.ts`, `art-packs.test.ts`; the client art tests are in `apps/client/test/art/`.
