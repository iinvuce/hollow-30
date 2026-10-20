import { randomBytes, randomUUID } from "node:crypto";
import { WORLD, WEAPONS, MODES, blocked, visible } from "../shared/world.js";
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export class Engine {
  constructor(store, options = {}) {
    this.store = store;
    this.rooms = new Map();
    this.clients = new Map();
    this.duration = options.duration ?? 1800;
    this.reconnect = (options.reconnect ?? 45) * 1000;
    this.resultsMs = options.resultsMs ?? 25000;
    this.events = 0;
  }
  send(ws, type, data = {}) {
    if (ws?.readyState === 1 && ws.bufferedAmount < 1e6)
      ws.send(JSON.stringify({ type, ...data }));
  }
  connect(ws, identity) {
    const id = identity.profile.id,
      old = this.clients.get(id);
    if (old?.ws && old.ws !== ws) {
      this.send(old.ws, "replaced");
      old.ws.close(4001, "Guest opened in another tab");
    }
    const client = { id, ws, room: old?.room ?? null, gone: 0 };
    this.clients.set(id, client);
    ws.guestId = id;
    this.send(ws, "welcome", identity);
    const room = this.rooms.get(client.room);
    if (room) {
      const p = room.members.get(id);
      if (p) {
        p.connected = true;
        p.gone = 0;
      }
      this.broadcast(room);
    }
  }
  disconnect(ws, now = Date.now()) {
    const c = this.clients.get(ws.guestId);
    if (!c || c.ws !== ws) return;
    c.ws = null;
    c.gone = now;
    const r = this.rooms.get(c.room),
      p = r?.members.get(c.id);
    if (p) {
      p.connected = false;
      p.ready = false;
      p.gone = now;
      p.input = {};
      this.broadcast(r);
    }
  }
  party(r) {
    return {
      code: r.code,
      leader: r.leader,
      state: r.state,
      practice: r.practice,
      mode: r.mode,
      minPlayers: MODES[r.mode].min,
      maxPlayers: MODES[r.mode].max,
      members: [...r.members.values()].map((p) => ({
        id: p.id,
        name: p.name,
        ready: p.ready,
        connected: p.connected,
        outfit: p.outfit,
      })),
    };
  }
  broadcast(r) {
    for (const id of r.members.keys())
      this.send(this.clients.get(id)?.ws, "party", { party: this.party(r) });
  }
  member(id) {
    const c = this.clients.get(id),
      r = this.rooms.get(c?.room);
    return [c, r, r?.members.get(id)];
  }
  leave(id) {
    const [c, r] = this.member(id);
    if (!r) return;
    r.members.delete(id);
    c.room = null;
    if (!r.members.size) this.rooms.delete(r.code);
    else {
      if (r.leader === id) r.leader = r.members.keys().next().value;
      this.broadcast(r);
    }
    this.send(c.ws, "party", { party: null });
  }
  handle(id, msg, now = Date.now()) {
    const [c, r, p] = this.member(id);
    if (!c) return;
    const profile = () => this.store.profile(id);
    switch (msg.type) {
      case "ping":
        return this.send(c.ws, "pong", { serverTime: now, sent: msg.sent });
      case "name": {
        if (r?.state === "match")
          throw Error("Change your name after the match.");
        const v = this.store.rename(id, msg.name);
        if (p) {
          p.name = v.name;
          this.broadcast(r);
        }
        return this.send(c.ws, "profile", { profile: v });
      }
      case "outfit": {
        if (r?.state === "match")
          throw Error("Change your outfit after the match.");
        const v = this.store.outfit(id, msg.outfit);
        if (p) {
          p.outfit = v.outfit;
          this.broadcast(r);
        }
        return this.send(c.ws, "profile", { profile: v });
      }
      case "crate":
        return this.send(c.ws, "crate", this.store.crate(id));
      case "buy":
        return this.send(c.ws, "purchase", this.store.buy(id, msg.cosmetic));
      case "mode": {
        if (!r || r.state !== "lobby" || r.leader !== id) throw Error("Only the party leader can change the mode in the lobby.");
        const mode = Object.hasOwn(MODES, msg.mode) ? MODES[msg.mode] : null;
        if (!mode) throw Error("Unknown game mode.");
        if (r.members.size > mode.max) throw Error(`${mode.label} supports ${mode.max} player${mode.max > 1 ? "s" : ""}. Leave the party before choosing a smaller mode.`);
        r.mode = msg.mode; r.practice = msg.mode === "practice";
        for (const player of r.members.values()) player.ready = false;
        return this.broadcast(r);
      }
      case "create": {
        const mode = msg.practice === true ? "practice" : (msg.mode ?? "squad");
        if (!Object.hasOwn(MODES, mode)) throw Error("Unknown game mode.");
        if (r?.state === "match")
          throw Error("Finish or leave the current match first.");
        this.leave(id);
        if (this.rooms.size >= 200)
          throw Error("Server is full. Try again shortly.");
        const code = randomBytes(6).toString("hex").toUpperCase();
        const room = {
          code,
          leader: id,
          state: "lobby",
          practice: mode === "practice",
          mode,
          members: new Map(),
          created: now,
        };
        this.rooms.set(code, room);
        return this.join(c, room, profile());
      }
      case "join": {
        const code = String(msg.code ?? "")
          .trim()
          .toUpperCase();
        const target = this.rooms.get(code);
        if (!target || MODES[target.mode].max === 1)
          throw Error(
            "Invalid or expired invite. Ask your friend for a new room code.",
          );
        if (target === r) return this.broadcast(r);
        if (target.state !== "lobby")
          throw Error("This squad is already in a match.");
        if (target.members.size >= MODES[target.mode].max) throw Error(`Party is full (${MODES[target.mode].max}/${MODES[target.mode].max}).`);
        if (r?.state === "match")
          throw Error("Leave your match before joining another party.");
        this.leave(id);
        return this.join(c, target, profile());
      }
      case "leave":
        return this.leave(id);
      case "ready":
        if (r?.state === "lobby") {
          p.ready = !p.ready;
          this.broadcast(r);
        }
        return;
      case "start": {
        if (!r || r.leader !== id || r.state !== "lobby")
          throw Error("Only the squad leader can deploy.");
        if (r.members.size < MODES[r.mode].min)
          throw Error(`${MODES[r.mode].label} needs ${MODES[r.mode].min} players. Invite a friend or select Solo.`);
        if (![...r.members.values()].every((m) => m.ready && m.connected))
          throw Error("Every player must be connected and ready.");
        this.start(r, now);
        return;
      }
      case "return":
        if (r?.state === "results") this.reset(r);
        return;
      case "input": {
        if (r?.state !== "match" || !p.connected || p.hp <= 0 || p.extracted)
          return;
        const v = msg.input || {};
        p.input = {
          x: finite(v.x, -1, 1),
          z: finite(v.z, -1, 1),
          aim: finite(v.aim, -Math.PI * 2, Math.PI * 2),
          shoot: v.shoot === true,
          sprint: v.sprint === true,
        };
        p.lastInput = now;
        return;
      }
      case "action": {
        if (r?.state !== "match" || p.hp <= 0 || p.extracted || !p.connected)
          return;
        if (msg.action === "reload") this.reload(p, now);
        if (
          msg.action === "heal" &&
          p.medkits > 0 &&
          p.hp < 100 &&
          now > p.healAt
        ) {
          p.medkits--;
          p.hp = Math.min(100, p.hp + 50);
          p.healAt = now + 2000;
        }
        if (msg.action === "interact") this.interact(r, p, now);
        if (msg.action === "equip") this.equip(p, msg.slot, msg.item);
        if (msg.action === "swap") {
          p.weapon =
            p.weapon === p.gear.primary ? p.gear.secondary : p.gear.primary;
          p.reloadAt = 0;
        }
        return;
      }
    }
  }
  join(c, room, profile) {
    room.members.set(c.id, {
      id: c.id,
      name: profile.name,
      outfit: profile.outfit,
      ready: false,
      connected: true,
      gone: 0,
    });
    c.room = room.code;
    this.broadcast(room);
  }
  start(r, now) {
    r.state = "match";
    r.matchId = randomUUID();
    r.startedAt = now;
    r.endsAt = now + this.duration * 1000;
    r.keycard = false;
    r.bunkerOpen = false;
    r.effects = [];
    r.lastSpawn = now;
    r.wave = 0;
    [...r.members.values()].forEach((p, i) =>
      Object.assign(p, {
        x: -25 + i * 1.3,
        z: 23,
        hp: 100,
        aim: 0,
        kills: 0,
        extracted: false,
        input: {},
        lastInput: now,
        lastShot: 0,
        reloadAt: 0,
        healAt: 0,
        weapon: "pistol",
        ammo: 90,
        medkits: 2,
        magazines: { pistol: 12, rifle: 30, shotgun: 6 },
        gear: {
          helmet: null,
          armour: null,
          backpack: null,
          primary: "pistol",
          secondary: "pistol",
        },
        bag: ["pistol"],
      }),
    );
    const items = [
      ["keycard", -8, -7],
      ["rifle", -26, 14],
      ["armour", -22, 12],
      ["helmet", -19, 12],
      ["backpack", -16, 12],
      ["shotgun", -8, 1],
      ["ammo", -10, -15],
      ["medkit", -27, -6],
      ["ammo", 14, 14],
      ["medkit", 12, -13],
      ["ammo", 23, -12],
    ];
    r.loot = items.map(([item, x, z], i) => ({ id: "loot" + i, item, x, z }));
    r.zombies = Array.from({ length: r.mode === "solo" || r.practice ? 8 : r.mode === "duo" ? 12 : 16 }, (_, i) => this.zombie(i, now));
    this.broadcast(r);
  }
  zombie(i, now) {
    const points = [
      [-7, -11],
      [8, -10],
      [15, 18],
      [-30, -28],
      [28, -29],
      [0, 17],
      [31, 9],
      [-10, 8],
    ];
    const [x, z] = points[i % points.length];
    return {
      id: randomUUID(),
      x: x + (i % 2),
      z: z + (i % 3),
      hp: 75,
      hitAt: now,
      speed: 1.65 + (i % 3) * 0.2,
    };
  }
  equip(p, slot, item) {
    const allowed = {
      helmet: ["helmet"],
      armour: ["armour"],
      backpack: ["backpack"],
      primary: Object.keys(WEAPONS),
      secondary: Object.keys(WEAPONS),
    };
    if (!allowed[slot]) return;
    if (item === null && !["primary", "secondary"].includes(slot)) {
      p.gear[slot] = null;
      return;
    }
    if (!p.bag.includes(item) || !allowed[slot].includes(item)) return;
    p.gear[slot] = item;
    if (slot === "primary" || slot === "secondary") {
      p.weapon = item;
      p.reloadAt = 0;
    }
  }
  reload(p, now) {
    const w = WEAPONS[p.weapon];
    if (!p.reloadAt && p.ammo > 0 && p.magazines[p.weapon] < w.mag)
      p.reloadAt = now + w.reload;
  }
  interact(r, p, now) {
    const loot = r.loot.find((l) => distance(l, p) < 2.8);
    if (loot) {
      if (loot.item === "keycard") r.keycard = true;
      else if (loot.item === "ammo") p.ammo += 60;
      else if (loot.item === "medkit") p.medkits++;
      else if (!p.bag.includes(loot.item)) {
        if (p.bag.length >= (p.gear.backpack ? 12 : 7)) return;
        p.bag.push(loot.item);
      }
      r.loot = r.loot.filter((l) => l.id !== loot.id);
      return;
    }
    if (r.keycard && distance(p, WORLD.bunker) < WORLD.bunker.radius)
      r.bunkerOpen = true;
    if (
      r.bunkerOpen &&
      distance(p, WORLD.extraction) < WORLD.extraction.radius
    ) {
      p.extracted = true;
      p.input = {};
      r.effects.push({ id: ++this.events, kind: "extract", x: p.x, z: p.z });
    }
  }
  move(p, dx, dz, r) {
    const hit = (x, z) =>
      blocked(x, z) ||
      (r &&
        !r.bunkerOpen &&
        Math.abs(x - 23) < 2.95 &&
        Math.abs(z + 16) < 0.75);
    if (!hit(p.x + dx, p.z)) p.x += dx;
    if (!hit(p.x, p.z + dz)) p.z += dz;
  }
  shoot(r, p, now) {
    const w = WEAPONS[p.weapon];
    if (p.reloadAt || now - p.lastShot < w.interval) return;
    if (p.magazines[p.weapon] <= 0) return this.reload(p, now);
    p.lastShot = now;
    p.magazines[p.weapon]--;
    const dir = { x: Math.sin(p.aim), z: Math.cos(p.aim) };
    const hit = r.zombies
      .filter((z) => {
        const d = distance(p, z),
          dot = ((z.x - p.x) * dir.x + (z.z - p.z) * dir.z) / (d || 1);
        return (
          z.hp > 0 &&
          d < w.range &&
          dot >
            Math.cos(
              (p.weapon === "shotgun" ? 0.24 : 0.06) + 0.6 / Math.max(1, d),
            ) &&
          visible(p, z)
        );
      })
      .sort((a, b) => distance(p, a) - distance(p, b))[0];
    let end = { x: p.x + dir.x * w.range, z: p.z + dir.z * w.range };
    for (let d = 0.5; d < w.range; d += 0.5)
      if (blocked(p.x + dir.x * d, p.z + dir.z * d, 0)) {
        end = { x: p.x + dir.x * d, z: p.z + dir.z * d };
        break;
      }
    if (hit) {
      hit.hp -= w.damage;
      end = hit;
      if (hit.hp <= 0) p.kills++;
    }
    r.effects.push({
      id: ++this.events,
      kind: hit ? "hit" : "shot",
      player: p.id,
      x: p.x,
      z: p.z,
      tx: end.x,
      tz: end.z,
    });
  }
  tick(dt, now = Date.now()) {
    dt = Math.min(dt, 0.1);
    for (const r of this.rooms.values()) {
      for (const p of [...r.members.values()])
        if (!p.connected && now - p.gone > this.reconnect) {
          this.leave(p.id);
          this.clients.delete(p.id);
        }
      if (!r.members.size) continue;
      if (r.state === "results") {
        if (now >= r.returnAt) this.reset(r);
        continue;
      }
      if (r.state === "lobby") {
        if (now - r.created > 3600000) {
          for (const id of [...r.members.keys()]) this.leave(id);
        }
        continue;
      }
      if (now >= r.endsAt) {
        this.finish(r, "Time expired", now);
        continue;
      }
      if (
        now - r.lastSpawn > 16000 &&
        r.zombies.filter((z) => z.hp > 0).length < 32
      ) {
        r.zombies.push(this.zombie(r.wave++, now));
        r.lastSpawn = now;
      }
      for (const p of r.members.values()) {
        if (!p.connected || p.hp <= 0 || p.extracted) continue;
        const input = now - p.lastInput < 350 ? p.input : {};
        const len = Math.hypot(input.x || 0, input.z || 0),
          speed = input.sprint ? 6.5 : 4.5;
        if (len)
          this.move(
            p,
            (input.x / Math.max(1, len)) * speed * dt,
            (input.z / Math.max(1, len)) * speed * dt,
            r,
          );
        p.aim = input.aim ?? p.aim;
        if (p.reloadAt && now >= p.reloadAt) {
          const add = Math.min(
            WEAPONS[p.weapon].mag - p.magazines[p.weapon],
            p.ammo,
          );
          p.magazines[p.weapon] += add;
          p.ammo -= add;
          p.reloadAt = 0;
        }
        if (input.shoot) this.shoot(r, p, now);
      }
      for (const z of r.zombies) {
        if (z.hp <= 0) continue;
        const target = [...r.members.values()]
          .filter(
            (p) =>
              p.connected &&
              p.hp > 0 &&
              !p.extracted &&
              distance(p, WORLD.shelter) > WORLD.shelter.radius,
          )
          .sort((a, b) => distance(a, z) - distance(b, z))[0];
        if (!target) continue;
        const d = distance(z, target);
        if (d > 1.1 && d < 24)
          this.move(
            z,
            ((target.x - z.x) / d) * z.speed * dt,
            ((target.z - z.z) / d) * z.speed * dt,
            r,
          );
        if (d < 1.5 && now - z.hitAt > 950 && visible(z, target)) {
          const protection =
            (target.gear.armour ? 0.35 : 0) + (target.gear.helmet ? 0.15 : 0);
          target.hp = Math.max(0, target.hp - Math.ceil(14 * (1 - protection)));
          z.hitAt = now;
        }
      }
      if ([...r.members.values()].every((p) => p.hp <= 0 || p.extracted))
        this.finish(
          r,
          [...r.members.values()].some((p) => p.extracted)
            ? "Extraction complete"
            : "Squad lost",
          now,
        );
    }
    for (const [id, c] of this.clients)
      if (!c.ws && !c.room && now - c.gone > this.reconnect)
        this.clients.delete(id);
  }
  finish(r, reason, now) {
    if (r.state !== "match") return;
    r.state = "results";
    r.returnAt = now + this.resultsMs;
    r.results = {
      reason,
      practice: r.practice,
      mode: r.mode,
      matchId: r.matchId,
      players: [...r.members.values()].map((p) => {
        const award = r.practice
          ? { xp: 0, coins: 0 }
          : this.store.reward(r.matchId, p.id, p.kills, p.extracted);
        if (award.profile)
          this.send(this.clients.get(p.id)?.ws, "profile", {
            profile: award.profile,
          });
        return {
          id: p.id,
          name: p.name,
          kills: p.kills,
          extracted: p.extracted,
          xp: award.xp,
          coins: award.coins,
        };
      }),
    };
    this.broadcast(r);
  }
  reset(r) {
    r.state = "lobby";
    r.created = Date.now();
    for (const p of r.members.values()) {
      p.ready = false;
      p.input = {};
    }
    delete r.zombies;
    delete r.loot;
    delete r.effects;
    delete r.results;
    this.broadcast(r);
  }
  snapshots(now = Date.now()) {
    for (const r of this.rooms.values()) {
      if (r.state === "lobby") continue;
      const data =
        r.state === "results"
          ? { state: "results", results: r.results, returnAt: r.returnAt }
          : {
              state: "match",
              serverTime: now,
              startedAt: r.startedAt,
              endsAt: r.endsAt,
              keycard: r.keycard,
              bunkerOpen: r.bunkerOpen,
              players: [...r.members.values()].map(
                ({ input, lastInput, lastShot, healAt, gone, ...p }) => p,
              ),
              zombies: r.zombies
                .filter((z) => z.hp > 0)
                .map(({ hitAt, speed, ...z }) => z),
              loot: r.loot,
              effects: r.effects,
            };
      for (const id of r.members.keys())
        this.send(this.clients.get(id)?.ws, "snapshot", data);
      if (r.effects) r.effects = [];
    }
  }
}
function finite(v, min, max) {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(min, Math.min(max, v))
    : 0;
}
