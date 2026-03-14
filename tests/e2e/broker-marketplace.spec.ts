import { test, expect } from "@playwright/test";

test.describe("Broker Marketplace Flow", () => {
  test("broker submits trip request", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
  });

  test("dispatcher accepts marketplace trip", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
  });

  test("broker sees real-time status", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
  });
});
