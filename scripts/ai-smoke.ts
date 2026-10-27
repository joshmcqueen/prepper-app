// Explicit opt-in live check. Uses synthetic facts only; never prints credentials.
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import OpenAI from 'openai';

const base = `http${process.env.TLS_CERT ? 's' : ''}://localhost:${process.env.PORT || 3001}`;
async function post(route: string, body: unknown) {
  const response = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error('Live endpoint failed'), {
      status: response.status,
      endpoint: route,
    });
  return result;
}
try {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing');
  const api = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60000 });
  for (const model of [
    process.env.OPENAI_MODEL || 'gpt-6-luna',
    process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-transcribe',
  ]) {
    try {
      await api.models.retrieve(model);
      console.log(`Model access confirmed: ${model}`);
    } catch (error) {
      const e = error as { status?: number; code?: string };
      console.log(JSON.stringify({ check: 'model access', model, status: e.status, code: e.code }));
    }
  }
  const svg = `<svg width="1000" height="900" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial" font-size="40"><text x="60" y="90">SAMPLE JASMINE RICE</text><text x="60" y="160">Brand: Test Pantry</text><text x="60" y="230">Net weight: 20 lb</text><text x="60" y="300">Best by: 2030-12-31</text><text x="60" y="390">Nutrition facts per 45 g serving</text><text x="60" y="460">Calories 160</text><text x="60" y="530">Protein 3 g</text><text x="60" y="600">Carbohydrate 36 g</text><text x="60" y="670">Fat 0 g</text></g></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const upload = new FormData();
  upload.append(
    'photo',
    new Blob([new Uint8Array(png)], { type: 'image/png' }),
    'synthetic-label.png',
  );
  const photo = await post('/api/photos', upload);
  const draft = await post('/api/ai/draft', {
    photoIds: [photo.id],
    text: 'Extract this synthetic test label. Purchase date is not recorded.',
    mode: 'extract',
  });
  console.log(
    JSON.stringify({
      check: 'photo extraction',
      quantity: draft.quantity,
      unit: draft.unit,
      bestBy: draft.bestBy,
      purchasedOn: draft.purchasedOn,
      nutrition: draft.nutrition,
    }),
  );
  if (
    draft.quantity !== 20 ||
    draft.bestBy !== '2030-12-31' ||
    draft.purchasedOn != null ||
    draft.nutrition.calories !== 160
  )
    throw new Error('Photo extraction did not match the synthetic fixture');
  const wav = path.resolve('.local/live-check/dictation.wav');
  const audio = new FormData();
  audio.append(
    'audio',
    new Blob([new Uint8Array(await fs.readFile(wav))], { type: 'audio/wav' }),
    'dictation.wav',
  );
  const transcript = await post('/api/ai/transcribe', audio);
  console.log(JSON.stringify({ check: 'synthetic speech transcription', text: transcript.text }));
  if (!/rice/i.test(transcript.text))
    throw new Error('Transcription did not include the synthetic item');
  console.log('Live AI checks passed. No inventory records were created.');
} catch (error) {
  const e = error as { status?: number; code?: string; endpoint?: string };
  console.error(
    JSON.stringify({
      check: 'live AI',
      result: 'failed',
      status: e.status,
      code: e.code,
      endpoint: e.endpoint,
    }),
  );
  process.exitCode = 1;
}
