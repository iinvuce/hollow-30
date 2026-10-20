# Play HOLLOW//30 on your phone

HOLLOW//30 has a 3D map, real multiplayer, online saves, and on-screen touch controls.

## Fastest local setup (same Wi-Fi)

1. On your **Windows computer**, install Node.js 24 or newer if needed.
2. Extract this ZIP to a folder and double-click `Start-HOLLOW.cmd` there. Leave its command window running. On macOS/Linux, run `npm ci` and `npm start` in this folder instead.
3. On the computer, confirm that `http://localhost:3000` loads the game.
4. Find your computer's local IP. On Windows open Command Prompt and enter `ipconfig`; find the **IPv4 Address** of your Wi-Fi connection, something like `192.168.1.20`.
5. Connect your **iPhone or Android phone to the same Wi-Fi**, then open Chrome or Safari at `http://YOUR-COMPUTER-IP:3000` (using the actual IPv4 address). Accept a local-network firewall permission if Windows asks. Do not type `localhost` on the phone.
6. Select **SOLO** then **DEPLOY SOLO**, or create a **DUO/SQUAD** party and share the invite. Playing on the phone works in portrait or landscape.

## Touch controls

- **Left joystick:** walk in any direction.
- **Right joystick:** point in any direction to aim and fire; release to stop.
- **SPRINT:** hold to run.
- **USE:** loot, unlock bunker, or extract when close to the objective (glows when useful).
- **RELOAD / HEAL / SWAP:** reload, use a medkit, or switch weapons.
- **INVENTORY:** open collected equipment menu. **MENU:** pause your input and view options; online match clock keeps running.

For better visibility, rotate your phone into landscape mode. On slower phones, leave the Graphics setting at Low.

## Make a public link

This project is not hosted just by uploading its ZIP to a static web host. It requires a **running Node.js server with WebSockets and persistent SQLite storage**.

- Use a Node/Docker hosting account with HTTPS, WebSocket support, and persistent storage (e.g. Render).
- Push the extracted project to a GitHub repository.
- Create a **Render Blueprint** from that repo; it reads `render.yaml`, builds `Dockerfile`, and mounts `/app/data` for saved progress. Persistent disk hosting can be paid.
- Wait for `/api/health` to return a JSON status of `ok`. Open the platform-provided **HTTPS** URL on your phone and share it with friends.

The host must stay running for multiplayer sessions. One server replica only. Never place private hosting credentials in browser code or in the ZIP.

**Status:** Code and backend tests are complete; public hosting, physical mobile performance, and full browser end-to-end touch testing still need verification with the connected host and actual phones.
