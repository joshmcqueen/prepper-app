import { useState } from 'react';
import { ArrowRight, Droplets, History, RotateCw } from 'lucide-react';
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

export function WaterTank() {
  const { state, navigate, setModal } = useApp();
  const [setup, setSetup] = useState<{ stock?: Stock } | null>(null);
  const tanks = state.stocks.filter(isWaterTank);
  const today = calendarDay(new Date(), state.settings.timezone);
  return (
    <section className="panel water-tank-panel" aria-label="Water tank rotation">
      <div className="section-heading">
        <div>
          <span className="eyebrow">WATER THAT KEEPS MOVING</span>
          <h2>
            <Droplets size={22} /> Tank → hot tub
          </h2>
        </div>
        <span className="status-pill">Outdoor water reserve</span>
      </div>
      <p>Cycle your outdoor tank into the hot tub, then record how much fresh water goes in.</p>
      {tanks.length === 0 ? (
        <button className="button secondary" onClick={() => setSetup({})}>
          Set up water tank <ArrowRight size={16} />
        </button>
      ) : (
        tanks.map((tank) => {
          const configured = tank.rotationDestination === 'hot_tub';
          return (
            <div className="water-tank" key={tank.id}>
              <h3>{tank.name}</h3>
              {configured && <RotationTimeline tank={tank} today={today} />}
              <dl className="tank-facts">
                <div>
                  <dt>Capacity</dt>
                  <dd>
                    {tank.capacity == null ? 'Unknown' : `${number(tank.capacity, 8)} gallons`}
                  </dd>
                </div>
                <div>
                  <dt>Recorded water</dt>
                  <dd>
                    {tank.quantity == null ? 'Unknown' : `${number(tank.quantity, 8)} gallons`}
                  </dd>
                </div>
              </dl>
              <div className="button-row wrap">
                <button
                  className="button"
                  onClick={() => setModal({ type: 'tank-maintenance', stock: tank })}
                >
                  <RotateCw size={17} /> Record maintenance
                </button>
                <button
                  className="button secondary"
                  onClick={() => setModal({ type: 'history', stock: tank })}
                >
                  <History size={17} /> Tank history
                </button>
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
      <p className="footnote">
        Due dates appear in Needs attention and use your existing email reminder settings, with a
        reminder 7 days before and on the due date.
      </p>
      {setup && <TankSetupDialog stock={setup.stock} onClose={() => setSetup(null)} />}
    </section>
  );
}

function RotationTimeline({ tank, today }: { tank: Stock; today: string }) {
  const due = rotationDate(tank);
  const days = due ? daysBetween(today, due) : null;
  const cycleDays = due && tank.lastRotatedOn ? daysBetween(tank.lastRotatedOn, due) : 0;
  const elapsed = cycleDays > 0 ? Math.max(0, Math.min(cycleDays, cycleDays - days!)) : null;
  const progress = elapsed == null ? 0 : (elapsed / cycleDays) * 100;
  const lead = tank.leadDays ?? (tank.highPriority ? 90 : 30);
  const reminder = due ? addDays(due, -lead) : null;
  const reminderPosition = cycleDays > 0 ? ((cycleDays - lead) / cycleDays) * 100 : null;
  const interval = tank.rotationDays
    ? `Every ${tank.rotationDays} days`
    : `Every ${tank.rotationMonths} months`;
  const status =
    days == null
      ? 'Waiting for a fresh fill'
      : days === 0
        ? 'Rotation due today'
        : `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ${days < 0 ? 'overdue' : 'until rotation'}`;
  return (
    <div className={`rotation-timeline ${days != null && days <= 0 ? 'rotation-due' : ''}`}>
      <div className="rotation-countdown">
        <div aria-label={status}>
          {days == null || days === 0 ? (
            <strong className="rotation-status">{status}</strong>
          ) : (
            <>
              <strong>{Math.abs(days)}</strong>
              <span>
                {Math.abs(days) === 1 ? 'day' : 'days'} {days < 0 ? 'overdue' : 'until rotation'}
              </span>
            </>
          )}
        </div>
        <span className="rotation-interval">{interval}</span>
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
      ) : (
        <p className="footnote rotation-start-hint">
          {due
            ? 'Record the last rotation date to show cycle progress.'
            : 'Record a fresh fill to start the timeline and reminders.'}
        </p>
      )}
      <dl className="rotation-dates">
        <div>
          <dt>Cycle started</dt>
          <dd>{dateLabel(tank.lastRotatedOn)}</dd>
        </div>
        <div>
          <dt>
            <span className="rotation-reminder-key" aria-hidden="true" />
            Reminder window
          </dt>
          <dd>{dateLabel(reminder)}</dd>
        </div>
        <div>
          <dt>Rotate & refill</dt>
          <dd>{dateLabel(due)}</dd>
        </div>
      </dl>
    </div>
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
