import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const root = process.env.SLOPEMATE_TEST_MAPS;
const catalog = root
  ? JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8"))
  : null;
const resort = catalog?.resorts.find((r: any) => r.id === "ru-dombay");
for (const [width, height] of [
  [375, 812],
  [390, 844],
  [430, 932],
])
  test(`real Dombay map-first UI ${width} (user OSM package; basemap availability separate)`, async ({
    page,
  }) => {
    test.skip(
      !resort,
      "Для этой проверки нужен изолированный набор из присланного реального пакета, SLOPEMATE_TEST_MAPS.",
    );
    const bundle = JSON.parse(
      fs.readFileSync(path.join(root!, catalog.files[resort.id]), "utf8"),
    );
    expect(bundle.resort.pistes).toBe(136);
    expect(bundle.resort.lifts).toBe(13);
    expect(bundle.resort.classified).toBe(131);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height });
    await page.route("https://telegram.org/**", (r) => r.abort());
    // Only tile requests may be explicitly disabled for the restricted cloud. Geometry/API are NEVER mocked here.
    if (process.env.SLOPEMATE_MAP_OFFLINE === "1")
      await page.route(
        /https:\/\/.*tile\.(opentopomap|openstreetmap)\.org\//,
        (r) => r.abort(),
      );
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Карта", exact: true })
      .click();
    await page.getByRole("button", { name: "Поиск и выбор курорта" }).click();
    await page.getByLabel("Курорт", { exact: true }).selectOption("ru-dombay");
    await expect(page.locator(".map-search-trigger")).toContainText("Домбай");
    await expect(page.locator("canvas")).not.toHaveCount(0);
    await page.waitForTimeout(350);
    const box = await page.locator(".map-wrap").boundingBox();
    expect(box!.height / height).toBeGreaterThan(0.7);
    expect(box!.y).toBeLessThan(85);
    expect(box!.y + box!.height).toBeLessThan(height - 65);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("heading", { name: "На карте", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Открыть сохранённый маршрут", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".resort-info-stats")).toHaveCount(0);
    await expect(page.locator(".leaflet-control-attribution svg")).toHaveCount(
      0,
    );
    await expect(page.locator(".leaflet-control-attribution")).toContainText(
      "OpenStreetMap",
    );
    await page.screenshot({
      path: `artifacts/map-readability/${width}/overview.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "О курорте", exact: true }).click();
    const info = page.getByRole("dialog", { name: "О курорте", exact: true });
    await expect(info).toBeVisible();
    await expect(info.locator(".resort-info-stats")).toContainText("136");
    await expect(info.locator(".resort-info-stats")).toContainText("13");
    await expect(info.locator(".resort-info-stats")).toContainText("131");
    await page.screenshot({
      path: `artifacts/map-readability/${width}/resort-info.png`,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(info).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "О курорте", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Приблизить", exact: true })
      .click({ clickCount: 2, delay: 180 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `artifacts/map-readability/${width}/zoomed.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Поиск и выбор курорта" }).click();
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
      path: `artifacts/map-readability/${width}/selected-piste.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Закрыть: Трасса" }).click();
    await page.getByRole("button", { name: "Слои", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Слои карты" }),
    ).toBeVisible();
    await page.getByLabel("Подъёмники и станции").uncheck();
    await expect(page.getByLabel("Подъёмники и станции")).not.toBeChecked();
    await page.getByLabel("Подъёмники и станции").check();
    await page.screenshot({
      path: `artifacts/map-readability/${width}/layers.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
