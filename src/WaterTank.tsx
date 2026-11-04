import { useId, useState } from 'react';
import { ArrowRight, CalendarDays, History, RotateCw } from 'lucide-react';
import { useApp } from './App';
import { dateLabel, number } from './api';
import { AsyncButton, Field, Modal, Num } from './ui';
import {
  addDays,
  calendarDay,
  daysBetween,
  isWaterTank,
  rotationDate,
  waterTankInput,
  type Stock,
} from '../shared/model';

export function WaterTank({ today }: { today: string }) {
  const { state, navigate, setModal } = useApp();
  const [setup, setSetup] = useState<{ stock?: Stock } | null>(null);
  const tanks = state.stocks.filter(isWaterTank);
  return (
    <section className="panel water-tank-panel" aria-label="Water tank rotation">
      <div className="section-heading">
        <h2>Outdoor water tank</h2>
      </div>
      {tanks.length === 0 ? (
        <button className="button secondary" onClick={() => setSetup({})}>
          Set up water tank <ArrowRight size={16} />
        </button>
      ) : (
        tanks.map((tank) => {
          const configured = tank.rotationDestination === 'hot_tub';
          return (
            <div className="water-tank" key={tank.id}>
              {(tanks.length > 1 || tank.name !== 'Outdoor water tank') && <h3>{tank.name}</h3>}
              <TankReadout tank={tank} today={today} configured={configured} />
              <div className="button-row wrap tank-actions">
                <button
                  className="button small"
                  onClick={() => setModal({ type: 'tank-maintenance', stock: tank })}
                >
                  <RotateCw size={17} /> Record maintenance
                </button>
                <button
                  className="button small secondary"
                  onClick={() => setModal({ type: 'history', stock: tank })}
                >
                  <History size={17} /> Tank history
                </button>
              </div>
              <div className="button-row wrap tank-secondary-actions">
                <button className="text-button" onClick={() => navigate(`/item/${tank.id}`)}>
                  Tank details <ArrowRight size={15} />
                </button>
                <button className="text-button" onClick={() => setSetup({ stock: tank })}>
                  {configured ? 'Edit rotation setup' : 'Set up 45-day rotation'}
                </button>
              </div>
            </div>
          );
        })
      )}
      {setup && <TankSetupDialog stock={setup.stock} onClose={() => setSetup(null)} />}
    </section>
  );
}

function TankReadout({
  tank,
  today,
  configured,
}: {
  tank: Stock;
  today: string;
  configured: boolean;
}) {
  const { quantity, capacity } = tank;
  const level = quantity != null && capacity ? Math.min(1, quantity / capacity) : null;
  const due = configured ? rotationDate(tank) : null;
  const days = due ? daysBetween(today, due) : null;
  const cycleDays = due && tank.lastRotatedOn ? daysBetween(tank.lastRotatedOn, due) : 0;
  const elapsed = cycleDays > 0 ? Math.max(0, Math.min(cycleDays, cycleDays - days!)) : null;
  const progress = elapsed == null ? 0 : (elapsed / cycleDays) * 100;
  const lead = tank.leadDays ?? (tank.highPriority ? 90 : 30);
  const reminder = due ? addDays(due, -lead) : null;
  const reminderPosition = cycleDays > 0 ? ((cycleDays - lead) / cycleDays) * 100 : null;
  const status =
    days == null
      ? 'Waiting for a fresh fill'
      : days === 0
        ? 'Rotation due today'
        : `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ${days < 0 ? 'overdue' : 'until rotation'}`;
  return (
    <div className={`rotation-timeline ${days != null && days <= 0 ? 'rotation-due' : ''}`}>
      <div className="tank-readout">
        <TankGauge level={level} />
        <div className="tank-readout-text">
          <div className="tank-level">
            <p>
              {quantity == null ? (
                <strong>Amount unknown</strong>
              ) : (
                <>
                  <strong>{number(quantity, 8)}</strong>
                  {capacity ? ` of ${number(capacity, 8)} gal` : ' gal recorded'}
                </>
              )}
            </p>
            <p>
              {level == null
                ? quantity === 0
                  ? 'Empty'
                  : 'Fill level unknown'
                : `${number(level * 100)}% full`}
              {quantity == null && capacity ? ` · ${number(capacity, 8)} gal capacity` : ''}
            </p>
          </div>
          {configured && (
            <div className="rotation-countdown">
              <div aria-label={status}>
                {days == null || days === 0 ? (
                  <strong className="rotation-status">{status}</strong>
                ) : (
                  <>
                    <strong>{Math.abs(days)}</strong>
                    <span>
                      {Math.abs(days) === 1 ? 'day' : 'days'}{' '}
                      {days < 0 ? 'overdue' : 'until rotation'}
                    </span>
                  </>
                )}
              </div>
              {due && (
                <p className="tank-due-date">
                  <CalendarDays size={15} aria-hidden="true" />
                  <time dateTime={due}>{dateLabel(due)}</time>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {elapsed != null ? (
        <>
          <div
            className="rotation-track"
            role="progressbar"
            aria-label="Rotation cycle elapsed"
            aria-valuemin={0}
            aria-valuemax={cycleDays}
            aria-valuenow={elapsed}
            aria-valuetext={`${elapsed} of ${cycleDays} days elapsed. ${status}.`}
          >
            <span className="rotation-elapsed" style={{ width: `${progress}%` }} />
            {reminderPosition != null && reminderPosition > 0 && reminderPosition < 100 && (
              <span className="rotation-reminder-marker" style={{ left: `${reminderPosition}%` }} />
            )}
            <span className="rotation-today-marker" style={{ left: `${progress}%` }} />
          </div>
        </>
      ) : null}
      {configured && (
        <details className="rotation-details">
          <summary>Rotation details</summary>
          <dl className="rotation-dates">
            <div>
              <dt>Cycle started</dt>
              <dd>{dateLabel(tank.lastRotatedOn)}</dd>
            </div>
            <div>
              <dt>Reminder window</dt>
              <dd>{dateLabel(reminder)}</dd>
            </div>
          </dl>
          <p className="footnote">
            {tank.rotationDays
              ? `Every ${tank.rotationDays} days`
              : `Every ${tank.rotationMonths} months`}
          </p>
        </details>
      )}
    </div>
  );
}

function TankGauge({ level }: { level: number | null }) {
  const clip = useId();
  const body =
    'M55 17H85L124 36Q127 38 127 42L117 174Q116 193 101 202Q88 210 70 210Q52 210 39 202Q24 193 23 174L13 42Q13 38 16 36Z';
  const line = 210 - (level ?? 0) * 173;
  return (
    <svg viewBox="0 0 140 218" aria-hidden="true" className="tank-gauge">
      <defs>
        <clipPath id={clip}>
          <path d={body} />
        </clipPath>
      </defs>
      <rect x="53" y="11" width="34" height="9" rx="2" className="tank-hardware" />
      <rect x="59" y="6" width="22" height="6" rx="2" className="tank-hardware" />
      <path d={body} className="vessel-interior" />
      {level != null && level > 0 && (
        <g clipPath={`url(#${clip})`}>
          <rect x="0" y={line} width="140" height={210 - line} className="vessel-water" />
          <path d={`M0 ${line}H140`} className="tank-waterline" />
        </g>
      )}
      <path d={body} className="tank-outline" />
      <circle cx="70" cy="32" r="5" className="tank-hardware" />
      <circle cx="70" cy="201" r="5" className="tank-hardware" />
    </svg>
  );
}

function TankSetupDialog({ stock, onClose }: { stock?: Stock; onClose: () => void }) {
  const { state, mutate, toast } = useApp();
  const today = calendarDay(new Date(), state.settings.timezone);
  const defaults = waterTankInput();
  const [date, setDate] = useState(stock?.lastRotatedOn ?? '');
  const [capacity, setCapacity] = useState(stock?.capacity || defaults.capacity);
  const [quantity, setQuantity] = useState(stock?.quantity ?? null);
  const configured = stock?.rotationDestination === 'hot_tub';
  const input = {
    ...defaults,
    locationId: state.locations.find((l) => l.id === 'LOC-OUTDOORS')?.id ?? null,
    ...stock,
    capacity,
    quantity,
    rotationDays: configured ? stock.rotationDays : defaults.rotationDays,
    rotationMonths: configured ? stock.rotationMonths : null,
    rotationDestination: 'hot_tub' as const,
    rotationOn: configured && date === (stock.lastRotatedOn ?? '') ? stock.rotationOn : null,
    lastRotatedOn: date || null,
    leadDays: configured ? stock.leadDays : defaults.leadDays,
    notify: configured ? stock.notify : defaults.notify,
    snoozedUntil: configured ? stock.snoozedUntil : null,
  };
  const next = rotationDate(input);
  return (
    <Modal
      title={configured ? 'Edit tank rotation setup' : 'Set up your tank rotation'}
      onClose={onClose}
    >
      <div className="modal-body form-stack">
        <Field label="Physical capacity (gallons)" hint="Enter the maximum your tank can hold.">
          <Num label="Physical capacity" value={capacity} onChange={setCapacity} />
        </Field>
        <Field label="Water currently in tank (gallons)" hint="Leave the amount blank if unknown.">
          <Num
            label="Water currently in tank"
            value={quantity}
            max={capacity ?? undefined}
            onChange={setQuantity}
          />
        </Field>
        <Field
          label="Last filled / rotated on"
          hint="Leave blank if unknown. You can start the countdown by recording a fresh fill."
        >
          <input
            type="date"
            aria-label="Tank rotation date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <p>
          {next ? `Next rotation ${dateLabel(next)}` : 'Next rotation is waiting for a fill date.'}
        </p>
      </div>
      <footer className="modal-footer">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <AsyncButton
          disabled={date > today}
          action={async () => {
            await mutate(
              stock ? `/api/stocks/${stock.id}` : '/api/stocks',
              stock ? 'PUT' : 'POST',
              input,
            );
            toast('Tank setup saved');
            onClose();
          }}
        >
          Save tank setup
        </AsyncButton>
      </footer>
    </Modal>
  );
}
