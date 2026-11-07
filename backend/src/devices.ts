import { Router } from "express";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { saveSession, type DB } from "./db.js";
import { pointSchema } from "./point-schema.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function initDevices(db: DB) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS recorder_pairs(code_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS recorder_devices(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),key_hash TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);`,
  );
}
export function createPair(db: DB, user: number) {
  const code = randomBytes(24).toString("base64url");
  const expires = Date.now() + 5 * 60000;
  db.prepare("DELETE FROM recorder_pairs WHERE expires<?").run(Date.now());
  db.prepare("INSERT INTO recorder_pairs VALUES(?,?,?)").run(
    hash(code),
    user,
    expires,
  );
  return { code, expires };
}
export function deviceRouter(db: DB) {
  const router = Router();
  router.post("/redeem", (req, res) => {
    const { code } = z
      .object({ code: z.string().regex(/^[A-Za-z0-9_-]{32}$/) })
      .parse(req.body);
    db.exec("BEGIN IMMEDIATE");
    try {
      const pair = db
        .prepare(
          "SELECT user_id FROM recorder_pairs WHERE code_hash=? AND expires>?",
        )
        .get(hash(code), Date.now());
      if (!pair) {
        db.exec("ROLLBACK");
        res.status(401).json({ error: "Код истёк или уже использован" });
        return;
      }
      db.prepare("DELETE FROM recorder_pairs WHERE code_hash=?").run(
        hash(code),
      );
      const key = randomBytes(32).toString("base64url"),
        id = randomUUID();
      db.prepare(
        "INSERT INTO recorder_devices(id,user_id,key_hash,created_at) VALUES(?,?,?,?)",
      ).run(id, pair.user_id, hash(key), Date.now());
      db.exec("COMMIT");
      res.set("Cache-Control", "no-store").json({ id, key });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  router.use((req, res, next) => {
    const key = req
      .get("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    const d = key
      ? db
          .prepare(
            "SELECT id,user_id FROM recorder_devices WHERE key_hash=? AND revoked=0",
          )
          .get(hash(key))
      : undefined;
    if (!d) {
      res
        .status(401)
        .json({ error: "Устройство не привязано или доступ отозван" });
      return;
    }
    res.locals.device = d;
    next();
  });
  router.post("/sessions", (req, res) => {
    const s = z
      .object({
        id: z.uuid(),
        points: z.array(pointSchema).min(2).max(40000),
        resort: z.string().max(100).default(""),
        trip: z.string().max(100).default(""),
        skiResortId: z.string().max(100).optional(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(
        saveSession(db, Number(res.locals.device.user_id), {
          ...s,
          source: "native",
        }),
      );
  });
  router.get("/status", (_req, res) => res.json({ paired: true }));
  return router;
}
