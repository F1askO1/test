import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../backend/src/app.js";
import {
  openDb,
  ensureUser,
  saveSession,
  getSession,
} from "../backend/src/db.js";
import { demoTrack } from "../shared/demo.js";
import { analyze as legacy } from "../shared/track-v1.js";
test("device pairing is one-time, isolated, revocable and upload UUID is idempotent", async () => {
  const db = openDb(":memory:");
  const app = createApp(db, {
    production: false,
    devAuth: true,
    token: "",
    trustProxy: 0,
    origins: [],
  });
  const pair = await request(app)
    .post("/api/recorder/pair")
    .set("Authorization", "Dev local")
    .expect(200);
  const device = await request(app)
    .post("/api/device/redeem")
    .send({ code: pair.body.code })
    .expect(200);
  await request(app)
    .post("/api/device/redeem")
    .send({ code: pair.body.code })
    .expect(401);
  await request(app).post("/api/device/sessions").send({}).expect(401);
  const body = { id: crypto.randomUUID(), points: demoTrack() };
  const one = await request(app)
    .post("/api/device/sessions")
    .set("Authorization", "Bearer " + device.body.key)
    .send(body)
    .expect(201);
  await request(app)
    .post("/api/device/sessions")
    .set("Authorization", "Bearer " + device.body.key)
    .send(body)
    .expect(201);
  assert.equal(one.body.source, "native");
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get()!.n, 1);
  await request(app)
    .get("/api/sessions")
    .set("Authorization", "Bearer " + device.body.key)
    .expect(401);
  await request(app)
    .delete("/api/recorder/devices/" + device.body.id)
    .set("Authorization", "Dev local")
    .expect(204);
  await request(app)
    .post("/api/device/sessions")
    .set("Authorization", "Bearer " + device.body.key)
    .send(body)
    .expect(401);
  await request(app).get("/api/ski/catalog").expect(401);
  db.close();
});
test("expired pairing code is rejected; old stored summary and v1 detail are not silently upgraded", async () => {
  const db = openDb(":memory:");
  ensureUser(db, { id: 1, first_name: "Test" });
  const app = createApp(db, {
    production: false,
    devAuth: true,
    token: "",
    trustProxy: 0,
    origins: [],
  });
  const pair = await request(app)
    .post("/api/recorder/pair")
    .set("Authorization", "Dev local");
  db.exec("UPDATE recorder_pairs SET expires=1");
  await request(app)
    .post("/api/device/redeem")
    .send({ code: pair.body.code })
    .expect(401);
  const id = crypto.randomUUID(),
    ps = demoTrack();
  saveSession(db, 1, { id, points: ps, source: "gps", resort: "", trip: "" });
  const { points, edges, ...summary } = legacy(ps);
  db.prepare("UPDATE sessions SET analysis=? WHERE id=?").run(
    JSON.stringify(summary),
    id,
  );
  const loaded = getSession(db, 1, id)!;
  assert.equal(loaded.analysis.engineVersion, undefined);
  assert.equal(loaded.analysis.runs.length, legacy(ps).runs.length);
  db.close();
});
