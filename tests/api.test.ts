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
import { deliverPending, queueReminders } from '../server/reminders.ts';
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
  it('converts legacy propane once and records independent, dated refills', async () => {
    const legacy = await create(
      stockInputSchema.parse({
        category: 'fuel',
        name: 'Propane tanks',
        brand: 'AmeriGas',
        quantity: 4,
        unit: 'lb',
        purchasedOn: '2025-01-01',
        locationId: 'LOC-OUTDOORS',
        notes: 'Keep this note',
      }),
    );
    const cylinders = Array.from({ length: 4 }, (_, i) => ({
      name: `Propane tank ${i + 1}`,
      quantity: 15,
      capacity: 20,
    }));
    const batch = {
      requestId: '1'.repeat(32),
      source: { id: legacy.id, version: legacy.version },
      cylinders,
    };
    const submit = (payload = batch) =>
      runtime.app.inject({
        method: 'POST',
        url: '/api/propane-cylinders',
        payload,
      });
    expect((await submit({ ...batch, source: { ...batch.source, version: 2 } })).statusCode).toBe(
      409,
    );
    expect(
      (
        await submit({
          ...batch,
          cylinders: [...cylinders.slice(0, 3), { ...cylinders[3], quantity: 21 }],
        })
      ).statusCode,
    ).toBe(400);
    expect(runtime.store.all()).toEqual([legacy]);

    runtime.store.db.exec(`
      CREATE TEMP TRIGGER fail_test_cylinder
      BEFORE INSERT ON stock_units
      WHEN json_extract(NEW.detail, '$.name') = 'Propane tank 3'
      BEGIN
        SELECT RAISE(ABORT, 'Simulated failure during batch insert');
      END;
    `);
    expect((await submit()).statusCode).toBe(500);
    expect(runtime.store.all()).toEqual([legacy]);
    runtime.store.db.exec('DROP TRIGGER fail_test_cylinder');

    const saved = await submit();
    expect(saved.statusCode, saved.body).toBe(201);
    const { ids } = saved.json<{ ids: string[] }>();
    expect(ids[0]).toBe(legacy.id);
    expect((await submit()).json()).toEqual({ ids });
    expect((await submit({ ...batch, cylinders: cylinders.slice(0, 1) })).statusCode).toBe(409);
    expect(runtime.store.all()).toHaveLength(4);
    for (const id of ids)
      expect(runtime.store.get(id)).toMatchObject({
        quantity: 15,
        capacity: 20,
        packaging: 'tank',
        brand: legacy.brand,
        locationId: legacy.locationId,
        notes: legacy.notes,
        purchasedOn: legacy.purchasedOn,
        lastRefilledOn: null,
      });
    const before = runtime.store.get(legacy.id);
    const action = (version: number, action: string, amount: number | undefined, date?: string) =>
      runtime.app.inject({
        method: 'POST',
        url: `/api/stocks/${legacy.id}/actions`,
        payload: { version, action, amount, date },
      });
    expect((await action(before.version, 'fill_propane_tank', 21, '2025-02-01')).statusCode).toBe(
      400,
    );
    expect((await action(before.version, 'fill_propane_tank', 20, '2099-01-01')).statusCode).toBe(
      400,
    );
    expect((await action(before.version, 'fill_propane_tank', 20, '2025-02-30')).statusCode).toBe(
      400,
    );
    expect((await action(before.version, 'fill_propane_tank', 20)).statusCode).toBe(400);
    const fill = await action(before.version, 'fill_propane_tank', 20, '2025-02-01');
    expect(fill.statusCode, fill.body).toBe(200);
    expect(fill.json()).toMatchObject({ quantity: 20, lastRefilledOn: '2025-02-01' });
    expect((await runtime.app.inject('/api/state')).json().dashboard.fuel.total).toBe(65);
    expect((await action(before.version, 'fill_propane_tank', 20, '2025-02-02')).statusCode).toBe(
      409,
    );
    expect(
      (await action(before.version + 1, 'fill_propane_tank', 20, '2025-01-31')).statusCode,
    ).toBe(400);
    expect((await action(before.version + 1, 'use', 2)).json()).toMatchObject({
      quantity: 18,
      lastRefilledOn: '2025-02-01',
    });
    const history = (await runtime.app.inject(`/api/stocks/${legacy.id}/history`)).json();
    expect(history.map((row: { action: string }) => row.action)).toEqual([
      'use',
      'fill_propane_tank',
      'edit',
      'create',
    ]);
    expect(JSON.parse(history[1].afterJson)).toMatchObject({ maintenanceOn: '2025-02-01' });
  });

  it('adds individual propane cylinders with shared details and fills an unknown balance', async () => {
    const result = await runtime.app.inject({
      method: 'POST',
      url: '/api/propane-cylinders',
      payload: {
        requestId: '2'.repeat(32),
        details: { brand: 'Test', purchasedOn: '2025-01-01' },
        cylinders: [
          { name: 'Unknown fill', quantity: null, capacity: 20 },
          { name: 'Partial fill', quantity: 7.5, capacity: 20 },
          { name: 'Empty', quantity: 0, capacity: 20 },
        ],
      },
    });
    expect(result.statusCode, result.body).toBe(201);
    const { ids } = result.json<{ ids: string[] }>();
    expect(ids.map((id) => runtime.store.get(id).quantity)).toEqual([null, 7.5, 0]);
    const refilled = await runtime.app.inject({
      method: 'POST',
      url: `/api/stocks/${ids[0]}/actions`,
      payload: { version: 1, action: 'fill_propane_tank', amount: 20, date: '2025-03-01' },
    });
    expect(refilled.statusCode, refilled.body).toBe(200);
    expect(refilled.json()).toMatchObject({ quantity: 20, lastRefilledOn: '2025-03-01' });
    expect((await runtime.app.inject('/api/state')).json().dashboard.fuel.total).toBe(27.5);
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
  it('adds jugs with shared details, keeps unknowns, and validates the entire request', async () => {
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/water-jugs',
      payload: {
        count: 6,
        details: {
          purchasedOn: '2026-10-01',
          lastRotatedOn: '2026-10-02',
          locationId: 'LOC-STORAGE',
          notes: 'Blue jugs',
          notify: false,
        },
      },
    });
    expect(response.statusCode).toBe(201);
    const jugs = response.json() as Stock[];
    expect(jugs).toHaveLength(6);
    expect(
      jugs.every(
        (s) =>
          s.purchasedOn === '2026-10-01' &&
          s.lastRotatedOn === '2026-10-02' &&
          s.quantity === 5 &&
          s.capacity === 5 &&
          s.bestBy === null &&
          s.notify === false &&
          s.notes === 'Blue jugs',
      ),
    ).toBe(true);
    expect(calculateDashboard(runtime.store.all(), runtime.store.getSettings()).water.total).toBe(
      30,
    );
    expect(runtime.store.all().some((s) => s.packaging === 'tank')).toBe(false);
    for (const payload of [
      { count: 0, details: {} },
      { count: 1.5, details: {} },
      { count: 101, details: {} },
      { count: 3, details: { purchasedOn: '2026-02-31' } },
      { count: 3, details: { quantity: 6, capacity: 5 } },
      { count: 3, details: { locationId: 'missing' } },
    ]) {
      expect(
        (await runtime.app.inject({ method: 'POST', url: '/api/water-jugs', payload })).statusCode,
      ).toBe(400);
      expect(runtime.store.all()).toHaveLength(6);
    }
  });
  it('bulk edits only chosen jug fields and rolls back on conflicts or invalid amounts', async () => {
    const first = await create(
      stockInputSchema.parse({
        category: 'water',
        packaging: 'jug',
        name: 'First jug',
        unit: 'gallon',
        quantity: 4,
        capacity: 5,
        purchasedOn: '2026-01-01',
        notes: 'Keep first',
      }),
    );
    const second = await create(
      stockInputSchema.parse({
        category: 'water',
        packaging: 'jug',
        name: 'Second jug',
        unit: 'gallon',
        quantity: null,
        capacity: 10,
        purchasedOn: '2026-02-01',
        notes: 'Keep second',
        notify: false,
      }),
    );
    const items = [first, second].map(({ id, version }) => ({ id, version }));
    const edit = (changes: unknown, selection = items) =>
      runtime.app.inject({
        method: 'PUT',
        url: '/api/water-jugs',
        payload: { items: selection, changes },
      });
    expect((await edit({ capacity: 2 })).statusCode).toBe(400);
    expect(runtime.store.get(first.id).version).toBe(1);
    expect(
      (await edit({ lastRotatedOn: '2026-10-20' }, [items[0], { ...items[1], version: 2 }]))
        .statusCode,
    ).toBe(409);
    expect(runtime.store.get(first.id).lastRotatedOn).toBeNull();
    expect((await edit({ lastRotatedOn: '2026-10-20', rotationMonths: 6 })).statusCode).toBe(200);
    expect(runtime.store.get(first.id)).toMatchObject({
      quantity: 4,
      capacity: 5,
      purchasedOn: '2026-01-01',
      notes: 'Keep first',
      notify: true,
      lastRotatedOn: '2026-10-20',
      rotationMonths: 6,
    });
    expect(runtime.store.get(second.id)).toMatchObject({
      quantity: null,
      capacity: 10,
      purchasedOn: '2026-02-01',
      notes: 'Keep second',
      notify: false,
      lastRotatedOn: '2026-10-20',
      rotationMonths: 6,
    });
    expect((await edit({ purchasedOn: null }, [{ id: first.id, version: 2 }])).statusCode).toBe(
      200,
    );
    expect(runtime.store.get(first.id).purchasedOn).toBeNull();
    expect((await edit({})).statusCode).toBe(400);
    const food = await create();
    expect(
      (await edit({ notes: 'wrong' }, [{ id: food.id, version: food.version }])).statusCode,
    ).toBe(400);
  });
  it('permanently deletes records and unshared photos while preserving sibling bags', async () => {
    const photo = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp';
    await fs.writeFile(path.join(runtime.store.dataDir, 'uploads', photo), 'test');
    const first = await create({ ...rice(), photoIds: [photo] });
    const [original, bag] = runtime.store.split(first.id, first.version, [
      { quantity: 8, containerId: null, packaging: 'mylar_1' },
    ]);
    const remove = (stock: Stock) =>
      runtime.app.inject({
        method: 'DELETE',
        url: `/api/stocks/${stock.id}`,
        payload: { version: stock.version },
      });
    expect((await remove(first)).statusCode).toBe(409);
    expect((await remove(original)).statusCode).toBe(200);
    expect((await runtime.app.inject(`/api/stocks/${first.id}`)).statusCode).toBe(404);
    expect(
      runtime.store.db.prepare('SELECT 1 FROM stock_units WHERE id=?').get(first.id),
    ).toBeUndefined();
    expect(
      runtime.store.db.prepare('SELECT 1 FROM adjustments WHERE stock_id=?').get(first.id),
    ).toBeUndefined();
    expect(runtime.store.get(bag.id).quantity).toBe(8);
    await expect(
      fs.access(path.join(runtime.store.dataDir, 'uploads', photo)),
    ).resolves.toBeUndefined();
    expect((await remove(bag)).statusCode).toBe(200);
    for (const table of [
      'stock_units',
      'adjustments',
      'purchase_batches',
      'catalog_items',
      'food_details',
    ])
      expect(runtime.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({
        n: 0,
      });
    await expect(fs.access(path.join(runtime.store.dataDir, 'uploads', photo))).rejects.toThrow();
  });
  it('bulk deletion is atomic and immediately removes queued item emails and stale summaries', async () => {
    const now = new Date();
    runtime.store.saveSettings({
      ...runtime.store.getSettings(),
      recipients: ['test@example.invalid'],
      digest: 'off',
    });
    const first = await create({
      ...rice(),
      name: 'Delete this rice',
      expiresOn: now.toISOString().slice(0, 10),
    });
    const second = await create({ ...rice(), name: 'Keep this rice' });
    queueReminders(runtime.store, now);
    expect(runtime.store.db.prepare('SELECT count(*) AS n FROM reminder_outbox').get()).toEqual({
      n: 1,
    });
    runtime.store.db
      .prepare(
        'INSERT INTO reminder_outbox(id,subject,body,recipients,next_attempt,created_at) VALUES (?,?,?,?,?,?)',
      )
      .run(
        'digest:weekly:old',
        'Old summary',
        'Delete this rice',
        '[]',
        now.toISOString(),
        now.toISOString(),
      );
    const remove = (items: unknown) =>
      runtime.app.inject({ method: 'POST', url: '/api/stocks/delete', payload: { items } });
    expect(
      (
        await remove([
          { id: first.id, version: first.version },
          { id: second.id, version: 2 },
        ])
      ).statusCode,
    ).toBe(409);
    expect(runtime.store.all()).toHaveLength(2);
    expect((await remove([{ id: first.id, version: first.version }])).statusCode).toBe(200);
    expect(runtime.store.all().map((s) => s.id)).toEqual([second.id]);
    const sent: string[] = [];
    await deliverPending(
      runtime.store,
      async (job) => {
        sent.push(job.body);
      },
      now,
    );
    expect(sent).toEqual([]);
    expect(
      runtime.store.db
        .prepare('SELECT id FROM reminder_outbox WHERE id LIKE ?')
        .all(`alert:${first.id}:%`),
    ).toEqual([]);
    expect((await runtime.app.inject(`/api/stocks/${first.id}/history`)).statusCode).toBe(404);
    expect(
      calculateDashboard(runtime.store.all(), runtime.store.getSettings(), now).alerts.some(
        (a) => a.stockId === first.id,
      ),
    ).toBe(false);
  });
  it('deletes storage without losing quantities, rejects stale edits, and never reuses bucket numbers', async () => {
    const bucket = runtime.store.createContainer({
      name: 'Delete bucket',
      locationId: 'LOC-STORAGE',
      capacityGallons: 5,
    });
    const stock = await create({ ...rice(), containerId: bucket.id, locationId: 'LOC-OUTDOORS' });
    expect(
      (
        await runtime.app.inject({
          method: 'DELETE',
          url: `/api/containers/${bucket.id}`,
          payload: { version: 2 },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await runtime.app.inject({
          method: 'DELETE',
          url: `/api/containers/${bucket.id}`,
          payload: { version: bucket.version },
        })
      ).statusCode,
    ).toBe(200);
    expect(runtime.store.get(stock.id)).toMatchObject({
      containerId: null,
      locationId: 'LOC-STORAGE',
      quantity: 20,
      version: 2,
    });
    const next = runtime.store.createContainer({
      name: 'Next',
      locationId: 'LOC-STORAGE',
      capacityGallons: 5,
    });
    expect(next.bucketNumber).toBe(bucket.bucketNumber + 1);
    expect(
      (
        await runtime.app.inject({
          method: 'DELETE',
          url: '/api/locations/LOC-STORAGE',
          payload: { name: 'Stale name' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await runtime.app.inject({
          method: 'DELETE',
          url: '/api/locations/LOC-STORAGE',
          payload: { name: 'Storage' },
        })
      ).statusCode,
    ).toBe(200);
    expect(runtime.store.get(stock.id)).toMatchObject({
      locationId: null,
      quantity: 20,
      version: 3,
    });
    expect(runtime.store.containers()[0]).toMatchObject({ locationId: null, version: 2 });
    const reopened = openStore(runtime.store.dataDir);
    expect(reopened.locations().some((l) => l.id === 'LOC-STORAGE')).toBe(false);
    reopened.db.close();
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/setup',
          payload: { water: true, buckets: true },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      runtime.store
        .all()
        .filter((s) => s.packaging === 'jug')
        .every((s) => s.locationId === null),
    ).toBe(true);
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
  it('records actual tank fills and dated maintenance atomically', async () => {
    const tank = await create(waterTankInput());
    const post = (stock: Stock, action: string, date?: string, amount?: number, note?: string) =>
      runtime.app.inject({
        method: 'POST',
        url: `/api/stocks/${stock.id}/actions`,
        payload: { version: stock.version, action, date, amount, note },
      });
    const history = async () => (await runtime.app.inject(`/api/stocks/${tank.id}/history`)).json();
    const initialHistory = await history();
    expect((await post(tank, 'refill', undefined, 250)).statusCode).toBe(400);
    expect((await post(tank, 'fill_water_tank', '2026-01-31', 301)).statusCode).toBe(400);
    expect((await post(tank, 'fill_water_tank', '2026-01-31', 0)).statusCode).toBe(400);
    expect((await post(tank, 'fill_water_tank', '2026-02-30', 250)).statusCode).toBe(400);
    expect((await post(tank, 'fill_water_tank', '2099-01-01', 250)).statusCode).toBe(400);
    expect((await post(tank, 'fill_water_tank', undefined, 250)).statusCode).toBe(400);
    expect((await post(tank, 'rotate_to_hot_tub', '2026-01-31')).statusCode).toBe(400);
    expect((await post(await create(), 'clean_water_tank', '2026-01-31')).statusCode).toBe(400);
    expect(runtime.store.get(tank.id)).toEqual(tank);
    expect(await history()).toEqual(initialHistory);

    const fillResponse = await post(tank, 'fill_water_tank', '2026-01-31', 250, 'First fill');
    expect(fillResponse.statusCode).toBe(200);
    const filled = fillResponse.json<Stock>();
    expect(filled).toMatchObject({ quantity: 250, capacity: 300, version: 2 });
    expect(rotationDate(filled)).toBe('2026-03-17');
    expect((await post(tank, 'rotate_to_hot_tub', '2026-03-17', 225)).statusCode).toBe(409);
    expect((await post(filled, 'empty_water_tank', '2026-01-30')).statusCode).toBe(400);
    expect((await post(filled, 'rotate_to_hot_tub', '2026-03-17', 301)).statusCode).toBe(400);
    expect(runtime.store.get(tank.id)).toEqual(filled);
    expect(await history()).toHaveLength(initialHistory.length + 1);

    const rotated = (
      await post(filled, 'rotate_to_hot_tub', '2026-03-17', 225, 'Hose refill')
    ).json<Stock>();
    expect(rotated.quantity).toBe(225);
    expect(rotationDate(rotated)).toBe('2026-05-01');
    const cleaned = (
      await post(rotated, 'clean_water_tank', '2026-01-30', undefined, 'Annual cleaning')
    ).json<Stock>();
    expect(cleaned.quantity).toBe(225);
    expect(rotationDate(cleaned)).toBe('2026-05-01');

    const drained = (await post(cleaned, 'rotate_to_hot_tub', '2026-05-01', 0)).json<Stock>();
    expect(drained.quantity).toBe(0);
    expect(rotationDate(drained)).toBeNull();
    expect((await post(drained, 'fill_water_tank', '2026-04-30', 250)).statusCode).toBe(400);
    const refilled = (await post(drained, 'fill_water_tank', '2026-05-02', 300)).json<Stock>();
    expect(refilled.quantity).toBe(300);
    expect(rotationDate(refilled)).toBe('2026-06-16');
    const emptied = (
      await post(refilled, 'empty_water_tank', '2026-05-03', undefined, 'Drained for service')
    ).json<Stock>();
    expect(emptied.quantity).toBe(0);
    expect(rotationDate(emptied)).toBeNull();
    expect((await post(emptied, 'fill_water_tank', '2026-05-02', 200)).statusCode).toBe(400);

    const rows = await history();
    expect(rows.slice(0, 6).map((row: { action: string }) => row.action)).toEqual([
      'empty_water_tank',
      'fill_water_tank',
      'rotate_to_hot_tub',
      'clean_water_tank',
      'rotate_to_hot_tub',
      'fill_water_tank',
    ]);
    expect(rows[3].note).toBe('Annual cleaning');
    expect(JSON.parse(rows[3].afterJson).maintenanceOn).toBe('2026-01-30');
    expect(JSON.parse(rows[5].beforeJson).quantity).toBeNull();
    expect(JSON.parse(rows[5].afterJson)).toMatchObject({
      quantity: 250,
      maintenanceOn: '2026-01-31',
    });
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
  it('exports only bucket labels as correctly sized PNG/PDF and numbered Excel batches', async () => {
    const bucket = (
      await runtime.app.inject({
        method: 'POST',
        url: '/api/containers',
        payload: { name: 'Breakfast', locationId: null, capacityGallons: 5 },
      })
    ).json<Container>();
    const payload = { containerIds: [bucket.id] };
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
    ).toContain(`/container/${bucket.id}`);
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
    expect(book.worksheets[0].getCell('A2').value).toBe('01');
    expect(book.worksheets[0].getCell('E2').value).toContain(`/container/${bucket.id}`);
    const tooMany = await runtime.app.inject({
      method: 'POST',
      url: '/api/labels/export',
      payload: { containerIds: Array(101).fill(bucket.id), format: 'xlsx' },
    });
    expect(tooMany.statusCode).toBe(400);
  });
  it('rejects resource-label requests, unknown buckets, and empty label exports', async () => {
    const item = await create();
    for (const query of [`stockId=${item.id}`, 'containerId=missing', '']) {
      const response = await runtime.app.inject(`/api/labels/preview?${query}`);
      expect(response.statusCode).toBe(query === 'containerId=missing' ? 404 : 400);
    }
    for (const payload of [
      { ids: [item.id], format: 'png' },
      { containerIds: [], format: 'pdf' },
      { containerIds: ['missing'], format: 'pdf' },
    ]) {
      const response = await runtime.app.inject({
        method: 'POST',
        url: '/api/labels/export',
        payload,
      });
      expect(response.statusCode).toBe(payload.containerIds?.[0] === 'missing' ? 404 : 400);
    }
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
