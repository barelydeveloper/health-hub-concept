import { expect, test } from "@playwright/test";

test("sign in and read fixture weight, then open workouts", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@localhost");
  await page.getByLabel("Password").fill(process.env.AUTH_PASSWORD ?? "change-me-now");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("151.0 lb")).toBeVisible();
  await page.getByRole("link", { name: "Workouts" }).click();
  await expect(page.getByRole("heading", { name: "Workouts" })).toBeVisible();
  await expect(page.getByText("5 reps, best 2")).toBeVisible();
  await page.getByRole("link", { name: "Body" }).click();
  await expect(page.getByRole("heading", { name: "Body composition" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Body fat, raw and normalized" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fat mass and fat-free mass" })).toBeVisible();
});
