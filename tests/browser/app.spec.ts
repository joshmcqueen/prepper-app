import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(async ({ request }) => {
  const r = await request.post('/api/database/reset', {
    data: { mode: 'demo', confirmation: 'RESET' },
  });
  expect(r.ok()).toBe(true);
});
test('sample dashboard, inventory editing, manual use, and label preview', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A little more prepared.' })).toBeVisible();
  await expect(page.getByText('230', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/${test.info().project.name}-dashboard.png`,
    fullPage: true,
  });
  await page.goto('/food');
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Resource name', exact: true })
    .fill('Browser test rice');
  await dialog.getByRole('spinbutton', { name: 'Remaining quantity', exact: true }).fill('10');
  await dialog.getByRole('button', { name: 'Add to inventory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser test rice', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Update stock', exact: true }).click();
  await page.getByRole('dialog').getByRole('spinbutton', { name: 'Action amount' }).fill('2');
  await page.getByRole('button', { name: 'Save update', exact: true }).click();
  await expect(page.locator('.detail-hero strong')).toHaveText('8');
  await page.getByRole('button', { name: 'Make label', exact: true }).click();
  await expect(page.getByAltText('Label preview')).toBeVisible();
  await page.getByAltText('Label preview').evaluate((img: HTMLImageElement) => img.decode());
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Edit resource', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Resource name', exact: true })
    .fill('Browser test rice updated');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Browser test rice updated', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('.detail-hero strong')).toHaveText('8');
  expect(errors).toEqual([]);
});
test('settings, attention, bucket contents, and reset/reseed controls', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('spinbutton', { name: 'food goal', exact: true }).fill('120');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: 'food goal', exact: true })).toHaveValue('120');
  await page.screenshot({
    path: `test-results/${test.info().project.name}-settings.png`,
    fullPage: true,
  });
  await page.goto('/attention');
  await page.getByRole('button', { name: 'Rotation', exact: true }).click();
  await expect(page.getByRole('button', { name: /Outdoor water tank/ })).toBeVisible();
  await page.goto('/container/BK-01');
  await expect(page.getByRole('button', { name: /Jasmine rice/ }).first()).toBeVisible();
  await page.goto('/settings#database');
  await page.getByRole('button', { name: 'Reset to empty', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Reset everything', exact: true })
    .click();
  await expect(page.getByText('Sample data · explore freely.', { exact: false })).toHaveCount(0);
  await expect(
    page.getByRole('spinbutton', { name: 'Calories per adult per day', exact: true }),
  ).toBeEmpty();
  await page.getByRole('button', { name: 'Reset & load sample data', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Reset & load sample data', exact: true })
    .click();
  await expect(page.getByText('Sample data · explore freely.', { exact: false })).toBeVisible();
});
test('AI failure preserves manual entry and stale saves show a conflict', async ({
  page,
  request,
}) => {
  await page.goto('/food');
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Resource name', exact: true })
    .fill('Keep this manual input');
  await page.route('**/api/ai/draft', (route) =>
    route.fulfill({ status: 503, json: { error: 'AI unavailable for this test' } }),
  );
  await page.getByRole('button', { name: 'Suggest details', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('AI unavailable');
  await expect(page.getByRole('textbox', { name: 'Resource name', exact: true })).toHaveValue(
    'Keep this manual input',
  );
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const state = await (await request.get('/api/state')).json();
  const item = state.stocks.find((s: { category: string }) => s.category === 'food');
  await page.goto(`/item/${item.id}`);
  await page.getByRole('button', { name: 'Edit resource', exact: true }).click();
  await request.put(`/api/stocks/${item.id}`, {
    data: { ...item, notes: 'Changed on another device' },
  });
  await page.getByRole('textbox', { name: 'Resource name', exact: true }).fill('Unsaved name');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('another device');
  await expect(page.getByRole('textbox', { name: 'Resource name', exact: true })).toHaveValue(
    'Unsaved name',
  );
});
test('photo capture and AI review preserve manual values until explicit selection', async ({
  page,
  request,
}) => {
  const state = await (await request.get('/api/state')).json();
  const source = state.stocks.find((s: { photoIds: string[] }) => s.photoIds.length);
  const photo = await (await request.get(`/uploads/${source.photoIds[0]}`)).body();
  await page.goto('/food');
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Resource name', exact: true })
    .fill('My manually entered rice');
  await page
    .getByLabel('Upload photos', { exact: true })
    .setInputFiles({ name: 'sample.webp', mimeType: 'image/webp', buffer: photo });
  await expect(page.getByAltText('Resource reference')).toBeVisible();
  await page.route('**/api/ai/draft', (route) =>
    route.fulfill({
      json: {
        name: 'AI suggested rice',
        brand: null,
        quantity: 7,
        unit: 'lb',
        description: 'A test inventory description.',
        notes: null,
        purchasedOn: null,
        bestBy: null,
        expiresOn: null,
        nutrition: {
          servingSize: null,
          servingUnit: null,
          calories: null,
          protein: null,
          carbs: null,
          fat: null,
        },
        reviewNotes: ['Verify the package facts.'],
      },
    }),
  );
  await page.getByRole('button', { name: 'Suggest details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review AI suggestions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to inventory' })).toBeDisabled();
  await page.getByRole('button', { name: 'Apply selected', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Resource name', exact: true })).toHaveValue(
    'My manually entered rice',
  );
  await expect(
    page.getByRole('spinbutton', { name: 'Remaining quantity', exact: true }),
  ).toHaveValue('7');
  await page.getByRole('button', { name: 'Add to inventory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My manually entered rice' })).toBeVisible();
  await expect(page.getByAltText('My manually entered rice reference photo')).toBeVisible();
});
test('splitting and moving bags keeps the total quantity and nutrition', async ({
  page,
  request,
}) => {
  const before = await (await request.get('/api/state')).json();
  const item = before.stocks.find(
    (s: { category: string; quantity: number; name: string }) =>
      s.category === 'food' && s.quantity === 25,
  );
  await page.goto(`/item/${item.id}`);
  await page.getByRole('button', { name: 'Split into bags', exact: true }).click();
  await page.getByRole('combobox', { name: 'Bag 1 bucket', exact: true }).selectOption('BK-10');
  await page.getByRole('button', { name: 'Split & make labels', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Labels for your reserve' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const after = await (await request.get('/api/state')).json();
  expect(after.dashboard.food.total).toBeCloseTo(before.dashboard.food.total);
  const child = after.stocks.find(
    (s: { batchId: string; containerId: string }) =>
      s.batchId === item.batchId && s.containerId === 'BK-10',
  );
  await page.goto(`/item/${child.id}`);
  await page.getByRole('button', { name: 'Update stock', exact: true }).click();
  await page.getByRole('combobox', { name: 'Inventory action', exact: true }).selectOption('move');
  await page.getByRole('combobox', { name: 'New bucket', exact: true }).selectOption('BK-11');
  await page.getByRole('button', { name: 'Save update', exact: true }).click();
  await expect(page.locator('.detail-facts').first()).toContainText('Bucket 11');
  const moved = await (await request.get('/api/state')).json();
  expect(moved.dashboard.food.total).toBeCloseTo(before.dashboard.food.total);
});
test('dashboard and inventory form have no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A little more prepared.' })).toBeVisible();
  const dashboard = await new AxeBuilder({ page }).analyze();
  expect(
    dashboard.violations
      .filter((v) => ['critical', 'serious'].includes(v.impact || ''))
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Add a resource', exact: true }).click();
  const form = await new AxeBuilder({ page }).include('dialog').analyze();
  expect(
    form.violations
      .filter((v) => ['critical', 'serious'].includes(v.impact || ''))
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
});

test('permanent bucket labels and browsing locations include bags and standalone supplies', async ({
  page,
  request,
}) => {
  await page.goto('/containers');
  const bucket = page
    .locator('.container-card')
    .filter({ has: page.getByRole('heading', { name: 'Bucket 04', exact: true }) });
  await expect(bucket).toContainText('Old-fashioned rolled oats');
  await expect(bucket).toContainText('Spices');
  await expect(bucket).toContainText('Freeze-dried blueberries');
  await page
    .getByRole('combobox', { name: 'Browse storage location' })
    .selectOption({ label: 'Attic' });
  await expect(page.getByRole('button', { name: /^Emergency blankets/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Old-fashioned rolled oats/ })).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Browse storage location' })
    .selectOption({ label: 'Hallway closet' });
  await expect(page.getByRole('button', { name: /^Toilet paper rolls/ })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Browse storage location' })
    .selectOption({ label: 'Garage shelves' });
  await bucket.click();
  await page.getByRole('button', { name: 'Make bucket label', exact: true }).click();
  await page.getByAltText('Label preview').evaluate((img: HTMLImageElement) => img.decode());
  await page.getByAltText('Label preview').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/${test.info().project.name}-bucket-label.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Edit bucket', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Bucket nickname', exact: true })
    .fill('Breakfast supplies');
  await page
    .getByRole('combobox', { name: 'Bucket location', exact: true })
    .selectOption({ label: 'Hallway closet' });
  await page.getByRole('button', { name: 'Save bucket', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Bucket 04 · Breakfast supplies', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.page-heading')).toContainText('Hallway closet');
  await page.getByRole('button', { name: /^Old-fashioned rolled oats/ }).click();
  await expect(page.locator('.detail-facts').first()).toContainText(
    'Hallway closet · Bucket 04 · Breakfast supplies',
  );
  await page.getByRole('button', { name: 'Edit resource', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Storage location', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.goto('/containers');
  await page
    .getByRole('combobox', { name: 'Browse storage location' })
    .selectOption({ label: 'Hallway closet' });
  await expect(page.getByRole('button', { name: /^Toilet paper rolls/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Old-fashioned rolled oats/ })).toBeVisible();
  await page.screenshot({
    path: `test-results/${test.info().project.name}-storage-locations.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Add bucket', exact: true }).click();
  await page.getByRole('button', { name: 'Save bucket', exact: true }).click();
  const state = await (await request.get('/api/state')).json();
  expect(state.containers.at(-1).bucketNumber).toBe(13);
  await page
    .getByRole('combobox', { name: 'Browse storage location' })
    .selectOption('__unassigned');
  await expect(page.getByRole('heading', { name: 'Bucket 13', exact: true })).toBeVisible();
});
