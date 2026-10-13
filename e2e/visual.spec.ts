import { expect, test } from "@playwright/test";

const routes = ["/", "/body", "/workouts", "/nutrition", "/recovery", "/goals", "/imports", "/settings"];
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

test("every primary screen renders without overflow", async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@localhost");
  await page.getByLabel("Password").fill(process.env.AUTH_PASSWORD ?? "change-me-now");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow, `${viewport.name} ${route}`).toBe(false);
      await page.screenshot({ path: `test-results/visual/${viewport.name}${route === "/" ? "-overview" : route.replaceAll("/", "-")}.png`, fullPage: true });
    }
  }
  expect(pageErrors).toEqual([]);
});
