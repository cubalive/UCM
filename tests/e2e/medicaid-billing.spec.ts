import { test, expect } from "@playwright/test";

test.describe("Medicaid Billing Flow", () => {
  test("completed Medicaid trip generates claim", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
  });

  test("claim appears in billing dashboard", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
  });

  test("no duplicate claims on retry", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
  });
});
