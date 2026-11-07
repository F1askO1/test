import { test, expect } from "@playwright/test";
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eee"/></svg>';
test("MOCK tile delivery: one visible tile cannot pass full viewport; pending tiles complete later", async ({
  page,
}) => {
  test.skip(
    !process.env.SLOPEMATE_TEST_MAPS,
    "Requires isolated real Dombay source",
  );
  let first = false,
    released = false;
  const waiting: (() => void)[] = [];
  await page.route("https://telegram.org/**", (r) => r.abort());
  await page.route(/https:\/\/.*tile\.opentopomap\.org\//, async (r) => {
    const z = Number(new URL(r.request().url()).pathname.split("/")[1]);
    if (z >= 10 && !released) {
      if (!first) first = true;
      else await new Promise<void>((resolve) => waiting.push(resolve));
    }
    await r
      .fulfill({ contentType: "image/svg+xml", body: image })
      .catch(() => {});
  });
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  await page.addInitScript(() =>
    localStorage.setItem("slopemate:resort", "ru-dombay"),
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Карта", exact: true })
    .click();
  const map = page.locator(".ski-map");
  await expect(page.locator(".map-search-trigger")).toContainText("Домбай");
  await expect
    .poll(async () => Number(await map.getAttribute("data-tile-loaded")))
    .toBe(1);
  expect(Number(await map.getAttribute("data-tile-coverage"))).toBeLessThan(1);
  await expect(map).toHaveAttribute("data-tile-state", "loading");
  expect(Number(await map.getAttribute("data-tile-pending"))).toBeGreaterThan(
    0,
  );
  released = true;
  waiting.forEach((done) => done());
  await expect(map).toHaveAttribute("data-tile-state", "ready");
  await expect(map).toHaveAttribute("data-tile-coverage", "1.000000");
  expect(await map.getAttribute("data-tile-loaded")).toBe(
    await map.getAttribute("data-tile-visible"),
  );
  // A viewport resize needs a fresh coverage proof, not a cumulative loaded counter.
  await page.setViewportSize({ width: 430, height: 932 });
  await expect(map).toHaveAttribute("data-tile-state", "ready");
  await expect(map).toHaveAttribute("data-tile-coverage", "1.000000");
});
test("MOCK HTTP 503: retry the failed visible image once without reloading successful tiles", async ({
  page,
}) => {
  test.skip(
    !process.env.SLOPEMATE_TEST_MAPS,
    "Requires isolated real Dombay source",
  );
  let bad = "",
    fallbacks = 0;
  const counts = new Map<string, number>();
  await page.route("https://telegram.org/**", (r) => r.abort());
  await page.route(/https:\/\/.*tile\.opentopomap\.org\//, async (r) => {
    const u = r.request().url(),
      z = Number(new URL(u).pathname.split("/")[1]);
    counts.set(u, (counts.get(u) ?? 0) + 1);
    if (z >= 10 && !bad) bad = u;
    if (u === bad && counts.get(u) === 1)
      await r.fulfill({
        status: 503,
        contentType: "text/plain",
        headers: { "cache-control": "no-store" },
        body: "MOCK temporary tile failure",
      });
    else await r.fulfill({ contentType: "image/svg+xml", body: image });
  });
  await page.route("https://tile.openstreetmap.org/**", (r) => {
    fallbacks++;
    return r.abort();
  });
  await page.addInitScript(() =>
    localStorage.setItem("slopemate:resort", "ru-dombay"),
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Карта", exact: true })
    .click();
  const map = page.locator(".ski-map");
  await expect(page.locator(".map-search-trigger")).toContainText("Домбай");
  await expect.poll(() => counts.get(bad) ?? 0).toBe(2);
  await expect(map).toHaveAttribute("data-tile-state", "ready");
  await expect(map).toHaveAttribute("data-tile-coverage", "1.000000");
  expect(fallbacks).toBe(0);
  expect(
    [...counts].filter(([u]) => u !== bad).every(([, count]) => count === 1),
  ).toBe(true);
});
