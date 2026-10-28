import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';
import jsQR from 'jsqr';
import { buildApp } from '../server/app.ts';
import { createBackup, restoreBackup } from '../server/backup.ts';
import { openStore } from '../server/db.ts';
import {
  calculateDashboard,
  effectiveLocationId,
  stockInputSchema,
  waterTankInput,
  rotationDate,
  type Stock,
  type Container,
} from '../shared/model.ts';

describe('inventory API and persistence', () => {
  let runtime: Awaited<ReturnType<typeof buildApp>>, temp: string;
  beforeEach(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'haven-test-'));
    runtime = await buildApp({ dataDir: path.join(temp, 'data') });
  });
  afterEach(async () => {
    await runtime.app.close();
    await fs.rm(temp, { recursive: true, force: true });
  });
  const rice = () =>
    stockInputSchema.parse({
      category: 'food',
      name: 'Rice',
      quantity: 20,
      unit: 'lb',
      nutrition: { servingSize: 100, servingUnit: 'g', calories: 350 },
    });
  async function create(input = rice()): Promise<Stock> {
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/stocks',
      payload: input,
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }
  it('starts empty, updates quantities, persists history, and rejects stale writes', async () => {
    expect((await runtime.app.inject('/api/state')).json().stocks).toHaveLength(0);
    const item = await create();
    const used = await runtime.app.inject({
      method: 'POST',
      url: `/api/stocks/${item.id}/actions`,
      payload: { version: 1, action: 'use', amount: 2 },
    });
    expect(used.json().quantity).toBe(18);
    expect(
      (
        await runtime.app.inject({
          method: 'PUT',
          url: `/api/stocks/${item.id}`,
          payload: { ...item, quantity: 15 },
        })
      ).statusCode,
    ).toBe(409);
    const history = (await runtime.app.inject(`/api/stocks/${item.id}/history`)).json();
    expect(history.map((h: { action: string }) => h.action)).toEqual(['use', 'create']);
  });
  it('rejects overdraw, overcapacity, malformed dates, and unknown references', async () => {
    const item = await create();
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: `/api/stocks/${item.id}/actions`,
          payload: { version: 1, action: 'use', amount: 21 },
        })
      ).statusCode,
    ).toBe(400);
    expect(runtime.store.get(item.id).quantity).toBe(20);
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/stocks',
          payload: { ...rice(), bestBy: '2026-02-31' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/stocks',
          payload: { ...rice(), containerId: 'MISSING' },
        })
      ).statusCode,
    ).toBe(400);
    const water = await create(
      stockInputSchema.parse({
        category: 'water',
        name: 'Jug',
        unit: 'gallon',
        quantity: 5,
        capacity: 5,
      }),
    );
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: `/api/stocks/${water.id}/actions`,
          payload: { version: 1, action: 'refill', amount: 1 },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('splits atomically and moves bags without changing totals', async () => {
    await runtime.app.inject({ method: 'POST', url: '/api/setup', payload: { buckets: true } });
    const item = await create(),
      calories = calculateDashboard(runtime.store.all(), runtime.store.getSettings()).food.total;
    const payload = {
      version: 1,
      parts: [
        { quantity: 8, containerId: 'BK-01', packaging: 'mylar_1' },
        { quantity: 12, containerId: 'BK-02', packaging: 'mylar_3' },
      ],
    };
    const response = await runtime.app.inject({
      method: 'POST',
      url: `/api/stocks/${item.id}/split`,
      payload,
    });
    expect(response.statusCode).toBe(200);
    const units: Stock[] = response.json();
    expect(units.map((s) => s.quantity)).toEqual([0, 8, 12]);
    expect(new Set(units.map((s) => s.batchId)).size).toBe(1);
    expect(
      calculateDashboard(runtime.store.all(), runtime.store.getSettings()).food.total,
    ).toBeCloseTo(calories);
    await runtime.app.inject({
      method: 'POST',
      url: `/api/stocks/${units[1].id}/actions`,
      payload: { version: 1, action: 'move', containerId: 'BK-03', locationId: 'LOC-OUTDOORS' },
    });
    expect(
      calculateDashboard(runtime.store.all(), runtime.store.getSettings()).food.total,
    ).toBeCloseTo(calories);
    const before = runtime.store.all().length;
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: `/api/stocks/${units[2].id}/split`,
          payload: {
            version: 1,
            parts: [{ quantity: 5, containerId: 'missing', packaging: 'mylar_1' }],
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(runtime.store.get(units[2].id).quantity).toBe(12);
    expect(runtime.store.all()).toHaveLength(before);
  });
  it('invalidates sibling versions when shared batch details change', async () => {
    const item = await create();
    const units = runtime.store.split(item.id, 1, [
      { quantity: 10, containerId: null, packaging: 'mylar_1' },
    ]);
    runtime.store.update(units[1].id, { ...units[1], name: 'Updated rice' }, 1);
    expect(runtime.store.get(item.id).name).toBe('Updated rice');
    expect(() => runtime.store.action(item.id, 2, 'use', { amount: 1 })).toThrow(/another device/);
  });
  it('makes water/bucket setup idempotent and leaves dates unknown', async () => {
    for (let i = 0; i < 2; i++)
      expect(
        (
          await runtime.app.inject({
            method: 'POST',
            url: '/api/setup',
            payload: { water: true, buckets: true },
          })
        ).statusCode,
      ).toBe(200);
    const data = (await runtime.app.inject('/api/state')).json();
    expect(data.stocks).toHaveLength(7);
    expect(data.containers).toHaveLength(12);
    expect(data.dashboard.water.total).toBe(30);
    expect(data.stocks.every((s: Stock) => s.lastRotatedOn == null)).toBe(true);
    const tank = data.stocks.find((s: Stock) => s.packaging === 'tank');
    expect(tank).toMatchObject({
      capacity: 300,
      quantity: null,
      rotationDays: 45,
      rotationDestination: 'hot_tub',
    });
  });
  it('records hot tub rotations atomically, refills only when confirmed, and preserves history', async () => {
    const tank = await create(waterTankInput());
    const rotate = (version: number, date: string, refilled = false) =>
      runtime.app.inject({
        method: 'POST',
        url: `/api/stocks/${tank.id}/actions`,
        payload: { version, action: 'rotate_to_hot_tub', date, refilled },
      });
    expect((await rotate(1, '2026-02-30')).statusCode).toBe(400);
    expect((await rotate(1, '2099-01-01')).statusCode).toBe(400);
    expect(runtime.store.get(tank.id).version).toBe(1);
    const first = await rotate(1, '2026-01-31');
    expect(first.statusCode).toBe(200);
    expect(first.json().quantity).toBeNull();
    expect(rotationDate(first.json())).toBe('2026-03-17');
    expect((await rotate(1, '2026-03-17', true)).statusCode).toBe(409);
    expect((await rotate(2, '2026-01-30', true)).statusCode).toBe(400);
    const second = await rotate(2, '2026-03-17', true);
    expect(second.json().quantity).toBe(300);
    expect(rotationDate(second.json())).toBe('2026-05-01');
    const history = (await runtime.app.inject(`/api/stocks/${tank.id}/history`)).json();
    expect(history[0].action).toBe('rotate_to_hot_tub');
    expect(history[0].note).toContain('Refilled tank to capacity');
    expect(history[1].note).toContain('recorded quantity unchanged');
    expect(JSON.parse(history[0].beforeJson).quantity).toBeNull();
    expect(JSON.parse(history[0].afterJson).lastRotatedOn).toBe('2026-03-17');
    const third = await rotate(3, '2026-05-01');
    expect(third.json().quantity).toBe(300);
    const food = await create();
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: `/api/stocks/${food.id}/actions`,
          payload: { version: 1, action: 'rotate_to_hot_tub', date: '2026-05-01', refilled: true },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('does not add a second tank when water setup follows a dedicated tank setup', async () => {
    await create(waterTankInput());
    await runtime.app.inject({ method: 'POST', url: '/api/setup', payload: { water: true } });
    expect(runtime.store.all().filter((s) => s.packaging === 'tank')).toHaveLength(1);
    expect(runtime.store.all()).toHaveLength(7);
  });
  it('keeps bucket numbers and QR identities permanent, allocates in order, and never reuses numbers', async () => {
    // Adding a bucket before setup must still let the 12-bucket setup finish safely.
    const first = await runtime.app.inject({
      method: 'POST',
      url: '/api/containers',
      payload: { name: 'First', locationId: null, capacityGallons: 5 },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().bucketNumber).toBe(1);
    await runtime.app.inject({ method: 'POST', url: '/api/setup', payload: { buckets: true } });
    let containers: Container[] = (await runtime.app.inject('/api/state')).json().containers;
    expect(containers.map((c) => c.bucketNumber)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    const added = await Promise.all(
      Array.from({ length: 3 }, () =>
        runtime.app.inject({
          method: 'POST',
          url: '/api/containers',
          payload: { name: '', locationId: null, capacityGallons: 5 },
        }),
      ),
    );
    expect(added.map((r) => r.json().bucketNumber).sort((a, b) => a - b)).toEqual([13, 14, 15]);
    const bucket = added[0].json<Container>();
    const changed = await runtime.app.inject({
      method: 'PUT',
      url: `/api/containers/${bucket.id}`,
      payload: {
        name: 'Oats and spices',
        locationId: 'LOC-STORAGE',
        capacityGallons: 5,
        version: 1,
      },
    });
    expect(changed.json()).toMatchObject({
      id: bucket.id,
      bucketNumber: bucket.bucketNumber,
      name: 'Oats and spices',
    });
    expect(
      (
        await runtime.app.inject({
          method: 'PUT',
          url: `/api/containers/${bucket.id}`,
          payload: {
            name: 'Renumber',
            locationId: null,
            capacityGallons: 5,
            version: 2,
            bucketNumber: 90,
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await runtime.app.inject({
          method: 'PUT',
          url: `/api/containers/${bucket.id}`,
          payload: { name: 'Stale', locationId: null, capacityGallons: 5, version: 1 },
        })
      ).statusCode,
    ).toBe(409);
    // A removed/retired record must not make its permanent number available again.
    runtime.store.db.prepare('DELETE FROM containers WHERE bucket_number=15').run();
    const next = await runtime.app.inject({
      method: 'POST',
      url: '/api/containers',
      payload: { locationId: null, capacityGallons: 5 },
    });
    expect(next.json().bucketNumber).toBe(16);
    containers = (await runtime.app.inject('/api/state')).json().containers;
    expect(containers.map((c) => c.bucketNumber)).toEqual([
      ...Array.from({ length: 14 }, (_, i) => i + 1),
      16,
    ]);
    const saved = openStore(path.join(temp, 'data'));
    expect(saved.containers().at(-1)?.bucketNumber).toBe(16);
    saved.db.close();
  });
  it('locates bags through their bucket and standalone items directly without changing totals on a bucket move', async () => {
    await runtime.app.inject({ method: 'POST', url: '/api/setup', payload: { buckets: true } });
    const closet = (
      await runtime.app.inject({
        method: 'POST',
        url: '/api/locations',
        payload: { name: 'Closet' },
      })
    ).json();
    const bag = await create({ ...rice(), containerId: 'BK-04', locationId: 'LOC-OUTDOORS' });
    const standalone = await create({ ...rice(), containerId: null, locationId: closet.id });
    const before = (await runtime.app.inject('/api/state')).json();
    expect(effectiveLocationId(bag, before.containers)).toBe('LOC-STORAGE');
    expect(effectiveLocationId(standalone, before.containers)).toBe(closet.id);
    await runtime.app.inject({
      method: 'PUT',
      url: '/api/containers/BK-04',
      payload: { name: 'Breakfast', locationId: closet.id, capacityGallons: 5, version: 1 },
    });
    const after = (await runtime.app.inject('/api/state')).json();
    expect(effectiveLocationId(bag, after.containers)).toBe(closet.id);
    expect(after.dashboard.food.total).toBe(before.dashboard.food.total);
    expect(after.stocks.map((s: Stock) => [s.id, s.quantity])).toEqual(
      before.stocks.map((s: Stock) => [s.id, s.quantity]),
    );
    await runtime.app.inject({
      method: 'PUT',
      url: '/api/containers/BK-04',
      payload: { name: '', locationId: null, capacityGallons: 5, version: 2 },
    });
    const unknown = (await runtime.app.inject('/api/state')).json();
    expect(effectiveLocationId(bag, unknown.containers)).toBeNull();
    expect(effectiveLocationId(standalone, unknown.containers)).toBe(closet.id);
  });
  it('exports correctly sized PNG/PDF labels and plain Excel batches', async () => {
    const item = await create();
    const payload = { ids: [item.id] };
    const png = await runtime.app.inject({
      method: 'POST',
      url: '/api/labels/export',
      payload: { ...payload, format: 'png' },
    });
    expect(png.statusCode).toBe(200);
    const metadata = await sharp(png.rawPayload).metadata();
    expect(metadata.width).toBe(Math.round((50 / 25.4) * 203));
    expect(metadata.height).toBe(Math.round((80 / 25.4) * 203));
    expect(metadata.density).toBe(203);
    const decoded = await sharp(png.rawPayload)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(
      jsQR(new Uint8ClampedArray(decoded.data), decoded.info.width, decoded.info.height)?.data,
    ).toContain(`/item/${item.id}`);
    const pdf = await runtime.app.inject({
      method: 'POST',
      url: '/api/labels/export',
      payload: { ...payload, format: 'pdf' },
    });
    const doc = await PDFDocument.load(pdf.rawPayload);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo((50 / 25.4) * 72);
    const xlsx = await runtime.app.inject({
      method: 'POST',
      url: '/api/labels/export',
      payload: { ...payload, format: 'xlsx' },
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(xlsx.rawPayload as never);
    expect(book.worksheets[0].getCell('H2').value).toContain(`/item/${item.id}`);
    const tooMany = await runtime.app.inject({
      method: 'POST',
      url: '/api/labels/export',
      payload: { ids: Array(101).fill(item.id), format: 'xlsx' },
    });
    expect(tooMany.statusCode).toBe(400);
  });
  it('restores an actual database snapshot and photos', async () => {
    const photo = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp';
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#abc' } })
      .webp()
      .toFile(path.join(runtime.store.dataDir, 'uploads', photo));
    const item = await create({ ...rice(), photoIds: [photo] });
    const backup = await createBackup(runtime.store);
    try {
      const destination = path.join(temp, 'restored');
      await restoreBackup(backup.file, destination);
      const restored = openStore(destination);
      try {
        expect(restored.get(item.id).quantity).toBe(20);
        expect(
          (await fs.readFile(path.join(destination, 'uploads', photo))).length,
        ).toBeGreaterThan(0);
      } finally {
        restored.db.close();
      }
      await expect(restoreBackup(backup.file, destination)).rejects.toThrow(/new or empty/);
    } finally {
      await backup.cleanup();
    }
  });
  it('resets settings and every inventory table, reseeds all categories, and removes photos', async () => {
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/database/reset',
          payload: { mode: 'demo', confirmation: 'RESET' },
        })
      ).statusCode,
    ).toBe(200);
    let data = (await runtime.app.inject('/api/state')).json();
    expect(data.demo).toBe(true);
    expect(new Set(data.stocks.map((s: Stock) => s.category)).size).toBe(5);
    expect(data.containers).toHaveLength(12);
    expect(data.settings.recipients).toEqual([]);
    expect(data.dashboard.water.total).toBe(330);
    const firstCount = data.stocks.length;
    await runtime.app.inject({
      method: 'POST',
      url: '/api/database/reset',
      payload: { mode: 'demo', confirmation: 'RESET' },
    });
    expect(runtime.store.all()).toHaveLength(firstCount);
    expect(await fs.readdir(path.join(runtime.store.dataDir, 'uploads'))).toHaveLength(3);
    await runtime.app.inject({
      method: 'POST',
      url: '/api/database/reset',
      payload: { mode: 'empty', confirmation: 'RESET' },
    });
    data = (await runtime.app.inject('/api/state')).json();
    expect(data.demo).toBe(false);
    expect(data.stocks).toEqual([]);
    expect(data.containers).toEqual([]);
    expect(data.settings.caloriesPerAdult).toBeNull();
    expect(data.deliveries).toEqual([]);
    expect(await fs.readdir(path.join(runtime.store.dataDir, 'uploads'))).toHaveLength(0);
  });
  it('requires explicit reset confirmation and rejects cross-origin writes', async () => {
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/database/reset',
          payload: { mode: 'empty' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/stocks',
          headers: { origin: 'https://other.example' },
          payload: rice(),
        })
      ).statusCode,
    ).toBe(403);
  });
  it('reports missing AI credentials without affecting inventory', async () => {
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const item = await create();
      const response = await runtime.app.inject({
        method: 'POST',
        url: '/api/ai/draft',
        payload: { text: 'Rice', photoIds: [] },
      });
      expect(response.statusCode).toBe(503);
      expect(runtime.store.get(item.id).quantity).toBe(20);
    } finally {
      if (key) process.env.OPENAI_API_KEY = key;
    }
  });
});
