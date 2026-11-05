import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../backend/src/app.js";
import { openDb } from "../backend/src/db.js";
import { demoTrack } from "../shared/demo.js";
import { randomUUID } from "node:crypto";
import { signed } from "./helpers.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const config = {
  production: false,
  devAuth: false,
  token: "test-token",
  origins: [],
  trustProxy: 0,
};
const auth = (id = 22) => `tma ${signed(id, Math.floor(Date.now() / 1000))}`;
test("API: auth, profile, idempotent sessions, private access, GPX, demo, delete", async () => {
  const db = openDb(":memory:"),
    app = createApp(db, config);
  try {
    await request(app).get("/api/me").expect(401);
    await request(app)
      .get("/api/me")
      .set("Authorization", "Dev local")
      .expect(401);
    await request(app).get("/api/me").set("Authorization", auth()).expect(200);
    const profile = {
      nickname: "Снежный",
      sport: "snowboard",
      level: "confident",
      discipline: "all",
      resort: "Тест",
      equipment: "Доска",
    };
    await request(app)
      .put("/api/profile")
      .set("Authorization", auth())
      .send(profile)
      .expect(200);
    assert.equal(
      (await request(app).get("/api/me").set("Authorization", auth())).body
        .profile.nickname,
      "Снежный",
    );
    const id = randomUUID(),
      body = { id, points: demoTrack(), resort: "Горы", trip: "Поездка" };
    await request(app)
      .post("/api/sessions")
      .set("Authorization", auth())
      .send(body)
      .expect(201);
    await request(app)
      .post("/api/sessions")
      .set("Authorization", auth())
      .send(body)
      .expect(201);
    assert.equal(
      (await request(app).get("/api/sessions").set("Authorization", auth()))
        .body.length,
      1,
    );
    await request(app)
      .get(`/api/sessions/${id}`)
      .set("Authorization", auth(33))
      .expect(404);
    await request(app)
      .delete(`/api/sessions/${id}`)
      .set("Authorization", auth(33))
      .expect(404);
    assert.equal(
      (await request(app).get("/api/sessions").set("Authorization", auth(33)))
        .body.length,
      0,
    );
    const detail = await request(app)
      .get(`/api/sessions/${id}`)
      .set("Authorization", auth())
      .expect(200);
    assert.equal(detail.body.analysis.runs.length, 2);
    await request(app)
      .post("/api/demo")
      .set("Authorization", auth())
      .send({ index: 1 })
      .expect(201);
    const list = (
      await request(app).get("/api/sessions").set("Authorization", auth())
    ).body;
    assert.equal(list.filter((s: any) => s.source === "demo").length, 1);
    const xml =
      '<gpx><trk><trkseg><trkpt lat="43" lon="40"><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="43.001" lon="40"><time>2026-01-01T00:00:10Z</time></trkpt></trkseg></trk></gpx>';
    const importId = randomUUID();
    for (let i = 0; i < 2; i++)
      await request(app)
        .post("/api/import")
        .set("Authorization", auth())
        .field("id", importId)
        .field("resort", "Тест")
        .field("trip", "Поездка")
        .field("demo", "false")
        .attach("file", Buffer.from(xml), "ride.gpx")
        .expect(201);
    await request(app)
      .post("/api/import")
      .set("Authorization", auth())
      .field("id", randomUUID())
      .attach("file", Buffer.from("<!DOCTYPE x><gpx/>"), "bad.gpx")
      .expect(400);
    await request(app)
      .post("/api/sessions")
      .set("Authorization", auth())
      .send({ id: "bad", points: [] })
      .expect(400);
    await request(app)
      .delete(`/api/sessions/${id}`)
      .set("Authorization", auth())
      .expect(204);
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM gps_points WHERE session_id=?")
        .get(id)!.n,
      0,
    );
  } finally {
    db.close();
  }
});
test("SQLite history and profile survive database reopening", async () => {
  const dir = mkdtempSync(join(tmpdir(), "slope-"));
  const path = join(dir, "test.sqlite");
  let db = openDb(path);
  try {
    let app = createApp(db, config);
    await request(app).get("/api/me").set("Authorization", auth()).expect(200);
    await request(app)
      .post("/api/demo")
      .set("Authorization", auth())
      .send({ index: 0 })
      .expect(201);
    db.close();
    db = openDb(path);
    app = createApp(db, config);
    assert.equal(
      (await request(app).get("/api/sessions").set("Authorization", auth()))
        .body.length,
      1,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
test("production rejects development authentication and absent token", () => {
  const db = openDb(":memory:");
  try {
    assert.throws(() =>
      createApp(db, { ...config, production: true, devAuth: true }),
    );
    assert.throws(() =>
      createApp(db, { ...config, production: true, token: "" }),
    );
  } finally {
    db.close();
  }
});
