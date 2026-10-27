import nodemailer from 'nodemailer';
import { calculateDashboard, calendarDay, type Alert } from '../shared/model.ts';
import { AppError, type Store } from './db.ts';

export type MailJob = {
  id: string;
  subject: string;
  body: string;
  recipients: string;
  attempts: number;
};
export type MailSender = (job: MailJob) => Promise<void>;
export const smtpConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
export const smtpSend: MailSender = async (job) => {
  if (!smtpConfigured())
    throw new AppError(503, 'Configure SMTP_HOST and SMTP_FROM in .env before sending email');
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: JSON.parse(job.recipients),
      subject: job.subject,
      text: job.body,
    });
  } finally {
    transport.close();
  }
};
export function alertThreshold(alert: Alert): number | null {
  if (alert.type === 'setup' || !alert.notify) return null;
  if (alert.type === 'low_stock') return -1;
  return (
    [...alert.leadDays].sort((a, b) => a - b).find((n) => alert.days != null && alert.days <= n) ??
    null
  );
}
export function queueReminders(store: Store, now = new Date()) {
  const settings = store.getSettings();
  if (!settings.recipients.length) {
    store.db.prepare("UPDATE reminder_outbox SET status='cancelled' WHERE status='pending'").run();
    return;
  }
  const day = calendarDay(now, settings.timezone);
  const dashboard = calculateDashboard(store.all(), settings, now);
  const insert = (key: string, subject: string, body: string) =>
    store.db
      .prepare(
        `INSERT INTO reminder_outbox(id,subject,body,recipients,next_attempt,created_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET status='pending',attempts=0,subject=excluded.subject,body=excluded.body,recipients=excluded.recipients,next_attempt=excluded.next_attempt,error=NULL WHERE reminder_outbox.status='cancelled'`,
      )
      .run(
        key,
        subject,
        body,
        JSON.stringify(settings.recipients),
        now.toISOString(),
        now.toISOString(),
      );
  const format = (alert: Alert) =>
    `${alert.highPriority ? '[Priority] ' : ''}${alert.name}: ${alert.message}`;
  const alertKeys = new Set<string>();
  const liveJobs = new Set<string>();
  store.db.transaction(() => {
    if (settings.emailAlerts)
      for (const alert of dashboard.alerts) {
        const threshold = alertThreshold(alert);
        if (threshold == null) continue;
        let key = `alert:${alert.key}:${threshold}`;
        if (alert.type === 'low_stock') {
          const episodeKey = `low:${alert.key}`;
          let episode = store.db.prepare('SELECT value FROM meta WHERE key=?').get(episodeKey) as
            { value: string } | undefined;
          if (!episode) {
            episode = { value: now.toISOString() };
            store.db.prepare('INSERT INTO meta VALUES (?,?)').run(episodeKey, episode.value);
          }
          key += `:${episode.value}`;
          alertKeys.add(episodeKey);
        }
        liveJobs.add(key);
        insert(
          key,
          `Haven · ${alert.name}`,
          `${format(alert)}\n\nOpen your inventory: ${settings.appBaseUrl}`,
        );
      }
    for (const row of store.db.prepare("SELECT key FROM meta WHERE key LIKE 'low:%'").all() as {
      key: string;
    }[])
      if (!alertKeys.has(row.key)) store.db.prepare('DELETE FROM meta WHERE key=?').run(row.key);
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: settings.timezone,
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(now),
    );
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const due =
      hour >= 9 &&
      ((settings.digest === 'weekly' && weekday === 1) ||
        (settings.digest === 'monthly' && day.endsWith('-01')));
    if (due) {
      const alerts = dashboard.alerts.filter((a) => a.type !== 'setup');
      const cov = (key: 'food' | 'water' | 'dog' | 'fuel') =>
        `${key}: ${dashboard[key].days == null ? 'needs setup / utility dependent' : `${Math.floor(dashboard[key].days!)} days`} (goal ${settings.targets[key]})`;
      insert(
        `digest:${settings.digest}:${day}`,
        'Haven · Your preparedness summary',
        `${settings.householdName}\n${['food', 'water', 'fuel', 'dog'].map((k) => cov(k as 'food')).join('\n')}\n\n${alerts.length ? alerts.map(format).join('\n') : 'No upcoming dates or low-stock items.'}\n\n${settings.appBaseUrl}`,
      );
    }
    for (const job of store.db
      .prepare("SELECT id FROM reminder_outbox WHERE status='pending'")
      .all() as { id: string }[]) {
      const active = job.id.startsWith('alert:')
        ? liveJobs.has(job.id)
        : job.id.startsWith(`digest:${settings.digest}:`) && settings.digest !== 'off';
      if (!active)
        store.db.prepare("UPDATE reminder_outbox SET status='cancelled' WHERE id=?").run(job.id);
      else
        store.db
          .prepare('UPDATE reminder_outbox SET recipients=? WHERE id=?')
          .run(JSON.stringify(settings.recipients), job.id);
    }
  })();
}
export async function deliverPending(
  store: Store,
  sender: MailSender = smtpSend,
  now = new Date(),
) {
  const jobs = store.db
    .prepare(
      "SELECT * FROM reminder_outbox WHERE status='pending' AND next_attempt<=? ORDER BY created_at LIMIT 10",
    )
    .all(now.toISOString()) as MailJob[];
  for (const job of jobs) {
    try {
      await sender(job);
      store.db
        .prepare(
          "UPDATE reminder_outbox SET status='sent',sent_at=?,attempts=attempts+1,error=NULL WHERE id=?",
        )
        .run(now.toISOString(), job.id);
    } catch {
      const attempts = job.attempts + 1;
      store.db
        .prepare('UPDATE reminder_outbox SET status=?,attempts=?,next_attempt=?,error=? WHERE id=?')
        .run(
          attempts >= 8 ? 'failed' : 'pending',
          attempts,
          new Date(now.getTime() + Math.min(360, 2 ** attempts) * 60000).toISOString(),
          'Delivery failed. Check SMTP configuration and network access.',
          job.id,
        );
    }
  }
}
export function startScheduler(store: Store) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      queueReminders(store);
      if (smtpConfigured()) await deliverPending(store);
    } catch (err) {
      console.error('Reminder scheduler:', err instanceof Error ? err.message : 'failed');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 60000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
