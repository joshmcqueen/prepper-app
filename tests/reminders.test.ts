import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore, type Store } from '../server/db.ts';
import { stockInputSchema } from '../shared/model.ts';
import { deliverPending, queueReminders, type MailJob } from '../server/reminders.ts';
describe('persistent reminder delivery', () => {
  let store: Store, temp: string;
  const monday = new Date('2026-10-26T17:00:00Z');
  beforeEach(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'haven-mail-'));
    store = openStore(temp);
    store.saveSettings({
      ...store.getSettings(),
      recipients: ['test@example.invalid'],
      digest: 'weekly',
    });
  });
  afterEach(async () => {
    store.db.close();
    await fs.rm(temp, { recursive: true, force: true });
  });
  const jobs = () =>
    store.db.prepare('SELECT * FROM reminder_outbox').all() as (MailJob & { status: string })[];
  const add = (extra = {}) =>
    store.create(
      stockInputSchema.parse({
        category: 'supplies',
        name: 'Important item',
        quantity: 10,
        unit: 'count',
        expiresOn: '2026-11-15',
        ...extra,
      }),
    );
  it('queues weekly summaries after 9 a.m. local time and deduplicates across a restart', async () => {
    queueReminders(store, new Date('2026-10-26T15:00:00Z'));
    expect(jobs()).toHaveLength(0);
    queueReminders(store, monday);
    queueReminders(store, monday);
    expect(jobs()).toHaveLength(1);
    store.db.close();
    store = openStore(temp);
    queueReminders(store, monday);
    expect(jobs()).toHaveLength(1);
    const sent: string[] = [];
    await deliverPending(
      store,
      async (job) => {
        sent.push(job.id);
      },
      monday,
    );
    await deliverPending(
      store,
      async (job) => {
        sent.push(job.id);
      },
      monday,
    );
    expect(sent).toHaveLength(1);
    expect(jobs()[0].status).toBe('sent');
  });
  it('sends monthly summaries only on the first and uses the configured timezone', () => {
    store.saveSettings({ ...store.getSettings(), digest: 'monthly' });
    queueReminders(store, monday);
    expect(jobs()).toHaveLength(0);
    queueReminders(store, new Date('2026-11-01T18:00:00Z'));
    expect(jobs()).toHaveLength(1);
  });
  it('honors priority, lead overrides, per-item switches and snoozes', () => {
    store.saveSettings({ ...store.getSettings(), digest: 'off' });
    add({ expiresOn: '2026-12-20', highPriority: true });
    add({ expiresOn: '2026-12-20', highPriority: false });
    add({ notify: false });
    add({ snoozedUntil: '2026-11-01' });
    add({ leadDays: 7 });
    queueReminders(store, monday);
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0].id).toContain(':90');
  });
  it('cancels pending alerts after snoozing and can requeue when the snooze ends', () => {
    store.saveSettings({ ...store.getSettings(), digest: 'off' });
    const item = add();
    queueReminders(store, monday);
    expect(jobs()[0].status).toBe('pending');
    store.update(item.id, { ...item, snoozedUntil: '2026-11-01' }, item.version);
    queueReminders(store, monday);
    expect(jobs()[0].status).toBe('cancelled');
    queueReminders(store, new Date('2026-11-01T18:00:00Z'));
    expect(jobs().filter((j) => j.status === 'pending')).toHaveLength(1);
  });
  it('retries with backoff and persists failures instead of spamming', async () => {
    store.saveSettings({ ...store.getSettings(), digest: 'off' });
    add();
    queueReminders(store, monday);
    let calls = 0;
    const fail = async () => {
      calls++;
      throw new Error('offline');
    };
    await deliverPending(store, fail, monday);
    await deliverPending(store, fail, monday);
    expect(calls).toBe(1);
    expect(jobs()[0].attempts).toBe(1);
    await deliverPending(
      store,
      async () => {
        calls++;
      },
      new Date(monday.getTime() + 3 * 60000),
    );
    expect(jobs()[0].status).toBe('sent');
    expect(calls).toBe(2);
  });
  it('starts a new low-stock episode only after stock recovers', () => {
    store.saveSettings({ ...store.getSettings(), digest: 'off' });
    const item = add({ expiresOn: null, minimum: 20 });
    queueReminders(store, monday);
    queueReminders(store, monday);
    expect(jobs()).toHaveLength(1);
    const recovered = store.action(item.id, item.version, 'refill', { amount: 20 });
    queueReminders(store, new Date(monday.getTime() + 60000));
    store.action(item.id, recovered.version, 'use', { amount: 25 });
    queueReminders(store, new Date(monday.getTime() + 120000));
    expect(jobs()).toHaveLength(2);
  });
  it('cancels deliveries if recipients are removed', () => {
    add();
    queueReminders(store, monday);
    store.saveSettings({ ...store.getSettings(), recipients: [] });
    queueReminders(store, monday);
    expect(jobs().every((j) => j.status === 'cancelled')).toBe(true);
  });
});
