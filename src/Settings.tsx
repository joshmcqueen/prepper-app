import { useState } from 'react';
import {
  ArrowDownToLine,
  Check,
  Download,
  HardDrive,
  Mail,
  MapPin,
  Plus,
  Save,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useApp, PageHeading } from './App';
import { api, download } from './api';
import { AsyncButton, Busy, ErrorMessage, Field, Modal, Num, Toggle } from './ui';
import { settingsSchema, type Settings, type Location } from '../shared/model';

export function SettingsPage() {
  const { state, reload, toast, mutate } = useApp();
  const [resetMode, setResetMode] = useState<'empty' | 'demo' | null>(null);
  const [form, setForm] = useState<Settings>(state.settings),
    [recipients, setRecipients] = useState(state.settings.recipients.join(', ')),
    [categories, setCategories] = useState(state.settings.supplyCategories.join(', ')),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [newLocation, setNewLocation] = useState('');
  const field = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const save = async (event: React.SubmitEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const parsed = settingsSchema.safeParse({
        ...form,
        recipients: recipients
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        supplyCategories: [
          ...new Set(
            categories
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ],
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        );
      const saved = await api<Settings>('/api/settings', 'PUT', parsed.data);
      setForm(saved);
      await reload();
      toast('Settings saved');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const numeric = (
    key:
      | 'adults'
      | 'dogWeightLb'
      | 'caloriesPerAdult'
      | 'waterPerAdult'
      | 'dogWaterGallons'
      | 'dogRationGrams'
      | 'lowDays'
      | 'labelWidth'
      | 'labelHeight',
    label: string,
    hint?: string,
  ) => (
    <Field label={label} hint={hint}>
      <Num
        label={label}
        value={form[key]}
        onChange={(v) => field(key, v as never)}
        min={key === 'adults' ? 1 : key === 'labelWidth' || key === 'labelHeight' ? 20 : 0}
        max={key === 'labelWidth' ? 50 : key === 'labelHeight' ? 150 : undefined}
        required={['adults', 'dogWeightLb', 'lowDays', 'labelWidth', 'labelHeight'].includes(key)}
      />
    </Field>
  );
  return (
    <>
      <PageHeading
        eyebrow="MAKE HAVEN YOURS"
        title="A plan for your household."
        description="Daily needs, goals, and reminders that fit the way you prepare."
      />
      <form onSubmit={save} className="settings-form">
        <div className="settings-nav">
          {[
            ['household', 'Household'],
            ['goals', 'Goals'],
            ['equipment', 'Fuel'],
            ['notifications', 'Email'],
            ['storage', 'Storage'],
            ['labels', 'Labels'],
            ['backup', 'Backup'],
            ['database', 'Reset'],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </div>
        <section className="panel settings-section" id="household">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE PEOPLE YOU’RE PREPARING FOR</span>
              <h2>Household & daily needs</h2>
            </div>
            <Settings2 size={22} />
          </div>
          <p className="section-description">
            These are your planning inputs, not dietary prescriptions. Leave a field blank until you
            know it; totals will still be tracked.
          </p>
          <div className="form-grid">
            <Field label="Household name">
              <input
                aria-label="Household name"
                value={form.householdName}
                required
                onChange={(e) => field('householdName', e.target.value)}
              />
            </Field>
            {numeric('adults', 'Number of adults')}
            {numeric('caloriesPerAdult', 'Calories per adult per day')}
            {numeric('waterPerAdult', 'Water gallons per adult per day')}
            {numeric('dogWeightLb', 'Dog weight (lb)')}
            {numeric(
              'dogRationGrams',
              'Dog food grams per day',
              'Use your measured daily ration. Dog food must be recorded in a weight unit for coverage.',
            )}
            {numeric(
              'dogWaterGallons',
              'Dog water gallons per day',
              'Included in household water coverage.',
            )}
            <Field label="Timezone">
              <input
                aria-label="Timezone"
                required
                value={form.timezone}
                onChange={(e) => field('timezone', e.target.value)}
                placeholder="America/Los_Angeles"
              />
            </Field>
          </div>
        </section>
        <section className="panel settings-section" id="goals">
          <span className="eyebrow">WATCH YOUR RESERVE GROW</span>
          <h2>Coverage goals</h2>
          <p className="section-description">
            Goals show your progress. A separate low-stock threshold controls attention and email
            alerts.
          </p>
          <div className="form-grid">
            {(['food', 'water', 'fuel', 'dog'] as const).map((category) => (
              <Field
                key={category}
                label={`${category === 'dog' ? 'Dog food' : category[0].toUpperCase() + category.slice(1)} goal (days)`}
              >
                <Num
                  label={`${category} goal`}
                  value={form.targets[category]}
                  required
                  min={1}
                  onChange={(n) =>
                    setForm((f) => ({ ...f, targets: { ...f.targets, [category]: n as number } }))
                  }
                />
              </Field>
            ))}
            {numeric('lowDays', 'Low-stock warning below (days)')}
          </div>
          <Field
            label="Supply categories"
            hint="Separate categories with commas. Each supply can have its own minimum quantity."
          >
            <textarea
              aria-label="Supply categories"
              rows={2}
              value={categories}
              onChange={(e) => setCategories(e.target.value)}
            />
          </Field>
        </section>
        <section className="panel settings-section" id="equipment">
          <span className="eyebrow">UNDERSTAND THE ASSUMPTIONS</span>
          <h2>Fuel & equipment</h2>
          <Toggle
            checked={form.naturalGasAvailable}
            onChange={(v) => field('naturalGasAvailable', v)}
            hint="Treat cooking and generation as utility-powered; preserve stored fuel as a separate reserve."
          >
            Natural gas available
          </Toggle>
          <Toggle checked={form.generatorNeeded} onChange={(v) => field('generatorNeeded', v)}>
            Generator needed
          </Toggle>
          <p className="section-description">
            During a gas outage, active equipment shares its fuel reserve. Propane rates use
            lb/hour; gasoline and diesel use gallons/hour. Different fuels are alternatives, not a
            combined reserve. Starter rates are illustrative until you replace them with your
            equipment’s figures.
          </p>
          {form.equipment.map((equipment, i) => (
            <div className="equipment-row" key={equipment.id}>
              <div className="form-grid">
                <Field label="Equipment name">
                  <input
                    aria-label={`Equipment ${i + 1} name`}
                    required
                    value={equipment.name}
                    onChange={(e) =>
                      field(
                        'equipment',
                        form.equipment.map((v, j) =>
                          i === j ? { ...v, name: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Purpose">
                  <select
                    aria-label={`Equipment ${i + 1} purpose`}
                    value={equipment.use}
                    onChange={(e) =>
                      field(
                        'equipment',
                        form.equipment.map((v, j) =>
                          i === j ? { ...v, use: e.target.value as 'cooking' | 'generator' } : v,
                        ),
                      )
                    }
                  >
                    <option value="cooking">Cooking</option>
                    <option value="generator">Generation</option>
                  </select>
                </Field>
                <Field label="Fuel">
                  <select
                    aria-label={`Equipment ${i + 1} fuel`}
                    value={equipment.fuel}
                    onChange={(e) =>
                      field(
                        'equipment',
                        form.equipment.map((v, j) =>
                          i === j ? { ...v, fuel: e.target.value as typeof equipment.fuel } : v,
                        ),
                      )
                    }
                  >
                    {['propane', 'gasoline', 'diesel'].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={`Consumption (${equipment.fuel === 'propane' ? 'lb' : 'gallons'}/hour)`}
                >
                  <Num
                    label={`Equipment ${i + 1} rate`}
                    value={equipment.rate}
                    required
                    onChange={(n) =>
                      field(
                        'equipment',
                        form.equipment.map((v, j) => (i === j ? { ...v, rate: n as number } : v)),
                      )
                    }
                  />
                </Field>
                <Field label="Operating hours per day">
                  <Num
                    label={`Equipment ${i + 1} hours`}
                    value={equipment.hours}
                    max={24}
                    required
                    onChange={(n) =>
                      field(
                        'equipment',
                        form.equipment.map((v, j) => (i === j ? { ...v, hours: n as number } : v)),
                      )
                    }
                  />
                </Field>
                <div className="equipment-controls">
                  <label>
                    <input
                      type="checkbox"
                      checked={equipment.illustrative}
                      onChange={(e) =>
                        field(
                          'equipment',
                          form.equipment.map((v, j) =>
                            i === j ? { ...v, illustrative: e.target.checked } : v,
                          ),
                        )
                      }
                    />
                    Illustrative assumption
                  </label>
                  <button
                    className="icon-button danger-text"
                    type="button"
                    aria-label={`Remove ${equipment.name}`}
                    onClick={() =>
                      field(
                        'equipment',
                        form.equipment.filter((_, j) => i !== j),
                      )
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              field('equipment', [
                ...form.equipment,
                {
                  id: crypto.randomUUID(),
                  name: 'New equipment',
                  fuel: 'propane',
                  use: 'generator',
                  rate: 1,
                  hours: 1,
                  illustrative: true,
                },
              ])
            }
          >
            <Plus size={17} />
            Add equipment / fuel alternative
          </button>
        </section>
        <section className="panel settings-section" id="notifications">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE RIGHT NUDGE, AT THE RIGHT TIME</span>
              <h2>Email reminders</h2>
            </div>
            <span className={`status-pill ${state.integrations.email ? 'connected' : ''}`}>
              {state.integrations.email ? 'SMTP configured' : 'SMTP needs setup'}
            </span>
          </div>
          <div className="form-grid">
            <Field label="Email recipients" hint="Separate your email addresses with commas.">
              <textarea
                aria-label="Email recipients"
                rows={2}
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                placeholder="you@example.com, partner@example.com"
              />
            </Field>
            <Field label="Summary schedule">
              <select
                aria-label="Summary schedule"
                value={form.digest}
                onChange={(e) => field('digest', e.target.value as Settings['digest'])}
              >
                <option value="weekly">Weekly · Monday at 9 a.m.</option>
                <option value="monthly">Monthly · 1st at 9 a.m.</option>
                <option value="off">No scheduled summary</option>
              </select>
            </Field>
          </div>
          <Toggle
            checked={form.emailAlerts}
            onChange={(v) => field('emailAlerts', v)}
            hint="Separate from summaries. Standard items: 30 days, 7 days, and the due date. High-priority items also alert at 90 days."
          >
            Send approaching-date, rotation, and low-stock alerts
          </Toggle>
          <p className="footnote">
            Times use {form.timezone}. Per-item switches, custom lead times, priority, and snoozing
            live on each resource. SMTP credentials stay in the server’s .env file.
          </p>
          <AsyncButton
            className="button secondary"
            action={async () => {
              await api('/api/email/test', 'POST', {
                recipients: recipients
                  .split(/[,;\n]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
              toast('Test email sent');
            }}
          >
            <Mail size={17} />
            Send test email
          </AsyncButton>
          {state.deliveries.length > 0 && (
            <details className="form-details">
              <summary>Delivery history</summary>
              {state.deliveries.map((d) => (
                <div className="delivery-row" key={d.id}>
                  <div>
                    <strong>{d.subject}</strong>
                    <small>
                      {new Date(d.createdAt).toLocaleString()} · {d.attempts} attempt
                      {d.attempts === 1 ? '' : 's'}
                    </small>
                    {d.error && <small>{d.error}</small>}
                  </div>
                  <span className="status-pill">{d.status}</span>
                  {d.status === 'failed' && (
                    <AsyncButton
                      className="button small secondary"
                      action={() => mutate(`/api/email/${encodeURIComponent(d.id)}/retry`, 'POST')}
                    >
                      Retry
                    </AsyncButton>
                  )}
                </div>
              ))}
            </details>
          )}
        </section>
        <section className="panel settings-section" id="storage">
          <span className="eyebrow">KNOW WHERE TO LOOK</span>
          <h2>Storage locations</h2>
          <p className="section-description">
            Add places such as Garage, Attic, or Closet. Items can live directly in a location or
            inside a bucket. Move a bucket from Storage & buckets and all its bags follow.
          </p>
          {state.locations.map((l) => (
            <LocationRow key={l.id} location={l} />
          ))}
          <div className="inline-input">
            <input
              aria-label="Add storage location"
              placeholder="e.g. Garage, attic, hallway closet"
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
            />
            <AsyncButton
              className="button secondary"
              disabled={!newLocation.trim()}
              action={async () => {
                await mutate('/api/locations', 'POST', { name: newLocation });
                setNewLocation('');
                toast('Location added');
              }}
            >
              <Plus size={17} />
              Add
            </AsyncButton>
          </div>
        </section>
        <section className="panel settings-section" id="labels">
          <span className="eyebrow">A LABEL NOW, LESS GUESSING LATER</span>
          <h2>Phomemo M110 labels</h2>
          <div className="form-grid">
            {numeric(
              'labelWidth',
              'Label width (mm)',
              'The M110 supports widths from 20 to 50 mm.',
            )}
            {numeric('labelHeight', 'Label height (mm)')}
            <Field
              label="App address for QR codes"
              className="full"
              hint="Use a stable address reachable from your phone, such as your mini-PC’s local hostname."
            >
              <input
                aria-label="App address for QR codes"
                type="url"
                required
                value={form.appBaseUrl}
                onChange={(e) => field('appBaseUrl', e.target.value)}
              />
            </Field>
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() => field('appBaseUrl', window.location.origin)}
          >
            Use this browser’s address
          </button>
          <p className="footnote">
            Small labels use a compact name, ID, and QR layout. Use 50 × 80 mm to include quantities
            and dates. Export PNG, PDF, or plain-data Excel batches from inventory. Use Print Master
            for your M110; direct browser Bluetooth printing is not included.
          </p>
        </section>
        <section className="panel settings-section" id="backup">
          <div className="section-heading">
            <div>
              <span className="eyebrow">KEEP A SECOND COPY</span>
              <h2>Backup & integrations</h2>
            </div>
            <HardDrive size={24} />
          </div>
          <p>
            A backup includes a consistent database snapshot, photos, and a version manifest. Server
            secrets are excluded.
          </p>
          <AsyncButton
            className="button secondary"
            action={async () => {
              await download(
                '/api/backup',
                `haven-backup-${new Date().toISOString().slice(0, 10)}.zip`,
              );
              toast('Backup downloaded');
            }}
          >
            <Download size={17} />
            Download backup
          </AsyncButton>
          <p className="footnote">
            Restore into a fresh data folder with the documented restore command. Scheduled S3
            backups and Docker/Dokploy packaging are planned for a later milestone.
          </p>
          <div className="integration-row">
            <span>OpenAI photo & voice assistance</span>
            <span className="status-pill">
              {state.integrations.ai ? 'API key configured' : 'Add OPENAI_API_KEY to .env'}
            </span>
          </div>
          <div className="integration-row">
            <span>Email delivery</span>
            <span className="status-pill">
              {state.integrations.email ? 'SMTP configured' : 'Add SMTP settings to .env'}
            </span>
          </div>
        </section>
        <section className="panel settings-section database-section" id="database">
          <span className="eyebrow">A FRESH START, WHENEVER YOU NEED ONE</span>
          <h2>Reset & sample data</h2>
          <p>
            Start completely fresh, or explore a full sample household. Both options clear all
            inventory, settings, buckets, photos, adjustments, and email history. Download a backup
            first if there is anything you want to keep.
          </p>
          <div className="button-row wrap">
            <button
              type="button"
              className="button secondary"
              onClick={() => setResetMode('empty')}
            >
              <Trash2 size={17} />
              Reset to empty
            </button>
            <button type="button" className="button secondary" onClick={() => setResetMode('demo')}>
              <Plus size={17} />
              Reset & load sample data
            </button>
          </div>
          <p className="footnote">
            Sample data includes all resource categories, labeled buckets, photos, incomplete
            records, low stock, and upcoming dates. Email recipients are blank so demo reminders are
            not sent.
          </p>
        </section>
        <div className="settings-save">
          <ErrorMessage message={error} />
          <span>Changes apply after saving.</span>
          <button className="button" disabled={busy}>
            {busy ? (
              <Busy label="Saving…" />
            ) : (
              <>
                <Save size={17} />
                Save settings
              </>
            )}
          </button>
        </div>
        {resetMode && (
          <Modal
            title={
              resetMode === 'demo'
                ? 'Replace everything with sample data?'
                : 'Reset this household to empty?'
            }
            onClose={() => setResetMode(null)}
          >
            <div className="modal-body">
              <p>
                This permanently clears all inventory and settings, including your email recipients
                and photos.{' '}
                {resetMode === 'demo'
                  ? 'A fictional household will be loaded for you to explore.'
                  : 'You will return to the original empty setup.'}
              </p>
            </div>
            <footer className="modal-footer">
              <button type="button" className="button secondary" onClick={() => setResetMode(null)}>
                Keep current data
              </button>
              <AsyncButton
                className="button danger"
                action={async () => {
                  await api('/api/database/reset', 'POST', {
                    mode: resetMode,
                    confirmation: 'RESET',
                  });
                  window.location.reload();
                }}
              >
                {resetMode === 'demo' ? 'Reset & load sample data' : 'Reset everything'}
              </AsyncButton>
            </footer>
          </Modal>
        )}
      </form>
    </>
  );
}
function LocationRow({ location }: { location: Location }) {
  const { mutate, toast } = useApp();
  const [name, setName] = useState(location.name);
  return (
    <div className="location-row">
      <MapPin size={17} />
      <input
        aria-label={`Location ${location.name}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <AsyncButton
        className="icon-button"
        disabled={name === location.name || !name.trim()}
        action={async () => {
          await mutate(`/api/locations/${location.id}`, 'PUT', { name });
          toast('Location renamed');
        }}
      >
        <Check size={18} />
      </AsyncButton>
    </div>
  );
}
