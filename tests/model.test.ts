import { describe, expect, it } from 'vitest';
import {
  addMonths,
  calendarDay,
  calculateDashboard,
  convert,
  settingsSchema,
  stockInputSchema,
  type Stock,
} from '../shared/model.ts';

const settings = settingsSchema.parse({
  caloriesPerAdult: 2000,
  waterPerAdult: 1,
  dogWaterGallons: 0.5,
  dogRationGrams: 400,
});
const stock = (input: Record<string, unknown>): Stock => ({
  ...stockInputSchema.parse({ category: 'food', name: 'Test item', ...input }),
  id: 'ST-TEST',
  catalogId: 'CAT-TEST',
  batchId: 'LOT-TEST',
  version: 1,
  createdAt: '',
  updatedAt: '',
});
describe('coverage calculations', () => {
  it('converts compatible units without inventing density', () => {
    expect(convert(1, 'lb', 'g')).toBeCloseTo(453.59237);
    expect(convert(1, 'gallon', 'ml')).toBeCloseTo(3785.411784);
    expect(convert(1, 'gallon', 'g')).toBeNull();
    expect(convert(1, 'count', 'g')).toBeNull();
  });
  it('keeps dog food separate and calculates human macros', () => {
    const food = stock({
      quantity: 1000,
      unit: 'g',
      nutrition: {
        servingSize: 100,
        servingUnit: 'g',
        calories: 400,
        protein: 10,
        carbs: 60,
        fat: 5,
      },
    });
    const dog = stock({ category: 'dog', quantity: 800, unit: 'g' });
    const d = calculateDashboard([food, dog], settings);
    expect(d.food.total).toBe(4000);
    expect(d.food.days).toBe(1);
    expect(d.dog.days).toBe(2);
    expect(d.macros.protein).toBe(100);
  });
  it('keeps unknown quantities and incompatible nutrition from becoming zero-day estimates', () => {
    const d = calculateDashboard(
      [
        stock({
          quantity: 1,
          unit: 'gallon',
          nutrition: { servingSize: 100, servingUnit: 'g', calories: 300 },
        }),
        stock({ category: 'water', quantity: null, unit: 'gallon' }),
        stock({ category: 'dog', quantity: null }),
      ],
      settings,
    );
    expect(d.food.unknown).toBe(1);
    expect(d.food.days).toBeNull();
    expect(d.water.days).toBeNull();
    expect(d.dog.days).toBeNull();
  });
  it('requires explicit household daily needs', () => {
    const d = calculateDashboard(
      [stock({ category: 'water', quantity: 230, unit: 'gallon' })],
      settingsSchema.parse({}),
    );
    expect(d.water.total).toBe(230);
    expect(d.water.days).toBeNull();
  });
  it('includes dog water in household coverage', () => {
    const d = calculateDashboard(
      [stock({ category: 'water', quantity: 230, unit: 'gallon' })],
      settings,
    );
    expect(d.water.days).toBe(92);
  });
  it('budgets propane once for cooking and generation, with separate alternative fuels', () => {
    const stocks = [
      stock({ category: 'fuel', fuelType: 'propane', quantity: 20, unit: 'lb' }),
      stock({ category: 'fuel', fuelType: 'gasoline', quantity: 5, unit: 'gallon' }),
    ];
    let d = calculateDashboard(stocks, settings);
    expect(d.fuel.days).toBeCloseTo(20 / 8.5);
    expect(d.fuel.total).toBe(20);
    expect(d.alternativeFuel[0].quantity).toBe(5);
    d = calculateDashboard(stocks, { ...settings, generatorNeeded: false });
    expect(d.fuel.days).toBe(40);
    d = calculateDashboard(stocks, { ...settings, naturalGasAvailable: true });
    expect(d.fuel.days).toBeNull();
    expect(d.fuel.total).toBe(20);
  });
  it('alerts on zero remaining essentials but stops date reminders for empty units', () => {
    const d = calculateDashboard(
      [
        stock({
          category: 'supplies',
          quantity: 0,
          unit: 'count',
          minimum: 5,
          expiresOn: '2026-10-28',
        }),
      ],
      settings,
      new Date('2026-10-27T20:00Z'),
    );
    expect(d.alerts.filter((a) => a.stockId)).toHaveLength(1);
    expect(d.alerts[0].type).toBe('low_stock');
  });
  it('leaves past-best-by quantities in totals', () => {
    const d = calculateDashboard(
      [
        stock({
          quantity: 10,
          unit: 'count',
          bestBy: '2025-01-01',
          nutrition: { servingSize: 1, servingUnit: 'count', calories: 100 },
        }),
      ],
      settings,
      new Date('2026-10-27T20:00Z'),
    );
    expect(d.food.total).toBe(1000);
    expect(d.alerts.find((a) => a.type === 'best_by')?.days).toBeLessThan(0);
  });
});
describe('calendar dates', () => {
  it('clamps month-end rotations, including leap years', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2023-08-31', 6)).toBe('2024-02-29');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
  });
  it('uses the configured timezone across midnight and DST', () => {
    expect(calendarDay(new Date('2026-10-27T01:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-26');
    expect(calendarDay(new Date('2026-03-08T10:30:00Z'), 'America/Los_Angeles')).toBe('2026-03-08');
  });
  it('rejects impossible calendar dates and negative amounts', () => {
    expect(
      stockInputSchema.safeParse({ category: 'food', name: 'Rice', bestBy: '2026-02-30' }).success,
    ).toBe(false);
    expect(
      stockInputSchema.safeParse({ category: 'food', name: 'Rice', quantity: -1 }).success,
    ).toBe(false);
  });
});
