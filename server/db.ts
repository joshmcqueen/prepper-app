import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  settingsSchema,
  stockInputSchema,
  round,
  type StockInput,
  type Stock,
  type Settings,
  type Location,
  type Container,
} from '../shared/model.ts';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
export const SCHEMA_VERSION = 2;
type Row = Record<string, unknown>;
export function openStore(dataDir: string) {
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const db = new Database(path.join(dataDir, 'inventory.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  const schema = fs.readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
  const version = Number(db.pragma('user_version', { simple: true }));
  if (version === 0) db.transaction(() => db.exec(schema))();
  else if (version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(
      'Prototype schema changed. Stop the server, remove the data directory, restart, and reseed.',
    );
  }
  db.prepare('INSERT OR IGNORE INTO settings VALUES (1,?)').run(
    JSON.stringify(
      settingsSchema.parse({ appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173' }),
    ),
  );
  db.prepare('INSERT OR IGNORE INTO locations VALUES (?,?)').run('LOC-STORAGE', 'Storage');
  db.prepare('INSERT OR IGNORE INTO locations VALUES (?,?)').run('LOC-OUTDOORS', 'Outdoors');
  const join = `SELECT s.*, c.id AS catalogId,c.category,c.name,c.brand,c.subcategory,c.description,c.notes,c.photos,
    b.purchased_on,b.best_by,b.expires_on,f.nutrition,u.fuel_type
    FROM stock_units s JOIN purchase_batches b ON b.id=s.batch_id JOIN catalog_items c ON c.id=b.catalog_id
    LEFT JOIN food_details f ON f.catalog_id=c.id LEFT JOIN fuel_details u ON u.catalog_id=c.id`;
  function hydrate(row: Row): Stock {
    return {
      ...JSON.parse(row.detail as string),
      id: row.id,
      catalogId: row.catalogId,
      batchId: row.batch_id,
      category: row.category,
      name: row.name,
      brand: row.brand,
      subcategory: row.subcategory,
      description: row.description,
      notes: row.notes,
      quantity: row.quantity,
      unit: row.unit,
      locationId: row.location_id,
      containerId: row.container_id,
      purchasedOn: row.purchased_on,
      bestBy: row.best_by,
      expiresOn: row.expires_on,
      photoIds: JSON.parse(row.photos as string),
      nutrition: row.nutrition
        ? JSON.parse(row.nutrition as string)
        : stockInputSchema.parse({ name: 'defaults', category: 'food' }).nutrition,
      fuelType: row.fuel_type || 'propane',
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as Stock;
  }
  function all(): Stock[] {
    return (
      db.prepare(`${join} WHERE s.archived=0 ORDER BY s.created_at DESC,s.id`).all() as Row[]
    ).map(hydrate);
  }
  function get(stockId: string): Stock {
    const row = db.prepare(`${join} WHERE s.id=? AND s.archived=0`).get(stockId) as Row | undefined;
    if (!row) throw new AppError(404, 'Item not found');
    return hydrate(row);
  }
  function references(input: StockInput) {
    if (input.locationId && !db.prepare('SELECT 1 FROM locations WHERE id=?').get(input.locationId))
      throw new AppError(400, 'Location no longer exists');
    if (
      input.containerId &&
      !db.prepare('SELECT 1 FROM containers WHERE id=?').get(input.containerId)
    )
      throw new AppError(400, 'Container no longer exists');
    for (const photo of input.photoIds)
      if (!fs.existsSync(path.join(dataDir, 'uploads', photo)))
        throw new AppError(400, 'Photo no longer exists');
  }
  function insertUnit(input: StockInput, batchId: string): Stock {
    const stockId = id('ST'),
      now = new Date().toISOString();
    db.prepare(
      'INSERT INTO stock_units(id,batch_id,quantity,unit,location_id,container_id,detail,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(
      stockId,
      batchId,
      input.quantity,
      input.unit,
      input.locationId,
      input.containerId,
      JSON.stringify(input),
      now,
      now,
    );
    return get(stockId);
  }
  function log(before: Stock | null, after: Stock, action: string, note = '') {
    db.prepare(
      'INSERT INTO adjustments(stock_id,action,before_json,after_json,note,created_at) VALUES (?,?,?,?,?,?)',
    ).run(
      after.id,
      action,
      JSON.stringify(before),
      JSON.stringify(after),
      note,
      new Date().toISOString(),
    );
  }
  function create(input: StockInput): Stock {
    return db.transaction(() => {
      input = stockInputSchema.parse(input);
      references(input);
      const catalogId = id('CAT'),
        batchId = id('LOT');
      db.prepare('INSERT INTO catalog_items VALUES (?,?,?,?,?,?,?,?)').run(
        catalogId,
        input.category,
        input.name,
        input.brand,
        input.subcategory,
        input.description,
        input.notes,
        JSON.stringify(input.photoIds),
      );
      if (['food', 'dog'].includes(input.category))
        db.prepare('INSERT INTO food_details VALUES (?,?)').run(
          catalogId,
          JSON.stringify(input.nutrition),
        );
      if (input.category === 'fuel')
        db.prepare('INSERT INTO fuel_details VALUES (?,?)').run(catalogId, input.fuelType);
      db.prepare('INSERT INTO purchase_batches VALUES (?,?,?,?,?)').run(
        batchId,
        catalogId,
        input.purchasedOn,
        input.bestBy,
        input.expiresOn,
      );
      const stock = insertUnit(input, batchId);
      log(null, stock, 'create');
      return stock;
    })();
  }
  function checkVersion(before: Stock, version: number) {
    if (before.version !== version)
      throw new AppError(
        409,
        'This item changed on another device. Reload it before saving. Your form has been preserved.',
      );
  }
  function update(stockId: string, input: StockInput, version: number): Stock {
    return db.transaction(() => {
      const before = get(stockId);
      checkVersion(before, version);
      input = stockInputSchema.parse(input);
      references(input);
      if (input.category !== before.category)
        throw new AppError(400, 'An existing item cannot change its main category');
      db.prepare(
        'UPDATE catalog_items SET name=?,brand=?,subcategory=?,description=?,notes=?,photos=? WHERE id=?',
      ).run(
        input.name,
        input.brand,
        input.subcategory,
        input.description,
        input.notes,
        JSON.stringify(input.photoIds),
        before.catalogId,
      );
      if (['food', 'dog'].includes(input.category))
        db.prepare('UPDATE food_details SET nutrition=? WHERE catalog_id=?').run(
          JSON.stringify(input.nutrition),
          before.catalogId,
        );
      if (input.category === 'fuel')
        db.prepare('UPDATE fuel_details SET fuel_type=? WHERE catalog_id=?').run(
          input.fuelType,
          before.catalogId,
        );
      db.prepare(
        'UPDATE purchase_batches SET purchased_on=?,best_by=?,expires_on=? WHERE id=?',
      ).run(input.purchasedOn, input.bestBy, input.expiresOn, before.batchId);
      const now = new Date().toISOString();
      db.prepare(
        'UPDATE stock_units SET version=version+1,updated_at=? WHERE batch_id IN (SELECT id FROM purchase_batches WHERE catalog_id=?)',
      ).run(now, before.catalogId);
      db.prepare(
        'UPDATE stock_units SET quantity=?,unit=?,location_id=?,container_id=?,detail=? WHERE id=?',
      ).run(
        input.quantity,
        input.unit,
        input.locationId,
        input.containerId,
        JSON.stringify(input),
        stockId,
      );
      const after = get(stockId);
      log(before, after, 'edit');
      return after;
    })();
  }
  function action(
    stockId: string,
    version: number,
    actionName: string,
    args: {
      amount?: number;
      date?: string;
      locationId?: string | null;
      containerId?: string | null;
      note?: string;
    },
  ): Stock {
    return db.transaction(() => {
      const before = get(stockId);
      checkVersion(before, version);
      const next = { ...before };
      if (actionName === 'use') {
        if (before.quantity == null)
          throw new AppError(400, 'Set the remaining quantity before recording use');
        next.quantity = round(before.quantity - (args.amount || 0));
      } else if (actionName === 'refill') {
        if (before.quantity == null)
          throw new AppError(400, 'Set the remaining quantity before recording a refill');
        next.quantity = round(before.quantity + (args.amount || 0));
      } else if (actionName === 'correct') next.quantity = args.amount ?? null;
      else if (actionName === 'empty') next.quantity = 0;
      else if (actionName === 'rotate') {
        if (!args.date) throw new AppError(400, 'A rotation date is required');
        next.lastRotatedOn = args.date;
        next.rotationOn = null;
      } else if (actionName === 'move') {
        next.locationId = args.locationId ?? null;
        next.containerId = args.containerId ?? null;
      } else throw new AppError(400, 'Unknown inventory action');
      const parsed = stockInputSchema.parse(next);
      references(parsed);
      db.prepare(
        'UPDATE stock_units SET quantity=?,location_id=?,container_id=?,detail=?,version=version+1,updated_at=? WHERE id=?',
      ).run(
        parsed.quantity,
        parsed.locationId,
        parsed.containerId,
        JSON.stringify(parsed),
        new Date().toISOString(),
        stockId,
      );
      const after = get(stockId);
      log(before, after, actionName, args.note);
      return after;
    })();
  }
  function split(
    stockId: string,
    version: number,
    parts: { quantity: number; containerId: string | null; packaging: StockInput['packaging'] }[],
  ): Stock[] {
    return db.transaction(() => {
      const before = get(stockId);
      checkVersion(before, version);
      if (!['food', 'dog'].includes(before.category))
        throw new AppError(400, 'Split is available for food and dog food');
      if (before.quantity == null)
        throw new AppError(400, 'Set the batch quantity before splitting');
      const total = round(parts.reduce((a, p) => a + p.quantity, 0));
      if (total > before.quantity)
        throw new AppError(400, 'Split quantities exceed the available amount');
      const after = action(stockId, version, 'use', {
        amount: total,
        note: 'Split into containers; contents remain in inventory',
      });
      const children = parts.map((p) => {
        const input = stockInputSchema.parse({ ...before, ...p, capacity: null });
        references(input);
        const child = insertUnit(input, before.batchId);
        log(null, child, 'split', `From ${stockId}`);
        return child;
      });
      return [after, ...children];
    })();
  }
  function getSettings(): Settings {
    return settingsSchema.parse(
      JSON.parse(
        (db.prepare('SELECT json FROM settings WHERE id=1').get() as { json: string }).json,
      ),
    );
  }
  function saveSettings(next: Settings): Settings {
    return db.transaction(() => {
      const current = getSettings();
      if (next.version !== current.version)
        throw new AppError(409, 'Settings changed on another device. Reload before saving.');
      const parsed = settingsSchema.parse({ ...next, version: current.version + 1 });
      db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(parsed));
      return parsed;
    })();
  }
  function locations(): Location[] {
    return db.prepare('SELECT id,name FROM locations ORDER BY name').all() as Location[];
  }
  function containers(): Container[] {
    return db
      .prepare(
        'SELECT id,bucket_number AS bucketNumber,name,location_id AS locationId,capacity_gallons AS capacityGallons,version FROM containers ORDER BY bucket_number',
      )
      .all() as Container[];
  }
  function createContainer(
    input: Pick<Container, 'name' | 'locationId' | 'capacityGallons'>,
    containerId = id('BK'),
  ): Container {
    return db.transaction(() => {
      if (input.locationId && !locations().some((l) => l.id === input.locationId))
        throw new AppError(400, 'Location not found');
      const highest =
        (db.prepare('SELECT MAX(bucket_number) AS n FROM containers').get() as { n: number | null })
          .n || 0;
      const saved = Number(
        (
          db.prepare("SELECT value FROM meta WHERE key='last_bucket_number'").get() as
            { value: string } | undefined
        )?.value || 0,
      );
      const bucketNumber = Math.max(highest, saved) + 1;
      db.prepare(
        'INSERT INTO containers(id,bucket_number,name,location_id,capacity_gallons) VALUES (?,?,?,?,?)',
      ).run(containerId, bucketNumber, input.name, input.locationId, input.capacityGallons);
      db.prepare(
        "INSERT INTO meta(key,value) VALUES ('last_bucket_number',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(String(bucketNumber));
      return { ...input, id: containerId, bucketNumber, version: 1 };
    })();
  }
  function setupBuckets(locationId: string) {
    db.transaction(() => {
      const highest = Math.max(0, ...containers().map((c) => c.bucketNumber));
      const saved = Number(
        (
          db.prepare("SELECT value FROM meta WHERE key='last_bucket_number'").get() as
            { value: string } | undefined
        )?.value || 0,
      );
      for (let n = Math.max(highest, saved) + 1; n <= 12; n++)
        createContainer(
          { name: '', locationId, capacityGallons: 5 },
          `BK-${String(n).padStart(2, '0')}`,
        );
    })();
  }
  function reset() {
    db.transaction(() => {
      for (const table of [
        'adjustments',
        'reminder_outbox',
        'stock_units',
        'purchase_batches',
        'food_details',
        'fuel_details',
        'catalog_items',
        'containers',
        'locations',
        'settings',
        'meta',
      ])
        db.prepare(`DELETE FROM ${table}`).run();
      db.prepare('INSERT INTO settings VALUES (1,?)').run(
        JSON.stringify(
          settingsSchema.parse({ appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173' }),
        ),
      );
      db.prepare('INSERT INTO locations VALUES (?,?)').run('LOC-STORAGE', 'Storage');
      db.prepare('INSERT INTO locations VALUES (?,?)').run('LOC-OUTDOORS', 'Outdoors');
    })();
  }
  return {
    db,
    dataDir,
    all,
    get,
    create,
    update,
    action,
    split,
    getSettings,
    saveSettings,
    locations,
    containers,
    createContainer,
    setupBuckets,
    log,
    checkVersion,
    reset,
  };
}
export type Store = ReturnType<typeof openStore>;
