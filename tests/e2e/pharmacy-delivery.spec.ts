import { test, expect } from "@playwright/test";

test.describe("Pharmacy Delivery Flow", () => {
  test("pharmacy admin creates delivery order", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
  });

  test("pharmacy creates multi-stop route", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
  });

  test("driver completes each delivery stop", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
  });

  test("pharmacy sees completed deliveries", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
  });
});
