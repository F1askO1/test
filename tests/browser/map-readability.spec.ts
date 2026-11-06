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
    const snapshot = async (options: {
      path: string;
      animations: "disabled";
    }) => {
      await expect(
        page.locator(".leaflet-container.leaflet-zoom-anim"),
      ).toHaveCount(0);
      let last = "",
        stable = 0;
      await expect
        .poll(
          async () => {
            const state = await page
              .locator(".ski-map")
              .evaluate((el) => ({
                view: (el as HTMLElement).dataset.mapView,
                transform: (
                  el.querySelector(".leaflet-map-pane") as HTMLElement
                )?.style.transform,
                tile: (el as HTMLElement).dataset.tileState,
                pending: (el as HTMLElement).dataset.tilePending,
              }));
            const signature = JSON.stringify(state),
              settled =
                process.env.SLOPEMATE_MAP_OFFLINE === "1"
                  ? state.tile === "unavailable" && state.pending === "0"
                  : state.tile !== "loading";
            stable = settled && signature === last ? stable + 1 : 0;
            last = signature;
            return stable;
          },
          { intervals: [150, 150, 150] },
        )
        .toBeGreaterThanOrEqual(2);
      await page.screenshot(options);
      fs.writeFileSync(
        options.path + ".json",
        JSON.stringify(
          await page.locator(".ski-map").evaluate((el) => ({
            state: { ...(el as HTMLElement).dataset },
            viewport: el
              .querySelector(".map")!
              .getBoundingClientRect()
              .toJSON(),
          })),
          null,
          2,
        ),
      );
    };
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
    await snapshot({
      path: `artifacts/map-readability/${width}/overview.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "О курорте", exact: true }).click();
    const info = page.getByRole("dialog", { name: "О курорте", exact: true });
    await expect(info).toBeVisible();
    await expect(info.locator(".resort-info-stats")).toContainText("136");
    await expect(info.locator(".resort-info-stats")).toContainText("13");
    await expect(info.locator(".resort-info-stats")).toContainText("131");
    await snapshot({
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
    await snapshot({
      path: `artifacts/map-readability/${width}/zoomed.png`,
      animations: "disabled",
    });
    const view = await page.locator(".ski-map").getAttribute("data-map-view");
    await page.getByRole("button", { name: "Слои", exact: true }).click();
    await page.getByLabel("Исходные линии OSM (диагностика)").check();
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await snapshot({
      path: `artifacts/map-readability/${width}/geometry-before.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Слои", exact: true }).click();
    await page.getByLabel("Исходные линии OSM (диагностика)").uncheck();
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await expect(page.locator(".ski-map")).toHaveAttribute(
      "data-map-view",
      view!,
    );
    await expect(page.locator(".ski-map")).toHaveAttribute(
      "data-source-lines",
      "149",
    );
    await expect(page.locator(".ski-map")).toHaveAttribute(
      "data-display-segments",
      bundle.areas?.length ? "644" : "1273",
    );
    await snapshot({
      path: `artifacts/map-readability/${width}/geometry-after.png`,
      animations: "disabled",
    });
    // Repeated redraw must not accumulate Canvas renderers/layers.
    const canvases = await page.locator(".leaflet-pane canvas").count();
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole("button", { name: "Приблизить", exact: true })
        .click();
      await page.getByRole("button", { name: "Отдалить", exact: true }).click();
    }
    expect(await page.locator(".leaflet-pane canvas").count()).toBe(canvases);
    expect(canvases).toBeLessThanOrEqual(4);
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
    await snapshot({
      path: `artifacts/map-readability/${width}/selected-piste.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Закрыть: Трасса" }).click();
    // Search fits bounds with Leaflet animation; wait for its final geometry before tapping.
    await expect(
      page.locator(".leaflet-container.leaflet-zoom-anim"),
    ).toHaveCount(0);
    await page.waitForTimeout(350);
    const thinHit = await page.evaluate(() => {
      const hits: { x: number; y: number }[] = [];
      for (const c of document.querySelectorAll<HTMLCanvasElement>(
        ".leaflet-ski-pistes-pane canvas",
      )) {
        const r = c.getBoundingClientRect(),
          d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        for (let y = 0; y < c.height; y += 2)
          for (let x = 0; x < c.width; x += 2) {
            const i = (y * c.width + x) * 4;
            if (
              Math.abs(d[i] - 23) < 8 &&
              Math.abs(d[i + 1] - 104) < 8 &&
              Math.abs(d[i + 2] - 213) < 8 &&
              d[i + 3] > 150
            ) {
              const px = r.x + (x * r.width) / c.width,
                py = r.y + (y * r.height) / c.height;
              if (
                px > 60 &&
                px < innerWidth - 70 &&
                py > 180 &&
                py < innerHeight - 160
              )
                hits.push({ x: px, y: py });
            }
          }
      }
      return (
        hits.sort(
          (a, b) =>
            Math.abs(a.y - innerHeight / 2) - Math.abs(b.y - innerHeight / 2),
        )[0] ?? null
      );
    });
    expect(thinHit).not.toBeNull();
    await page.touchscreen.tap(thinHit!.x, thinHit!.y);
    await expect(
      page.getByRole("region", { name: "Карточка объекта карты" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закрыть: Трасса" }).click();
    await page.getByRole("button", { name: "Слои", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Слои карты" }),
    ).toBeVisible();
    await page.getByLabel("Подъёмники и станции").uncheck();
    await expect(page.getByLabel("Подъёмники и станции")).not.toBeChecked();
    await page.getByLabel("Подъёмники и станции").check();
    await snapshot({
      path: `artifacts/map-readability/${width}/layers.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (width === 390 && bundle.areas?.length) {
      await page.getByRole("button", { name: "Поиск и выбор курорта" }).click();
      await page.getByLabel("Курорт или трасса").fill("Домбайская поляна");
      await page
        .getByRole("button", { name: "⌁ Домбайская поляна", exact: true })
        .first()
        .click();
      await page.getByRole("button", { name: "Закрыть: Трасса" }).click();
      await page.waitForTimeout(400);
      await snapshot({
        path: "artifacts/map-readability/390/junction.png",
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Поиск и выбор курорта" }).click();
      await page.getByLabel("Курорт или трасса").fill("Сулахат");
      await page
        .getByRole("button", { name: "▱ Сулахат · площадь", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Площадная трасса", exact: true }),
      ).toContainText("не набор осевых маршрутов");
      await snapshot({
        path: "artifacts/map-readability/390/area.png",
        animations: "disabled",
      });
      await page
        .getByRole("button", { name: "Закрыть: Площадная трасса" })
        .click();
    }
    if (width === 375) {
      await page.getByRole("button", { name: "Поиск и выбор курорта" }).click();
      await page.getByLabel("Курорт", { exact: true }).selectOption("");
      await expect(page.locator(".ski-map")).toHaveAttribute(
        "data-source-lines",
        "0",
      );
      await page.getByRole("button", { name: "Поиск и выбор курорта" }).click();
      await page
        .getByLabel("Курорт", { exact: true })
        .selectOption("ru-dombay");
      await expect(page.locator(".ski-map")).toHaveAttribute(
        "data-source-lines",
        "149",
      );
      expect(
        await page.locator(".leaflet-pane canvas").count(),
      ).toBeLessThanOrEqual(4);
    }
    await page.waitForTimeout(150);
    expect(errors).toEqual([]);
  });
