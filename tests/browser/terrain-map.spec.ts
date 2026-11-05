import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("SYNTHETIC GPS on real Dombay map: persisted off-piste statistics and touch selection", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.SLOPEMATE_TEST_MAPS,
    "Requires isolated real Dombay package",
  );
  await page.route("https://telegram.org/**", (r) => r.abort());
  await page.route(
    /https:\/\/.*tile\.(opentopomap|openstreetmap)\.org\//,
    (r) => r.abort(),
  );
  const id = randomUUID();
  const points = Array.from({ length: 80 }, (_, i) => ({
    lon: 41.65,
    lat: 43.282 + i * 0.00018,
    t: Date.now() - 400000 + i * 5000,
    alt: 3000 - i * 5,
    altAccuracy: 2,
    accuracy: 4,
  }));
  const response = await request.post("/api/sessions", {
    headers: { Authorization: "Dev local" },
    data: {
      id,
      points,
      skiResortId: "ru-dombay",
      resort: "СИНТЕТИЧЕСКИЙ GPS · НЕ ЗАПИСЬ ПОЛЬЗОВАТЕЛЯ",
      trip: "ТЕСТ ФРИРАЙДА",
    },
  });
  expect(response.status()).toBe(201);
  const saved = await response.json();
  expect(saved.analysis.terrain.offPisteDistance).toBeGreaterThan(500);
  const replay = await request.get("/api/sessions/" + id, {
    headers: { Authorization: "Dev local" },
  });
  expect((await replay.json()).analysis.terrain).toEqual(
    saved.analysis.terrain,
  );
  await page.addInitScript(() =>
    localStorage.setItem("slopemate:resort", "ru-dombay"),
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Прогресс", exact: true })
    .click();
  await page
    .getByRole("button", { name: "История катаний", exact: true })
    .click();
  await page.getByRole("button", { name: "Всё время", exact: true }).click();
  await page.getByRole("button", { name: /СИНТЕТИЧЕСКИЙ GPS/ }).click();
  await expect(
    page.getByRole("region", { name: "Трассы и фрирайд" }),
  ).toContainText("Вероятный фрирайд");
  await page.locator(".map-wrap").scrollIntoViewIfNeeded();
  await expect(page.locator(".leaflet-pane canvas")).not.toHaveCount(0);
  await page.waitForTimeout(400);
  await page.screenshot({
    path: "artifacts/geometry-audit/synthetic-gps-real-dombay.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.locator(".map-wrap").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  // Tap the midpoint of the longest classified segment, away from adjacent
  // unknown segments and endpoint markers. Web Mercator projection uses the
  // actual visible center/zoom, not a test-only map instance or event injection.
  const segment = saved.analysis.terrain.segments
    .filter((s: any) => s.type === "off_piste")
    .sort((a: any, b: any) => b.distance - a.distance)[0];
  const point =
    saved.analysis.points[Math.floor((segment.from + segment.to) / 2)];
  const hit = await page.evaluate((p: { lon: number; lat: number }) => {
    const el = document.querySelector<HTMLElement>(".ski-map")!,
      view = el.dataset.mapView!.split(",").map(Number),
      rect = el.querySelector(".map")!.getBoundingClientRect();
    const world = (lon: number, lat: number) => {
      const scale = 256 * 2 ** view[2],
        s = Math.sin((lat * Math.PI) / 180);
      return [
        ((lon + 180) / 360) * scale,
        (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
      ];
    };
    const c = world(view[1], view[0]),
      q = world(p.lon, p.lat);
    return {
      x: rect.x + rect.width / 2 + q[0] - c[0],
      y: rect.y + rect.height / 2 + q[1] - c[1],
    };
  }, point);
  expect(hit.y).toBeGreaterThan(0);
  expect(hit.y).toBeLessThan(800);
  await page.touchscreen.tap(hit.x, hit.y);
  await expect(
    page.getByRole("dialog", { name: "Вероятный фрирайд", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/geometry-audit/synthetic-freeride-card.png",
    animations: "disabled",
  });
  await request.delete("/api/sessions/" + id, {
    headers: { Authorization: "Dev local" },
  });
});
test("MOCK tiles only: automatic OSM fallback is bounded and diagnostics distinguish provider", async ({
  page,
}) => {
  await page.route("https://telegram.org/**", (r) => r.abort());
  await page.route(/https:\/\/.*tile\.opentopomap\.org\//, (r) => r.abort());
  // A 1px mocked image proves fallback lifecycle only, NEVER real terrain availability.
  await page.route("https://tile.openstreetmap.org/**", (r) =>
    r.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz0AAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Карта", exact: true })
    .click();
  await expect(
    page.getByText("Рельеф недоступен · резерв OSM", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "О курорте", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "О курорте", exact: true }),
  ).toContainText("OpenStreetMap · ready");
});
