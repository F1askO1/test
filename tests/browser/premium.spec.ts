import { test, expect } from "@playwright/test";
const auth = { Authorization: "Dev local" };
for (const [width, height] of [
  [375, 812],
  [390, 844],
  [430, 932],
]) {
  test(`Monochrome Alpine visual states ${width}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: 43.66,
      longitude: 40.25,
      accuracy: 4,
    });
    await page.route("https://telegram.org/**", (route) => route.abort());
    // Do not counterfeit geography. Missing external tiles exercise the honest offline-basemap state.
    await page.route("https://tile.openstreetmap.org/**", (route) =>
      route.abort(),
    );
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const s of (
      await page.request.get("/api/sessions", { headers: auth })
    ).ok()
      ? await (
          await page.request.get("/api/sessions", { headers: auth })
        ).json()
      : [])
      await page.request.delete("/api/sessions/" + s.id, { headers: auth });
    await page.request.put("/api/profile", {
      headers: auth,
      data: {
        nickname: "Тестовый райдер",
        sport: "snowboard",
        level: "confident",
        discipline: "all",
        resort: "",
        equipment: "",
      },
    });
    await page.route("**/api/me", async (route) => {
      await new Promise((r) => setTimeout(r, 1100));
      await route.continue();
    });
    await page.goto("/");
    const splash = page.locator(".splash:not(.is-leaving)");
    await expect(splash).toBeVisible();
    await page.waitForTimeout(400);
    const icon = await page.locator(".splash-icon").boundingBox();
    expect(icon).not.toBeNull();
    expect(icon!.width).toBeGreaterThanOrEqual(100);
    expect(icon!.width).toBeLessThanOrEqual(140);
    expect(Math.abs(icon!.x + icon!.width / 2 - width / 2)).toBeLessThan(1);
    expect(Math.abs(icon!.y + icon!.height / 2 - height / 2)).toBeLessThan(1);
    expect(
      await splash.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(0, 0, 0)");
    const shot = async (name: string, fullPage = true) => {
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: `artifacts/premium-ui/${width}/${name}.png`,
        fullPage,
        animations: "disabled",
      });
    };
    await shot("splash", false);
    await expect(
      page.getByRole("heading", { name: /Привет, Тестовый/ }),
    ).toBeVisible();
    await expect(page.locator(".splash")).toHaveCount(0);
    await page.unroute("**/api/me");
    await shot("home");
    await shot("empty");
    const nav = async (name: string) => {
      await page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
    };
    await nav("Катание");
    await shot("ride-idle");
    await page.getByRole("button", { name: "Начать GPS-запись" }).click();
    await expect(
      page.getByRole("button", { name: "Приостановить" }),
    ).toBeVisible();
    await page.waitForTimeout(1100);
    await context.setGeolocation({
      latitude: 43.66015,
      longitude: 40.25,
      accuracy: 4,
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("slopemate:draft:1") || "{}").points
              ?.length ?? 0,
        ),
      )
      .toBeGreaterThan(1);
    // Fixed controls must stay in the viewport, including after the entrance animation.
    const controls = await page
      .getByRole("button", { name: "Приостановить" })
      .boundingBox();
    expect(controls!.y).toBeGreaterThan(0);
    expect(controls!.y + controls!.height).toBeLessThan(height - 60);
    const navBox = await page.getByRole("navigation").boundingBox();
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(height + 1);
    await shot("ride-active", false);
    await page.getByRole("button", { name: "Приостановить" }).click();
    await shot("ride-paused", false);
    await nav("Карта");
    await shot("map", false);
    await nav("Катание");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Сбросить запись" }).click();
    await page.getByRole("button", { name: /Утренний вельвет/ }).click();
    await expect(page.getByText("ДЕМО · СИНТЕТИЧЕСКИЙ ТРЕК")).toBeVisible();
    await shot("route-details");
    await nav("Прогресс");
    await page
      .getByRole("button", { name: "Демонстрация", exact: true })
      .click();
    await page.getByRole("button", { name: "Всё время", exact: true }).click();
    await shot("progress");
    await page
      .getByRole("button", { name: "История катаний", exact: true })
      .click();
    await shot("history");
    await nav("Профиль");
    await shot("profile");
    await page
      .getByLabel("Никнейм", { exact: true })
      .fill("Очень длинное тестовое имя райдера");
    await page.evaluate(() => {
      const sizes = [
        ...document.querySelectorAll<HTMLElement>(
          "h1,h2,h3,p,span,label,input,select,textarea,button,small,strong",
        ),
      ].map((el) => [el, parseFloat(getComputedStyle(el).fontSize)] as const);
      for (const [el, size] of sizes) el.style.fontSize = size * 1.25 + "px";
    });
    await shot("profile-large-type");
    expect(errors).toEqual([]);
  });
}
test("splash yields to an authorization error and honors reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", (r) => r.abort());
  await page.route("**/api/me", async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await r.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Переоткройте приложение через Telegram.",
      }),
    });
  });
  await page.goto("/");
  await expect(
    page.getByText("Переоткройте приложение через Telegram."),
  ).toBeVisible();
  await expect(page.locator(".splash")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Повторить", exact: true }),
  ).toBeVisible();
});
test("393px Telegram safe areas update without clipping input or navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.route("https://telegram.org/**", (r) => r.abort());
  await page.addInitScript(() => {
    const events: Record<string, () => void> = {};
    (window as any)._safeEvents = events;
    (window as any).Telegram = {
      WebApp: {
        initData: "",
        ready() {},
        expand() {},
        setHeaderColor() {},
        setBackgroundColor() {},
        safeAreaInset: { top: 24, bottom: 34 },
        contentSafeAreaInset: { top: 12, bottom: 0 },
        onEvent(name: string, fn: () => void) {
          events[name] = fn;
        },
        offEvent(name: string) {
          delete events[name];
        },
      },
    };
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Профиль", exact: true })
    .click();
  await page.getByLabel("Никнейм", { exact: true }).focus();
  expect(
    await page
      .locator(".shell")
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop)),
  ).toBeGreaterThanOrEqual(52);
  await page.evaluate(() => {
    (window as any).Telegram.WebApp.safeAreaInset.bottom = 47;
    (window as any)._safeEvents.safeAreaChanged();
  });
  expect(
    await page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--tg-bottom"),
    ),
  ).toBe("47px");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
