import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, createHash, randomInt } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { COSMETICS } from "../shared/world.js";
export class Store {
  constructor(path) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      readFileSync(new URL("./migration.sql", import.meta.url), "utf8"),
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const columns = this.db.prepare("PRAGMA table_info(guests)").all();
      if (!columns.some(c => c.name === "coins")) {
        this.db.exec("ALTER TABLE guests ADD COLUMN coins INTEGER NOT NULL DEFAULT 150");
      }
      const rewardColumns = this.db.prepare("PRAGMA table_info(rewards)").all();
      if (!rewardColumns.some(c => c.name === "coins")) {
        this.db.exec("ALTER TABLE rewards ADD COLUMN coins INTEGER NOT NULL DEFAULT 0");
      }
      if (this.db.prepare("PRAGMA user_version").get().user_version < 2) {
        this.db.exec("UPDATE guests SET crates=crates+1; PRAGMA user_version=2");
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  profile(id) {
    const r = this.db
      .prepare("SELECT id,name,xp,crates,coins,outfit,owned FROM guests WHERE id=?")
      .get(id);
    return r && { ...r, owned: JSON.parse(r.owned) };
  }
  identity(token, name = "Survivor") {
    if (token) {
      const row = this.db
        .prepare("SELECT id FROM guests WHERE credential_hash=?")
        .get(this.hash(token));
      if (!row)
        throw Error(
          "Guest credential not recognized. Clear it in Settings to create a new guest.",
        );
      return { token, profile: this.profile(row.id) };
    }
    token = randomBytes(32).toString("hex");
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO guests(id,credential_hash,name,created_at,crates) VALUES(?,?,?,?,1)",
      )
      .run(id, this.hash(token), cleanName(name), Date.now());
    return { token, profile: this.profile(id) };
  }
  hash(v) {
    return createHash("sha256").update(v).digest("hex");
  }
  rename(id, name) {
    this.db
      .prepare("UPDATE guests SET name=? WHERE id=?")
      .run(cleanName(name), id);
    return this.profile(id);
  }
  outfit(id, outfit) {
    if (!this.profile(id).owned.includes(outfit))
      throw Error("This cosmetic is not owned yet.");
    this.db.prepare("UPDATE guests SET outfit=? WHERE id=?").run(outfit, id);
    return this.profile(id);
  }
  reward(matchId, id, kills, extracted) {
    const xp = 30 + kills * 10 + (extracted ? 100 : 0);
    const coins = 25 + kills * 5 + (extracted ? 100 : 0);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = this.db
        .prepare("INSERT OR IGNORE INTO rewards(match_id,guest_id,xp,extracted,kills,created_at,coins) VALUES(?,?,?,?,?,?,?)")
        .run(matchId, id, xp, extracted ? 1 : 0, kills, Date.now(), coins);
      if (r.changes) {
        const p = this.profile(id),
          owned = [
            ...new Set([
              ...p.owned,
              ...COSMETICS.filter((c) => Number.isFinite(c.xp) && c.xp <= p.xp + xp).map((c) => c.id),
            ]),
          ];
        this.db
          .prepare(
            "UPDATE guests SET xp=xp+?,coins=coins+?,crates=crates+1,owned=? WHERE id=?",
          )
          .run(xp, coins, JSON.stringify(owned), id);
      }
      this.db.exec("COMMIT");
      return { xp: r.changes ? xp : 0, coins: r.changes ? coins : 0, profile: this.profile(id) };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  crate(id) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const p = this.profile(id);
      if (!p.crates)
        throw Error("No crates left. Complete a Solo, Duo or Squad match to earn one.");
      const pool = COSMETICS.filter(
        (c) => c.id !== "survivor" && !p.owned.includes(c.id),
      );
      const total = pool.reduce((n, c) => n + c.weight, 0);
      let roll = total ? randomInt(total) : 0;
      const won = pool.find((c) => (roll -= c.weight) < 0);
      this.db
        .prepare("UPDATE guests SET crates=crates-1,owned=?,xp=xp+?,coins=coins+? WHERE id=?")
        .run(
          JSON.stringify(won ? [...p.owned, won.id] : p.owned),
          won ? 0 : 50,
          won ? 0 : 50,
          id,
        );
      this.db.exec("COMMIT");
      return {
        won: won?.name || "Collection complete: 50 XP + 50 coins",
        cosmetic: won?.id || null,
        bonusCoins: won ? 0 : 50,
        profile: this.profile(id),
      };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  buy(id, cosmeticId) {
    const cosmetic = COSMETICS.find(c => c.id === cosmeticId && c.price > 0);
    if (!cosmetic) throw Error("This outfit is not available to buy.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const p = this.profile(id);
      if (p.owned.includes(cosmetic.id)) throw Error("You already own this outfit.");
      if (p.coins < cosmetic.price) throw Error(`You need ${cosmetic.price - p.coins} more coins. Earn coins by surviving matches.`);
      this.db.prepare("UPDATE guests SET coins=coins-?,owned=? WHERE id=?").run(cosmetic.price, JSON.stringify([...p.owned, cosmetic.id]), id);
      const receipt = randomUUID();
      this.db.prepare("INSERT INTO purchases VALUES(?,?,?,?,?)").run(receipt, id, cosmetic.id, cosmetic.price, Date.now());
      this.db.exec("COMMIT");
      return { cosmetic: cosmetic.id, cost: cosmetic.price, receipt, profile: this.profile(id) };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close() {
    this.db.close();
  }
}
function cleanName(name) {
  return (
    String(name)
      .replace(/[<>\x00-\x1f]/g, "")
      .trim()
      .slice(0, 20) || "Survivor"
  );
}
