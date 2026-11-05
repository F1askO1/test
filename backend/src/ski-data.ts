import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { SkiCatalog, SkiBundle } from "../../shared/ski.js";
const root = () => resolve(process.env.SKI_DATA_PATH || "map-data");
const coord = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const source = z
  .string()
  .url()
  .refine((s) => {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password;
  });
export const resortSchema = z.object({
  id: z
    .string()
    .regex(/^[\w-]{1,100}$/)
    .refine((s) => !["__proto__", "prototype", "constructor"].includes(s)),
  name: z.string().max(200),
  aliases: z.array(z.string().max(200)).max(30),
  region: z.string().max(200),
  center: coord,
  bbox: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ]),
  source,
  updatedAt: z.string().max(50),
  pistes: z.number().nonnegative(),
  lifts: z.number().nonnegative(),
  classified: z.number().nonnegative(),
  completeness: z.literal("partial"),
  association: z
    .enum(["search-window", "source-membership", "proximity"])
    .optional(),
});
export const lineSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(200),
  kind: z.enum(["piste", "lift"]),
  coordinates: z.array(coord).min(2).max(30000),
  difficulty: z.string().max(100).nullable(),
  osmTags: z.record(z.string(), z.string().max(500)).optional(),
  routeRelations: z
    .array(
      z.object({
        id: z.string(),
        difficulty: z.string().nullable(),
        name: z.string(),
      }),
    )
    .optional(),
  liftType: z.string().max(100).optional(),
  durationSeconds: z.number().positive().nullable().optional(),
  direction: z.union([z.literal(1), z.literal(-1)]).nullable(),
  source,
  stations: z
    .array(
      z.object({
        name: z.string().max(200),
        coordinate: coord,
        role: z.enum(["unknown", "lower", "upper", "intermediate"]),
      }),
    )
    .max(1000),
});
export const catalogSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().nullable(),
  source: z.string().max(500),
  attribution: z.string().max(1000),
  resorts: z.array(resortSchema).max(20000),
  unassigned: z.number().nonnegative(),
  notice: z.string().max(2000).optional(),
  files: z.record(z.string(), z.string()).optional(),
});
export const bundleSchema = z.object({
  resort: resortSchema,
  lines: z.array(lineSchema).max(15000),
  attribution: z.string().max(1000),
  updatedAt: z.string(),
});
function read(name: string) {
  const p = resolve(root(), name);
  if (
    !/^[a-zA-Z0-9_.-]+\.json$/.test(name) ||
    statSync(p).size > 12 * 1024 * 1024
  )
    throw Error("Invalid map bundle");
  return JSON.parse(readFileSync(p, "utf8"));
}
export function skiCatalog(): SkiCatalog & { files?: Record<string, string> } {
  return catalogSchema.parse(read("catalog.json"));
}
const cache = new Map<string, { stamp: number; bundle: SkiBundle }>();
export function skiBundle(id: string): SkiBundle | null {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return null;
  const catalog = skiCatalog(),
    file = catalog.files?.[id];
  if (!file) return null;
  if (!/^[a-zA-Z0-9_.-]+\.json$/.test(file))
    throw Error("Invalid map filename");
  const stamp = statSync(resolve(root(), file)).mtimeMs;
  const hit = cache.get(file);
  if (hit?.stamp === stamp) return hit.bundle;
  const data = bundleSchema.parse(read(file));
  if (data.resort.id !== id) throw Error("Invalid map bundle");
  if (cache.size >= 10) cache.delete(cache.keys().next().value!);
  cache.set(file, { stamp, bundle: data });
  return data;
}
