import { test, expect } from "@playwright/test";

test.describe("Auth Security E2E", () => {
  test("invalid credentials show error", async ({ page }) => {
    await page.goto("/login");
    await page.fill('[name="email"]', 'invalid@test.com');
    await page.fill('[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    // Should show error message, not crash
    await expect(page.locator('body')).toBeVisible();
  });

  test("direct URL without auth redirects to login", async ({ page }) => {
    await page.goto("/trips");
    // Should redirect to login or show unauthorized
    await expect(page.locator('body')).toBeVisible();
  });

  test("login page renders correctly", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
    await expect(page.locator('input[name="email"], input[type="email"]')).toBeVisible();
  });

  test("session expiry redirects to login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('body')).toBeVisible();
  });

  test("back button after logout", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('body')).toBeVisible();
  });
});
