import sharp from 'sharp';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { round, type Container, type Settings, type Stock } from '../shared/model.ts';

type Label = {
  id: string;
  name: string;
  quantity: string;
  purchased: string;
  bestBy: string;
  expires: string;
  url: string;
  extra: string;
};
export function stockLabel(stock: Stock, settings: Settings): Label {
  return {
    id: stock.id,
    name: stock.name,
    quantity:
      stock.quantity == null ? 'Quantity unknown' : `${round(stock.quantity)} ${stock.unit}`,
    purchased: stock.purchasedOn || '',
    bestBy: stock.bestBy || '',
    expires: stock.expiresOn || '',
    url: `${settings.appBaseUrl.replace(/\/$/, '')}/item/${stock.id}`,
    extra: stock.brand,
  };
}
export function containerLabel(container: Container, settings: Settings): Label {
  return {
    id: container.id,
    name: container.name,
    quantity: `${container.capacityGallons}-gallon bucket`,
    purchased: '',
    bestBy: '',
    expires: '',
    url: `${settings.appBaseUrl.replace(/\/$/, '')}/container/${container.id}`,
    extra: 'Scan for current contents',
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
    const size = Math.min(w - 24, h - 60);
    const qr = await QRCode.toBuffer(label.url, {
      width: size,
      margin: 4,
      errorCorrectionLevel: 'M',
    });
    const compact = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial,sans-serif" text-anchor="middle"><text x="${w / 2}" y="20" font-size="13" font-weight="bold">${escape(label.name.slice(0, Math.floor((w - 20) / 8)))}</text><text x="${w / 2}" y="${h - 8}" font-size="12">${escape(label.id)}</text></g></svg>`;
    return sharp(Buffer.from(compact))
      .composite([{ input: qr, top: 30, left: Math.floor((w - size) / 2) }])
      .png()
      .withMetadata({ density: 203 })
      .toBuffer();
  }
  const pad = 18,
    font = Math.max(15, Math.min(23, Math.floor(w / 17)));
  const qrSize = Math.min(160, Math.floor(w * 0.42), Math.floor(h * 0.38));
  const qr = await QRCode.toBuffer(label.url, {
    width: qrSize,
    margin: 4,
    errorCorrectionLevel: 'M',
  });
  const chars = Math.max(15, Math.floor((w - pad * 2) / (font * 0.6)));
  const words = label.name.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (`${line} ${word}`.trim().length > chars && line) {
      lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  const title = lines
    .slice(0, 3)
    .map(
      (s, i) =>
        `<text x="${pad}" y="${pad + font + i * (font + 5)}" font-size="${font}" font-weight="bold">${escape(s.slice(0, chars))}${i === 2 && lines.length > 3 ? '…' : ''}</text>`,
    )
    .join('');
  const y = pad + Math.min(lines.length, 3) * (font + 5) + 18;
  const detail = [
    label.quantity,
    label.purchased && `Purchased ${label.purchased}`,
    label.bestBy && `Best by ${label.bestBy}`,
    label.expires && `Expires ${label.expires}`,
    label.extra,
  ].filter(Boolean);
  const small = Math.max(13, font - 5);
  const available = h - y - qrSize - 25;
  const visible = detail.slice(0, Math.max(1, Math.floor(available / (small + 7))));
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial,sans-serif">${title}${visible.map((s, i) => `<text x="${pad}" y="${y + i * (small + 7)}" font-size="${small}">${escape(s.slice(0, Math.floor((w - pad * 2) / (small * 0.6))))}</text>`).join('')}<text x="${pad + qrSize + 8}" y="${h - 30}" font-size="${small - 1}">${escape(label.id)}</text></g></svg>`;
  return sharp(Buffer.from(svg))
    .composite([{ input: qr, top: h - qrSize - 15, left: pad }])
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
  const sheet = book.addWorksheet('Labels');
  sheet.addRow(['ID', 'Name', 'Quantity', 'Purchased', 'Best by', 'Expires', 'Details', 'QR URL']);
  labels.forEach((label) =>
    sheet.addRow([
      label.id,
      label.name,
      label.quantity,
      label.purchased,
      label.bestBy,
      label.expires,
      label.extra,
      label.url,
    ]),
  );
  return Buffer.from(await book.xlsx.writeBuffer());
}
