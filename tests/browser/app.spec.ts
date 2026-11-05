import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import jsQR from 'jsqr';
import AxeBuilder from '@axe-core/playwright';
import { addDays, calendarDay, type Stock } from '../../shared/model';
test.beforeEach(async ({ request }) => {
  const r = await request.post('/api/database/reset', {
    data: { mode: 'demo', confirmation: 'RESET' },
  });
  expect(r.ok()).toBe(true);
});
test('sample dashboard, inventory editing, manual use, and Sharpie reference', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A little more prepared.' })).toBeVisible();
  await expect(page.getByText('330', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Make label', exact: true })).toHaveCount(0);
  const notes = page.getByRole('region', { name: 'Sharpie notes for Browser test rice' });
  await expect(notes).toContainText('8 lb');
  await expect(notes).not.toContainText('Best by');
  await expect(notes).not.toContainText('Purchased');
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
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Split into bags', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Bags ready for your Sharpie' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('12.5 lb');
  await expect(page.getByRole('dialog')).toContainText('Bag 1 · Bucket 10');
  await expect(page.getByAltText('Label preview')).toHaveCount(0);
  await page.screenshot({
    path: `test-results/${test.info().project.name}-bag-notes.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
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

test('bucket QR opens live contents and new bags inherit the bucket without guessed facts', async ({
  page,
  request,
}) => {
  const before = await (await request.get('/api/state')).json();
  const label = await request.get('/api/labels/preview?containerId=BK-10');
  expect(label.ok()).toBe(true);
  const pixels = await sharp(await label.body())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const qr = jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height);
  expect(qr?.data).toBe(`${before.settings.appBaseUrl}/container/BK-10`);
  const bucketPath = new URL(qr!.data).pathname;
  await page.goto(bucketPath);
  await expect(page.getByRole('heading', { name: 'Bucket 10', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Labels/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add bag to bucket', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: 'Bucket', exact: true })).toHaveValue('BK-10');
  await dialog.getByRole('textbox', { name: 'Resource name', exact: true }).fill('Sharpie lentils');
  await dialog.getByRole('button', { name: 'Add to inventory', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Sharpie notes for Sharpie lentils' }),
  ).toContainText('Amount not recorded');
  await expect(page.locator('.detail-facts').first()).toContainText('Bucket 10');
  const saved = await (await request.get('/api/state')).json();
  const bag = saved.stocks.find((s: { name: string }) => s.name === 'Sharpie lentils');
  expect(bag).toMatchObject({
    containerId: 'BK-10',
    quantity: null,
    bestBy: null,
    purchasedOn: null,
  });
  expect(saved.dashboard.food.total).toBe(before.dashboard.food.total);
  await page.goto(bucketPath);
  await expect(page.getByRole('button', { name: /^Sharpie lentils/ })).toBeVisible();
  const updated = await request.put(`/api/stocks/${bag.id}`, {
    data: { ...bag, quantity: 3, bestBy: '2030-10-28' },
  });
  expect(updated.ok()).toBe(true);
  await page.getByRole('button', { name: 'Refresh contents', exact: true }).click();
  const row = page
    .locator('.stock-row')
    .filter({ has: page.getByRole('button', { name: /^Sharpie lentils/ }) });
  await expect(row.locator('.quantity-cell')).toContainText('3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations
      .filter((v) => ['critical', 'serious'].includes(v.impact || ''))
      .map((v) => v.id),
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/${test.info().project.name}-bucket-contents.png`,
    fullPage: true,
  });
  const moved = await request.post(`/api/stocks/${bag.id}/actions`, {
    data: {
      version: (await updated.json()).version,
      action: 'move',
      containerId: 'BK-11',
      locationId: null,
    },
  });
  expect(moved.ok()).toBe(true);
  await page.getByRole('button', { name: 'Refresh contents', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Sharpie lentils/ })).toHaveCount(0);
  await page.goto('/container/BK-11');
  await expect(page.getByRole('button', { name: /^Sharpie lentils/ })).toBeVisible();
  const sameLabel = await request.get('/api/labels/preview?containerId=BK-10');
  expect(await sameLabel.body()).toEqual(await label.body());
});

test('records the first tank fill, hot tub rotations, and dated maintenance history', async ({
  page,
  request,
}) => {
  await request.post('/api/database/reset', { data: { mode: 'empty', confirmation: 'RESET' } });
  await page.goto('/water');
  const panel = page.getByRole('region', { name: 'Water tank rotation' });
  const tankFill = panel.locator('.tank-gauge .vessel-water');
  const dialog = page.getByRole('dialog');
  const progress = panel.getByRole('progressbar', { name: 'Rotation cycle elapsed' });
  const save = dialog.getByRole('button', { name: 'Save maintenance' });
  const action = dialog.getByLabel('Inventory action');
  const amount = dialog.getByRole('spinbutton', { name: 'Gallons in tank after filling' });
  const date = dialog.getByLabel('Maintenance date');
  const note = dialog.getByRole('textbox', { name: 'Maintenance note' });
  const openMaintenance = () =>
    panel.getByRole('button', { name: 'Record maintenance', exact: true }).click();

  await panel.getByRole('button', { name: 'Set up water tank', exact: true }).click();
  await expect(dialog.getByLabel('Physical capacity')).toHaveValue('300');
  await dialog.getByRole('button', { name: 'Save tank setup', exact: true }).click();
  await expect(panel.getByText('Amount unknown', { exact: true })).toBeVisible();
  await expect(panel.getByText(/Fill level unknown/)).toBeVisible();
  await expect(tankFill).toHaveCount(0);
  await expect(panel.getByText('Waiting for a fresh fill', { exact: true })).toBeVisible();
  await expect(progress).toHaveCount(0);
  let state = await (await request.get('/api/state')).json();
  expect(state.stocks).toHaveLength(1);
  expect(state.dashboard.water.total).toBe(0);
  const tank = state.stocks[0];

  await panel.getByRole('button', { name: 'Tank details', exact: true }).click();
  await page.getByRole('button', { name: 'Update stock', exact: true }).click();
  await expect(action).toHaveValue('fill_water_tank');
  await expect(amount).toHaveValue('');
  const today = await date.inputValue();
  const next = addDays(today, 45);
  await amount.fill('250');
  await note.fill('First fill at the top bung');
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.detail-hero strong')).toHaveText('250');
  state = await (await request.get('/api/state')).json();
  expect(state.stocks[0]).toMatchObject({ quantity: 250, capacity: 300, rotationDays: 45 });
  expect(state.dashboard.water.total).toBe(250);
  expect(state.dashboard.alerts).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'rotation', date: next })]),
  );

  await page.goto('/water');
  await expect(panel.getByText('250 of 300 gal', { exact: true })).toBeVisible();
  await expect(panel.getByText('83% full', { exact: true })).toBeVisible();
  await expect(tankFill).toBeVisible();
  await openMaintenance();
  await expect(action).toHaveValue('rotate_to_hot_tub');
  const outcome = dialog.getByLabel('After pumping into the hot tub');
  await outcome.selectOption('refilled');
  await expect(amount).toHaveValue('');
  await amount.fill('225');
  await note.fill('Refilled after transfer');
  const concurrent = await request.put(`/api/stocks/${tank.id}`, {
    data: { ...state.stocks[0], notes: 'Other device' },
  });
  expect(concurrent.ok()).toBe(true);
  await save.click();
  await expect(dialog.getByRole('alert')).toContainText('changed on another device');
  await expect(amount).toHaveValue('225');
  await expect(note).toHaveValue('Refilled after transfer');
  await expect(date).toHaveValue(today);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.reload();
  await openMaintenance();
  await outcome.selectOption('refilled');
  await amount.fill('225');
  await note.fill('Refilled after transfer');
  await save.click();
  await expect(panel.getByText('225 of 300 gal', { exact: true })).toBeVisible();
  await expect(panel.getByText('75% full', { exact: true })).toBeVisible();
  await openMaintenance();
  await outcome.selectOption('empty');
  await save.click();
  await expect(panel.getByText('0% full', { exact: true })).toBeVisible();
  await expect(tankFill).toHaveCount(0);
  await expect(progress).toHaveCount(0);
  state = await (await request.get('/api/state')).json();
  expect(state.dashboard.alerts.some((alert: { type: string }) => alert.type === 'rotation')).toBe(
    false,
  );

  await openMaintenance();
  await action.selectOption('clean_water_tank');
  const yesterday = addDays(today, -1);
  await date.fill(yesterday);
  await note.fill('Annual cleaning');
  await save.click();
  await expect(panel.getByText('0 of 300 gal', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Edit rotation setup', exact: true }).click();
  await dialog.getByLabel('Physical capacity').fill('280');
  await dialog.getByRole('button', { name: 'Save tank setup', exact: true }).click();
  await expect(panel.getByText('0 of 280 gal', { exact: true })).toBeVisible();

  await openMaintenance();
  await expect(action).toHaveValue('fill_water_tank');
  await amount.fill('250');
  await save.click();
  await expect(progress).toHaveAttribute('aria-valuenow', '0');

  await page.reload();
  await panel.getByRole('button', { name: 'Tank history', exact: true }).click();
  const cleaning = dialog.locator('.history-row').filter({ hasText: 'Tank cleaned' });
  await expect(cleaning).toContainText('Annual cleaning');
  await expect(cleaning.locator('time')).toHaveAttribute('datetime', yesterday);
  await expect(
    dialog.locator('.history-row').filter({ hasText: 'Refilled after transfer' }),
  ).toContainText('Filled to 225 gallons');
  await expect(
    dialog.locator('.history-row').filter({ hasText: 'First fill at the top bung' }),
  ).toContainText('Filled to 250 gallons');
  await expect(dialog.getByText('Left empty', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/${test.info().project.name}-water-tank.png`,
    fullPage: true,
  });
});

test('water overview shows jug quantities and the earliest tracked date', async ({
  page,
  request,
}) => {
  const state = await (await request.get('/api/state')).json();
  const today = calendarDay(new Date(), state.settings.timezone);
  const jugs = (state.stocks as Stock[])
    .filter((stock) => stock.packaging === 'jug')
    .sort((a, b) => a.name.localeCompare(b.name));
  const changes = [
    { bestBy: addDays(today, 31), rotationOn: addDays(today, 60), quantity: 3 },
    { bestBy: addDays(today, 7), rotationOn: addDays(today, 7), leadDays: 7 },
    { expiresOn: today, bestBy: today, rotationOn: today },
    { rotationOn: addDays(today, -1), expiresOn: addDays(today, 10), quantity: 0 },
    { lastRotatedOn: null, quantity: null },
    { rotationOn: addDays(today, 8), leadDays: 7 },
  ];
  for (const [index, jug] of jugs.entries()) {
    const saved = await request.put(`/api/stocks/${jug.id}`, {
      data: { ...jug, ...changes[index] },
    });
    expect(saved.ok()).toBe(true);
  }

  await page.goto('/water');
  await expect(page.getByRole('heading', { name: 'Water storage' })).toBeVisible();
  await expect(page.getByText(/318 gallons recorded/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Water inventory' })).toBeVisible();
  const shelf = page.getByRole('region', { name: 'Indoor water jugs' });
  const tiles = shelf.getByRole('list').getByRole('button');
  await expect(tiles).toHaveCount(6);
  await expect(shelf.getByText('6 jugs · 18 gallons recorded')).toBeVisible();
  await expect(tiles.nth(0)).toContainText(/Jug 1.*3 gal.*Scheduled.*Best by/);
  await expect(tiles.nth(1)).toContainText(/Jug 2.*Due soon.*Best by/);
  await expect(tiles.nth(2)).toContainText(/Jug 3.*Due today.*Expires/);
  await expect(tiles.nth(2).locator('time')).toHaveAttribute('datetime', today);
  await expect(tiles.nth(3)).toContainText(/Jug 4.*Empty.*Overdue.*Rotation/);
  await expect(tiles.nth(4)).toContainText(/Jug 5.*Amount unknown.*No date set/);
  await expect(tiles.nth(5)).toContainText(/Jug 6.*Scheduled.*Rotation/);
  const columns = (el: Element) => getComputedStyle(el).gridTemplateColumns.split(' ').length;
  expect(await page.locator('.water-overview').evaluate(columns)).toBe(
    test.info().project.name === 'desktop' ? 2 : 1,
  );
  expect(await shelf.getByRole('list').evaluate(columns)).toBe(
    test.info().project.name === 'phone' ? 3 : 6,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const a11y = await new AxeBuilder({ page }).include('.water-overview').analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({
    path: `test-results/${test.info().project.name}-water-overview.png`,
    fullPage: true,
  });

  await shelf.getByRole('button', { name: 'Add water jugs' }).focus();
  await page.keyboard.press('Tab');
  await expect(tiles.first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/item/${jugs[0].id}`);
});

test('rotation timeline shows elapsed time, due and overdue states, and unknown dates', async ({
  page,
  request,
}) => {
  const today = calendarDay(new Date(), 'America/Los_Angeles');
  const state = await (await request.get('/api/state')).json();
  const tank = state.stocks.find(
    (s: { category: string; packaging: string }) =>
      s.category === 'water' && s.packaging === 'tank',
  );
  async function setCycle(lastRotatedOn: string | null, rotationOn: string | null = null) {
    const current = await (await request.get(`/api/stocks/${tank.id}`)).json();
    const response = await request.put(`/api/stocks/${tank.id}`, {
      data: { ...current, lastRotatedOn, rotationOn },
    });
    expect(response.ok()).toBe(true);
    await page.goto('/water');
  }
  const panel = page.getByRole('region', { name: 'Water tank rotation' });
  const progress = panel.getByRole('progressbar', { name: 'Rotation cycle elapsed' });
  await setCycle(addDays(today, -18));
  await expect(progress).toHaveAttribute('aria-valuenow', '18');
  await expect(progress).toHaveAttribute('aria-valuemax', '45');
  await expect(progress).toHaveAttribute(
    'aria-valuetext',
    '18 of 45 days elapsed. 27 days until rotation.',
  );
  await expect(panel.getByLabel('27 days until rotation', { exact: true })).toBeVisible();
  await expect(panel.getByText('Reminder window', { exact: true })).toBeHidden();
  await panel.getByText('Rotation details', { exact: true }).click();
  await expect(panel.getByText('Reminder window', { exact: true })).toBeVisible();
  await panel.getByText('Rotation details', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const accessibility = await new AxeBuilder({ page }).include('.water-tank-panel').analyze();
  expect(
    accessibility.violations
      .filter((v) => ['critical', 'serious'].includes(v.impact || ''))
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  await panel.screenshot({ path: `test-results/${test.info().project.name}-water-timeline.png` });

  await setCycle(addDays(today, -45));
  await expect(panel.getByText('Rotation due today', { exact: true })).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '45');
  await setCycle(addDays(today, -48));
  await expect(panel.getByLabel('3 days overdue', { exact: true })).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '45');
  await expect(progress).toHaveAttribute(
    'aria-valuetext',
    '45 of 45 days elapsed. 3 days overdue.',
  );
  await setCycle(addDays(today, -18), addDays(today, 20));
  await expect(progress).toHaveAttribute('aria-valuemax', '38');
  await expect(progress).toHaveAttribute('aria-valuenow', '18');
  await expect(panel.getByLabel('20 days until rotation', { exact: true })).toBeVisible();
  await setCycle(null);
  await expect(panel.getByText('Waiting for a fresh fill', { exact: true })).toBeVisible();
  await expect(progress).toHaveCount(0);
  const final = await (await request.get(`/api/stocks/${tank.id}`)).json();
  expect(final.quantity).toBe(300);
});

test('configures an existing tank for 45 days without duplicating water', async ({
  page,
  request,
}) => {
  const state = await (await request.get('/api/state')).json();
  const tank = state.stocks.find(
    (s: { category: string; packaging: string }) =>
      s.category === 'water' && s.packaging === 'tank',
  );
  const configured = await request.put(`/api/stocks/${tank.id}`, {
    data: {
      ...tank,
      capacity: 200,
      quantity: 125,
      rotationDestination: null,
      rotationDays: null,
      rotationMonths: 6,
    },
  });
  expect(configured.ok()).toBe(true);
  await page.goto('/water');
  await page.getByRole('button', { name: 'Set up 45-day rotation', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('spinbutton', { name: 'Physical capacity' })).toHaveValue('200');
  await expect(
    dialog.getByRole('spinbutton', { name: 'Water currently in tank', exact: true }),
  ).toHaveValue('125');
  await dialog.getByRole('button', { name: 'Save tank setup', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const updated = await (await request.get('/api/state')).json();
  expect(updated.stocks.length).toBe(state.stocks.length);
  expect(updated.stocks.find((s: { id: string }) => s.id === tank.id)).toMatchObject({
    capacity: 200,
    quantity: 125,
    rotationDays: 45,
    rotationMonths: null,
  });
});

test('adds jugs with shared details, bulk edits existing jugs, and deletes a selection', async ({
  page,
  request,
}) => {
  await request.post('/api/database/reset', { data: { mode: 'empty', confirmation: 'RESET' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add water jugs', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton', { name: 'Number of jugs', exact: true }).fill('6');
  await dialog.getByLabel('Purchase date', { exact: true }).fill('2026-10-01');
  await dialog.getByLabel('Last filled / rotated date', { exact: true }).fill('2026-10-02');
  await dialog.getByLabel('Jug notes', { exact: true }).fill('Shared blue jugs');
  await page.route('**/api/water-jugs', (route) =>
    route.fulfill({ status: 503, json: { error: 'Temporary failure' } }),
  );
  await dialog.getByRole('button', { name: 'Add jugs', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Temporary failure');
  await expect(dialog.getByLabel('Purchase date', { exact: true })).toHaveValue('2026-10-01');
  await page.unroute('**/api/water-jugs');
  await page.screenshot({
    path: `test-results/${test.info().project.name}-add-jugs.png`,
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Add jugs', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  let state = await (await request.get('/api/state')).json();
  expect(state.stocks).toHaveLength(6);
  expect(
    state.stocks.every(
      (s: any) =>
        s.purchasedOn === '2026-10-01' &&
        s.lastRotatedOn === '2026-10-02' &&
        s.notes === 'Shared blue jugs' &&
        s.bestBy === null,
    ),
  ).toBe(true);
  expect(state.dashboard.water.total).toBe(30);
  await page.goto('/water');
  const firstJugDate = page
    .getByRole('region', { name: 'Indoor water jugs' })
    .getByRole('button', { name: /^Jug 1 / })
    .locator('time');
  await expect(firstJugDate).toHaveAttribute('datetime', '2027-10-02');
  await page.getByRole('checkbox', { name: 'Select all shown resources', exact: true }).check();
  await page.getByRole('button', { name: 'Edit selected jugs', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Gallons in each jug', { exact: true })).toBeDisabled();
  await dialog
    .getByRole('checkbox', { name: 'Change Last filled / rotated date', exact: true })
    .check();
  await dialog.getByLabel('Last filled / rotated date', { exact: true }).fill('2026-10-20');
  const changed = state.stocks[1];
  await request.put(`/api/stocks/${changed.id}`, { data: { ...changed, quantity: 3 } });
  await dialog.getByRole('button', { name: 'Save jug details', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('another device');
  await expect(dialog.getByLabel('Last filled / rotated date', { exact: true })).toHaveValue(
    '2026-10-20',
  );
  state = await (await request.get('/api/state')).json();
  expect(state.stocks.every((s: any) => s.lastRotatedOn === '2026-10-02')).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.getByRole('checkbox', { name: 'Select all shown resources', exact: true }).check();
  await page.getByRole('button', { name: 'Edit selected jugs', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('checkbox', { name: 'Change Last filled / rotated date', exact: true })
    .check();
  await dialog.getByLabel('Last filled / rotated date', { exact: true }).fill('2026-10-20');
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({
    path: `test-results/${test.info().project.name}-edit-jugs.png`,
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Save jug details', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(firstJugDate).toHaveAttribute('datetime', '2027-10-20');
  state = await (await request.get('/api/state')).json();
  expect(
    state.stocks.every(
      (s: any) => s.lastRotatedOn === '2026-10-20' && s.purchasedOn === '2026-10-01',
    ),
  ).toBe(true);
  expect(state.stocks.find((s: any) => s.id === changed.id).quantity).toBe(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Keep them', exact: true }).click();
  expect((await (await request.get('/api/state')).json()).stocks).toHaveLength(6);
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete resources', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Your reserve starts here.', exact: true }),
  ).toBeVisible();
  state = await (await request.get('/api/state')).json();
  expect(state.stocks).toHaveLength(0);
  expect(state.dashboard.water.total).toBe(0);
  await page.getByRole('button', { name: 'Add water jugs', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('deletes a resource, bucket, and location with clear consequences', async ({
  page,
  request,
}) => {
  let state = await (await request.get('/api/state')).json();
  const jug = state.stocks.find((s: any) => s.packaging === 'jug');
  await page.goto(`/item/${jug.id}`);
  await expect(page.getByRole('button', { name: /archive/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete resource', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Resource deleted');
  expect((await request.get(`/api/stocks/${jug.id}`)).status()).toBe(404);
  const contents = state.stocks.filter((s: any) => s.containerId === 'BK-01');
  const bucket = state.containers.find((c: any) => c.id === 'BK-01');
  await page.goto('/container/BK-01');
  await page.getByRole('button', { name: 'Edit bucket', exact: true }).click();
  await page.getByRole('button', { name: 'Delete bucket', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('resources stay in inventory');
  await page.getByRole('button', { name: 'Delete bucket permanently', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  state = await (await request.get('/api/state')).json();
  expect(state.containers.some((c: any) => c.id === 'BK-01')).toBe(false);
  for (const stock of contents) {
    const saved = state.stocks.find((s: any) => s.id === stock.id);
    expect(saved.quantity).toBe(stock.quantity);
    expect(saved.containerId).toBeNull();
    expect(saved.locationId).toBe(bucket.locationId);
  }
  const location = state.locations.find((l: any) => l.id === bucket.locationId);
  await page.goto('/settings#storage');
  await page.getByRole('button', { name: `Delete location ${location.name}`, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('no location assigned');
  await page.getByRole('button', { name: 'Delete location permanently', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  state = await (await request.get('/api/state')).json();
  expect(state.locations.some((l: any) => l.id === location.id)).toBe(false);
  for (const stock of contents)
    expect(state.stocks.find((s: any) => s.id === stock.id).locationId).toBeNull();
});

test('Fuel converts exchange cylinders, estimates runtime, and records a dated refill', async ({
  page,
  request,
}) => {
  expect(
    (
      await request.post('/api/database/reset', {
        data: { mode: 'empty', confirmation: 'RESET' },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post('/api/stocks', {
        data: {
          category: 'fuel',
          name: 'Propane tanks',
          brand: 'AmeriGas',
          quantity: 4,
          unit: 'lb',
        },
      })
    ).ok(),
  ).toBe(true);

  await page.goto('/fuel');
  await page.getByRole('button', { name: 'Convert to cylinders: Propane tanks' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('spinbutton', { name: 'Number of tanks' })).toHaveValue('4');
  await expect(dialog.getByRole('spinbutton', { name: 'Tank 4 remaining' })).toHaveValue('15');
  await expect(dialog.getByRole('spinbutton', { name: 'Tank 4 capacity' })).toHaveValue('20');
  await dialog.getByRole('button', { name: 'Convert cylinders' }).click();
  const reserve = page.getByRole('region', { name: 'Propane reserve' });
  await expect(reserve.getByText('4 tanks · 60 lb recorded')).toBeVisible();
  await expect(reserve.getByText('15 / 20 lb · 75%')).toHaveCount(4);

  await page.getByRole('button', { name: 'Edit equipment' }).click();
  await page.getByLabel('Kitchen uses piped natural gas').selectOption('yes');
  await page.getByRole('button', { name: 'Use Pulsar PGD105TiSCO preset' }).click();
  await page.getByRole('button', { name: 'Use Gas One B-4545 preset' }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await page.goto('/fuel');
  await expect(page.getByText('Piped natural gas for kitchen cooking')).toBeVisible();
  await expect(page.getByText('~24 hr', { exact: true })).toBeVisible();
  await expect(page.getByText('~129 hr', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Record refill for Propane tank 1', exact: true }).click();
  await expect(
    dialog.getByRole('spinbutton', { name: 'Pounds in the tank after refill' }),
  ).toHaveValue('20');
  const today = calendarDay(new Date(), 'America/Los_Angeles');
  await expect(dialog.getByLabel('Refill date')).toHaveValue(today);
  const refillDate = addDays(today, -1);
  await dialog.getByLabel('Refill date').fill(refillDate);
  await dialog.getByRole('button', { name: 'Save refill' }).click();
  await expect(reserve.getByText('4 tanks · 65 lb recorded')).toBeVisible();
  await expect(reserve.getByText('20 / 20 lb · 100%')).toBeVisible();
  await expect(page.getByText('~26 hr', { exact: true })).toBeVisible();
  await expect(reserve.locator(`time[datetime="${refillDate}"]`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/${test.info().project.name}-fuel.png`,
    fullPage: true,
  });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  await reserve.getByRole('button', { name: /^Propane tank 1 / }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(dialog.getByText('Propane refill')).toBeVisible();
  await expect(dialog.locator(`time[datetime="${refillDate}"]`)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/fuel');
  await page.getByRole('button', { name: 'Add other fuel' }).click();
  await expect(dialog.getByLabel('Fuel type')).toHaveValue('gasoline');
  await expect(dialog.getByLabel('Quantity unit')).toHaveValue('gallon');
  await expect(dialog.getByLabel('Specific rotation date')).toBeVisible();
});
