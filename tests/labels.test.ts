import { expect, it } from 'vitest';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { containerLabel, labelPng, stockLabel } from '../server/labels.ts';
import { settingsSchema, stockInputSchema, type Stock } from '../shared/model.ts';

it.each([
  [50, 80],
  [50, 50],
  [40, 30],
  [20, 20],
])('exports a decodable QR at %s × %s mm', async (labelWidth, labelHeight) => {
  const settings = settingsSchema.parse({ labelWidth, labelHeight });
  const stock: Stock = {
    ...stockInputSchema.parse({
      category: 'food',
      name: 'Rice & beans <test>',
      quantity: 4,
      unit: 'lb',
    }),
    id: 'ST-12345678',
    batchId: 'LOT-TEST',
    catalogId: 'CAT-TEST',
    version: 1,
    createdAt: '',
    updatedAt: '',
  };
  const label = stockLabel(stock, settings);
  const png = await labelPng(label, settings);
  const pixels = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(pixels.info.width).toBe(Math.round((labelWidth / 25.4) * 203));
  expect(
    jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height)?.data,
  ).toBe(label.url);
});

it.each([
  [50, 80],
  [50, 50],
  [40, 30],
  [20, 20],
])('exports a decodable permanent bucket label at %s × %s mm', async (labelWidth, labelHeight) => {
  const settings = settingsSchema.parse({ labelWidth, labelHeight });
  const container = {
    id: 'BK-ABCDEF12',
    bucketNumber: 4,
    name: 'Breakfast',
    locationId: null,
    capacityGallons: 5,
    version: 1,
  };
  const label = containerLabel(container, settings);
  expect(label.bucketNumber).toBe('04');
  const png = await labelPng(label, settings);
  const pixels = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(
    jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height)?.data,
  ).toBe(`${settings.appBaseUrl}/container/BK-ABCDEF12`);
  expect(
    containerLabel({ ...container, name: 'New contents', locationId: 'LOC-CLOSET' }, settings).url,
  ).toBe(label.url);
});
