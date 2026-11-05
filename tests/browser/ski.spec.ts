import { test, expect } from "@playwright/test";
const profile = {
  nickname: "Тест карты",
  sport: "snowboard",
  level: "confident",
  discipline: "all",
  resort: "",
  equipment: "",
};
test("Telegram SDK finishes before the first authenticated request (regression for defer)", async ({
  page,
}) => {
  let sdkReady = false,
    authorization = "";
  await page.route(
    "https://telegram.org/js/telegram-web-app.js",
    async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      sdkReady = true;
      await route.fulfill({
        contentType: "text/javascript",
        body: 'window.Telegram={WebApp:{initData:"test-signed-data",ready(){},expand(){}}}',
      });
    },
  );
  await page.route("**/api/me", async (route) => {
    expect(sdkReady).toBe(true);
    authorization = route.request().headers().authorization;
    await route.fulfill({
      json: { user: { id: 1, first_name: "Тест" }, profile, dev: false },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Привет/ })).toBeVisible();
  expect(authorization).toBe("tma test-signed-data");
});
const resort = {
  id: "synthetic-resort",
  name: "ТЕСТОВЫЙ курорт · синтетика",
  aliases: [],
  region: "Тестовый регион",
  center: [40, 43],
  bbox: [39.995, 42.995, 40.005, 43.005],
  source: "https://www.openstreetmap.org/copyright",
  updatedAt: "2026-11-05",
  pistes: 4,
  lifts: 1,
  classified: 4,
  completeness: "partial",
};
const lines = ["beginner", "easy", "intermediate", "advanced"].map(
  (difficulty, i) => ({
    id: "test-" + i,
    name: "ТЕСТ трасса " + i,
    kind: "piste",
    difficulty,
    coordinates: [
      [39.996 + i * 0.002, 43.004],
      [39.996 + i * 0.002, 42.997],
    ],
    direction: null,
    stations: [],
    source: "https://www.openstreetmap.org/copyright",
  }),
);
const lift = {
  id: "test-lift",
  name: "ТЕСТ подъёмник",
  kind: "lift",
  difficulty: null,
  liftType: "chair_lift",
  coordinates: [
    [40.004, 42.997],
    [40.004, 43.004],
  ],
  direction: 1,
  stations: [
    { name: "ТЕСТ станция", coordinate: [40.004, 43.004], role: "upper" },
  ],
  source: "https://www.openstreetmap.org/copyright",
};
for (const [width, height] of [
  [375, 812],
  [390, 844],
  [430, 932],
])
  test(`light ski layers and resort/piste selection ${width} (synthetic map fixture)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.route("https://telegram.org/**", (r) => r.abort());
    await page.route(
      /https:\/\/.*tile\.(opentopomap|openstreetmap)\.org\//,
      (r) => r.abort(),
    );
    await page.route("**/api/ski/catalog", (r) =>
      r.fulfill({
        json: {
          version: 1,
          updatedAt: "2026-11-05",
          source: "SYNTHETIC TEST ONLY",
          attribution: "Synthetic test fixture, not resort data",
          resorts: [resort],
          unassigned: 0,
        },
      }),
    );
    await page.route("**/api/ski/resorts/*", (r) =>
      r.fulfill({
        json: {
          resort,
          lines: [...lines, lift],
          attribution: "Synthetic test fixture",
          updatedAt: "2026-11-05",
        },
      }),
    );
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Карта", exact: true })
      .click();
    await expect(
      page.getByText("Россия · в каталоге 1 курортов", { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: `artifacts/ski-map/${width}/catalog-synthetic.png`,
      fullPage: true,
    });
    await page.getByLabel("Курорт", { exact: true }).selectOption(resort.id);
    await expect(
      page.getByText(/ТЕСТОВЫЙ курорт · синтетика · 4 трасс/),
    ).toBeVisible();
    await expect(page.locator(".light-ski-map")).toHaveCSS(
      "background-color",
      "rgb(247, 248, 250)",
    );
    await expect(page.locator(".leaflet-tile-pane")).toHaveCSS(
      "filter",
      "none",
    );
    await page.screenshot({
      path: `artifacts/ski-map/${width}/resort-synthetic.png`,
      fullPage: true,
    });
    await page.getByLabel("Курорт или трасса").fill("ТЕСТ трасса 1");
    await page.getByRole("button", { name: "⌁ ТЕСТ трасса 1" }).click();
    await expect(
      page.getByRole("region", { name: "Карточка объекта карты" }),
    ).toContainText("Лёгкая · синяя");
    await page.screenshot({
      path: `artifacts/ski-map/${width}/piste-synthetic.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Слои", exact: true }).click();
    await page.getByLabel("Подъёмники и станции").uncheck();
    await expect(page.getByLabel("Подъёмники и станции")).not.toBeChecked();
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
test("IndexedDB restores a legacy draft and later points survive a reload without localStorage", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 43, longitude: 40, accuracy: 4 });
  await page.route("https://telegram.org/**", (r) => r.abort());
  await page.route(
    /https:\/\/.*tile\.(opentopomap|openstreetmap)\.org\//,
    (r) => r.abort(),
  );
  const id = crypto.randomUUID(),
    t = Date.now() - 10000;
  await page.addInitScript(
    ({ id, t }) => {
      if (!sessionStorage.getItem("migration-seeded")) {
        localStorage.setItem(
          "slopemate:draft:1",
          JSON.stringify({
            id,
            points: [{ lat: 43, lon: 40, t, accuracy: 4 }],
            started: t,
            resort: "Legacy",
            trip: "",
          }),
        );
        sessionStorage.setItem("migration-seeded", "1");
      }
    },
    { id, t },
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Катание", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Возобновить GPS" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Возобновить GPS" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("slopemate:draft:1") || "{}").points
            ?.length ?? 0,
      ),
    )
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "Приостановить" }).click();
  await page.evaluate(() => localStorage.removeItem("slopemate:draft:1"));
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Катание", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Возобновить GPS" }),
  ).toBeEnabled();
  await expect(page.getByText(/2 точек/)).toBeVisible();
});

test("synthetic lift ride shows remaining polyline distance and experimental ETA", async ({
  page,
}) => {
  await page.route("https://telegram.org/**", (r) => r.abort());
  await page.route(
    /https:\/\/.*tile\.(opentopomap|openstreetmap)\.org\//,
    (r) => r.abort(),
  );
  await page.route("**/api/ski/catalog", (r) =>
    r.fulfill({
      json: {
        version: 1,
        updatedAt: "2026-11-05",
        source: "SYNTHETIC TEST ONLY",
        attribution: "Synthetic test fixture",
        resorts: [resort],
        unassigned: 0,
      },
    }),
  );
  await page.route("**/api/ski/resorts/*", (r) =>
    r.fulfill({
      json: {
        resort,
        lines: [...lines, lift],
        attribution: "Synthetic test fixture",
        updatedAt: "2026-11-05",
      },
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("slopemate:resort", "synthetic-resort");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition: (cb: unknown) => {
          (window as any).syntheticFix = cb;
          return 1;
        },
        clearWatch: () => {},
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Катание", exact: true })
    .click();
  await page.getByRole("button", { name: "Начать GPS-запись" }).click();
  await page.evaluate(() => {
    const start = Date.now() - 70000;
    for (let i = 0; i < 15; i++)
      (window as any).syntheticFix({
        timestamp: start + i * 5000,
        coords: {
          latitude: 42.9995 + i * 0.0001,
          longitude: 40.004,
          accuracy: 4,
          altitude: 1000 + i * 3,
          altitudeAccuracy: 2,
          speed: 2.2,
          heading: 0,
        },
      });
  });
  await expect(page.locator(".lift-card")).toContainText("Подъём подтверждён");
  await expect(page.locator(".lift-card")).toContainText(
    "экспериментальный прогноз",
  );
  await expect(page.locator(".lift-card progress")).toBeVisible();
  await page.screenshot({
    path: "artifacts/ski-map/390/lift-eta-synthetic.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Скрыть карточку подъёмника" })
    .click();
  await expect(page.locator(".lift-card")).toHaveCount(0);
});
