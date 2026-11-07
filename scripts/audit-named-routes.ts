// Read-only audit of the pinned public Dombay sources. Does not open SQLite.
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { bundleSchema } from "../backend/src/ski-data.js";
import { osmXmlToOverpass } from "../shared/ski-alternatives.js";
import { namedRoutes, dombayCatalogue } from "../shared/named-routes.js";
const packageFile = "map-sources/prepared/dombay-2026-11-06.slopemap",
  xmlFile = "tests/fixtures/dombay/resort.osm";
const digest = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const data = fs.readFileSync(packageFile),
  payload = JSON.parse(
    gunzipSync(data, { maxOutputLength: 64 * 1024 * 1024 }).toString(),
  );
const entry = payload.entries.find((e: any) => e.id === "ru-dombay");
if (!entry || digest(entry.json) !== entry.sha256)
  throw Error("Invalid package hash");
const bundle = bundleSchema.parse(JSON.parse(entry.json)),
  raw = osmXmlToOverpass(fs.readFileSync(xmlFile, "utf8"));
const ways = new Map<number, any>(
  raw.elements.filter((e: any) => e.type === "way").map((e: any) => [e.id, e]),
);
const routes = namedRoutes(bundle);
const links = (ids: string[]) =>
  ids
    .map(
      (id) =>
        `[${id}](https://www.openstreetmap.org/${id.replace("way-", "way/").replace("relation-", "relation/")})`,
    )
    .join(", ") || "—";
const rows = routes.map((route) => {
  const nodeConnections: { left: string; right: string; nodeIds: number[] }[] =
    [];
  for (let i = 0; i < route.lineIds.length; i++)
    for (let j = i + 1; j < route.lineIds.length; j++) {
      const left = route.lineIds[i],
        right = route.lineIds[j],
        a = ways.get(Number(left.replace("way-", ""))),
        b = ways.get(Number(right.replace("way-", ""))),
        nodes = new Set<number>(a?.nodes ?? []),
        shared = (b?.nodes ?? []).filter((n: number) => nodes.has(n));
      if (shared.length) nodeConnections.push({ left, right, nodeIds: shared });
    }
  return {
    ...route,
    nodeConnections,
    lines: route.lineIds.map((id) => {
      const l = bundle.lines.find((l) => l.id === id)!;
      return {
        id,
        difficulty: l.difficulty,
        pisteType: l.osmTags?.["piste:type"] ?? null,
        pisteRef: l.osmTags?.["piste:ref"] ?? null,
        route: l.osmTags?.route ?? null,
        relations: l.routeRelations ?? [],
      };
    }),
    areas: route.areaIds.map((id) => {
      const a = bundle.areas!.find((a) => a.id === id)!;
      return {
        id,
        difficulty: a.difficulty,
        grooming: a.grooming,
        complete: a.complete,
        rings: a.rings.length,
      };
    }),
  };
});
const namedIds = new Set(routes.flatMap((r) => r.lineIds));
const report = {
  catalogue: dombayCatalogue,
  officialPageIndependentlyRead: false,
  officialExtentConfirmed: false,
  sourceHashes: {
    package: digest(data),
    xml: digest(fs.readFileSync(xmlFile)),
  },
  counts: {
    matchedNames: routes.filter((r) => r.status === "osm-name-match").length,
    catalogueNames: routes.length,
    allLinearPisteSegments: bundle.lines.filter(
      (l) => l.kind === "piste" && l.geometryRole === "centerline",
    ).length,
    namedLineSegments: namedIds.size,
    contextLineSegments: bundle.lines.filter(
      (l) =>
        l.kind === "piste" &&
        l.geometryRole === "centerline" &&
        !namedIds.has(l.id),
    ).length,
    areas: bundle.areas?.length ?? 0,
    lifts: bundle.resort.lifts,
    allSourceObjects: bundle.lines.length,
  },
  mapping: rows,
};
const md = [
  "# Сопоставление названий Домбая и настоящих объектов OSM",
  "",
  `Источник списка названий: задание пользователя, ссылка на каталог: ${dombayCatalogue.url}. Страница не прочитана независимо (CONNECT 403); официальные сложности и полная геометрия не подтверждены. Имена OSM и точные общие node ID проверяются по подготовленному пакету и исходному XML.`,
  "",
  "| Имя из каталога | Линейные OSM ID | Площадные OSM ID | Геометрия / сложность OSM | Подтверждение |",
  "| --- | --- | --- | --- | --- |",
];
for (const r of rows) {
  const types =
    [
      r.lineIds.length
        ? `${r.lineIds.length} линейных частей, ${r.components} связный компонент`
        : "",
      r.areaIds.length ? `${r.areaIds.length} площадных зон` : "",
    ]
      .filter(Boolean)
      .join("; ") || "Нет привязки";
  const difficulty = [
    r.lines.length
      ? "линии: " +
        [...new Set(r.lines.map((l) => l.difficulty ?? "unknown"))].join("/")
      : "",
    r.areas.length
      ? "площади: " +
        [...new Set(r.areas.map((a) => a.difficulty ?? "unknown"))].join("/")
      : "",
  ]
    .filter(Boolean)
    .join("; ");
  const evidence =
    r.status === "unmatched"
      ? "Достоверного совпадения нет"
      : `Совпадение имени OSM${r.nodeConnections.length ? "; общие node ID у частей" : ""}${r.areaIds.some((id) => id.startsWith("relation-")) ? "; имя multipolygon relation" : ""}. Полная официальная трасса не подтверждена.`;
  md.push(
    `| ${r.name} | ${links(r.lineIds)} | ${links(r.areaIds)} | ${types}${difficulty ? "; " + difficulty : ""} | ${evidence} |`,
  );
}
md.push(
  "",
  "`easy` — синяя, `intermediate` — красная, `novice` — учебная. У «Лесной» синяя линия и красная площадная зона сохранены раздельно: это конфликт исходных атрибутов, не повод выбрать одну сложность произвольно.",
  "",
  `Итог: ${report.counts.matchedNames} совпадений имён, ${report.counts.namedLineSegments} именованных линейных частей, ${report.counts.contextLineSegments} дополнительных частей. Все ${report.counts.allSourceObjects} исходных объектов сохранены. «Выезд на лесную», «Лягушатник» и участки без имени не назначаются официальным маршрутам по близости. В линейных частях этого набора отсутствует piste:ref; числовые номера официальных трасс не угадываются.`,
  "",
  "Восстановление таблицы: `node --import tsx scripts/audit-named-routes.ts`. Полные теги, свидетельства и общие node ID: [DOMBAY_NAMED_ROUTES.json](DOMBAY_NAMED_ROUTES.json).",
  "",
);
fs.writeFileSync(
  "docs/DOMBAY_NAMED_ROUTES.json",
  JSON.stringify(report, null, 2) + "\n",
);
fs.writeFileSync("docs/DOMBAY_NAMED_ROUTES.md", md.join("\n"));
console.log(JSON.stringify(report.counts));
