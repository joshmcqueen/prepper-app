import { useState } from 'react';
import { useApp } from './App';
import { Busy, ErrorMessage, Field, Modal, Num } from './ui';
import type { JugChanges, Stock } from '../shared/model';

const dateFields = [
  ['purchasedOn', 'Purchase date'],
  ['bestBy', 'Best-by date'],
  ['expiresOn', 'Expiration date'],
  ['lastRotatedOn', 'Last filled / rotated date'],
] as const;

export function WaterJugsModal({ stocks, onClose }: { stocks?: Stock[]; onClose: () => void }) {
  const { state, mutate, toast } = useApp();
  const editing = !!stocks;
  const [count, setCount] = useState<number | null>(6);
  const [details, setDetails] = useState<JugChanges>(() => ({
    quantity: 5,
    capacity: 5,
    rotationMonths: 12,
    locationId: state.locations.find((l) => l.id === 'LOC-STORAGE')?.id ?? null,
    purchasedOn: null,
    bestBy: null,
    expiresOn: null,
    lastRotatedOn: null,
    notes: '',
    notify: true,
    ...(stocks?.[0]
      ? Object.fromEntries(
          [
            'quantity',
            'capacity',
            'rotationMonths',
            'locationId',
            'purchasedOn',
            'bestBy',
            'expiresOn',
            'lastRotatedOn',
            'notes',
            'notify',
          ].map((key) => [key, stocks[0][key as keyof Stock]]),
        )
      : {}),
  }));
  const [selected, setSelected] = useState<Set<keyof JugChanges>>(new Set());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const change = <K extends keyof JugChanges>(key: K, value: JugChanges[K]) =>
    setDetails((d) => ({ ...d, [key]: value }));
  const control = (key: keyof JugChanges, label: string, children: React.ReactNode) => (
    <div className="jug-field" key={key}>
      {editing && (
        <label className="bulk-apply">
          <input
            type="checkbox"
            aria-label={`Change ${label}`}
            checked={selected.has(key)}
            onChange={(e) =>
              setSelected((old) => {
                const next = new Set(old);
                if (e.target.checked) next.add(key);
                else next.delete(key);
                return next;
              })
            }
          />{' '}
          Apply to selected jugs
        </label>
      )}
      <fieldset disabled={busy || (editing && !selected.has(key))}>
        <Field label={label}>{children}</Field>
      </fieldset>
    </div>
  );
  return (
    <Modal
      title={editing ? `Edit ${stocks.length} water jugs` : 'Add water jugs'}
      subtitle={
        editing
          ? 'Choose the details to apply. All other values stay as recorded.'
          : 'Enter shared details once. Each jug gets its own inventory entry.'
      }
      onClose={onClose}
    >
      <form
        className="water-jugs-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            if (editing) {
              const changes = Object.fromEntries([...selected].map((key) => [key, details[key]]));
              await mutate('/api/water-jugs', 'PUT', {
                items: stocks.map(({ id, version }) => ({ id, version })),
                changes,
              });
            } else await mutate('/api/water-jugs', 'POST', { count, details });
            toast(editing ? 'Selected jugs updated' : `${count} water jugs added`);
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          {!editing && (
            <Field label="Number of jugs">
              <Num
                label="Number of jugs"
                value={count}
                min={1}
                max={100}
                required
                onChange={setCount}
              />
            </Field>
          )}
          <p className="footnote">
            Amounts are per jug. Leave unknown dates or amounts blank. Tank setup is separate.
          </p>
          <div className="form-grid">
            {control(
              'quantity',
              'Gallons in each jug',
              <Num
                label="Gallons in each jug"
                value={details.quantity ?? null}
                onChange={(n) => change('quantity', n)}
              />,
            )}
            {control(
              'capacity',
              'Jug capacity (gallons)',
              <Num
                label="Jug capacity (gallons)"
                value={details.capacity ?? null}
                onChange={(n) => change('capacity', n)}
              />,
            )}
            {control(
              'locationId',
              'Jug location',
              <select
                aria-label="Jug location"
                value={details.locationId ?? ''}
                onChange={(e) => change('locationId', e.target.value || null)}
              >
                <option value="">Not assigned</option>
                {state.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>,
            )}
            {control(
              'rotationMonths',
              'Rotation interval (months)',
              <Num
                label="Rotation interval (months)"
                min={1}
                max={1200}
                value={details.rotationMonths ?? null}
                onChange={(n) => change('rotationMonths', n)}
              />,
            )}
            {dateFields.map(([key, label]) =>
              control(
                key,
                label,
                <input
                  type="date"
                  aria-label={label}
                  value={details[key] ?? ''}
                  onChange={(e) => change(key, e.target.value || null)}
                />,
              ),
            )}
          </div>
          {control(
            'notes',
            'Jug notes',
            <textarea
              aria-label="Jug notes"
              value={details.notes ?? ''}
              onChange={(e) => change('notes', e.target.value)}
            />,
          )}
          {control(
            'notify',
            'Jug reminders',
            <select
              aria-label="Jug reminders"
              value={details.notify ? 'on' : 'off'}
              onChange={(e) => change('notify', e.target.value === 'on')}
            >
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>,
          )}
          <ErrorMessage message={error} />
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={busy || (editing && !selected.size)}>
            {busy ? <Busy /> : editing ? 'Save jug details' : 'Add jugs'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
