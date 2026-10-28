import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { addMonths, calendarDay, stockInputSchema, type StockInput } from '../shared/model.ts';
import type { Store } from './db.ts';

export async function seedDemo(store: Store, now = new Date()) {
  const today = calendarDay(now, 'America/Los_Angeles');
  const day = (offset: number) =>
    new Date(Date.parse(today) + offset * 86400000).toISOString().slice(0, 10);
  const makePhoto = async (title: string, color: string) => {
    const photo = `${randomUUID()}.webp`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#f0eee5"/><circle cx="320" cy="300" r="240" fill="${color}" opacity=".15"/><ellipse cx="320" cy="540" rx="140" ry="22" fill="#28392f" opacity=".08"/><path d="M215 120H425L450 520Q320 560 190 520Z" fill="${color}"/><path d="M215 120H425V145H215Z" fill="#fff" opacity=".35"/><rect x="215" y="275" width="210" height="140" rx="4" fill="#fbfaf2"/><g fill="#53624c" text-anchor="middle" font-family="Arial,sans-serif"><text x="320" y="316" font-size="13" letter-spacing="4">HAVEN SAMPLE</text><text x="320" y="355" font-size="27">${title}</text><text x="320" y="385" font-size="15">HOUSEHOLD RESERVE</text><text x="320" y="600" font-size="14" opacity=".5">Illustration · not a product photo</text></g></svg>`;
    await sharp(Buffer.from(svg))
      .webp()
      .toFile(path.join(store.dataDir, 'uploads', photo));
    return photo;
  };
  const ricePhoto = await makePhoto('Jasmine Rice', '#b7a47d'),
    oatsPhoto = await makePhoto('Rolled Oats', '#b69069'),
    dogPhoto = await makePhoto('Dog Kibble', '#8e9b78');
  store.db.transaction(() => {
    const settings = store.getSettings();
    store.saveSettings({
      ...settings,
      householdName: 'The McQueen household',
      caloriesPerAdult: 2200,
      waterPerAdult: 1,
      dogWaterGallons: 0.5,
      dogRationGrams: 400,
      equipment: [
        ...settings.equipment,
        {
          id: 'generator-gasoline',
          name: 'Generator · gasoline alternative',
          fuel: 'gasoline',
          use: 'generator',
          rate: 0.5,
          hours: 4,
          illustrative: true,
        },
      ],
    });
    for (const [id, name] of [
      ['LOC-PANTRY', 'Pantry'],
      ['LOC-GARAGE', 'Garage shelves'],
      ['LOC-ESSENTIALS', 'Essentials cabinet'],
      ['LOC-ATTIC', 'Attic'],
      ['LOC-CLOSET', 'Hallway closet'],
    ])
      store.db.prepare('INSERT INTO locations VALUES (?,?)').run(id, name);
    store.setupBuckets('LOC-GARAGE');
    const add = (input: Partial<StockInput> & { name: string; category: StockInput['category'] }) =>
      store.create(
        stockInputSchema.parse({ locationId: 'LOC-PANTRY', purchasedOn: day(-60), ...input }),
      );
    const food = (input: Partial<StockInput> & { name: string }) =>
      add({ category: 'food', unit: 'lb', brand: 'Sample pantry brand', ...input });
    const rice = food({
      name: 'Jasmine rice',
      quantity: 60,
      subcategory: 'Grains',
      bestBy: day(900),
      photoIds: [ricePhoto],
      nutrition: {
        servingSize: 45,
        servingUnit: 'g',
        calories: 160,
        protein: 3,
        carbs: 36,
        fat: 0,
      },
      notes: 'Sample bulk purchase, divided among three Mylar bags.',
    });
    store.split(
      rice.id,
      rice.version,
      [1, 2, 3].map((n) => ({ quantity: 20, containerId: `BK-0${n}`, packaging: 'mylar_3' })),
    );
    food({
      name: 'Old-fashioned rolled oats',
      quantity: 32,
      subcategory: 'Grains',
      containerId: 'BK-04',
      packaging: 'mylar_3',
      bestBy: day(21),
      highPriority: true,
      photoIds: [oatsPhoto],
      nutrition: {
        servingSize: 40,
        servingUnit: 'g',
        calories: 150,
        protein: 5,
        carbs: 27,
        fat: 3,
      },
    });
    food({
      name: 'Spices',
      quantity: 0.5,
      containerId: 'BK-04',
      packaging: 'mylar_1',
      notes: 'Fictional sample bag; replace with your own details.',
    });
    food({
      name: 'Freeze-dried blueberries',
      quantity: 2,
      containerId: 'BK-04',
      packaging: 'mylar_1',
      notes: 'Fictional sample bag; nutrition and dates are unknown.',
    });
    food({
      name: 'Dry pinto beans',
      quantity: 25,
      subcategory: 'Beans & legumes',
      containerId: 'BK-05',
      packaging: 'mylar_3',
      bestBy: day(540),
      nutrition: {
        servingSize: 35,
        servingUnit: 'g',
        calories: 120,
        protein: 8,
        carbs: 22,
        fat: 0,
      },
    });
    food({
      name: 'Extra virgin olive oil',
      quantity: 1.5,
      unit: 'gallon',
      subcategory: 'Oils & fats',
      bestBy: day(60),
      nutrition: {
        servingSize: 15,
        servingUnit: 'ml',
        calories: 120,
        protein: 0,
        carbs: 0,
        fat: 14,
      },
    });
    food({
      name: 'Raw honey',
      quantity: 12,
      subcategory: 'Sweeteners',
      bestBy: null,
      nutrition: { servingSize: 21, servingUnit: 'g', calories: 60, protein: 0, carbs: 17, fat: 0 },
    });
    food({
      name: 'Freeze-dried dinner pouches',
      quantity: 18,
      unit: 'count',
      subcategory: 'Prepared meals',
      bestBy: day(2500),
      nutrition: {
        servingSize: 1,
        servingUnit: 'count',
        calories: 620,
        protein: 24,
        carbs: 86,
        fat: 20,
      },
    });
    food({
      name: 'Canned chicken',
      quantity: 24,
      unit: 'count',
      subcategory: 'Canned food',
      bestBy: day(240),
      nutrition: {
        servingSize: 1,
        servingUnit: 'count',
        calories: 210,
        protein: 42,
        carbs: 0,
        fat: 4,
      },
    });
    food({
      name: 'Coconut oil',
      quantity: 4,
      subcategory: 'Oils & fats',
      bestBy: day(180),
      nutrition: {
        servingSize: 14,
        servingUnit: 'g',
        calories: 120,
        protein: 0,
        carbs: 0,
        fat: 14,
      },
    });
    food({
      name: 'Lentils · quantity to verify',
      quantity: null,
      subcategory: 'Beans & legumes',
      containerId: 'BK-06',
      notes: 'Sample incomplete record: check the amount and package nutrition.',
    });
    for (let n = 1; n <= 6; n++)
      add({
        category: 'water',
        name: `Sealed water jug ${n}`,
        quantity: 5,
        capacity: 5,
        unit: 'gallon',
        packaging: 'jug',
        locationId: 'LOC-STORAGE',
        rotationMonths: 12,
        lastRotatedOn: n <= 2 ? addMonths(today, -11) : addMonths(today, -5),
      });
    add({
      category: 'water',
      name: 'Outdoor water tank',
      quantity: 300,
      capacity: 300,
      unit: 'gallon',
      packaging: 'tank',
      locationId: 'LOC-OUTDOORS',
      rotationDays: 45,
      rotationDestination: 'hot_tub',
      leadDays: 7,
      lastRotatedOn: day(-46),
      highPriority: true,
    });
    for (const [i, quantity] of [20, 18, 12].entries())
      add({
        category: 'fuel',
        name: `Propane tank ${i + 1}`,
        quantity,
        capacity: 20,
        unit: 'lb',
        packaging: 'tank',
        fuelType: 'propane',
        locationId: 'LOC-OUTDOORS',
        notes: 'Sample quantity: fuel weight, excluding the tank.',
      });
    add({
      category: 'fuel',
      name: 'Generator gasoline reserve',
      quantity: 5,
      capacity: 5,
      unit: 'gallon',
      fuelType: 'gasoline',
      locationId: 'LOC-OUTDOORS',
      rotationOn: day(12),
    });
    add({
      category: 'dog',
      name: 'Adult dog kibble',
      brand: 'Sample dog food',
      quantity: 32,
      unit: 'lb',
      bestBy: day(70),
      photoIds: [dogPhoto],
      minimum: 10,
      highPriority: true,
      notes:
        'Sample food and ration amounts; replace with your dog’s actual food and measured intake.',
    });
    add({
      category: 'dog',
      name: 'Backup kibble bag',
      quantity: 22,
      unit: 'lb',
      bestBy: day(160),
      locationId: 'LOC-GARAGE',
    });
    const supply = (input: Partial<StockInput> & { name: string }) =>
      add({ category: 'supplies', unit: 'count', locationId: 'LOC-ESSENTIALS', ...input });
    supply({
      name: 'Household medicine · sample',
      subcategory: 'Medicine',
      quantity: 12,
      minimum: 20,
      expiresOn: day(18),
      highPriority: true,
      notes: 'Placeholder inventory only. Replace with your own item details.',
    });
    supply({
      name: 'First-aid kit',
      subcategory: 'First aid',
      quantity: 2,
      minimum: 1,
      rotationOn: day(45),
    });
    supply({
      name: 'Toilet paper rolls',
      subcategory: 'Sanitation',
      quantity: 24,
      minimum: 12,
      locationId: 'LOC-CLOSET',
    });
    supply({
      name: 'Emergency blankets · sample',
      subcategory: 'Shelter',
      quantity: 4,
      locationId: 'LOC-ATTIC',
    });
    supply({ name: 'LED flashlights', subcategory: 'Tools', quantity: 4, minimum: 2 });
    supply({
      name: 'Firearms · sample inventory',
      subcategory: 'Firearms',
      quantity: 2,
      locationId: 'LOC-STORAGE',
      notes: 'Fictional demonstration record.',
    });
    supply({
      name: 'Ammunition · sample inventory',
      subcategory: 'Ammunition',
      quantity: 500,
      minimum: 300,
      locationId: 'LOC-STORAGE',
      notes: 'Fictional demonstration record. Quantity is rounds.',
    });
    store.db
      .prepare("INSERT INTO meta VALUES ('setup_water','1'),('setup_buckets','1'),('demo','1')")
      .run();
    const delivery = store.db.prepare(`INSERT INTO reminder_outbox
      (id,subject,body,recipients,status,attempts,next_attempt,created_at,sent_at,error)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    delivery.run(
      'demo-sent',
      'Sample · Weekly preparedness summary',
      'Preview record only. No email was sent.',
      '[]',
      'sent',
      1,
      now.toISOString(),
      new Date(now.getTime() - 86400000).toISOString(),
      new Date(now.getTime() - 86400000).toISOString(),
      null,
    );
    delivery.run(
      'demo-failed',
      'Sample · Water rotation reminder',
      'Preview record only. No email was attempted.',
      '[]',
      'failed',
      3,
      now.toISOString(),
      now.toISOString(),
      null,
      'Sample delivery failure for preview. No email was attempted.',
    );
  })();
}
