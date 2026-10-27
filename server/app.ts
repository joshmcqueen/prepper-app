import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z, ZodError } from 'zod';
import {
  stockInputSchema,
  settingsSchema,
  calculateDashboard,
  type Settings,
} from '../shared/model.ts';
import { AppError, id, openStore, type Store } from './db.ts';
import { containerLabel, labelExcel, labelPdf, labelPng, stockLabel } from './labels.ts';
import { extractDraft, transcribe } from './ai.ts';
import { createBackup } from './backup.ts';
import { smtpConfigured, smtpSend } from './reminders.ts';
import { seedDemo } from './seed.ts';

const identity = z.string().min(1).max(100);
const paramsSchema = z.object({ id: identity });
const versionSchema = z.number().int().positive();
export async function buildApp(options: {
  dataDir: string;
  store?: Store;
  logger?: boolean;
  https?: { key: Buffer; cert: Buffer };
}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
    ...(options.https ? { https: options.https } : {}),
  });
  const store = options.store || openStore(options.dataDir);
  app.addHook('onClose', async () => {
    if (!options.store) store.db.close();
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: error.issues
          .map((issue) => `${issue.path.join('.') || 'Input'}: ${issue.message}`)
          .join('; '),
      });
    const status = (error as { statusCode?: number }).statusCode || 500;
    if (status >= 500 && !(error instanceof AppError)) {
      app.log.error(error);
      return reply.code(status).send({
        error: 'The request could not be completed. Your input is preserved. Please try again.',
      });
    }
    return reply.code(status).send({ error: (error as Error).message });
  });
  app.addHook('onRequest', async (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin) {
      const origin = new URL(request.headers.origin);
      if (origin.host !== request.headers.host && origin.origin !== store.getSettings().appBaseUrl)
        throw new AppError(403, 'This request must come from the app');
    }
  });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 2 } });
  await app.register(staticFiles, {
    root: path.join(store.dataDir, 'uploads'),
    prefix: '/uploads/',
    decorateReply: false,
    maxAge: '1d',
  });
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/state', async () => {
    const stocks = store.all(),
      settings = store.getSettings();
    return {
      stocks,
      settings,
      dashboard: calculateDashboard(stocks, settings),
      locations: store.locations(),
      containers: store.containers(),
      demo: !!store.db.prepare("SELECT 1 FROM meta WHERE key='demo'").get(),
      setup: {
        water: !!store.db.prepare("SELECT 1 FROM meta WHERE key='setup_water'").get(),
        buckets: !!store.db.prepare("SELECT 1 FROM meta WHERE key='setup_buckets'").get(),
      },
      integrations: { ai: !!process.env.OPENAI_API_KEY, email: smtpConfigured() },
      deliveries: store.db
        .prepare(
          'SELECT id,subject,status,attempts,created_at AS createdAt,sent_at AS sentAt,error FROM reminder_outbox ORDER BY created_at DESC LIMIT 30',
        )
        .all(),
    };
  });
  app.get('/api/stocks/:id', async (req) => store.get(paramsSchema.parse(req.params).id));
  app.get('/api/stocks/:id/history', async (req) => {
    const stock = store.get(paramsSchema.parse(req.params).id);
    return store.db
      .prepare(
        'SELECT action,note,created_at AS createdAt,before_json AS beforeJson,after_json AS afterJson FROM adjustments WHERE stock_id=? ORDER BY id DESC LIMIT 100',
      )
      .all(stock.id);
  });
  app.post('/api/stocks', async (req, reply) => {
    const stock = store.create(stockInputSchema.parse(req.body));
    return reply.code(201).send(stock);
  });
  app.put('/api/stocks/:id', async (req) => {
    const version = z.object({ version: versionSchema }).parse(req.body).version;
    return store.update(
      paramsSchema.parse(req.params).id,
      stockInputSchema.parse(req.body),
      version,
    );
  });
  app.delete('/api/stocks/:id', async (req) => {
    const { version } = z.object({ version: versionSchema }).parse(req.body);
    return store.db.transaction(() => {
      const stock = store.get(paramsSchema.parse(req.params).id);
      store.checkVersion(stock, version);
      store.log(stock, stock, 'archive');
      store.db
        .prepare('UPDATE stock_units SET archived=1,version=version+1 WHERE id=?')
        .run(stock.id);
      return { ok: true };
    })();
  });
  app.post('/api/stocks/:id/actions', async (req) => {
    const args = z
      .object({
        version: versionSchema,
        action: z.enum(['use', 'refill', 'correct', 'empty', 'rotate', 'move']),
        amount: z.number().finite().min(0).max(1e12).optional(),
        date: stockInputSchema.shape.lastRotatedOn.optional(),
        locationId: identity.nullable().optional(),
        containerId: identity.nullable().optional(),
        note: z.string().max(1000).optional(),
      })
      .parse(req.body);
    if (['use', 'refill'].includes(args.action) && (!args.amount || args.amount <= 0))
      throw new AppError(400, 'Enter a positive amount');
    return store.action(paramsSchema.parse(req.params).id, args.version, args.action, {
      ...args,
      date: args.date ?? undefined,
    });
  });
  app.post('/api/stocks/:id/split', async (req) => {
    const body = z
      .object({
        version: versionSchema,
        parts: z
          .array(
            z.object({
              quantity: z.number().finite().positive().max(1e12),
              containerId: identity.nullable(),
              packaging: stockInputSchema.shape.packaging,
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(req.body);
    return store.split(paramsSchema.parse(req.params).id, body.version, body.parts);
  });
  app.put('/api/settings', async (req) => store.saveSettings(settingsSchema.parse(req.body)));
  let resetting = false;
  app.post('/api/database/reset', async (req) => {
    const { mode } = z
      .object({ mode: z.enum(['empty', 'demo']), confirmation: z.literal('RESET') })
      .parse(req.body);
    if (resetting) throw new AppError(409, 'A reset is already in progress');
    resetting = true;
    try {
      store.reset();
      for (const photo of fs.readdirSync(path.join(store.dataDir, 'uploads')))
        if (/^[a-f0-9-]+\.webp$/.test(photo))
          fs.unlinkSync(path.join(store.dataDir, 'uploads', photo));
      if (mode === 'demo') await seedDemo(store);
      return { ok: true, mode };
    } finally {
      resetting = false;
    }
  });
  app.post('/api/locations', async (req, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    if (store.locations().some((l) => l.name.toLowerCase() === name.toLowerCase()))
      throw new AppError(409, 'A location with that name already exists');
    const location = { id: id('LOC'), name };
    store.db.prepare('INSERT INTO locations VALUES (?,?)').run(location.id, name);
    return reply.code(201).send(location);
  });
  app.put('/api/locations/:id', async (req) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    const locationId = paramsSchema.parse(req.params).id;
    if (!store.locations().some((l) => l.id === locationId))
      throw new AppError(404, 'Location not found');
    if (
      store
        .locations()
        .some((l) => l.id !== locationId && l.name.toLowerCase() === name.toLowerCase())
    )
      throw new AppError(409, 'A location with that name already exists');
    store.db.prepare('UPDATE locations SET name=? WHERE id=?').run(name, locationId);
    return { id: locationId, name };
  });
  const containerSchema = z.object({
    name: z.string().trim().min(1).max(100),
    locationId: identity.nullable(),
    capacityGallons: z.number().positive().max(10000),
  });
  app.post('/api/containers', async (req) => {
    const c = containerSchema.parse(req.body);
    if (c.locationId && !store.locations().some((l) => l.id === c.locationId))
      throw new AppError(400, 'Location not found');
    const containerId = id('BK');
    store.db
      .prepare('INSERT INTO containers(id,name,location_id,capacity_gallons) VALUES (?,?,?,?)')
      .run(containerId, c.name, c.locationId, c.capacityGallons);
    return { ...c, id: containerId, version: 1 };
  });
  app.put('/api/containers/:id', async (req) => {
    const c = containerSchema.extend({ version: versionSchema }).parse(req.body);
    const containerId = paramsSchema.parse(req.params).id;
    if (c.locationId && !store.locations().some((l) => l.id === c.locationId))
      throw new AppError(400, 'Location not found');
    const old = store.containers().find((b) => b.id === containerId);
    if (!old) throw new AppError(404, 'Container not found');
    if (old.version !== c.version)
      throw new AppError(409, 'This container changed. Reload before saving.');
    store.db
      .prepare(
        'UPDATE containers SET name=?,location_id=?,capacity_gallons=?,version=version+1 WHERE id=?',
      )
      .run(c.name, c.locationId, c.capacityGallons, containerId);
    return { ...c, id: containerId, version: c.version + 1 };
  });
  app.post('/api/setup', async (req) => {
    const { water, buckets } = z
      .object({ water: z.boolean().default(false), buckets: z.boolean().default(false) })
      .parse(req.body);
    return store.db.transaction(() => {
      if (water && !store.db.prepare("SELECT 1 FROM meta WHERE key='setup_water'").get()) {
        for (let n = 1; n <= 6; n++)
          store.create(
            stockInputSchema.parse({
              category: 'water',
              name: `Sealed water jug ${n}`,
              quantity: 5,
              capacity: 5,
              unit: 'gallon',
              packaging: 'jug',
              rotationMonths: 12,
              locationId: 'LOC-STORAGE',
            }),
          );
        store.create(
          stockInputSchema.parse({
            category: 'water',
            name: 'Outdoor water tank',
            quantity: 200,
            capacity: 200,
            unit: 'gallon',
            packaging: 'tank',
            rotationMonths: 6,
            locationId: 'LOC-OUTDOORS',
          }),
        );
        store.db.prepare("INSERT INTO meta VALUES ('setup_water','1')").run();
      }
      if (buckets && !store.db.prepare("SELECT 1 FROM meta WHERE key='setup_buckets'").get()) {
        for (let n = 1; n <= 12; n++)
          store.db
            .prepare(
              'INSERT INTO containers(id,name,location_id,capacity_gallons) VALUES (?,?,?,5)',
            )
            .run(
              `BK-${String(n).padStart(2, '0')}`,
              `Bucket ${String(n).padStart(2, '0')}`,
              'LOC-STORAGE',
            );
        store.db.prepare("INSERT INTO meta VALUES ('setup_buckets','1')").run();
      }
      return { ok: true };
    })();
  });
  app.post('/api/photos', async (req) => {
    const file = await req.file();
    if (
      !file ||
      !['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.mimetype)
    )
      throw new AppError(400, 'Choose a JPEG, PNG, WebP, or supported camera photo');
    const buffer = await file.toBuffer();
    const photoId = `${randomUUID()}.webp`;
    try {
      await sharp(buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(1800, 1800, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(path.join(store.dataDir, 'uploads', photoId));
    } catch {
      throw new AppError(400, 'This photo could not be decoded. Try a JPEG or PNG export.');
    }
    return { id: photoId };
  });
  app.post('/api/ai/draft', async (req) => {
    const input = z
      .object({
        text: z.string().max(20000).default(''),
        photoIds: stockInputSchema.shape.photoIds,
        mode: z.enum(['extract', 'description']).default('extract'),
      })
      .parse(req.body);
    for (const photo of input.photoIds)
      if (!fs.existsSync(path.join(store.dataDir, 'uploads', photo)))
        throw new AppError(400, 'Photo not found');
    try {
      return await extractDraft(store.dataDir, input);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        'AI request failed. Check your API key, model access, and connection. Your input is preserved.',
      );
    }
  });
  app.post('/api/ai/transcribe', async (req) => {
    const file = await req.file();
    if (!file || !/^(audio\/|video\/mp4|video\/webm)/.test(file.mimetype))
      throw new AppError(400, 'Choose a supported audio recording');
    const audio = await file.toBuffer();
    try {
      return await transcribe(audio, file.filename);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'Transcription failed. Retry or type your notes.');
    }
  });
  app.get('/api/labels/preview', async (req, reply) => {
    const q = z
      .object({ stockId: identity.optional(), containerId: identity.optional() })
      .parse(req.query);
    const settings = store.getSettings();
    const container = store.containers().find((c) => c.id === q.containerId);
    const label = q.stockId
      ? stockLabel(store.get(q.stockId), settings)
      : container
        ? containerLabel(container, settings)
        : null;
    if (!label) throw new AppError(404, 'Label item not found');
    reply.header('Cache-Control', 'no-store');
    return reply.type('image/png').send(await labelPng(label, settings));
  });
  app.post('/api/labels/export', async (req, reply) => {
    const body = z
      .object({
        ids: z.array(identity).max(100).default([]),
        containerIds: z.array(identity).max(100).default([]),
        format: z.enum(['png', 'pdf', 'xlsx']),
      })
      .parse(req.body);
    if (
      body.ids.length + body.containerIds.length < 1 ||
      body.ids.length + body.containerIds.length > 100
    )
      throw new AppError(400, 'Select between 1 and 100 labels');
    const settings = store.getSettings();
    const containers = store.containers();
    const labels = [
      ...body.ids.map((stockId) => stockLabel(store.get(stockId), settings)),
      ...body.containerIds.map((cId) => {
        const c = containers.find((c) => c.id === cId);
        if (!c) throw new AppError(404, 'Container not found');
        return containerLabel(c, settings);
      }),
    ];
    if (body.format === 'png' && labels.length !== 1)
      throw new AppError(400, 'Select one label for an individual PNG export');
    reply.header('Content-Disposition', `attachment; filename="haven-labels.${body.format}"`);
    if (body.format === 'png')
      return reply.type('image/png').send(await labelPng(labels[0], settings));
    if (body.format === 'pdf')
      return reply.type('application/pdf').send(Buffer.from(await labelPdf(labels, settings)));
    return reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .send(await labelExcel(labels));
  });
  app.post('/api/email/test', async (req) => {
    const { recipients } = z
      .object({ recipients: z.array(z.email()).min(1).max(10) })
      .parse(req.body);
    await smtpSend({
      id: 'test',
      subject: 'Haven · Your email is connected',
      body: 'Your household inventory can send reminders to this address.',
      recipients: JSON.stringify(recipients),
      attempts: 0,
    });
    return { ok: true };
  });
  app.post('/api/email/:id/retry', async (req) => {
    const jobId = paramsSchema.parse(req.params).id;
    const result = store.db
      .prepare(
        "UPDATE reminder_outbox SET status='pending',attempts=0,next_attempt=?,error=NULL WHERE id=? AND status='failed'",
      )
      .run(new Date().toISOString(), jobId);
    if (!result.changes) throw new AppError(400, 'Only failed deliveries can be retried');
    return { ok: true };
  });
  app.get('/api/backup', async (_req, reply) => {
    const backup = await createBackup(store);
    const stream = fs.createReadStream(backup.file);
    stream.on('close', () => void backup.cleanup());
    return reply
      .header(
        'Content-Disposition',
        `attachment; filename="haven-backup-${new Date().toISOString().slice(0, 10)}.zip"`,
      )
      .type('application/zip')
      .send(stream);
  });
  const dist = path.resolve('dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    await app.register(staticFiles, { root: dist, wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') || req.url.startsWith('/uploads/')
        ? reply.code(404).send({ error: 'Not found' })
        : reply.sendFile('index.html'),
    );
  }
  return { app, store };
}
