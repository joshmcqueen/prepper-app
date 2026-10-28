import { z } from 'zod';

export const categorySchema = z.enum(['food', 'water', 'fuel', 'dog', 'supplies']);
export type Category = z.infer<typeof categorySchema>;
export const unitSchema = z.enum(['g', 'kg', 'lb', 'oz', 'ml', 'l', 'gallon', 'count']);
export type Unit = z.infer<typeof unitSchema>;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
    'Enter a valid calendar date',
  )
  .nullable()
  .default(null);
const amount = z.number().finite().min(0).max(1e12);
const text = z.string().trim().max(5000);
export const nutritionSchema = z.object({
  servingSize: amount.nullable().default(null),
  servingUnit: unitSchema.default('g'),
  calories: amount.nullable().default(null),
  protein: amount.nullable().default(null),
  carbs: amount.nullable().default(null),
  fat: amount.nullable().default(null),
});
export const stockInputSchema = z
  .object({
    category: categorySchema,
    name: text.min(1).max(200),
    brand: text.default(''),
    subcategory: text.max(100).default(''),
    description: text.default(''),
    notes: text.default(''),
    quantity: amount.nullable().default(null),
    unit: unitSchema.default('lb'),
    capacity: amount.nullable().default(null),
    locationId: text.nullable().default(null),
    containerId: text.nullable().default(null),
    packaging: z
      .enum(['original', 'mylar_1', 'mylar_3', 'mylar_5', 'bucket', 'tank', 'jug', 'other'])
      .default('original'),
    purchasedOn: date,
    bestBy: date,
    expiresOn: date,
    rotationOn: date,
    lastRotatedOn: date,
    rotationMonths: z.number().int().min(1).max(1200).nullable().default(null),
    rotationDays: z.number().int().min(1).max(36500).nullable().default(null),
    rotationDestination: z.enum(['hot_tub']).nullable().default(null),
    photoIds: z
      .array(z.string().regex(/^[a-f0-9-]+\.webp$/))
      .max(12)
      .default([]),
    nutrition: nutritionSchema.default({
      servingSize: null,
      servingUnit: 'g',
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
    }),
    fuelType: z.enum(['propane', 'gasoline', 'diesel', 'other']).default('propane'),
    minimum: amount.nullable().default(null),
    notify: z.boolean().default(true),
    highPriority: z.boolean().default(false),
    leadDays: z.number().int().min(0).max(3650).nullable().default(null),
    snoozedUntil: date,
  })
  .superRefine((v, ctx) => {
    if (v.rotationDays != null && v.rotationMonths != null)
      ctx.addIssue({
        code: 'custom',
        path: ['rotationDays'],
        message: 'Choose days or months for the rotation interval',
      });
    if (v.rotationDestination === 'hot_tub' && (v.category !== 'water' || v.packaging !== 'tank'))
      ctx.addIssue({
        code: 'custom',
        path: ['rotationDestination'],
        message: 'Hot tub rotation is available for water tanks',
      });
    if (
      v.rotationDestination === 'hot_tub' &&
      (!v.capacity || (!v.rotationDays && !v.rotationMonths))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['capacity'],
        message: 'Hot tub rotation needs a positive tank capacity and rotation interval',
      });
    if (v.capacity != null && v.quantity != null && v.quantity > v.capacity)
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'Remaining amount exceeds capacity',
      });
    if (v.category === 'water' && v.unit !== 'gallon')
      ctx.addIssue({ code: 'custom', path: ['unit'], message: 'Water is tracked in gallons' });
    if (v.category === 'fuel' && v.fuelType === 'propane' && v.unit !== 'lb')
      ctx.addIssue({
        code: 'custom',
        path: ['unit'],
        message: 'Propane is tracked in pounds of fuel',
      });
    if (v.category === 'fuel' && ['gasoline', 'diesel'].includes(v.fuelType) && v.unit !== 'gallon')
      ctx.addIssue({
        code: 'custom',
        path: ['unit'],
        message: 'Liquid fuel is tracked in gallons',
      });
  });
export type StockInput = z.infer<typeof stockInputSchema>;
export type Stock = StockInput & {
  id: string;
  catalogId: string;
  batchId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export const equipmentSchema = z.object({
  id: text.min(1),
  name: text.min(1),
  use: z.enum(['cooking', 'generator']),
  fuel: z.enum(['propane', 'gasoline', 'diesel']),
  rate: amount,
  hours: z.number().min(0).max(24),
  illustrative: z.boolean().default(true),
});
export const settingsSchema = z.object({
  version: z.number().int().min(1).default(1),
  householdName: text.min(1).max(100).default('Our household'),
  adults: z.number().int().min(1).max(100).default(2),
  dogWeightLb: amount.default(75),
  caloriesPerAdult: amount.nullable().default(null),
  waterPerAdult: amount.nullable().default(null),
  dogWaterGallons: amount.nullable().default(null),
  dogRationGrams: amount.nullable().default(null),
  targets: z
    .object({
      food: amount.positive().default(90),
      water: amount.positive().default(90),
      fuel: amount.positive().default(90),
      dog: amount.positive().default(90),
    })
    .default({ food: 90, water: 90, fuel: 90, dog: 90 }),
  lowDays: amount.default(30),
  naturalGasAvailable: z.boolean().default(false),
  generatorNeeded: z.boolean().default(true),
  equipment: z
    .array(equipmentSchema)
    .max(30)
    .default([
      {
        id: 'burner',
        name: 'Small cooking burner',
        use: 'cooking',
        fuel: 'propane',
        rate: 0.5,
        hours: 1,
        illustrative: true,
      },
      {
        id: 'generator',
        name: 'Tri-fuel generator',
        use: 'generator',
        fuel: 'propane',
        rate: 2,
        hours: 4,
        illustrative: true,
      },
    ]),
  supplyCategories: z
    .array(text.min(1).max(100))
    .min(1)
    .max(50)
    .default([
      'Medicine',
      'First aid',
      'Sanitation',
      'Tools',
      'Firearms',
      'Ammunition',
      'Miscellaneous',
    ]),
  timezone: z
    .string()
    .refine((t) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: t });
        return true;
      } catch {
        return false;
      }
    })
    .default('America/Los_Angeles'),
  recipients: z.array(z.email()).max(10).default([]),
  digest: z.enum(['off', 'weekly', 'monthly']).default('weekly'),
  emailAlerts: z.boolean().default(true),
  labelWidth: z.number().min(20).max(50).default(50),
  labelHeight: z.number().min(20).max(150).default(80),
  appBaseUrl: z
    .url()
    .refine((url) => /^https?:\/\//.test(url), 'Use an http or https URL')
    .default('http://localhost:5173'),
});
export type Settings = z.infer<typeof settingsSchema>;
export type Location = { id: string; name: string };
export type Container = {
  id: string;
  bucketNumber: number;
  name: string;
  locationId: string | null;
  capacityGallons: number;
  version: number;
};
export const bucketNumberLabel = (container: Container) =>
  String(container.bucketNumber).padStart(2, '0');
export function bucketName(container: Container): string {
  const title = `Bucket ${bucketNumberLabel(container)}`;
  return container.name && container.name !== title ? `${title} · ${container.name}` : title;
}
export function effectiveLocationId(
  stock: Pick<Stock, 'containerId' | 'locationId'>,
  containers: Container[],
): string | null {
  const container = containers.find((c) => c.id === stock.containerId);
  return container ? container.locationId : stock.locationId;
}
export type Alert = {
  key: string;
  stockId: string | null;
  category: Category;
  name: string;
  type: 'best_by' | 'expiration' | 'rotation' | 'low_stock' | 'setup';
  date: string | null;
  days: number | null;
  highPriority: boolean;
  message: string;
  notify: boolean;
  leadDays: number[];
};
export type Coverage = {
  total: number;
  known: number;
  unknown: number;
  days: number | null;
  target: number;
  unit: string;
};
export type Dashboard = {
  food: Coverage;
  water: Coverage;
  fuel: Coverage;
  dog: Coverage;
  alerts: Alert[];
  macros: { protein: number; carbs: number; fat: number };
  alternativeFuel: { type: string; quantity: number; unit: string; days: number | null }[];
  foodTypes: { name: string; calories: number }[];
  utilitiesAvailable: boolean;
  illustrative: boolean;
  totalItems: number;
};

const factors: Record<Unit, [string, number]> = {
  g: ['mass', 1],
  kg: ['mass', 1000],
  lb: ['mass', 453.59237],
  oz: ['mass', 28.349523125],
  ml: ['volume', 1],
  l: ['volume', 1000],
  gallon: ['volume', 3785.411784],
  count: ['count', 1],
};
export function convert(value: number, from: Unit, to: Unit): number | null {
  return factors[from][0] === factors[to][0] ? (value * factors[from][1]) / factors[to][1] : null;
}
export function calendarDay(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}
export function addMonths(value: string, months: number): string {
  const d = new Date(`${value}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, end));
  return d.toISOString().slice(0, 10);
}
export function addDays(value: string, days: number): string {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function rotationDate(stock: StockInput): string | null {
  return (
    stock.rotationOn ||
    (stock.lastRotatedOn && stock.rotationDays
      ? addDays(stock.lastRotatedOn, stock.rotationDays)
      : stock.lastRotatedOn && stock.rotationMonths
        ? addMonths(stock.lastRotatedOn, stock.rotationMonths)
        : null)
  );
}
export function waterTankInput(): StockInput {
  return stockInputSchema.parse({
    category: 'water',
    name: 'Outdoor water tank',
    capacity: 300,
    unit: 'gallon',
    packaging: 'tank',
    locationId: 'LOC-OUTDOORS',
    rotationDays: 45,
    rotationDestination: 'hot_tub',
    leadDays: 7,
  });
}
export const round = (n: number) => Math.round(n * 1e8) / 1e8;
export function calculateDashboard(
  stocks: Stock[],
  settings: Settings,
  now = new Date(),
): Dashboard {
  const today = calendarDay(now, settings.timezone);
  const coverage = (category: keyof Settings['targets'], unit: string): Coverage => ({
    total: 0,
    known: 0,
    unknown: 0,
    days: null,
    target: settings.targets[category],
    unit,
  });
  const result: Dashboard = {
    food: coverage('food', 'kcal'),
    water: coverage('water', 'gallons'),
    fuel: coverage('fuel', 'lb propane'),
    dog: coverage('dog', 'g'),
    alerts: [],
    macros: { protein: 0, carbs: 0, fat: 0 },
    alternativeFuel: [],
    foodTypes: [],
    utilitiesAvailable: settings.naturalGasAvailable,
    illustrative: settings.equipment.some((e) => e.illustrative),
    totalItems: stocks.length,
  };
  const types = new Map<string, number>();
  for (const stock of stocks) {
    const active = stock.quantity !== 0;
    if (stock.category === 'food') {
      const n = stock.nutrition;
      const q = stock.quantity == null ? null : convert(stock.quantity, stock.unit, n.servingUnit);
      if (q != null && n.servingSize && n.calories != null) {
        const servings = q / n.servingSize,
          cal = servings * n.calories;
        result.food.total += cal;
        result.food.known++;
        types.set(
          stock.subcategory || 'Other foods',
          (types.get(stock.subcategory || 'Other foods') || 0) + cal,
        );
        for (const key of ['protein', 'carbs', 'fat'] as const)
          if (n[key] != null) result.macros[key] += servings * n[key];
      } else if (active) result.food.unknown++;
    }
    if (stock.category === 'water') {
      if (stock.quantity != null) {
        result.water.total += stock.quantity;
        result.water.known++;
      } else result.water.unknown++;
    }
    if (stock.category === 'dog') {
      const g = stock.quantity == null ? null : convert(stock.quantity, stock.unit, 'g');
      if (g != null) {
        result.dog.total += g;
        result.dog.known++;
      } else if (active) result.dog.unknown++;
    }
    if (stock.category === 'fuel') {
      if (stock.fuelType === 'propane') {
        if (stock.quantity != null) {
          result.fuel.total += stock.quantity;
          result.fuel.known++;
        } else result.fuel.unknown++;
      } else {
        let alt = result.alternativeFuel.find(
          (f) => f.type === stock.fuelType && f.unit === stock.unit,
        );
        if (!alt) {
          alt = { type: stock.fuelType, quantity: 0, unit: stock.unit, days: null };
          result.alternativeFuel.push(alt);
        }
        alt.quantity += stock.quantity ?? 0;
      }
    }
    const leads =
      stock.leadDays == null
        ? stock.highPriority
          ? [90, 30, 7, 0]
          : [30, 7, 0]
        : [stock.leadDays, 7, 0]
            .filter((n, i, a) => n <= stock.leadDays! && a.indexOf(n) === i)
            .sort((a, b) => b - a);
    const notify = stock.notify && (!stock.snoozedUntil || stock.snoozedUntil <= today);
    const pushDate = (type: Alert['type'], date: string | null, title: string) => {
      if (!date) return;
      const days = daysBetween(today, date);
      if (days <= Math.max(...leads, 90))
        result.alerts.push({
          key: `${stock.id}:${type}:${date}`,
          stockId: stock.id,
          category: stock.category,
          name: stock.name,
          type,
          date,
          days,
          highPriority: stock.highPriority,
          message:
            days < 0
              ? `${title} ${Math.abs(days)} days ago`
              : days === 0
                ? `${title} today`
                : `${title} in ${days} days`,
          notify,
          leadDays: leads,
        });
    };
    if (active) {
      pushDate('best_by', stock.bestBy, 'Best-by date');
      pushDate('expiration', stock.expiresOn, 'Expires');
      pushDate('rotation', rotationDate(stock), 'Rotation due');
    }
    if (stock.minimum != null && stock.quantity != null && stock.quantity < stock.minimum)
      result.alerts.push({
        key: `${stock.id}:low_stock`,
        stockId: stock.id,
        category: stock.category,
        name: stock.name,
        type: 'low_stock',
        date: null,
        days: null,
        highPriority: stock.highPriority,
        message: `${round(stock.quantity)} ${stock.unit} left · minimum ${stock.minimum}`,
        notify,
        leadDays: [],
      });
    if ((stock.category === 'water' && !rotationDate(stock)) || stock.quantity == null)
      result.alerts.push({
        key: `${stock.id}:setup`,
        stockId: stock.id,
        category: stock.category,
        name: stock.name,
        type: 'setup',
        date: null,
        days: null,
        highPriority: false,
        message:
          stock.quantity == null
            ? 'Remaining quantity needs a stock check'
            : 'Add a last rotation date to start reminders',
        notify: false,
        leadDays: [],
      });
  }
  const dailyCalories =
    settings.caloriesPerAdult == null ? null : settings.adults * settings.caloriesPerAdult;
  const dailyWater =
    settings.waterPerAdult == null || settings.dogWaterGallons == null
      ? null
      : settings.adults * settings.waterPerAdult + settings.dogWaterGallons;
  if (dailyCalories && (result.food.known > 0 || !result.food.unknown))
    result.food.days = result.food.total / dailyCalories;
  if (dailyWater && (result.water.known > 0 || !result.water.unknown))
    result.water.days = result.water.total / dailyWater;
  if (settings.dogRationGrams && (result.dog.known > 0 || !result.dog.unknown))
    result.dog.days = result.dog.total / settings.dogRationGrams;
  const dailyFuel = (fuel: string) =>
    settings.equipment
      .filter((e) => e.fuel === fuel && (e.use !== 'generator' || settings.generatorNeeded))
      .reduce((a, e) => a + e.hours * e.rate, 0);
  const propaneDaily = dailyFuel('propane');
  if (
    !settings.naturalGasAvailable &&
    propaneDaily > 0 &&
    (result.fuel.known > 0 || !result.fuel.unknown)
  )
    result.fuel.days = result.fuel.total / propaneDaily;
  for (const alt of result.alternativeFuel) {
    const daily = dailyFuel(alt.type);
    if (!settings.naturalGasAvailable && daily > 0) alt.days = alt.quantity / daily;
  }
  result.foodTypes = [...types]
    .map(([name, calories]) => ({ name, calories }))
    .sort((a, b) => b.calories - a.calories);
  for (const category of ['food', 'water', 'fuel', 'dog'] as const) {
    const cov = result[category];
    if (
      stocks.some((s) => s.category === category) &&
      cov.days != null &&
      cov.days < settings.lowDays
    )
      result.alerts.push({
        key: `${category}:coverage`,
        stockId: null,
        category,
        name: `${category === 'dog' ? 'Dog food' : category[0].toUpperCase() + category.slice(1)} reserve`,
        type: 'low_stock',
        date: null,
        days: null,
        highPriority: false,
        message: `${Math.floor(cov.days)} days of coverage · low-stock threshold ${settings.lowDays} days`,
        notify: true,
        leadDays: [],
      });
  }
  result.alerts.sort(
    (a, b) => Number(b.highPriority) - Number(a.highPriority) || (a.days ?? 999) - (b.days ?? 999),
  );
  return result;
}
