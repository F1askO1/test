import { test, expect } from "@playwright/test";
test("mobile: empty state, demo, real GPX, profile, reload, deletion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Привет, Райдер/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Катание" })
    .click();
  await page.getByRole("button", { name: /Утренний вельвет/ }).click();
  await expect(
    page.getByRole("heading", { name: /Утренний вельвет/ }),
  ).toBeVisible();
  await expect(page.getByText("ДЕМО · СИНТЕТИЧЕСКИЙ ТРЕК")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Главная" })
    .click();
  await expect(page.getByText("История начинается с тебя")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Катание" })
    .click();
  await page.getByLabel("Импортировать GPX", { exact: true }).setInputFiles({
    name: "test.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(
      '<gpx><trk><trkseg><trkpt lat="43.6" lon="40.2"><time>2026-11-05T08:00:00Z</time></trkpt><trkpt lat="43.601" lon="40.2"><time>2026-11-05T08:00:10Z</time></trkpt><trkpt lat="43.602" lon="40.2"><time>2026-11-05T08:00:20Z</time></trkpt></trkseg></trk></gpx>',
    ),
  });
  await expect(page.getByText("ИМПОРТ GPX", { exact: true })).toBeVisible();
  await expect(page.getByText("Спуски не определены")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Профиль" })
    .click();
  await page.getByLabel("Никнейм", { exact: true }).fill("Снежный");
  await page
    .getByRole("button", { name: "Сохранить профиль", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Профиль сохранён" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /Привет, Снежный/ }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Прогресс" })
    .click();
  await page.getByRole("button", { name: "Всё время", exact: true }).click();
  await page.getByRole("button", { name: /Без названия курорта/ }).click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Удалить запись", exact: true })
    .click();
  await expect(page.getByText("Здесь пока чистый склон")).toBeVisible();
  expect(errors).toEqual([]);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Главная" })
    .click();
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
});
test("GPS: consent, point capture, pause, local recovery, sync", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 43.66,
    longitude: 40.25,
    accuracy: 4,
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Катание" })
    .click();
  await page.getByRole("button", { name: "Начать GPS-запись" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("slopemate:draft:1") ?? "{}").points
            ?.length ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  await context.setGeolocation({
    latitude: 43.6601,
    longitude: 40.25,
    accuracy: 4,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("slopemate:draft:1") ?? "{}").points
            ?.length ?? 0,
      ),
    )
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "Приостановить" }).click();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Катание" })
    .click();
  await expect(
    page.getByRole("button", { name: "Возобновить GPS" }),
  ).toBeVisible();
  await page.route("**/api/sessions", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await page.getByRole("button", { name: "Завершить и сохранить" }).click();
  await expect(page.getByText(/Нет связи с сервером/)).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("slopemate:draft:1")),
  ).not.toBeNull();
  await page.unroute("**/api/sessions");
  await page.getByRole("button", { name: "Завершить и сохранить" }).click();
  await expect(page.getByText("GPS-ЗАПИСЬ", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("slopemate:draft:1")),
  ).toBeNull();
});
test("GPS permission refusal is explained and draft remains available", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (
          _success: unknown,
          error: (e: { code: number }) => void,
        ) => {
          setTimeout(() => error({ code: 1 }), 10);
          return 1;
        },
        clearWatch: () => {},
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Катание" })
    .click();
  await page.getByRole("button", { name: "Начать GPS-запись" }).click();
  await expect(page.getByText(/Доступ к геолокации запрещён/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Возобновить GPS" }),
  ).toBeVisible();
});
