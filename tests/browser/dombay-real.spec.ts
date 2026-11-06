import { waitForFullTerrain } from "./map-coverage";
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const mapsRoot = process.env.SLOPEMATE_TEST_MAPS || "map-data";
const catalog = JSON.parse(
  fs.readFileSync(path.join(mapsRoot, "catalog.json"), "utf8"),
);
const resort = catalog.resorts.find((r: any) => r.id === "ru-dombay");
test("REAL DATA ONLY: Dombay source pistes, lifts and actual terrain tiles", async ({
  page,
}) => {
  test.setTimeout(180000);
  test.skip(
    process.env.SLOPEMATE_MAP_OFFLINE === "1",
    "Сеть тайлов запрещена политикой среды; реальную подложку этот прогон не проверяет.",
  );
  test.skip(
    !resort,
    "Реальный набор Домбая не получен: источник запрещён network policy. Синтетика не подставляется.",
  );
  const bundle = JSON.parse(
    fs.readFileSync(path.join(mapsRoot, catalog.files[resort.id]), "utf8"),
  );
  expect(bundle.lines.some((l: any) => l.kind === "piste")).toBe(true);
  expect(bundle.lines.some((l: any) => l.kind === "lift")).toBe(true);
  expect(resort.classified).toBeGreaterThan(0);
  expect(
    bundle.lines.find((l: any) => l.id === "way-879140376")?.geometryRole,
    "Установите пакет из исходного OSM с площадными тегами",
  ).toBe("area-boundary");
  expect(bundle.areas?.some((a: any) => a.id === "way-879140376")).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://telegram.org/**", (r) => r.abort());
  const network: unknown[] = [];
  page.on("response", (r) => {
    if (/tile\.(opentopomap|openstreetmap)\.org/.test(r.url()))
      network.push({
        url: new URL(r.url()).hostname + new URL(r.url()).pathname,
        status: r.status(),
      });
  });
  page.on("requestfailed", (r) => {
    if (/tile\.(opentopomap|openstreetmap)\.org/.test(r.url()))
      network.push({
        url: new URL(r.url()).hostname + new URL(r.url()).pathname,
        error: r.failure()?.errorText,
      });
  });
  try {
    // No mocked geometry, /api/ski or tiles in this test.
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Карта", exact: true })
      .click();
    await page.getByRole("button", { name: "Поиск и выбор курорта" }).click();
    await page.getByLabel("Курорт", { exact: true }).selectOption("ru-dombay");
    await page.locator(".map-wrap").scrollIntoViewIfNeeded();
    await waitForFullTerrain(page, "artifacts/real-dombay/map-coverage.json");
    await page.screenshot({
      path: "artifacts/real-dombay/map.png",
      fullPage: false,
    });
    const piste = bundle.lines.find((l: any) => l.kind === "piste");
    await page.getByRole("button", { name: "Поиск и выбор курорта" }).click();
    await page.getByLabel("Курорт или трасса").fill(piste.name);
    await page
      .getByRole("button", { name: "⌁ " + piste.name, exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("region", { name: "Карточка объекта карты" }),
    ).toContainText(piste.name);
    await waitForFullTerrain(page, "artifacts/real-dombay/piste-coverage.json");
    await page.screenshot({
      path: "artifacts/real-dombay/piste.png",
      fullPage: false,
    });
    await page.getByRole("button", { name: "Закрыть: Трасса" }).click();
    await page.getByRole("button", { name: "Отдалить", exact: true }).click();
    await waitForFullTerrain(
      page,
      "artifacts/real-dombay/parallel-coverage.json",
    );
    const view = await page.locator(".ski-map").getAttribute("data-map-view");
    await page.getByRole("button", { name: "Слои", exact: true }).click();
    await page.getByLabel("Исходные линии OSM (диагностика)").check();
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await waitForFullTerrain(
      page,
      "artifacts/real-dombay/parallel-before-coverage.json",
    );
    await page.screenshot({
      path: "artifacts/real-dombay/parallel-before.png",
      fullPage: false,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Слои", exact: true }).click();
    await page.getByLabel("Исходные линии OSM (диагностика)").uncheck();
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await expect(page.locator(".ski-map")).toHaveAttribute(
      "data-map-view",
      view!,
    );
    await waitForFullTerrain(
      page,
      "artifacts/real-dombay/parallel-after-coverage.json",
    );
    await page.screenshot({
      path: "artifacts/real-dombay/parallel-after.png",
      fullPage: false,
      animations: "disabled",
    });
    const junction = bundle.lines.find(
      (l: any) =>
        l.kind === "piste" &&
        l.geometryRole !== "area-boundary" &&
        l.name === "Домбайская поляна",
    );
    expect(junction).toBeTruthy();
    await page.getByRole("button", { name: "Поиск и выбор курорта" }).click();
    await page.getByLabel("Курорт или трасса").fill(junction.name);
    await page
      .getByRole("button", { name: "⌁ " + junction.name, exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Закрыть: Трасса" }).click();
    await waitForFullTerrain(
      page,
      "artifacts/real-dombay/junction-coverage.json",
    );
    await page.screenshot({
      path: "artifacts/real-dombay/junction.png",
      fullPage: false,
      animations: "disabled",
    });
  } finally {
    fs.mkdirSync("artifacts/real-dombay", { recursive: true });
    fs.writeFileSync(
      "artifacts/real-dombay/tile-network.json",
      JSON.stringify(network, null, 2),
    );
  }
});
