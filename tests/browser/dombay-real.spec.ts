import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const catalog = JSON.parse(fs.readFileSync("map-data/catalog.json", "utf8"));
const resort = catalog.resorts.find((r: any) => r.id === "ru-dombay");
test("REAL DATA ONLY: Dombay source pistes, lifts and actual terrain tiles", async ({
  page,
}) => {
  test.skip(
    !resort,
    "Реальный набор Домбая не получен: источник запрещён network policy. Синтетика не подставляется.",
  );
  const bundle = JSON.parse(
    fs.readFileSync(path.join("map-data", catalog.files[resort.id]), "utf8"),
  );
  expect(bundle.lines.some((l: any) => l.kind === "piste")).toBe(true);
  expect(bundle.lines.some((l: any) => l.kind === "lift")).toBe(true);
  expect(resort.classified).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://telegram.org/**", (r) => r.abort());
  // No mocked geometry, /api/ski or tiles in this test.
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Карта", exact: true })
    .click();
  await page.getByLabel("Курорт", { exact: true }).selectOption("ru-dombay");
  await page.locator(".map-wrap").scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.locator(".leaflet-tile-loaded").count(), {
      timeout: 20000,
    })
    .toBeGreaterThan(0);
  await expect(page.locator(".tile-error")).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/real-dombay/map.png",
    fullPage: true,
  });
  const piste = bundle.lines.find((l: any) => l.kind === "piste");
  await page.getByLabel("Курорт или трасса").fill(piste.name);
  await page
    .getByRole("button", { name: "⌁ " + piste.name, exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "Карточка объекта карты" }),
  ).toContainText(piste.name);
  await page.screenshot({
    path: "artifacts/real-dombay/piste.png",
    fullPage: true,
  });
});
