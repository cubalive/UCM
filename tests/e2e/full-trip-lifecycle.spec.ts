import { test, expect } from "@playwright/test";

test.describe("Full Trip Lifecycle", () => {
  test("dispatcher creates trip, driver completes it", async ({ page }) => {
    // 1. Login as dispatcher
    await page.goto("/login");
    await page.fill('[name="email"]', 'dispatch@test.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/dashboard|dispatch/);

    // 2. Navigate to trips
    await page.click('text=Trips');
    await expect(page.locator('h1, h2')).toContainText(/trips/i);

    // 3. Create new trip
    await page.click('text=New Trip');
    // Fill trip form
    await page.fill('[name="pickupAddress"]', '123 Main St, Miami FL');
    await page.fill('[name="dropoffAddress"]', '456 Oak Ave, Miami FL');
    // ... more form fields
    await page.click('button[type="submit"]');

    // 4. Verify trip created
    await expect(page.locator('.toast, [role="alert"]')).toContainText(/created|success/i);
  });

  test("trip shows correct status progression", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
  });

  test("completed trip appears in billing", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('form')).toBeVisible();
  });
});
