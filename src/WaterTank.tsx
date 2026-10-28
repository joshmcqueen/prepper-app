import { useState } from 'react';
import { ArrowRight, Droplets, History, RotateCw } from 'lucide-react';
import { useApp } from './App';
import { dateLabel, number } from './api';
import { AsyncButton, Field, Modal, Num, Toggle } from './ui';
import {
  addDays,
  calendarDay,
  daysBetween,
  rotationDate,
  waterTankInput,
  type Stock,
} from '../shared/model';

export function WaterTank() {
  const { state, navigate, setModal } = useApp();
  const [dialog, setDialog] = useState<{ mode: 'setup' | 'rotate'; stock?: Stock } | null>(null);
  const tanks = state.stocks.filter((s) => s.category === 'water' && s.packaging === 'tank');
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
      <p>
        Cycle your 300-gallon outdoor tank into the hot tub, then refill the tank for the next
        cycle.
      </p>
      {tanks.length === 0 ? (
        <button className="button secondary" onClick={() => setDialog({ mode: 'setup' })}>
          Set up 300-gallon tank <ArrowRight size={16} />
        </button>
      ) : (
        tanks.map((tank) => {
          const configured = tank.rotationDestination === 'hot_tub';
          return (
            <div className="water-tank" key={tank.id}>
              <h3>{tank.name}</h3>
              {configured ? (
                <>
                  <RotationTimeline tank={tank} today={today} />
                  <dl className="tank-facts">
                    <div>
                      <dt>Capacity</dt>
                      <dd>{number(tank.capacity ?? 300)} gallons</dd>
                    </div>
                    <div>
                      <dt>Recorded water</dt>
                      <dd>
                        {tank.quantity == null ? 'Unknown' : `${number(tank.quantity)} gallons`}
                      </dd>
                    </div>
                  </dl>
                  <div className="button-row wrap">
                    <button
                      className="button"
                      onClick={() => setDialog({ mode: 'rotate', stock: tank })}
                    >
                      <RotateCw size={17} /> Record hot tub rotation
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setModal({ type: 'history', stock: tank })}
                    >
                      <History size={17} /> Rotation history
                    </button>
                    <button className="text-button" onClick={() => navigate(`/item/${tank.id}`)}>
                      Tank details <ArrowRight size={15} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setDialog({ mode: 'setup', stock: tank })}
                    >
                      Edit rotation setup
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>Use this existing tank for your 300-gallon, 45-day routine.</p>
                  <button
                    className="button secondary"
                    onClick={() => setDialog({ mode: 'setup', stock: tank })}
                  >
                    Set up 45-day rotation
                  </button>
                </>
              )}
            </div>
          );
        })
      )}
      <p className="footnote">
        Due dates appear in Needs attention and use your existing email reminder settings, with a
        reminder 7 days before and on the due date.
      </p>
      {dialog && (
        <TankDialog mode={dialog.mode} stock={dialog.stock} onClose={() => setDialog(null)} />
      )}
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
      ? 'Add your last rotation date'
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
            : 'Record the last fill or completed rotation to start the timeline and reminders.'}
        </p>
      )}
      <dl className="rotation-dates">
        <div>
          <dt>Last rotated</dt>
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

function TankDialog({
  mode,
  stock,
  onClose,
}: {
  mode: 'setup' | 'rotate';
  stock?: Stock;
  onClose: () => void;
}) {
  const { state, mutate, toast } = useApp();
  const today = calendarDay(new Date(), state.settings.timezone);
  const [date, setDate] = useState(mode === 'rotate' ? today : stock?.lastRotatedOn || '');
  const [quantity, setQuantity] = useState<number | null>(stock?.quantity ?? null);
  const [refilled, setRefilled] = useState(false);
  const [note, setNote] = useState('');
  const next = date
    ? mode === 'rotate'
      ? rotationDate({ ...stock!, lastRotatedOn: date, rotationOn: null })
      : addDays(date, 45)
    : null;
  return (
    <Modal
      title={mode === 'setup' ? 'Set up your tank rotation' : 'Record hot tub rotation'}
      onClose={onClose}
    >
      <div className="modal-body form-stack">
        <p>
          {mode === 'setup'
            ? '300-gallon outdoor tank · rotate into the hot tub every 45 days. Existing water quantities stay as entered below.'
            : 'Record this after transferring the tank water into the hot tub.'}
        </p>
        <Field
          label={mode === 'setup' ? 'Last filled / rotated on' : 'Rotation completed on'}
          hint={
            mode === 'setup'
              ? 'Leave blank if unknown. Reminders start once a date is recorded.'
              : undefined
          }
        >
          <input
            type="date"
            aria-label="Tank rotation date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        {mode === 'setup' ? (
          <Field
            label="Water currently in tank (gallons)"
            hint="Capacity is 300 gallons. Leave the amount blank if unknown."
          >
            <Num
              label="Water currently in tank"
              value={quantity}
              max={300}
              onChange={setQuantity}
            />
          </Field>
        ) : (
          <>
            <Toggle
              checked={refilled}
              onChange={setRefilled}
              hint={`Only confirm after refilling. This sets recorded water to ${number(stock!.capacity!)} gallons.`}
            >
              Tank refilled to full
            </Toggle>
            <p className="footnote">
              {refilled
                ? `Recorded water will be set to ${number(stock!.capacity!)} gallons.`
                : 'Recorded water amount stays unchanged. If the tank is empty or partially filled, update the amount in Tank details.'}
            </p>
            <Field label="Rotation note (optional)">
              <textarea
                aria-label="Tank rotation note"
                value={note}
                maxLength={800}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </>
        )}
        <p>{next ? `Next rotation: ${dateLabel(next)}` : 'Next rotation: waiting for a date'}</p>
      </div>
      <footer className="modal-footer">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <AsyncButton
          disabled={(mode === 'rotate' && !date) || date > today}
          action={async () => {
            if (mode === 'setup') {
              const input = {
                ...(stock || waterTankInput()),
                capacity: 300,
                quantity,
                rotationDays: 45,
                rotationMonths: null,
                rotationDestination: 'hot_tub',
                rotationOn: null,
                lastRotatedOn: date || null,
                leadDays: 7,
                notify: true,
                snoozedUntil: null,
              };
              await mutate(
                stock ? `/api/stocks/${stock.id}` : '/api/stocks',
                stock ? 'PUT' : 'POST',
                input,
              );
              toast('Tank rotation set up · every 45 days');
            } else {
              await mutate(`/api/stocks/${stock!.id}/actions`, 'POST', {
                version: stock!.version,
                action: 'rotate_to_hot_tub',
                date,
                refilled,
                note,
              });
              toast('Hot tub rotation recorded');
            }
            onClose();
          }}
        >
          {mode === 'setup' ? 'Save tank setup' : 'Save rotation'}
        </AsyncButton>
      </footer>
    </Modal>
  );
}
