# Mods

A mod changes Ochag without changing its code. A mod is a folder with a `mod.json` file inside the **mods folder**; the app picks it up by itself. There are four kinds of mods.

| | Mechanics | Visual | Art pack | Spell pack |
|---|---|---|---|---|
| Changes | rules: class features, spell effects, new table actions | appearance only: colours, backgrounds, pictures, fonts | portraits, crests, race signs, item and scenery pictures | adds homebrew spells to a campaign |
| Contains | code (JavaScript or TypeScript) | `.css` files and images, no code | images and their captions, no code | spell files saved by the spell builder, no code |
| Installed by | the GM, on the computer that runs the server | any player, for themselves | any player, for themselves, section by section | the GM, on the computer that runs the server |
| Applies to | everyone at the table: the GM's server computes it | only the player who installed it | only the player who installed it | the campaigns the GM adds it to |
| Takes effect | after the server restarts | at once, with "Refresh list" | at once, with a checkbox in the Mods window | when the GM adds it in the Mods window |

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
| `kind` | `"mechanics"` (the default), `"visual"`, `"art"` or `"spells"` |
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
| `api.spellEffect(index, { code, rounds, self?, parameters? })` | the effect of an SRD spell by its index (`'longstrider'`, `'bless'` and so on); it replaces the ready-made effect of that spell's mechanics table |
| `api.importers.define({ id, name, description, extensions, translations, parse })` | a character sheet import format. `parse(original)` returns `{ proposal, mapping, warnings }` in the format of [packages/importer/proposal.ts](../packages/importer/proposal.ts). The import buttons appear only when at least one importer exists |
| `api.conditions.define({ code, name, kind, icon, description, clauses, stages })` | a condition, disease, poison, curse or effect, described by the clauses of the Conditions tab (see below). A code `mod_…` adds a new one; an SRD code (`'poisoned'`, `'sight_rot'`) replaces that rule and keeps its name |
| `api.rules.define({ key, kind, label, description, default, options, topic })` | a campaign rule in the Rules window: `kind: 'flag'` is a switch, `kind: 'choice'` a list of at least two `{ value, label }` options; `topic` puts it in a section (`combat`, `movement`, `magic`, `recovery`, `characters`, `exploration`, `other`). The key starts with `mod_`. The GM's value is checked against the rule: a switch stays a switch, a choice one of its options |
| `api.rules.value(q, campaignId, key)` | the campaign's value of the mod's rule, or its `default` while the GM has not touched it |
| `api.races.define({ id, name, size, speed, bonuses, darkvision, resistances, skills, skillChoices, weapons, languages, cantrip, traits, subraces, icon, tagline, names })` | a race for the hero wizard, next to the SRD ones (see below). The id starts with `mod_` |
| `api.races.subrace(raceId, { id, name, bonuses, speed, darkvision, resistances, weapons, traits })` | a subrace for an SRD race (`'dwarf'`, `'elf'`…) or for a race of a mod loaded earlier |
| `api.bestiary.define({ id, name, en, size, type, ac, hitDice, speed, abilities, cr, attacks, … })` | a creature in the bestiary, next to the SRD ones (see below). The id starts with `mod_` |
| `api.feats.define({ id, name, en, text, abilities, effects })` | a feat: in the level-up list under «Из модов» and in the sheet's «Черты». `abilities` lists the abilities the feat may raise by 1; the player picks one |
| `api.ui.form({ id, title, description, icon, who, scope, submit, fields, run })` | a window in the table's «Ещё» menu: the mod describes its fields, the app draws them with its own controls and checks the values, then calls `run` (see below) |
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

**A condition** is data, not code: the engine reads its clauses, so a condition from a mod works in rolls, movement, attacks, durations and courses like the built-in ones. `clauses` and each stage's `clauses` hold `{ kind, values }` items with the kinds of [packages/domain/combat/condition-rules.ts](../packages/domain/combat/condition-rules.ts) (`CLAUSE_CATALOG`): `own-rolls`, `roll-bonus`, `rolls-against`, `crit-against`, `cannot-attack`, `cannot-approach`, `speed`, `cannot-act`, `resistance`, `with-condition`, `repeat-save`, `lasts` and `note`. Unknown clauses are dropped and unknown values fall back to the default, as when the GM saves them. `kind` is `condition`, `disease`, `poison`, `curse` or `effect`; `icon` is the name of a line icon of the app (an unknown one shows as a warning sign). On the Conditions tab the mod's conditions sit under «Из модов», and the GM can change them for a campaign and return them to the mod's rules.

**A race, a subrace or a feat** is data, too. `bonuses` is `{ constitution: 2, charisma: 1 }` (each from −2 to 3); `size` is `small` or `medium`; `speed` is 10 to 60 feet; `darkvision` is 30, 60, 90 or 120; `skills` and `weapons` are SRD indexes (`perception`, `longsword`); `cantrip` is `{ index, ability }` with an SRD cantrip; `icon` is a line icon of the app. Each trait is `{ name, text, effects }`; the rules read its `effects`, the same way they read the SRD traits:

| Effect | What it does |
|---|---|
| `{ kind: 'save-advantage', condition?, damage?, magic?, concentration?, abilities? }` | advantage on saving throws; every filter given must hold (`condition: 'frightened'`, `damage: 'poison'`, `magic: true`, `abilities: ['wisdom']`) |
| `{ kind: 'roll-bonus', rolls, value, abilities? }` | a number added to `attacks`, `checks`, `saves` or `initiative` |
| `{ kind: 'resistance', damage }` | resistance to a damage type |
| `{ kind: 'speed', feet }` | walking speed changes by this many feet |
| `{ kind: 'passive', skill: 'perception', value }` | passive Perception changes |
| `{ kind: 'reroll-ones' }` | a natural 1 on a d20 attack, check or save is rolled again |
| `{ kind: 'save-proficiency', ability }` | proficiency in this saving throw |
| `{ kind: 'hp-per-level', value }` | the hit point maximum grows by this much per level |

A trait without `text` is described by its effects. A wrong effect, an id without `mod_` or an unknown subrace target refuses the whole mod, and the Mods window says why. The example [examples/mods/ash-folk](../examples/mods/ash-folk/index.js) adds a race with two subraces, a subrace for the SRD dwarf and a feat.

**A bestiary creature** is the same stat block as an SRD one, so it spawns, attacks, saves, resists and takes conditions like them, and auto-turn reads its multiattack. Required: `id` (`mod_…`), `name`, `type` (`'зверь'`, `'нежить'`, `'гуманоид (гоблин)'`), `ac`, `hitDice` (`'4d8+4'`), `cr` (0, 0.125, 0.25, 0.5 or 1–30) and `abilities` (`{ strength, dexterity, constitution, intelligence, wisdom, charisma }` or six numbers). Optional: `en` (the English name), `size`, `alignment`, `hp`, `acNote`, `speed`, `speedNote`, `saves` and `skills` as totals (`{ wisdom: 5 }`, `{ perception: 4 }`), `vulnerable`, `resistant`, `immune` (damage types; `nonmagical` for weapons that are not magical), `conditionImmunities` (condition codes), `darkvision`, `senses`, `passive`, `languages`, `traits`, `actions` and `reactions` (`{ name, text }`), `multiattack` (`{ count, text }`, the text starting with «Совершает…»), `legendary` (`{ actions, resistances, options: [{ name, cost, text }] }`) and `spellcasting` (`{ ability, slots, spells, slotless, text }` with SRD spell indexes). An attack is `{ name, kind, ability, toHit, reach, range, damage, type, versatile, extra, note }`. Hit points, the attack bonus, the average damage and passive Perception are worked out when they are left out. In the bestiary the creature is marked with its mod, and the «Источник» list shows only SRD or only mod creatures.

**A window** is data plus one function. `who` is `gm` (the default) or `everyone`; `scope: 'character'` makes the window act for the figure selected on the table (a player only for their own creature), `campaign` (the default) for the whole campaign. `fields` holds up to 12 fields, each `{ key, label, hint, type, required, default }`:

| `type` | Extra settings | Value in `run` |
|---|---|---|
| `text`, `textarea` | `maxLength`, `placeholder` | a string |
| `number` | `min`, `max`, `step` | a number or `null` |
| `select` | `options: [{ value, label }]`, at least two | one of the values |
| `checkbox` | — | `true` or `false` |
| `character` | `who`: `any`, `character` or `npc` | a creature id in the campaign or `null` |

The server checks the values against the same description: an unknown field, an empty required one, a number out of range or a creature from another campaign is refused with a message the window shows. `run({ q, ctx, kit, campaignId, userId, characterId, values })` works inside the request's transaction, with the same `ctx` and `kit` as a route, and returns `{ message }`, which the window shows. To refuse, throw an error with `statusCode` (`kit.reject(409, '…')`); any other error is answered «Мод «…» не справился: …» and goes to the server log. The window's route is `POST /campaigns/:campaignId/mods/<mod id>/forms/<window id>`; the mod does not register it. The example mod [ash-folk](../examples/mods/ash-folk/index.js) has a GM window that burns a chosen creature and a player window that heals the selected figure. A new class feature appears in the sheet's feature list and is used with its button, but the client does not know it in advance; for example, the level-up window does not show it.

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

## Spell packs

```json
{ "id": "home-spells", "name": "Домашние заклинания", "version": "1.0.0", "kind": "spells", "author": "Мастер" }
```

The spells live in the mod's `spells/` folder (another folder inside the mod can be named in `"spells"`). Each spell is a `.spell.json` file in the format the spell builder saves with «Скачать шаблон»: `{ "format": "ochag-spell-template", "version": 1, "template": { … } }`. A pack holds up to 300 files of up to 256 KB each.

- The GM adds a pack in the Mods window, under «Заклинания — для кампании», with «Добавить в кампанию». Its spells become approved spells of that campaign at once, and heroes can learn them. Adding the pack again adds only the files that are not in the campaign yet.
- «Убрать из кампании» deletes the pack's spells together with the GM's edits to them. A spell that a hero knows, or that a sheet import is mapped to, stays.
- A file that is not a spell file, does not parse or does not pass the spell builder's checks is skipped; the Mods window lists such files with the reason.
- A picture saved inside a spell file is not taken over: the spell gets its school's picture.
- The server reads the packs from the mods folder each time the list is opened, so a new pack shows up without a restart.

## Adventures

A ready-made adventure turns into a new campaign with one button: in the lobby, «Новая кампания» → «Из готового приключения…».

```json
{ "id": "ash-ford", "name": "Пепел над Кривым бродом", "version": "1.0.0", "kind": "adventure", "adventure": "adventure.json" }
```

The scenes are `.ochag-scene` files saved by the app («Сохранить в файл» in a scene card's menu): the map, walls, pins, traps and the creatures on it, with their pictures, models and music. This format survives app updates, so an adventure does not break when the database changes. Everything else is in `adventure.json` (up to 2 MB):

```json
{
  "format": "ochag-adventure", "formatVersion": 1,
  "title": "…", "levels": "1–2", "players": "3–5", "duration": "один вечер", "intro": "…", "cover": "cover.png",
  "scenes": ["scenes/01-tavern.ochag-scene"],
  "notes": [{ "title": "…", "body": "…" }],
  "quests": [{ "title": "…", "description": "…", "xp": 300, "hidden": false, "objectives": ["…"] }],
  "handouts": [{ "title": "…", "text": "…", "image": "pictures/map.png" }],
  "rollTables": [{ "name": "…", "formula": "1d6", "entries": [{ "from": 1, "to": 1, "text": "…" }], "secret": false }],
  "npcs": [{ "monster": "veteran", "name": "Капитан Брам", "disposition": "friendly", "count": 1 }]
}
```

- Paths point inside the mod's folder. The cover (PNG, JPEG or WebP up to 1.5 MB) shows in the lobby and becomes the campaign's banner.
- Notes go to the GM only, as usual: the GM grants them to players later. A quest with `"hidden": true` stays hidden until the GM shows it, and handouts wait for the GM to hand them out.
- `npcs` are creatures off the scenes, by bestiary index (SRD or a mechanics mod's), with an optional name and attitude.
- A missing file, a broken scene, a table that does not cover its die or an unknown creature is skipped. The adventure window and the Mods window list what was skipped and why. An adventure with nothing in it cannot be used.
- The server reads adventures from the mods folder each time the list is opened, so a new one shows up without a restart.

The example is [examples/mods/ash-ford](../examples/mods/ash-ford/adventure.json): two scenes, four GM notes, two quests, a handout, a table of tavern rumours and one creature off the scenes.

## Where this is in the code

- Server: [apps/server/src/system/mods.ts](../apps/server/src/system/mods.ts) (loading, the api, the `GET /mods` route); startup in `apps/server/src/main.ts`, which reads `MODS_DIR`; the desktop app sets it in `apps/desktop/host/server.cjs`.
- Visual mods: [apps/desktop/host/visual-mods.cjs](../apps/desktop/host/visual-mods.cjs) and [apps/client/src/settings/visualMods.ts](../apps/client/src/settings/visualMods.ts); the window is `apps/client/src/components/settings/ModsDialog.vue`.
- Art packs: [apps/desktop/host/art-packs.cjs](../apps/desktop/host/art-packs.cjs) reads the packs, [apps/client/src/art/artPacks.ts](../apps/client/src/art/artPacks.ts) turns sections on, and [apps/client/src/art/artSource.ts](../apps/client/src/art/artSource.ts) decides where the game takes a picture for a path.
- Spell packs: [apps/server/src/spells/spell-packs.ts](../apps/server/src/spells/spell-packs.ts) reads the packs, and [apps/server/src/spells/spell-pack-routes.ts](../apps/server/src/spells/spell-pack-routes.ts) adds them to a campaign and takes them out (`GET`, `POST`, `DELETE /campaigns/:id/spell-packs`); the spells are marked with `pack_id` (migration 110).
- Races, subraces and feats: the effects engine is [packages/domain/character/traits.ts](../packages/domain/character/traits.ts), a mod's description is checked in [mod-heroes.ts](../packages/domain/character/mod-heroes.ts); `characterTraitEffects` in `hero-traits.ts` gathers a hero's race, subrace and feats.
- Bestiary creatures: [packages/domain/world/mod-monsters.ts](../packages/domain/world/mod-monsters.ts) checks the description; the registry is `defineModMonster`, `bestiaryMonsters` and `findMonster` in [packages/domain/world/bestiary.ts](../packages/domain/world/bestiary.ts).
- Windows: [apps/server/src/system/mod-forms.ts](../apps/server/src/system/mod-forms.ts) checks the description and the values and registers the routes; the client draws them in [apps/client/src/components/campaign/ModFormDialog.vue](../apps/client/src/components/campaign/ModFormDialog.vue).
- Adventures: [apps/server/src/campaign/adventures.ts](../apps/server/src/campaign/adventures.ts) reads and checks them, [adventure-routes.ts](../apps/server/src/campaign/adventure-routes.ts) makes the campaign (`GET /adventures`, `POST /adventures/:id/campaign`); scenes are imported by `importSceneFile` in `tabletop/scene/routes/file.ts`, the same code as «Загрузить сцену из файла».
- Tests: `apps/server/test/system/mods.test.ts`, `mods-examples.test.ts`, `mod-heroes.test.ts`, `mod-bestiary.test.ts`, `mod-forms.test.ts`, `apps/server/test/campaign/adventures.test.ts`, `visual-mods.test.ts`, `art-packs.test.ts`, `apps/server/test/spells/spell-packs.test.ts`; the client art tests are in `apps/client/test/art/`.
