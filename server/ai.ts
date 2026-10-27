import OpenAI, { toFile } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError } from './db.ts';
import { unitSchema } from '../shared/model.ts';

const nullableText = z.string().nullable();
const nullableNumber = z.number().nonnegative().nullable();
export const draftSchema = z.object({
  name: nullableText,
  brand: nullableText,
  description: nullableText,
  notes: nullableText,
  quantity: nullableNumber,
  unit: unitSchema.nullable(),
  purchasedOn: nullableText,
  bestBy: nullableText,
  expiresOn: nullableText,
  nutrition: z.object({
    servingSize: nullableNumber,
    servingUnit: unitSchema.nullable(),
    calories: nullableNumber,
    protein: nullableNumber,
    carbs: nullableNumber,
    fat: nullableNumber,
  }),
  reviewNotes: z.array(z.string()),
});
function client() {
  if (!process.env.OPENAI_API_KEY)
    throw new AppError(
      503,
      'AI is not configured yet. Add OPENAI_API_KEY to .env. You can keep entering items manually.',
    );
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60000 });
}
const prompt = (name: string) =>
  fs.readFile(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8');
export async function extractDraft(
  dataDir: string,
  input: { text: string; photoIds: string[]; mode: 'extract' | 'description' },
) {
  const api = client();
  const images = await Promise.all(
    input.photoIds.map(async (photo) => ({
      type: 'input_image' as const,
      image_url: `data:image/webp;base64,${(await fs.readFile(path.join(dataDir, 'uploads', photo))).toString('base64')}`,
      detail: 'high' as const,
    })),
  );
  const response = await api.responses.parse({
    model: process.env.OPENAI_MODEL || 'gpt-6-luna',
    store: false,
    input: [
      { role: 'system', content: await prompt(input.mode) },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: input.text || 'Extract the visible inventory facts.' },
          ...images,
        ],
      },
    ],
    text: { format: zodTextFormat(draftSchema, 'inventory_draft') },
  });
  if (!response.output_parsed)
    throw new AppError(
      502,
      'AI could not produce a readable draft. Your input is preserved; retry or enter it manually.',
    );
  return response.output_parsed;
}
export async function transcribe(buffer: Buffer, filename: string) {
  const api = client();
  const response = await api.audio.transcriptions.create({
    file: await toFile(buffer, filename),
    model: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-transcribe',
    prompt: await prompt('transcription'),
  });
  return { text: response.text };
}
