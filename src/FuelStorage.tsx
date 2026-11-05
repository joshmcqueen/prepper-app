import { useId, useState } from 'react';
import { ArrowRight, CookingPot, Flame, Plus, Zap } from 'lucide-react';
import {
  effectiveLocationId,
  isPropane,
  isPropaneTank,
  propaneBtuPerPound,
  propaneLoads,
  type Stock,
  type StockInput,
} from '../shared/model';
import { useApp } from './App';
import { dateLabel, number } from './api';
import { Busy, ErrorMessage, Field, Modal, Num } from './ui';

const tankNames = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function FuelStorage() {
  const { state, setModal, navigate } = useApp();
  const tanks = state.stocks
    .filter(isPropaneTank)
    .sort((a, b) => tankNames.compare(a.name, b.name));
  const older = state.stocks.filter((stock) => isPropane(stock) && !isPropaneTank(stock));
  const { total, known, unknown } = state.dashboard.fuel;
  const { kitchenNaturalGas, generator, stove } = state.settings.fuelSetup;
  const editEquipment = () => navigate('/settings#equipment');

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Fuel storage</h1>
          <p>Propane reserve and backup runtimes</p>
        </div>
        <div className="button-row wrap">
          <button className="button" onClick={() => setModal({ type: 'propane-cylinders' })}>
            <Plus size={18} /> Add propane tanks
          </button>
          <button
            className="button secondary"
            onClick={() => setModal({ type: 'edit', category: 'fuel', otherFuel: true })}
          >
            Add other fuel
          </button>
        </div>
      </div>
      <div className="fuel-overview">
        <section className="panel fuel-reserve" aria-labelledby="propane-reserve">
          <h2 id="propane-reserve">Propane reserve</h2>
          <p>
            {tanks.length} {tanks.length === 1 ? 'tank' : 'tanks'} ·{' '}
            {known ? `${number(total, 2)} lb recorded` : 'No measured propane amount'}
            {unknown > 0 && ` · ${unknown} with unknown amounts`}
          </p>
          {tanks.length > 0 && (
            <ul className="fuel-tank-shelf" role="list">
              {tanks.map((tank) => (
                <li className="fuel-tank-tile" key={tank.id}>
                  <button className="jug-tile" onClick={() => navigate(`/item/${tank.id}`)}>
                    <CylinderGauge tank={tank} />
                    <strong>{tank.name}</strong>
                    <span>{tankAmount(tank)}</span>
                    <small>
                      {state.locations.find(
                        (l) => l.id === effectiveLocationId(tank, state.containers),
                      )?.name ?? 'Location not assigned'}
                    </small>
                    {tank.lastRefilledOn && (
                      <small>
                        Refilled{' '}
                        <time dateTime={tank.lastRefilledOn}>{dateLabel(tank.lastRefilledOn)}</time>
                      </small>
                    )}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setModal({ type: 'propane-refill', stock: tank })}
                    aria-label={`Record refill for ${tank.name}`}
                  >
                    Record refill
                  </button>
                </li>
              ))}
            </ul>
          )}
          {older.length > 0 && (
            <div className="fuel-review">
              <h3>Older propane entries</h3>
              <p>
                Review these entries as individual cylinders to include their fuel in estimates.
              </p>
              {older.map((stock) => (
                <div key={stock.id} className="button-row wrap">
                  <span>
                    {stock.name} ·{' '}
                    {stock.quantity == null
                      ? 'Amount unknown'
                      : `${number(stock.quantity, 2)} lb recorded`}
                  </span>
                  <button
                    className="text-button"
                    aria-label={`Convert to cylinders: ${stock.name}`}
                    onClick={() => setModal({ type: 'propane-cylinders', source: stock })}
                  >
                    Convert to cylinders <ArrowRight size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="fuel-pair">
          <section className="panel fuel-scenario">
            <CookingPot size={24} aria-hidden="true" />
            <div>
              <h3>Power outage, gas available</h3>
              <p>
                {kitchenNaturalGas === true
                  ? 'Piped natural gas for kitchen cooking'
                  : kitchenNaturalGas === false
                    ? 'Use your outdoor cooking backup'
                    : 'Confirm your kitchen gas connection in Settings'}
              </p>
            </div>
          </section>
          <section className="panel fuel-scenario">
            <Flame size={24} aria-hidden="true" />
            <div>
              <h3>Power and gas outage</h3>
              <p>Outdoor propane stove and backup generator</p>
            </div>
          </section>
        </div>
        <div className="fuel-pair">
          <section className="panel fuel-runtime">
            <h2>
              <Zap size={21} aria-hidden="true" /> Generator runtime
            </h2>
            {generator ? (
              <>
                <p>{generator.name}</p>
                <dl>
                  {(Object.keys(propaneLoads) as (keyof typeof propaneLoads)[]).map((load) => (
                    <div key={load}>
                      <dt>
                        {load[0].toUpperCase() + load.slice(1)} ·{' '}
                        {number(generator.watts.propane.running * propaneLoads[load])} W
                        <small>{number(generator.propaneRates[load], 3)} lb/hr</small>
                      </dt>
                      <dd>
                        {known
                          ? `~${number(total / generator.propaneRates[load], 1)} hr`
                          : 'Amount needed'}
                      </dd>
                    </div>
                  ))}
                </dl>
                <details>
                  <summary>Power ratings by fuel</summary>
                  <dl>
                    {(
                      [
                        ['gasoline', 'Gasoline'],
                        ['propane', 'Propane'],
                        ['naturalGas', 'Natural gas'],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>
                          {number(generator.watts[key].running)} W running ·{' '}
                          {number(generator.watts[key].peak)} W peak
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </>
            ) : (
              <p>Choose a generator preset in Settings to estimate runtime.</p>
            )}
          </section>
          <section className="panel fuel-runtime">
            <h2>
              <CookingPot size={21} aria-hidden="true" /> Outdoor cooking
            </h2>
            {stove ? (
              <>
                <p>
                  {stove.name} · {number(stove.btuPerBurner)} BTU/hr per burner
                </p>
                <dl>
                  {[1, 2].map((burners) => {
                    const hours = (total * propaneBtuPerPound) / (stove.btuPerBurner * burners);
                    return (
                      <div key={burners}>
                        <dt>{burners === 1 ? 'One burner' : 'Two burners'}</dt>
                        <dd>
                          {known ? (
                            <>
                              ~{number(hours)} hr
                              <small>{number(Math.floor(hours * 2))} × 30-minute sessions</small>
                            </>
                          ) : (
                            'Amount needed'
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </>
            ) : (
              <p>Choose a stove preset in Settings to estimate cooking time.</p>
            )}
          </section>
        </div>
        <div className="button-row wrap fuel-estimate-note">
          <p>Illustrative estimates. Each scenario uses the same recorded propane reserve.</p>
          <button className="text-button" onClick={editEquipment}>
            Edit equipment <ArrowRight size={15} />
          </button>
        </div>
        {state.dashboard.alternativeFuel.length > 0 && (
          <div className="fuel-pair">
            {state.dashboard.alternativeFuel.map((fuel) => (
              <div className="panel fuel-other" key={`${fuel.type}:${fuel.unit}`}>
                <strong>{fuel.type[0].toUpperCase() + fuel.type.slice(1)}</strong>
                <p>
                  {number(fuel.quantity, 2)} {fuel.unit} recorded
                  {fuel.unknown > 0 && ` · ${fuel.unknown} unknown`}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function tankAmount(tank: Stock) {
  if (tank.quantity == null)
    return tank.capacity
      ? `Amount unknown · ${number(tank.capacity, 2)} lb capacity`
      : 'Amount unknown';
  const quantity = number(tank.quantity, 2);
  if (!tank.capacity) return `${quantity} lb · capacity unknown`;
  return `${quantity} / ${number(tank.capacity, 2)} lb · ${number((tank.quantity / tank.capacity) * 100)}%`;
}

function CylinderGauge({ tank }: { tank: Stock }) {
  const clip = useId();
  const level = tank.quantity != null && tank.capacity ? tank.quantity / tank.capacity : 0;
  const body =
    'M30 28H66C79 31 88 40 88 54V82C88 94 79 101 66 101H30C17 101 8 94 8 82V54C8 40 17 31 30 28Z';
  return (
    <svg className="fuel-gauge" viewBox="0 0 96 114" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <path d={body} />
        </clipPath>
      </defs>
      <path
        d="M30 29V13Q30 8 36 8H60Q66 8 66 13V29M35 16H61M43 28V21H53V28M26 100V106Q48 112 70 106V100"
        className="fuel-cylinder-outline"
      />
      <path d={body} className="fuel-cylinder-shell" />
      <rect
        x="8"
        y={101 - level * 73}
        width="80"
        height={level * 73}
        clipPath={`url(#${clip})`}
        className="fuel-cylinder-fill"
      />
      <path d={body} className="fuel-cylinder-outline" />
      {(tank.quantity == null || !tank.capacity) && (
        <text x="48" y="74" textAnchor="middle">
          ?
        </text>
      )}
    </svg>
  );
}

type Cylinder = Pick<StockInput, 'name' | 'quantity' | 'capacity'>;

export function PropaneCylindersModal({
  source,
  onClose,
}: {
  source?: Stock;
  onClose: () => void;
}) {
  const { state, mutate, toast } = useApp();
  const exchange =
    source?.quantity === 4 &&
    /amerigas/i.test(source.brand) &&
    /tanks|cylinders/i.test(source.name);
  const nextNumber =
    Math.max(
      0,
      ...state.stocks
        .filter(isPropaneTank)
        .map((tank) => Number(/^Propane tank (\d+)$/i.exec(tank.name)?.[1] ?? 0)),
    ) + 1;
  const newCylinder = (index: number): Cylinder => ({
    name: `Propane tank ${nextNumber + index}`,
    quantity: exchange ? 15 : index === 0 ? (source?.quantity ?? null) : null,
    capacity: exchange ? 20 : (source?.capacity ?? null),
  });
  const [requestId] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  );
  const [cylinders, setCylinders] = useState(() =>
    Array.from({ length: exchange ? 4 : 1 }, (_, index) => newCylinder(index)),
  );
  const [count, setCount] = useState<number | null>(cylinders.length);
  const [details, setDetails] = useState({
    brand: '',
    purchasedOn: '',
    locationId: state.locations.find((l) => l.id === 'LOC-OUTDOORS')?.id ?? '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setCylinder = (index: number, change: Partial<Cylinder>) =>
    setCylinders((old) => old.map((tank, i) => (i === index ? { ...tank, ...change } : tank)));

  return (
    <Modal title={source ? 'Convert to cylinders' : 'Add propane tanks'} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            if (count == null || !Number.isInteger(count) || count < 1 || count > 100)
              throw new Error('Enter a number of tanks from 1 to 100');
            await mutate('/api/propane-cylinders', 'POST', {
              requestId,
              cylinders: cylinders.slice(0, count),
              ...(source
                ? { source: { id: source.id, version: source.version } }
                : {
                    details: {
                      ...details,
                      purchasedOn: details.purchasedOn || null,
                      locationId: details.locationId || null,
                    },
                  }),
            });
            toast(source ? 'Propane cylinders converted' : 'Propane cylinders added');
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          {source && (
            <p>
              Review the cylinders that will replace {source.name}
              {source.quantity != null && ` (${number(source.quantity, 2)} lb recorded)`}. Purchase
              details carry over.
              {exchange &&
                ' Four AmeriGas cylinders are prefilled at 15 lb each based on your purchase.'}
            </p>
          )}
          <Field label="Number of tanks">
            <Num
              label="Number of tanks"
              value={count}
              required
              min={1}
              max={100}
              onChange={(value) => {
                setCount(value);
                if (
                  value != null &&
                  Number.isInteger(value) &&
                  value > cylinders.length &&
                  value <= 100
                )
                  setCylinders((old) => [
                    ...old,
                    ...Array.from({ length: value - old.length }, (_, i) =>
                      newCylinder(old.length + i),
                    ),
                  ]);
              }}
            />
          </Field>
          {!source && (
            <div className="form-grid">
              <Field label="Brand">
                <input
                  aria-label="Brand"
                  value={details.brand}
                  onChange={(e) => setDetails({ ...details, brand: e.target.value })}
                />
              </Field>
              <Field label="Purchased on">
                <input
                  aria-label="Purchased on"
                  type="date"
                  value={details.purchasedOn}
                  onChange={(e) => setDetails({ ...details, purchasedOn: e.target.value })}
                />
              </Field>
              <Field label="Storage location">
                <select
                  aria-label="Storage location"
                  value={details.locationId}
                  onChange={(e) => setDetails({ ...details, locationId: e.target.value })}
                >
                  <option value="">Not assigned</option>
                  {state.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Shared notes">
                <input
                  aria-label="Shared notes"
                  value={details.notes}
                  onChange={(e) => setDetails({ ...details, notes: e.target.value })}
                />
              </Field>
            </div>
          )}
          <p className="footnote">Enter net propane weight. Leave unknown amounts blank.</p>
          {cylinders.slice(0, count ?? 0).map((tank, index) => (
            <fieldset className="form-grid fuel-cylinder-fields" key={index}>
              <legend>Tank {index + 1}</legend>
              <Field label="Cylinder name">
                <input
                  aria-label={`Tank ${index + 1} name`}
                  value={tank.name}
                  required
                  maxLength={200}
                  onChange={(e) => setCylinder(index, { name: e.target.value })}
                />
              </Field>
              <Field label="Rated propane capacity (lb)">
                <Num
                  label={`Tank ${index + 1} capacity`}
                  value={tank.capacity}
                  min={0.00000001}
                  onChange={(capacity) => setCylinder(index, { capacity })}
                />
              </Field>
              <Field label="Propane remaining (lb)">
                <Num
                  label={`Tank ${index + 1} remaining`}
                  value={tank.quantity}
                  max={tank.capacity ?? undefined}
                  onChange={(quantity) => setCylinder(index, { quantity })}
                />
              </Field>
            </fieldset>
          ))}
          <ErrorMessage message={error} />
        </div>
        <footer className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={busy}>
            {busy ? <Busy /> : source ? 'Convert cylinders' : 'Save propane tanks'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
