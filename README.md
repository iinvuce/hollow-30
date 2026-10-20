# HOLLOW//30 — DovyStudio

Thirty minutes. Get out alive.

A working browser co-op survival game with an original procedural Three.js world and an authoritative Node/WebSocket server. No external images, models, fonts, paid assets, fake players, or simulated multiplayer. The previous website is preserved in `original-site/`.

## Run

Install **Node.js 24 or newer**, then run in this directory:

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd start
```

Open **http://localhost:3000**. Use the `npm` equivalent on macOS/Linux. The backend serves the client and WebSocket connection together. Opening `index.html` directly or using a static Live Server is not sufficient.

On Windows, you can also double-click **Start-HOLLOW.cmd**. It checks Node.js, installs missing dependencies, and runs the game server. Keep that window open, then visit the Local URL it prints.

**If you were using `http://127.0.0.1:5500/index.html`:** that is a static Live Server preview. Use **http://127.0.0.1:3000** after starting the game server. Static previews cannot serve the game’s `/vendor` modules or `/socket` backend. The loading screen now checks the backend first and shows a link to the proper local server, instead of incorrectly blaming WebGL for missing files.

1. Choose your display name using the avatar in the top-right.
2. Create a squad, then select **Invite a friend**. Share the private URL or 12-character room code.
3. Your friend opens it in a different browser profile/device. Each player clicks **Ready up**.
4. The leader clicks **Deploy squad**. Standard matches require 2–4 real players.
5. Collect the violet keycard in town, unlock the bunker in the north-east with E, and extract in the south-east with E.
6. Each survivor must extract or be downed to finish early. Otherwise the deadline ends the match for everyone. Results return the party to the lobby.

**Phone controls (iPhone and Android):** Open the running game in Safari or Chrome. The left circular stick moves the survivor; the right stick aims and fires while held off-centre. Use the on-screen **SPRINT**, **USE**, **RELOAD**, **HEAL**, and **SWAP** buttons. Tap **INVENTORY** near the top-right for collected gear and **MENU** at the top. Both portrait and landscape are supported; landscape gives a wider view. No keyboard is needed. Touch controls appear automatically on devices with coarse touch pointers. You can also use the original mouse/keyboard controls on desktop.

The mobile renderer defaults to the low-power profile to preserve battery and framerate. Settings allows higher quality on faster phones. This is a live online game: the server must stay running, and internet or LAN connectivity is required. The mobile controls have not been verified on physical iPhones or Android devices.

**Solo practice** starts immediately with one player and earns no permanent rewards. It uses the same server simulation. To test multiplayer on one machine, use two independent browser profiles (or normal and incognito), not two tabs with the same local storage. The latest connection replaces an older connection for the same guest.

For another device on your local network, open `http://YOUR_COMPUTER_LAN_IP:3000` while the server is running and share that origin’s invite link. Allow the Node port through your own firewall if needed. `localhost` links only work on the hosting computer. This build does not open firewall rules or expose a public tunnel automatically.

## Controls

On phones, use the on-screen twin-stick controls and action buttons; the following table documents the desktop equivalents.

| Key | Action |
| --- | --- |
| WASD | Move |
| Shift | Sprint |
| Mouse / left button | Aim / shoot |
| R | Reload |
| E | Collect nearby item / unlock bunker / extract |
| Q | Consume medkit (+50 HP, 2-second cooldown) |
| 1 or 2 | Toggle primary / secondary |
| I | Inventory: click collected equipment to equip; remove protection by slot |
| Escape | Menu (the match keeps running) |
| ? | Controls overlay |

P12 pistol, AR-30 rifle, and Breach-6 shotgun have different fire rates, ranges, magazine sizes, and reload times. Field equipment resets every match. Body armour reduces damage by 35%; helmet adds 15%; a backpack raises item capacity from 7 to 12 distinct items. Ammunition and medkits use separate counters. The starting shelter is safe from zombie targeting. Buildings and bunker walls block movement and line of sight. A locked bunker gate blocks entry until the party uses its keycard.

## Environment

Copy `.env.example` to `.env`; the `npm start` script reads it. Variables can instead be set by your hosting platform.

| Variable | Default | Meaning |
| --- | --- | --- |
| PORT | 3000 | HTTP + WebSocket port |
| HOST | 0.0.0.0 | Listening interface |
| DATABASE_PATH | data/hollow.sqlite | SQLite database; directory is created on startup |
| MATCH_SECONDS | 1800 | Match duration; set to 60 for a short manual test |
| RECONNECT_SECONDS | 45 | Reservation after disconnect |
| PUBLIC_ORIGIN | request origin | Set to your exact HTTPS origin behind a reverse proxy |

The five-minute warning appears whenever remaining time is at or below five minutes, including short test matches. Deadlines use server timestamps; browser clocks are synchronized through WebSocket ping/pong. Simulation is fixed at up to 20 Hz and snapshots at 10 Hz. Client inputs expire after 350 ms. Match timers continue while the server process runs; active matches do not survive a server restart.

## Saves, rewards, privacy

SQLite migration `server/migration.sql` is applied automatically at startup. It creates `guests` and `rewards`, uses WAL, and sets schema version 1. Back up the database using a SQLite-aware backup or stop the process before copying the database and its WAL files.

The browser retains a random 256-bit guest credential in local storage. Only its SHA-256 hash is stored server-side. Names, ownership, XP, crate count, and equipped outfit live in SQLite. Clearing the credential loses access; account linking and guest recovery are not implemented. Do not share guest credentials. Invite codes are separate 48-bit bearer capabilities: possession of the code authorizes joining a private lobby. No room directory or public matchmaking is exposed.

Completed squad matches award **30 XP + 10 per kill + 100 for extracting**, plus one cosmetic crate. The reward ledger has a unique `(match_id, guest_id)` key and updates progress transactionally to prevent duplicate grants. Leaving before the match completes forfeits its rewards. Solo practice earns none.

Free rewards: Field operative (0 XP), Toxic Protocol (100), Event Horizon (300), Afterlife (600). Unlocked cosmetics are granted automatically. Each outfit includes its matching weapon finish. Cosmetic outfits confer no combat advantage.

Crates are earned only. Base chances: **Hazmat 60%, Galaxy 30%, Skeleton 10%**. Owned items are excluded; remaining weights are renormalized. If all are owned, a crate grants 50 XP. All purchases and the premium cosmetic track are explicitly **Coming soon**. There are no payment forms or paid random crates.

The server validates player speed, weapon cooldown, ammunition, line of sight, damage, item proximity, equipment ownership, extraction requirements, party capacity, and leadership/readiness. It limits payload size, message rate, connections per address, and total rooms. These are baseline protections, not a claim of a production penetration test or full anti-cheat. Host this as a **single process / single replica**. Horizontal scaling needs a shared authoritative room layer. NAT users currently share the per-address limit of 12 connections.

## Deploy

No public deployment has been made here. A static-only host cannot run this game because it requires an always-on Node + WebSocket + SQLite backend. `render.yaml` provides a Render Blueprint using the included Dockerfile and a persistent disk (paid hosting may be required).

Use a Node/Docker-capable host that supports persistent WebSockets, an always-running instance, and a durable writable disk. Supply the hosting project/credentials (or deploy the included Dockerfile yourself), a public HTTPS domain, a mounted database volume, and a TLS reverse proxy that forwards WebSocket upgrades. Set `PUBLIC_ORIGIN` to the final HTTPS origin. Keep one replica, disable idle sleeping, and preserve the volume across releases. No secret is needed in client code.

```sh
docker build -t hollow30 .
docker run -d --name hollow30 -p 3000:3000 -v hollow30-data:/app/data \
  -e PUBLIC_ORIGIN=https://your-domain.example hollow30
```

Terminate HTTPS at your host’s reverse proxy. Serve HTTP and `/socket` on the same origin; do not cache WebSocket upgrades. For local Docker testing, omit `PUBLIC_ORIGIN` and use http://localhost:3000. Verify `/api/health`, then complete an invite → ready → shared match test over the final public URL before calling it live. The Docker recipe is provided but has not been built in this environment. For a quick deployment, push this folder to a GitHub repository, then create a new Render Blueprint from that repository. Render should detect `render.yaml`. After the service becomes healthy, open its HTTPS URL on a phone. Set `PUBLIC_ORIGIN` to that exact HTTPS URL if your hosting config requires an explicit origin. The WebSocket upgrade must be forwarded. Render hosting requires you to connect your own Render account; this package is not already publicly hosted.

## Verification

```powershell
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:startup
```

The browser test launches the installed Google Chrome in headless software-rendering mode and starts its own isolated backend/database on a free port. It requires Chrome (or adapt `channel` in `tests/browser.mjs` to your installed Playwright browser). It uses two separate browser contexts and actual UI, keyboard, and mouse input; it does not expose or call debug/teleport endpoints. Screenshots are written to `artifacts/`.

The startup regression test checks real 3D/match startup, a reproduced static Live Server error, a missing scene module, and reduced graphics settings. The renderer lets the browser select its GPU and retries without anti-aliasing before reporting a genuine graphics failure. A working WebGL 2 browser is still needed for the 3D game.

`tests/multiplayer.test.js` tests the actual WebSocket protocol with independent clients. Small server-side fixtures position enemies and loot only inside the test process for deterministic combat assertions; the production server has no fixture API. Read `TESTING.md` for the current verified results and limits.

## Source map

- `index.html`, `style.css`: accessible responsive lobby, HUD, touch gamepad, dialogs, loading states.
- `script.js`: menus, guest credential, WebSocket client, touch/keyboard input, HUD, generated sound.
- `scene.js`: original 3D character, outfits, weapon finishes, outpost, playable map and effects.
- `shared/world.js`: geometry/collision, weapons and cosmetic catalog.
- `server/index.js`: HTTP allowlist, WebSocket transport, heartbeat, rate limits, origin checks.
- `server/engine.js`: authoritative parties, matches, zombies, combat, loot and lifecycle.
- `server/database.js`, `server/migration.sql`: persistent guest data and idempotent rewards.

All application artwork and audio are generated procedurally in source. Three.js and ws are MIT licensed; their licenses are included in their installed packages. See `ASSETS.md`.

## Deliberate first-version limits

One compact map, simple zombie pursuit with obstacle sliding, one-stage bunker objective, no revive/spectator camera, no public matchmaking, no accounts/recovery, no paid content, no gamepad support, no horizontal scaling or active-match restart recovery. Menus and gameplay support mouse/keyboard and on-screen twin-stick touch controls. Live hosting, load testing, physical multi-device/mobile performance, and Docker execution are not verified here.


## Mobile / install notes

The app declares `manifest.webmanifest` for home-screen display where the browser supports it. It is **not an offline game**: it always needs the game server. In Safari, use Share → Add to Home Screen; on Android Chrome, use the browser menu → Add to Home screen / Install app when offered. The game should be served via HTTPS for public use. On the same Wi‑Fi as your computer, the phone can use `http://COMPUTER-LAN-IP:3000` if the computer is running the server and the firewall permits access.

The optional `npm run test:touch` browser regression uses an installed Chrome browser (or `CHROME_PATH`) to check mobile inputs and capture portrait/landscape screenshots. It is not part of `npm test`.
