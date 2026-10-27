import { useEffect, useRef, useState } from 'react';
import { Camera, Check, ImagePlus, Mic, Plus, Sparkles, Square, Trash2, X } from 'lucide-react';
import { categoryNames, api } from './api';
import { useApp } from './App';
import { AsyncButton, Busy, ErrorMessage, Field, Modal, Num, Toggle } from './ui';
import {
  stockInputSchema,
  unitSchema,
  type Category,
  type Stock,
  type StockInput,
  type Unit,
} from '../shared/model';

type Draft = {
  name: string | null;
  brand: string | null;
  description: string | null;
  notes: string | null;
  quantity: number | null;
  unit: Unit | null;
  purchasedOn: string | null;
  bestBy: string | null;
  expiresOn: string | null;
  nutrition: {
    servingSize: number | null;
    servingUnit: Unit | null;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  };
  reviewNotes: string[];
};
const packagingLabels: Record<StockInput['packaging'], string> = {
  original: 'Original package',
  mylar_1: '1-gallon Mylar bag',
  mylar_3: '3-gallon Mylar bag',
  mylar_5: '5-gallon Mylar bag',
  bucket: 'Food-safe bucket',
  tank: 'Tank',
  jug: 'Jug',
  other: 'Other',
};
export function StockEditor({
  category,
  stock,
  duplicate,
  onClose,
}: {
  category: Category;
  stock?: Stock;
  duplicate?: boolean;
  onClose: () => void;
}) {
  const { state, reload, toast, navigate, mutate } = useApp();
  const [form, setForm] = useState<StockInput>(() =>
    stock
      ? { ...stock, name: duplicate ? `${stock.name} (copy)` : stock.name }
      : {
          ...stockInputSchema.parse({
            name: 'New resource',
            category,
            unit: category === 'water' ? 'gallon' : category === 'supplies' ? 'count' : 'lb',
            locationId: 'LOC-STORAGE',
          }),
          name: '',
        },
  );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [photoBusy, setPhotoBusy] = useState(false),
    [aiBusy, setAiBusy] = useState(false),
    [notes, setNotes] = useState(''),
    [draft, setDraft] = useState<Draft | null>(null),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [recording, setRecording] = useState(false),
    [recorded, setRecorded] = useState<Blob | null>(null),
    [newLocation, setNewLocation] = useState('');
  const photoRef = useRef<HTMLInputElement>(null),
    cameraRef = useRef<HTMLInputElement>(null),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (recordTimer.current) clearTimeout(recordTimer.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state === 'recording') recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  const field = <K extends keyof StockInput>(key: K, value: StockInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const nutrition = <K extends keyof StockInput['nutrition']>(
    key: K,
    value: StockInput['nutrition'][K],
  ) => setForm((f) => ({ ...f, nutrition: { ...f.nutrition, [key]: value } }));
  const input = (
    key: 'name' | 'brand' | 'subcategory' | 'description' | 'notes',
    label: string,
    placeholder = '',
  ) => (
    <input
      aria-label={label}
      value={form[key]}
      placeholder={placeholder}
      onChange={(e) => field(key, e.target.value)}
      required={key === 'name'}
      maxLength={key === 'name' ? 200 : 5000}
    />
  );
  const dateInput = (
    key: 'purchasedOn' | 'bestBy' | 'expiresOn' | 'lastRotatedOn' | 'rotationOn' | 'snoozedUntil',
    label: string,
  ) => (
    <input
      aria-label={label}
      type="date"
      value={form[key] || ''}
      onChange={(e) => field(key, e.target.value || null)}
    />
  );
  const upload = async (files: FileList | null) => {
    if (!files) return;
    setPhotoBusy(true);
    setError('');
    try {
      if (form.photoIds.length + files.length > 12)
        throw new Error('An item can have up to 12 photos');
      for (const file of Array.from(files)) {
        const data = new FormData();
        data.append('photo', file);
        const result = await api<{ id: string }>('/api/photos', 'POST', data);
        setForm((f) => ({ ...f, photoIds: [...f.photoIds, result.id] }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhotoBusy(false);
      if (photoRef.current) photoRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
    }
  };
  const transcribe = async (blob: Blob) => {
    setAiBusy(true);
    setError('');
    try {
      const data = new FormData();
      data.append('audio', blob, blob.type.includes('mp4') ? 'dictation.m4a' : 'dictation.webm');
      const result = await api<{ text: string }>('/api/ai/transcribe', 'POST', data);
      setNotes((n) => `${n}${n ? '\n' : ''}${result.text}`);
      toast('Dictation added to capture notes. Review it before using AI.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };
  const startRecording = async () => {
    setError('');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          'Dictation requires HTTPS on phones and tablets. You can type notes or use your keyboard’s dictation instead. See README for local HTTPS setup.',
        );
      if (!window.MediaRecorder)
        throw new Error(
          'This browser cannot record audio. Use keyboard dictation or type your notes.',
        );
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm', 'audio/mp4'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const media = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
      recorder.current = media;
      const chunks: BlobPart[] = [];
      media.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      media.onstop = () => {
        setRecording(false);
        stream.current?.getTracks().forEach((t) => t.stop());
        if (recordTimer.current) clearTimeout(recordTimer.current);
        const blob = new Blob(chunks, { type: media.mimeType });
        setRecorded(blob);
        void transcribe(blob);
      };
      media.start();
      setRecording(true);
      recordTimer.current = setTimeout(() => {
        if (media.state === 'recording') media.stop();
      }, 120000);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(
        (e as Error).name === 'NotAllowedError'
          ? 'Microphone permission was denied. You can type notes or use keyboard dictation.'
          : (e as Error).message,
      );
    }
  };
  const extract = async (mode: 'extract' | 'description') => {
    setAiBusy(true);
    setError('');
    try {
      const result = await api<Draft>('/api/ai/draft', 'POST', {
        mode,
        photoIds: form.photoIds,
        text: `Current manually entered facts: ${JSON.stringify(form)}\nAdditional notes or dictation: ${notes}`,
      });
      setDraft(result);
      const available = new Set<string>();
      for (const [key, value] of Object.entries(result)) {
        if (key === 'reviewNotes') continue;
        if (key === 'nutrition') {
          for (const [k, v] of Object.entries(result.nutrition))
            if (v != null && form.nutrition[k as keyof typeof form.nutrition] == null)
              available.add(`nutrition.${k}`);
        } else if (
          value != null &&
          (form[key as keyof StockInput] == null || form[key as keyof StockInput] === '')
        )
          available.add(key);
      }
      setSelected(available);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };
  const suggestions: { key: string; value: string | number }[] = draft
    ? Object.entries(draft).flatMap<{ key: string; value: string | number }>(([key, value]) =>
        key === 'reviewNotes'
          ? []
          : key === 'nutrition'
            ? Object.entries(draft.nutrition)
                .filter(([, v]) => v != null)
                .map(([k, v]) => ({ key: `nutrition.${k}`, value: v as string | number }))
            : value == null
              ? []
              : [{ key, value: value as string | number }],
      )
    : [];
  const applyDraft = () => {
    if (!draft) return;
    setForm((current) => {
      const next = { ...current, nutrition: { ...current.nutrition } };
      for (const suggestion of suggestions) {
        if (!selected.has(suggestion.key)) continue;
        if (suggestion.key.startsWith('nutrition.'))
          (next.nutrition as Record<string, unknown>)[suggestion.key.split('.')[1]] =
            suggestion.value;
        else (next as Record<string, unknown>)[suggestion.key] = suggestion.value;
      }
      return next;
    });
    setDraft(null);
    toast('Selected suggestions applied. Review the form before saving.');
  };
  const save = async (event: React.SubmitEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const parsed = stockInputSchema.safeParse(form);
      if (!parsed.success)
        throw new Error(
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        );
      const editing = stock && !duplicate;
      const saved = await api<Stock>(
        editing ? `/api/stocks/${stock.id}` : '/api/stocks',
        editing ? 'PUT' : 'POST',
        editing ? { ...parsed.data, version: stock.version } : parsed.data,
      );
      await reload();
      onClose();
      toast(editing ? 'Item updated' : 'Resource added to your reserve');
      navigate(`/item/${saved.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={stock && !duplicate ? 'Edit resource' : 'Add a resource'}
      subtitle="A few details now. A clearer picture of your reserve."
      onClose={onClose}
      wide
    >
      <form onSubmit={save}>
        <div className="modal-body">
          <div className="category-selector">
            {Object.entries(categoryNames).map(([key, label]) => (
              <button
                type="button"
                key={key}
                disabled={!!stock}
                className={form.category === key ? 'active' : ''}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    category: key as Category,
                    unit: key === 'water' ? 'gallon' : key === 'supplies' ? 'count' : 'lb',
                  }))
                }
              >
                {label}
              </button>
            ))}
          </div>
          <section className="capture-panel">
            <div className="section-heading">
              <div>
                <h3>Start with a photo or your voice</h3>
                <p>Combine label photos and notes, then review AI suggestions.</p>
              </div>
              <Sparkles size={22} />
            </div>
            <div className="capture-buttons">
              <button
                type="button"
                className="button secondary"
                disabled={photoBusy}
                onClick={() => photoRef.current?.click()}
              >
                <ImagePlus size={18} />
                Photo library
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={photoBusy}
                onClick={() => cameraRef.current?.click()}
              >
                <Camera size={18} />
                Camera
              </button>
              <button
                type="button"
                className={`button ${recording ? 'danger' : 'secondary'}`}
                disabled={aiBusy}
                onClick={() => (recording ? recorder.current?.stop() : void startRecording())}
              >
                {recording ? (
                  <>
                    <Square size={16} />
                    Stop recording
                  </>
                ) : (
                  <>
                    <Mic size={18} />
                    Dictate
                  </>
                )}
              </button>
            </div>
            <input
              ref={photoRef}
              hidden
              aria-label="Upload photos"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => void upload(e.target.files)}
            />
            <input
              ref={cameraRef}
              hidden
              aria-label="Take a photo"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void upload(e.target.files)}
            />
            {photoBusy && (
              <p>
                <Busy label="Saving photo…" />
              </p>
            )}
            <div className="photo-grid">
              {form.photoIds.map((photo) => (
                <div key={photo}>
                  <img src={`/uploads/${photo}`} alt="Resource reference" />
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() =>
                      field(
                        'photoIds',
                        form.photoIds.filter((p) => p !== photo),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <textarea
              aria-label="Capture notes or dictation"
              placeholder="For example: 25 pounds of jasmine rice, purchased last Saturday. Nutrition and best-by date are in the photos."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
            <div className="capture-bottom">
              <span>
                {!state.integrations.ai
                  ? 'Add your OpenAI key to enable AI assistance.'
                  : 'AI suggestions are always reviewed before saving.'}
              </span>
              <button
                type="button"
                className="button small"
                disabled={aiBusy || photoBusy || recording}
                onClick={() => void extract('extract')}
              >
                {aiBusy ? (
                  <Busy />
                ) : (
                  <>
                    <Sparkles size={16} />
                    Suggest details
                  </>
                )}
              </button>
            </div>
            {recorded && (
              <button
                type="button"
                className="text-button"
                disabled={aiBusy}
                onClick={() => void transcribe(recorded)}
              >
                Retry last transcription
              </button>
            )}
          </section>
          {draft && (
            <section className="ai-review">
              <h3>Review AI suggestions</h3>
              <p>
                Existing values are not selected automatically. Check a field to replace its current
                value.
              </p>
              {draft.reviewNotes.map((note, i) => (
                <p key={i} className="review-note">
                  {note}
                </p>
              ))}
              <div className="suggestions">
                {suggestions.map((s) => (
                  <label key={s.key}>
                    <input
                      type="checkbox"
                      checked={selected.has(s.key)}
                      onChange={(e) =>
                        setSelected((values) => {
                          const next = new Set(values);
                          if (e.target.checked) next.add(s.key);
                          else next.delete(s.key);
                          return next;
                        })
                      }
                    />
                    <span>
                      <strong>{s.key.replace('nutrition.', '').replace(/([A-Z])/g, ' $1')}</strong>
                      <span>{String(s.value)}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="button-row">
                <button type="button" className="button small" onClick={applyDraft}>
                  <Check size={16} />
                  Apply selected
                </button>
                <button
                  type="button"
                  className="button small secondary"
                  onClick={() => setDraft(null)}
                >
                  Discard suggestions
                </button>
              </div>
            </section>
          )}
          <h3 className="form-section-title">The essentials</h3>
          <div className="form-grid">
            <Field label="Resource name" className="full">
              {input('name', 'Resource name', 'e.g. Jasmine rice')}
            </Field>
            <Field label="Brand / manufacturer">{input('brand', 'Brand / manufacturer')}</Field>
            <Field label="Category">
              {form.category === 'supplies' ? (
                <select
                  aria-label="Supply category"
                  value={form.subcategory}
                  onChange={(e) => field('subcategory', e.target.value)}
                >
                  <option value="">Choose a category</option>
                  {state.settings.supplyCategories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              ) : (
                input('subcategory', 'Food or resource category', 'e.g. Grains, canned food, oils')
              )}
            </Field>
            <Field label="Remaining quantity">
              <Num
                label="Remaining quantity"
                value={form.quantity}
                onChange={(n) => field('quantity', n)}
              />
            </Field>
            <Field label="Quantity unit">
              <select
                aria-label="Quantity unit"
                value={form.unit}
                onChange={(e) => field('unit', e.target.value as Unit)}
                disabled={form.category === 'water' || form.category === 'fuel'}
              >
                {unitSchema.options.map((u) => (
                  <option key={u} value={u}>
                    {u === 'count' ? 'items / packages' : u}
                  </option>
                ))}
              </select>
            </Field>
            {['water', 'fuel'].includes(form.category) && (
              <Field
                label={
                  form.category === 'fuel'
                    ? 'Fuel capacity (not tank tare weight)'
                    : 'Container capacity in gallons'
                }
              >
                <Num
                  label="Capacity"
                  value={form.capacity}
                  onChange={(n) => field('capacity', n)}
                />
              </Field>
            )}
            {form.category === 'fuel' && (
              <Field label="Fuel type">
                <select
                  aria-label="Fuel type"
                  value={form.fuelType}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      fuelType: e.target.value as StockInput['fuelType'],
                      unit: e.target.value === 'propane' ? 'lb' : 'gallon',
                    }))
                  }
                >
                  {['propane', 'gasoline', 'diesel', 'other'].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Purchased on">{dateInput('purchasedOn', 'Purchased on')}</Field>
            <Field label="Manufacturer best-by date">
              {dateInput('bestBy', 'Manufacturer best-by date')}
            </Field>
            <Field label="Expiration date (if applicable)">
              {dateInput('expiresOn', 'Expiration date')}
            </Field>
          </div>
          {['food', 'dog'].includes(form.category) && (
            <details className="form-details" open>
              <summary>
                Nutrition facts <span>Optional · from the package</span>
              </summary>
              <div className="form-grid">
                <Field label="Serving size">
                  <Num
                    label="Serving size"
                    value={form.nutrition.servingSize}
                    onChange={(n) => nutrition('servingSize', n)}
                  />
                </Field>
                <Field label="Serving unit">
                  <select
                    aria-label="Serving unit"
                    value={form.nutrition.servingUnit}
                    onChange={(e) => nutrition('servingUnit', e.target.value as Unit)}
                  >
                    {unitSchema.options.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </Field>
                {(['calories', 'protein', 'carbs', 'fat'] as const).map((key) => (
                  <Field
                    key={key}
                    label={
                      key === 'calories'
                        ? 'Calories per serving'
                        : `${key[0].toUpperCase() + key.slice(1)} per serving (g)`
                    }
                  >
                    <Num
                      label={`${key} per serving`}
                      value={form.nutrition[key]}
                      onChange={(n) => nutrition(key, n)}
                    />
                  </Field>
                ))}
              </div>
              <p className="footnote">
                Use a serving unit compatible with your quantity. Volume is never converted to
                weight by guessing density.
              </p>
            </details>
          )}
          <details className="form-details" open>
            <summary>Storage & rotation</summary>
            <div className="form-grid">
              <Field label="Packaging">
                <select
                  aria-label="Packaging"
                  value={form.packaging}
                  onChange={(e) => field('packaging', e.target.value as StockInput['packaging'])}
                >
                  {Object.entries(packagingLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Bucket">
                <select
                  aria-label="Bucket"
                  value={form.containerId || ''}
                  onChange={(e) => field('containerId', e.target.value || null)}
                >
                  <option value="">No bucket / standalone</option>
                  {state.containers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Storage location"
                hint="A bucket’s location takes precedence when a bag is inside it."
              >
                <select
                  aria-label="Storage location"
                  value={form.locationId || ''}
                  onChange={(e) => field('locationId', e.target.value || null)}
                >
                  <option value="">Not assigned</option>
                  {state.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Create a location">
                <div className="inline-input">
                  <input
                    aria-label="New location name"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="e.g. Garage shelf"
                  />
                  <AsyncButton
                    className="icon-button"
                    disabled={!newLocation.trim()}
                    action={async () => {
                      const l = await api<{ id: string }>('/api/locations', 'POST', {
                        name: newLocation,
                      });
                      await reload();
                      field('locationId', l.id);
                      setNewLocation('');
                    }}
                  >
                    <Plus size={18} />
                  </AsyncButton>
                </div>
              </Field>
              <Field label="Last rotated / refilled on">
                {dateInput('lastRotatedOn', 'Last rotated on')}
              </Field>
              <Field label="Rotate every (months)">
                <Num
                  label="Rotation interval in months"
                  value={form.rotationMonths}
                  min={1}
                  max={1200}
                  onChange={(n) => field('rotationMonths', n)}
                />
              </Field>
              <Field
                label="Specific rotation date"
                hint="Overrides the interval until the next rotation."
              >
                {dateInput('rotationOn', 'Specific rotation date')}
              </Field>
            </div>
          </details>
          <details className="form-details">
            <summary>Notes & description</summary>
            <Field label="Description">
              <textarea
                aria-label="Description"
                value={form.description}
                rows={3}
                onChange={(e) => field('description', e.target.value)}
              />
            </Field>
            <button
              type="button"
              className="text-button"
              disabled={aiBusy}
              onClick={() => void extract('description')}
            >
              <Sparkles size={16} />
              Suggest a description
            </button>
            <Field label="Your notes">
              <textarea
                aria-label="Your notes"
                value={form.notes}
                rows={3}
                onChange={(e) => field('notes', e.target.value)}
              />
            </Field>
          </details>
          <details className="form-details">
            <summary>Reminders & priority</summary>
            <Toggle checked={form.notify} onChange={(v) => field('notify', v)}>
              Notify me before dates are due
            </Toggle>
            <Toggle
              checked={form.highPriority}
              onChange={(v) => field('highPriority', v)}
              hint="Add an earlier, 90-day reminder unless a custom lead time is set."
            >
              High-priority item
            </Toggle>
            <div className="form-grid">
              <Field label="Custom reminder lead time (days)">
                <Num
                  label="Custom reminder lead time"
                  value={form.leadDays}
                  max={3650}
                  onChange={(n) => field('leadDays', n)}
                />
              </Field>
              <Field label={`Minimum remaining quantity (${form.unit})`}>
                <Num
                  label="Minimum remaining quantity"
                  value={form.minimum}
                  onChange={(n) => field('minimum', n)}
                />
              </Field>
              <Field label="Snooze reminders until">
                {dateInput('snoozedUntil', 'Snooze reminders until')}
              </Field>
            </div>
          </details>
          {stock && !duplicate && (
            <p className="footnote">
              Name, nutrition, notes, photos, and purchase dates are shared with other bags split
              from this batch. Quantities, storage, and reminders belong to this unit.
            </p>
          )}
          <ErrorMessage message={error} />
        </div>
        <footer className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button"
            type="submit"
            disabled={busy || photoBusy || recording || aiBusy || !!draft}
          >
            {busy ? (
              <Busy label="Saving…" />
            ) : (
              <>
                <Check size={17} />
                {stock && !duplicate ? 'Save changes' : 'Add to inventory'}
              </>
            )}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
