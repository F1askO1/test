import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TelegramUser } from "./auth.js";
import { analyze, type Analysis, type Point } from "../../shared/track.js";
export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,first_name TEXT NOT NULL,username TEXT,photo_url TEXT);
 CREATE TABLE IF NOT EXISTS rider_profiles(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,nickname TEXT NOT NULL DEFAULT '',sport TEXT NOT NULL DEFAULT 'snowboard',level TEXT NOT NULL DEFAULT 'beginner',discipline TEXT NOT NULL DEFAULT 'all',resort TEXT NOT NULL DEFAULT '',equipment TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),source TEXT NOT NULL,resort TEXT NOT NULL,trip TEXT NOT NULL,started_at INTEGER NOT NULL,created_at INTEGER NOT NULL,analysis TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(user_id,started_at);
 CREATE TABLE IF NOT EXISTS gps_points(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,seq INTEGER NOT NULL,point TEXT NOT NULL,PRIMARY KEY(session_id,seq));
 CREATE TABLE IF NOT EXISTS runs(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,seq INTEGER NOT NULL,details TEXT NOT NULL,PRIMARY KEY(session_id,seq));
 PRAGMA user_version=1;`);
  return db;
}
export type DB = ReturnType<typeof openDb>;
export function ensureUser(db: DB, u: TelegramUser) {
  db.prepare(
    "INSERT INTO users(id,first_name,username,photo_url) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name,username=excluded.username,photo_url=excluded.photo_url",
  ).run(u.id, u.first_name, u.username ?? null, u.photo_url ?? null);
  db.prepare("INSERT OR IGNORE INTO rider_profiles(user_id) VALUES(?)").run(
    u.id,
  );
}
export function saveSession(
  db: DB,
  user: number,
  data: {
    id: string;
    source: string;
    resort: string;
    trip: string;
    points: Point[];
  },
) {
  const existing = db
    .prepare("SELECT user_id FROM sessions WHERE id=?")
    .get(data.id);
  if (existing) {
    if (existing.user_id !== user) throw new Error("Идентификатор уже занят");
    return getSession(db, user, data.id);
  }
  const a = analyze(data.points);
  if (a.points.length < 2 || a.duration <= 0)
    throw new Error("Недостаточно пригодных GPS-данных");
  db.exec("BEGIN IMMEDIATE");
  try {
    const { points, edges, ...summary } = a;
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)").run(
      data.id,
      user,
      data.source,
      data.resort,
      data.trip,
      a.points[0].t,
      Date.now(),
      JSON.stringify(summary),
    );
    const p = db.prepare("INSERT INTO gps_points VALUES(?,?,?)");
    points.forEach((point, i) => p.run(data.id, i, JSON.stringify(point)));
    const r = db.prepare("INSERT INTO runs VALUES(?,?,?)");
    a.runs.forEach((run, i) => r.run(data.id, i, JSON.stringify(run)));
    db.exec("COMMIT");
    return getSession(db, user, data.id);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function listSessions(db: DB, user: number) {
  return db
    .prepare(
      "SELECT id,source,resort,trip,started_at,analysis FROM sessions WHERE user_id=? ORDER BY started_at DESC",
    )
    .all(user)
    .map((row) => ({
      id: row.id as string,
      source: row.source as string,
      resort: row.resort as string,
      trip: row.trip as string,
      started_at: row.started_at as number,
      analysis: JSON.parse(row.analysis as string) as Omit<
        Analysis,
        "points" | "edges"
      >,
    }));
}
export function getSession(db: DB, user: number, id: string) {
  const row = db
    .prepare(
      "SELECT id,source,resort,trip,started_at,analysis FROM sessions WHERE id=? AND user_id=?",
    )
    .get(id, user);
  if (!row) return null;
  const points = db
    .prepare("SELECT point FROM gps_points WHERE session_id=? ORDER BY seq")
    .all(id)
    .map((r) => JSON.parse(r.point as string));
  return {
    ...row,
    analysis: {
      ...analyze(points),
      rejected: JSON.parse(row.analysis as string).rejected,
    },
  };
}
