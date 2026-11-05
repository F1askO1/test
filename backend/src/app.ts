import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { verifyInitData, type TelegramUser } from "./auth.js";
import {
  ensureUser,
  getSession,
  listSessions,
  saveSession,
  type DB,
} from "./db.js";
import { parseGpx, MAX_GPX_BYTES, MAX_POINTS } from "./gpx.js";
import { demoTrack, demoNames } from "../../shared/demo.js";
export type Config = {
  production: boolean;
  devAuth: boolean;
  token: string;
  origins: string[];
  trustProxy: number;
  status?: () => unknown;
};
const point = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  t: z.number().positive().max(8640000000000000),
  alt: z.number().min(-12000).max(20000).nullable().optional(),
  accuracy: z.number().nonnegative().nullable().optional(),
  altAccuracy: z.number().nonnegative().nullable().optional(),
  speed: z.number().nonnegative().nullable().optional(),
  breakBefore: z.boolean().optional(),
});
const session = z.object({
  id: z.uuid(),
  resort: z.string().trim().max(100).default(""),
  trip: z.string().trim().max(100).default(""),
  points: z.array(point).min(2).max(MAX_POINTS),
});
export const profileSchema = z.object({
  nickname: z.string().trim().max(40),
  sport: z.enum(["snowboard", "ski"]),
  level: z.enum(["beginner", "intermediate", "confident", "expert"]),
  discipline: z.enum(["piste", "freeride", "park", "all"]),
  resort: z.string().trim().max(100),
  equipment: z.string().trim().max(200),
});
export function createApp(db: DB, config: Config) {
  if (config.production && config.devAuth)
    throw new Error("DEV_AUTH запрещён в production");
  if (config.production && !config.token)
    throw new Error("BOT_TOKEN обязателен в production");
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://telegram.org"],
          imgSrc: [
            "'self'",
            "data:",
            "blob:",
            "https://*.tile.openstreetmap.org",
            "https://tile.openstreetmap.org",
            "https://*.t.me",
            "https://t.me",
            "https://*.telegram.org",
          ],
          connectSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          frameAncestors: [
            "'self'",
            "https://web.telegram.org",
            "https://*.telegram.org",
          ],
        },
      },
      frameguard: false,
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) =>
        cb(null, !origin || config.origins.includes(origin)),
      credentials: false,
    }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use(express.json({ limit: "12mb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/status", (_req, res) => {
    let database = "ready";
    try {
      db.prepare("SELECT 1").get();
    } catch {
      database = "unavailable";
    }
    res
      .set("Cache-Control", "no-store")
      .json({
        http: "ready",
        mode:
          config.production && !config.devAuth
            ? "production-private"
            : "local-development",
        database,
        telegram: config.status?.() ?? { bot: "disabled", api: "unknown" },
      });
  });
  app.use("/api", (req, res, next) => {
    try {
      let user: TelegramUser;
      const h = req.get("authorization") ?? "";
      if (h.startsWith("tma ") && config.token)
        user = verifyInitData(h.slice(4), config.token);
      else if (config.devAuth && !config.production && h === "Dev local")
        user = { id: 1, first_name: "Райдер", username: "local_rider" };
      else {
        res.status(401).json({
          error:
            "Откройте приложение через Telegram. Локально включите DEV_AUTH.",
        });
        return;
      }
      ensureUser(db, user);
      res.locals.user = user;
      next();
    } catch {
      res.status(401).json({
        error:
          "Авторизация недействительна или истекла. Откройте приложение заново.",
      });
    }
  });
  app.get("/api/me", (_req, res) => {
    const u = res.locals.user;
    res.json({
      user: u,
      profile: db
        .prepare(
          "SELECT nickname,sport,level,discipline,resort,equipment FROM rider_profiles WHERE user_id=?",
        )
        .get(u.id),
      dev: config.devAuth && u.id === 1,
    });
  });
  app.put("/api/profile", (req, res) => {
    const p = profileSchema.parse(req.body);
    db.prepare(
      "UPDATE rider_profiles SET nickname=?,sport=?,level=?,discipline=?,resort=?,equipment=? WHERE user_id=?",
    ).run(
      p.nickname,
      p.sport,
      p.level,
      p.discipline,
      p.resort,
      p.equipment,
      res.locals.user.id,
    );
    res.json(p);
  });
  app.get("/api/sessions", (_req, res) =>
    res.json(listSessions(db, res.locals.user.id)),
  );
  app.get("/api/sessions/:id", (req, res) => {
    const s = getSession(db, res.locals.user.id, String(req.params.id));
    if (!s) {
      res.status(404).json({ error: "Запись не найдена" });
      return;
    }
    res.json(s);
  });
  app.post("/api/sessions", (req, res) => {
    const s = session.parse(req.body);
    res
      .status(201)
      .json(saveSession(db, res.locals.user.id, { ...s, source: "gps" }));
  });
  app.delete("/api/sessions/:id", (req, res) => {
    const r = db
      .prepare("DELETE FROM sessions WHERE id=? AND user_id=?")
      .run(String(req.params.id), res.locals.user.id);
    res.status(r.changes ? 204 : 404).end();
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_GPX_BYTES, files: 1, fields: 4 },
  });
  app.post("/api/import", upload.single("file"), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Выберите GPX-файл" });
      return;
    }
    const meta = z
      .object({
        id: z.uuid(),
        resort: z.string().trim().max(100).default(""),
        trip: z.string().trim().max(100).default(""),
        demo: z.enum(["true", "false"]).default("false"),
      })
      .parse(req.body);
    let points;
    try {
      points = parseGpx(req.file.buffer);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.status(201).json(
      saveSession(db, res.locals.user.id, {
        ...meta,
        points,
        source: meta.demo === "true" ? "demo" : "gpx",
      }),
    );
  });
  app.post("/api/demo", (req, res) => {
    const { index } = z
      .object({ index: z.number().int().min(0).max(2) })
      .parse(req.body);
    res.status(201).json(
      saveSession(db, res.locals.user.id, {
        id: randomUUID(),
        source: "demo",
        resort: demoNames[index],
        trip: "Демонстрация",
        points: demoTrack(index),
      }),
    );
  });
  if (existsSync(resolve("dist/frontend/index.html"))) {
    app.use(express.static(resolve("dist/frontend")));
    app.get("/{*path}", (req, res) => {
      if (req.path.startsWith("/api/")) {
        res.status(404).json({ error: "API не найден" });
        return;
      }
      res.sendFile(resolve("dist/frontend/index.html"));
    });
  }
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const bad =
        err instanceof z.ZodError ||
        err instanceof multer.MulterError ||
        err.type === "entity.too.large";
      const status = bad ? 400 : err.status === 400 ? 400 : 500;
      if (status === 500) console.error("API error:", err.message);
      res.status(status).json({
        error:
          err instanceof z.ZodError
            ? "Проверьте формат данных"
            : err instanceof multer.MulterError
              ? "Файл слишком большой или неверное поле"
              : err.type === "entity.too.large"
                ? "Слишком большой запрос"
                : err instanceof Error &&
                    /GPX|XML|точ|данных|время|дат|Идентификатор|высот|координат|DTD|сущност/i.test(
                      err.message,
                    )
                  ? err.message
                  : "Не удалось выполнить запрос",
      });
    },
  );
  return app;
}
