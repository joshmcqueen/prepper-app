import sharp from 'sharp';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { bucketName, bucketNumberLabel, type Container, type Settings } from '../shared/model.ts';

type Label = {
  bucketNumber: string;
  id: string;
  name: string;
  capacity: string;
  url: string;
};
export function containerLabel(container: Container, settings: Settings): Label {
  return {
    bucketNumber: bucketNumberLabel(container),
    id: container.id,
    name: bucketName(container),
    capacity: `${container.capacityGallons}-gallon bucket`,
    url: `${settings.appBaseUrl.replace(/\/$/, '')}/container/${container.id}`,
  };
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export async function labelPng(label: Label, settings: Settings): Promise<Buffer> {
  const w = Math.round((settings.labelWidth / 25.4) * 203),
    h = Math.round((settings.labelHeight / 25.4) * 203);
  if (w < 280 || h < 320) {
    const size = Math.min(w - 24, h - 49);
    const qr = await QRCode.toBuffer(label.url, {
      width: size,
      margin: 4,
      errorCorrectionLevel: 'M',
    });
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial,sans-serif" text-anchor="middle"><text x="${w / 2}" y="20" font-size="18" font-weight="bold">BUCKET ${escape(label.bucketNumber)}</text><text x="${w / 2}" y="${h - 7}" font-size="10">${escape(label.id)}</text></g></svg>`;
    return sharp(Buffer.from(svg))
      .composite([{ input: qr, top: 26, left: Math.floor((w - size) / 2) }])
      .png()
      .withMetadata({ density: 203 })
      .toBuffer();
  }
  const headingFont = Math.max(12, Math.min(28, Math.floor(w / 14)));
  const numberFont = Math.floor(
    Math.min(132, w * 0.32, (w * 1.25) / label.bucketNumber.length, h * 0.2),
  );
  const numberY = headingFont + numberFont + 12;
  const size = Math.floor(Math.min(w - 24, h - numberY - 40, 260));
  const top = h - size - 25;
  const qr = await QRCode.toBuffer(label.url, {
    width: size,
    margin: 4,
    errorCorrectionLevel: 'M',
  });
  const details =
    top - numberY > 65
      ? `<text x="${w / 2}" y="${numberY + 30}" font-size="18">${escape(label.capacity)}</text><text x="${w / 2}" y="${numberY + 56}" font-size="16">Scan for current contents</text>`
      : '';
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial,sans-serif" text-anchor="middle"><text x="${w / 2}" y="${headingFont + 5}" font-size="${headingFont}">BUCKET</text><text x="${w / 2}" y="${numberY}" font-size="${numberFont}" font-weight="bold">${escape(label.bucketNumber)}</text>${details}<text x="${w / 2}" y="${h - 7}" font-size="11">${escape(label.id)}</text></g></svg>`;
  return sharp(Buffer.from(svg))
    .composite([{ input: qr, top, left: Math.floor((w - size) / 2) }])
    .png()
    .withMetadata({ density: 203 })
    .toBuffer();
}
export async function labelPdf(labels: Label[], settings: Settings): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const label of labels) {
    const png = await pdf.embedPng(await labelPng(label, settings));
    const w = (settings.labelWidth / 25.4) * 72,
      h = (settings.labelHeight / 25.4) * 72;
    const page = pdf.addPage([w, h]);
    page.drawImage(png, { x: 0, y: 0, width: w, height: h });
  }
  return pdf.save();
}
export async function labelExcel(labels: Label[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Bucket labels');
  sheet.addRow(['Bucket number', 'ID', 'Name', 'Capacity', 'QR URL']);
  labels.forEach((label) =>
    sheet.addRow([label.bucketNumber, label.id, label.name, label.capacity, label.url]),
  );
  return Buffer.from(await book.xlsx.writeBuffer());
}
