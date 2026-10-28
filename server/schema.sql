-- Disposable prototype schema. Reset and reseed instead of maintaining migrations.
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY, bucket_number INTEGER NOT NULL UNIQUE CHECK(bucket_number>0),
  name TEXT NOT NULL, location_id TEXT REFERENCES locations(id),
  capacity_gallons REAL NOT NULL CHECK(capacity_gallons>0), version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS catalog_items (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL, brand TEXT NOT NULL,
  subcategory TEXT NOT NULL, description TEXT NOT NULL, notes TEXT NOT NULL, photos TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS food_details (catalog_id TEXT PRIMARY KEY REFERENCES catalog_items(id), nutrition TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fuel_details (catalog_id TEXT PRIMARY KEY REFERENCES catalog_items(id), fuel_type TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS purchase_batches (
  id TEXT PRIMARY KEY, catalog_id TEXT NOT NULL REFERENCES catalog_items(id),
  purchased_on TEXT, best_by TEXT, expires_on TEXT
);
CREATE TABLE IF NOT EXISTS stock_units (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES purchase_batches(id),
  quantity REAL CHECK(quantity IS NULL OR quantity>=0), unit TEXT NOT NULL,
  location_id TEXT REFERENCES locations(id), container_id TEXT REFERENCES containers(id),
  detail TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS stock_batch ON stock_units(batch_id);
CREATE TABLE IF NOT EXISTS adjustments (
  id INTEGER PRIMARY KEY, stock_id TEXT NOT NULL REFERENCES stock_units(id),
  action TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
  note TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminder_outbox (
  id TEXT PRIMARY KEY, subject TEXT NOT NULL, body TEXT NOT NULL, recipients TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt TEXT NOT NULL, created_at TEXT NOT NULL, sent_at TEXT, error TEXT
);
PRAGMA user_version=2;
