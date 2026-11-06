# Ochag (Очаг)

[Русская версия](README.ru.md)

Ochag is a virtual tabletop for 5th Edition fantasy role-playing games. The game master runs the server on their own Windows computer. Players join over a home or virtual local network, or over the internet through a Cloudflare tunnel or the GM's public IP address. The interface is in English and Russian.

The project is in open beta.

## Features

- **Table.** Scenes on a 3D board with figures, walls, doors, fog of war, light, weather, music and sound effects. Players can also join from a phone browser.
- **Rules.** The server applies the 5th Edition rules of the SRD 5.1: initiative and turn order, the action economy, attacks and damage, conditions, spells with targets and areas, saving throws, reactions, cover, class and race features, rests, experience and levels. NPC turns can be played with one button.
- **Characters.** Step-by-step creation, level-up, multiclassing, equipment, magic items and custom spells.
- **Campaigns.** Quests, a chronicle, handouts, shops, encounters, a bestiary and mini-games.
- **Server.** Accounts, invitations, scheduled backups, campaign transfer between computers, and app updates delivered to players by the GM's server.
- **Mods.** Rule mods are installed by the GM and take precedence over the built-in rules. Visual mods are installed by each player for themselves. See [docs/MODS.md](docs/MODS.md).

## Getting started

1. Download `Ochag-Setup-<version>.exe` from the [Releases page](https://github.com/Darmion/ochag/releases) and run it. The installer is not signed, so Windows may show "Windows protected your PC": choose "More info", then "Run anyway".
2. **GM.** Choose "I’m the GM". The server starts on your computer, and the database is built in. The database needs the Microsoft Visual C++ Redistributable (x64), which most PCs already have; if it is missing, the app says so and offers Microsoft's download. Create a campaign and send the invitation to your players. For players outside your network, open the "Server" tab and use "Players over the internet".
3. **Player.** Choose "I’m a player" and paste the GM's invitation. To play from a phone, open the GM's address with `/phone/` at the end in a browser.

## Building from source

Requirements: Windows, Node.js 24 or newer, and Docker Desktop for the development database.

```powershell
Copy-Item .env.example .env       # set POSTGRES_PASSWORD and APP_DB_PASSWORD (20+ characters)
docker compose up -d --wait
npm ci
npm --prefix apps/client ci
npm run db:migrate
npm run db:provision
npm start                         # API server at http://127.0.0.1:3000
```

In a second window, the browser client with a proxy to that server:

```powershell
npm --prefix apps/client run dev  # http://127.0.0.1:5173
```

The desktop app starts its own embedded PostgreSQL and server and does not need Docker:

```powershell
npm run desktop                   # build the client and open it in Electron
npm run desktop:dist              # build the installer into release/
```

Checks:

```powershell
npm run typecheck
npm --prefix apps/client exec vue-tsc -- -b
npm test                          # uses an in-memory PostgreSQL and never touches your database
npm run i18n:check                # every interface string has English
```

The same checks run on GitHub for every push and pull request (`.github/workflows/ci.yml`).

## Repository layout

| Path | Contents |
|---|---|
| `apps/server` | Fastify API and the `/live` WebSocket; the server is the source of truth and checks every permission |
| `apps/client` | Vue 3 and TypeScript client; the 3D table is built on Babylon.js |
| `apps/desktop` | Electron shell: the embedded PostgreSQL and server, a sandboxed window and a limited preload API |
| `packages/domain` | Game rules without the server or the database, and the SRD 5.1 data |
| `packages/importer` | The common character sheet format used by import mods |
| `mods` | Bundled optional mods: the art pack and the Long Story Short sheet import |
| `examples/mods` | Example mods |
| `db` | SQL migrations and schema tests |
| `scripts` | Migrations, backups, string extraction and build tools |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the parts fit together
- [docs/API.md](docs/API.md) — server routes, request bodies and trust boundaries
- [docs/MODS.md](docs/MODS.md) — writing mods
- [docs/I18N.md](docs/I18N.md) — interface translation

## Reporting a bug

[Open an issue](https://github.com/Darmion/ochag/issues). Describe what you did, what you expected and what happened instead, and give the app version shown in the top bar. Screenshots help.

## Licence

The code is licensed under the PolyForm Noncommercial License 1.0.0 ([LICENSE.md](LICENSE.md)). The project's own pictures and texts are licensed under CC BY-NC 4.0. Third-party material keeps its own terms; [NOTICE.md](NOTICE.md) lists which licence covers which part, and the authors.

Ochag is not affiliated with or endorsed by Wizards of the Coast.
