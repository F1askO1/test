import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { project } from "../../shared/ski";
import { waitForFullTerrain } from "./map-coverage";
const root = process.env.SLOPEMATE_TEST_MAPS;
const catalog = root
  ? JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8"))
  : null;
const bundle = catalog?.files?.["ru-dombay"]
  ? JSON.parse(
      fs.readFileSync(path.join(root!, catalog.files["ru-dombay"]), "utf8"),
    )
  : null;
test("REAL Dombay: identical-camera base/main/detail/named/area; offline geometry is not a terrain proof", async ({
  page,
}) => {
  test.setTimeout(180000);
  test.skip(
    !bundle?.areas?.length,
    "Requires isolated real prepared Dombay package",
  );
  const offline = process.env.SLOPEMATE_MAP_OFFLINE === "1";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://telegram.org/**", (r) => r.abort());
  if (offline)
    await page.route(
      /https:\/\/.*tile\.(opentopomap|openstreetmap)\.org\//,
      (r) => r.abort(),
    );
  await page.addInitScript(() =>
    localStorage.setItem("slopemate:resort", "ru-dombay"),
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Карта", exact: true })
    .click();
  await expect(page.locator(".map-search-trigger")).toContainText("Домбай");
  let nativeProvider: "topo" | "clean" = "topo";
  if (!offline) {
    await page.getByRole("button", { name: "Слои", exact: true }).click();
    const clean = page.getByRole("button", { name: /^Чистая топография:/ });
    if (await clean.count()) {
      await clean.click();
      nativeProvider = "clean";
    }
    await page.getByRole("button", { name: "Готово", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Приблизить", exact: true })
    .click({ clickCount: 2, delay: 180 });
  await page.waitForTimeout(400);
  const map = page.locator(".ski-map");
  const camera = await map.getAttribute("data-map-view");
  const layer = async () =>
    page.getByRole("button", { name: "Слои", exact: true }).click();
  const close = async () =>
    page.getByRole("button", { name: "Готово", exact: true }).click();
  const shot = async (name: string) => {
    await expect(
      page.locator(".leaflet-container.leaflet-zoom-anim"),
    ).toHaveCount(0);
    if (offline)
      await expect(map).toHaveAttribute("data-tile-state", "unavailable");
    else
      await waitForFullTerrain(
        page,
        `artifacts/real-dombay/named-${name}-coverage.json`,
        nativeProvider,
      );
    await expect(map).toHaveAttribute("data-map-view", camera!);
    fs.mkdirSync("artifacts/named-routes/screenshots", { recursive: true });
    await page.screenshot({
      path: `artifacts/named-routes/screenshots/${name}.png`,
      fullPage: false,
      animations: "disabled",
    });
    fs.writeFileSync(
      `artifacts/named-routes/screenshots/${name}.json`,
      JSON.stringify(
        {
          offline,
          geometry: "real prepared user OSM package",
          state: await map.evaluate((el) => ({ ...el.dataset })),
          viewport: { width: 390, height: 844 },
        },
        null,
        2,
      ),
    );
  };
  await expect(map).toHaveAttribute("data-map-mode", "main");
  await expect(map).toHaveAttribute("data-named-routes", "9");
  await layer();
  await page.getByLabel("Трассы", { exact: true }).uncheck();
  await page.getByLabel("Подъёмники и станции").uncheck();
  await page.getByLabel("Мой трек", { exact: true }).uncheck();
  await close();
  await expect(map).toHaveAttribute("data-render-paths", "0");
  await shot("basemap-only");
  await layer();
  await page.getByLabel("Трассы", { exact: true }).check();
  await page.getByLabel("Подъёмники и станции").check();
  await close();
  await shot("main");
  const mainColor = Number(await map.getAttribute("data-colored-piste-paths"));
  await layer();
  await page.getByLabel("Режим карты").selectOption("osm");
  await close();
  await shot("detailed");
  if (offline) {
    expect(
      Number(await map.getAttribute("data-colored-piste-paths")),
    ).toBeGreaterThan(mainColor);
  } else if (nativeProvider === "topo") {
    await expect(map).toHaveAttribute("data-ski-overlay", "vectors");
    await expect(map).toHaveAttribute("data-lift-overlay", "raster-only");
  }
  if (!offline && nativeProvider === "topo") {
    await layer();
    await page.getByLabel("Не дублировать лыжную схему OpenTopoMap").uncheck();
    await close();
    await shot("detailed-overlay-inspection");
    await layer();
    await page.getByLabel("Режим карты").selectOption("main");
    await close();
    await shot("main-overlay-inspection");
    await layer();
    await page.getByLabel("Не дублировать лыжную схему OpenTopoMap").check();
    await close();
  }
  await layer();
  await page.getByLabel("Режим карты").selectOption("main");
  await close();
  const geo = (
    x: number,
    y: number,
    rect: { x: number; y: number; width: number; height: number },
    view: number[],
  ) => {
    const scale = 256 * 2 ** view[2],
      sin = Math.sin((view[0] * Math.PI) / 180),
      cx = ((view[1] + 180) / 360) * scale,
      cy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
    const wx = cx + x - rect.x - rect.width / 2,
      wy = cy + y - rect.y - rect.height / 2;
    return {
      lon: (wx / scale) * 360 - 180,
      lat:
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / scale))) * 180) /
        Math.PI,
      t: 1,
    };
  };
  const rect = (await page.locator(".map").boundingBox())!,
    view = camera!.split(",").map(Number);
  const target = bundle.lines.find((l: any) => l.id === "way-400416107");
  let hit: { x: number; y: number } | null = null;
  for (let y = 170; y < 660 && !hit; y += 3)
    for (let x = 65; x < 310; x += 3) {
      const p = geo(x, y, rect, view);
      if (project(p, target.coordinates).distance < 1) {
        hit = { x, y };
        break;
      }
    }
  expect(hit).not.toBeNull();
  await page.touchscreen.tap(hit!.x, hit!.y);
  await expect(
    page.getByRole("dialog", { name: "Именованная трасса", exact: true }),
  ).toContainText("Домбайская поляна");
  await shot("selected-named");
  await page
    .getByRole("button", { name: "Закрыть: Именованная трасса" })
    .click();
  await page.getByRole("button", { name: "О курорте", exact: true }).click();
  await page.getByText("Площадные зоны OSM", { exact: true }).click();
  await page
    .getByRole("button", { name: "Площадь: Сулахат", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Площадная трасса", exact: true }),
  ).toContainText("Сулахат");
  await shot("area");
});
test("MOCK raster: default protection prevents extra ordinary ski strokes; explicit inspection override restores them", async ({
  page,
}) => {
  test.skip(!bundle, "Requires isolated real package");
  await page.route("https://telegram.org/**", (r) => r.abort());
  await page.route(
    /https:\/\/.*tile\.(opentopomap|openstreetmap)\.org\//,
    (r) =>
      r.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#ddd"/></svg>',
      }),
  );
  await page.addInitScript(() =>
    localStorage.setItem("slopemate:resort", "ru-dombay"),
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Карта", exact: true })
    .click();
  const map = page.locator(".ski-map");
  await expect(map).toHaveAttribute("data-tile-state", "ready");
  await expect(map).toHaveAttribute("data-ski-overlay", "vectors");
  await expect(map).toHaveAttribute("data-lift-overlay", "raster-only");
  expect(Number(await map.getAttribute("data-render-paths"))).toBeGreaterThan(
    0,
  );
  await page.getByRole("button", { name: "Слои", exact: true }).click();
  await page
    .getByLabel("Наш слой подъёмников поверх подложки (сравнение)")
    .check();
  await expect(map).toHaveAttribute("data-lift-overlay", "vectors");
  await page
    .getByLabel("Наш слой подъёмников поверх подложки (сравнение)")
    .uncheck();
  await expect(map).toHaveAttribute("data-lift-overlay", "raster-only");
  await page
    .getByLabel("Трассы уже нарисованы в подложке (после проверки)")
    .check();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(map).toHaveAttribute("data-render-paths", "0");
  await page.getByRole("button", { name: "Слои", exact: true }).click();
  await page.getByLabel("Не дублировать лыжную схему OpenTopoMap").uncheck();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(map).toHaveAttribute("data-ski-overlay", "vectors");
  expect(Number(await map.getAttribute("data-render-paths"))).toBeGreaterThan(
    0,
  );
});
