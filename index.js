import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Store } from "./database.js";
import { Engine } from "./engine.js";
export async function createServer(options = {}) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const store = new Store(
    options.database ??
      process.env.DATABASE_PATH ??
      resolve(root, "data/hollow.sqlite"),
  );
  const engine = new Engine(store, {
    duration: Number(process.env.MATCH_SECONDS) || 1800,
    reconnect: Number(process.env.RECONNECT_SECONDS) || 45,
    ...options,
  });
  const types = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
    ".ico": "image/x-icon",
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "same-origin");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; frame-ancestors 'none'",
      );
      if (url.pathname === "/api/health") {
        res.setHeader("Content-Type", "application/json");
        return res.end(
          JSON.stringify({
            status: "ok",
            rooms: engine.rooms.size,
            duration: engine.duration,
          }),
        );
      }
      const path = url.pathname === "/" ? "/index.html" : url.pathname;
      const allowed = [
        "/index.html",
        "/style.css",
        "/script.js",
        "/scene.js",
        "/cosmetics.js",
        "/favicon.svg",
        "/manifest.webmanifest",
        "/shared/world.js",
        "/vendor/three.module.js",
        "/vendor/three.core.js",
      ];
      if (!allowed.includes(path)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      const file = path.startsWith("/vendor/")
        ? resolve(root, "node_modules/three/build", path.slice(8))
        : resolve(root, "." + path);
      const body = await readFile(file);
      res.setHeader(
        "Content-Type",
        types[extname(file)] || "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-cache");
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end("Game files unavailable. Check server installation.");
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const connections = new Map();
  server.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin,
      expected = process.env.PUBLIC_ORIGIN;
    if (
      req.url !== "/socket" ||
      (origin &&
        origin !== (expected || `http://${req.headers.host}`) &&
        origin !== `https://${req.headers.host}`)
    ) {
      socket.destroy();
      return;
    }
    const ip = req.socket.remoteAddress;
    if ((connections.get(ip) || 0) >= 12) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      connections.set(ip, (connections.get(ip) || 0) + 1);
      ws.ip = ip;
      wss.emit("connection", ws);
    });
  });
  wss.on("connection", (ws) => {
    ws.alive = true;
    ws.count = 0;
    ws.window = Date.now();
    const authTimer = setTimeout(() => {
      if (!ws.guestId) ws.close(4000, "Authentication timeout");
    }, 8000);
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.on("message", (raw) => {
      try {
        const now = Date.now();
        if (now - ws.window > 1000) {
          ws.window = now;
          ws.count = 0;
        }
        if (++ws.count > 90) {
          ws.close(4008, "Rate limit");
          return;
        }
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg.type !== "string") return;
        if (!ws.guestId) {
          if (msg.type !== "hello")
            throw Error("Connect with a guest identity first.");
          if (
            msg.token &&
            (typeof msg.token !== "string" || msg.token.length > 128)
          )
            throw Error("Invalid credential.");
          engine.connect(ws, store.identity(msg.token, msg.name));
          clearTimeout(authTimer);
        } else if (engine.clients.get(ws.guestId)?.ws === ws)
          engine.handle(ws.guestId, msg, now);
      } catch (error) {
        engine.send(ws, "error", { message: error.message });
      }
    });
    ws.on("close", () => {
      clearTimeout(authTimer);
      engine.disconnect(ws);
      connections.set(ws.ip, Math.max(0, (connections.get(ws.ip) || 1) - 1));
    });
    ws.on("error", () => {});
  });
  let previous = Date.now(),
    count = 0;
  const ticker = setInterval(() => {
    const now = Date.now();
    engine.tick((now - previous) / 1000, now);
    previous = now;
    if (++count % 2 === 0) engine.snapshots(now);
  }, 50);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
  }, 10000);
  return {
    server,
    engine,
    store,
    async close() {
      clearInterval(ticker);
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise((r) => server.close(r));
      wss.close();
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await createServer();
  app.server.listen(
    Number(process.env.PORT) || 3000,
    process.env.HOST || "0.0.0.0",
    () =>
      console.log(
        `HOLLOW//30 listening at http://localhost:${app.server.address().port}`,
      ),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
