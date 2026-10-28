import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Download,
  History,
  MapPin,
  Package,
  Pencil,
  Plus,
  Printer,
  Search,
  Split,
  Trash2,
} from 'lucide-react';
import { useApp, CoverageCard, PageHeading, type ModalState } from './App';
import { api, categoryNames, dateLabel, download, number } from './api';
import {
  AsyncButton,
  Busy,
  CategoryIcon,
  Empty,
  ErrorMessage,
  Field,
  Modal,
  Num,
  Toggle,
} from './ui';
import {
  bucketName,
  bucketNumberLabel,
  effectiveLocationId,
  calendarDay,
  round,
  rotationDate,
  type Category,
  type Container,
  type Stock,
  type StockInput,
} from '../shared/model';

function place(stock: Stock, state: ReturnType<typeof useApp>['state']) {
  const container = state.containers.find((c) => c.id === stock.containerId);
  const location = state.locations.find(
    (l) => l.id === effectiveLocationId(stock, state.containers),
  );
  return [location?.name || 'Location not assigned', container && bucketName(container)]
    .filter(Boolean)
    .join(' · ');
}
export function Inventory({ category }: { category: Category }) {
  const { state, setModal, navigate, mutate, toast } = useApp();
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const scenario = async (key: 'naturalGasAvailable' | 'generatorNeeded', value: boolean) => {
    setSaving(true);
    setError('');
    try {
      await mutate('/api/settings', 'PUT', { ...state.settings, [key]: value });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const descriptions = {
    food: 'From everyday staples to long-term stores. Every calorie counts.',
    water: 'Your water reserve, refill dates, and the next rotation.',
    fuel: 'Stored fuel and the assumptions behind your cooking and electricity coverage.',
    dog: 'Their food, their own reserve. Keep your companion in the plan.',
    supplies: 'The other essentials that help your household stay ready.',
  };
  return (
    <>
      <PageHeading
        eyebrow="YOUR HOUSEHOLD RESERVE"
        title={
          category === 'dog'
            ? 'For your four-legged family.'
            : `${categoryNames[category]}, accounted for.`
        }
        description={descriptions[category]}
        action={
          <button className="button" onClick={() => setModal({ type: 'edit', category })}>
            <Plus size={18} />
            Add {category === 'dog' ? 'dog food' : category === 'supplies' ? 'a supply' : category}
          </button>
        }
      />
      {category !== 'supplies' && (
        <div className="inventory-summary">
          <CoverageCard category={category} compact />
          <div className="panel metric-notes">
            {category === 'food' ? (
              <>
                <h3>Nutrition in your reserve</h3>
                <div className="macro-grid">
                  {(['protein', 'carbs', 'fat'] as const).map((k) => (
                    <div key={k}>
                      <strong>
                        {number(state.dashboard.macros[k])}
                        <small>g</small>
                      </strong>
                      <span>{k}</span>
                    </div>
                  ))}
                </div>
                <p>
                  Based on compatible serving sizes and quantities. Missing nutrition stays unknown.
                </p>
              </>
            ) : category === 'water' ? (
              <>
                <h3>Keep your water moving</h3>
                <p>
                  Use Rotate after checking a jug or cycling the outdoor tank. The next reminder
                  follows its own interval.
                </p>
                <p>Missing last-rotation dates appear in Needs attention.</p>
                {!state.setup.water && (
                  <AsyncButton
                    className="button small secondary"
                    action={async () => {
                      await mutate('/api/setup', 'POST', { water: true });
                      toast('Added six jugs and your outdoor tank');
                    }}
                  >
                    Confirm & add your 230-gallon setup
                  </AsyncButton>
                )}
              </>
            ) : category === 'dog' ? (
              <>
                <h3>A measured daily ration</h3>
                <p>
                  {state.settings.dogRationGrams
                    ? `${number(state.settings.dogRationGrams)} g of food per day`
                    : 'Add your dog’s measured daily food ration to calculate coverage.'}
                </p>
                <p>
                  Recorded dog weight: {state.settings.dogWeightLb} lb. Dog food is kept separate
                  from human calories.
                </p>
                <button className="text-button" onClick={() => navigate('/settings')}>
                  Adjust daily needs <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <>
                <h3>Plan for the outage you have in mind</h3>
                <fieldset disabled={saving} className="scenario-toggles">
                  <Toggle
                    checked={state.settings.naturalGasAvailable}
                    onChange={(v) => void scenario('naturalGasAvailable', v)}
                  >
                    Natural gas available
                  </Toggle>
                  <Toggle
                    checked={state.settings.generatorNeeded}
                    onChange={(v) => void scenario('generatorNeeded', v)}
                  >
                    Generator needed
                  </Toggle>
                </fieldset>
                <p>
                  {state.settings.naturalGasAvailable
                    ? 'Cooking and generation use the utility connection; stored fuel remains a separate reserve.'
                    : 'Cooking and generation share each fuel’s recorded reserve. Alternative fuels are shown separately.'}
                </p>
                {state.dashboard.illustrative && (
                  <span className="status-pill">Illustrative equipment assumptions</span>
                )}
                <button className="text-button" onClick={() => navigate('/settings')}>
                  Fine-tune equipment <ArrowRight size={16} />
                </button>
                <ErrorMessage message={error} />
              </>
            )}
          </div>
        </div>
      )}
      {category === 'fuel' && state.dashboard.alternativeFuel.length > 0 && (
        <div className="alternative-fuels">
          {state.dashboard.alternativeFuel.map((f) => (
            <div className="panel" key={`${f.type}${f.unit}`}>
              <strong>{f.type}</strong>
              <p>
                {number(f.quantity, 1)} {f.unit} stored
              </p>
              <span>
                {f.days == null
                  ? 'Set equipment rates for coverage'
                  : `${number(f.days, 1)} days for configured equipment`}
              </span>
            </div>
          ))}
        </div>
      )}
      <StockTable
        stocks={state.stocks.filter((s) => s.category === category)}
        defaultCategory={category}
      />
    </>
  );
}
function StockTable({
  stocks,
  defaultCategory = 'food',
  showLocationFilter = true,
}: {
  stocks: Stock[];
  defaultCategory?: Category;
  showLocationFilter?: boolean;
}) {
  const { state, navigate, setModal } = useApp();
  const [search, setSearch] = useState(''),
    [location, setLocation] = useState(''),
    [subcategory, setSubcategory] = useState(''),
    [showEmpty, setShowEmpty] = useState(false),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const categories = [...new Set(stocks.map((s) => s.subcategory).filter(Boolean))].sort();
  const shown = stocks.filter((s) => {
    return (
      (showEmpty || s.quantity !== 0) &&
      (!location || effectiveLocationId(s, state.containers) === location) &&
      (!subcategory || s.subcategory === subcategory) &&
      `${s.name} ${s.brand} ${s.id} ${s.notes} ${place(s, state)}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  });
  const selectedIds = stocks.filter((s) => selected.has(s.id)).map((s) => s.id);
  return (
    <section className="panel stock-panel">
      <div className="inventory-toolbar">
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label="Search inventory"
            placeholder="Search your inventory…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {showLocationFilter && (
          <select
            aria-label="Filter by location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          >
            <option value="">All locations</option>
            {state.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Filter by category"
          value={subcategory}
          onChange={(e) => setSubcategory(e.target.value)}
        >
          <option value="">All types</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="table-meta">
        <span>
          {shown.length} resource{shown.length === 1 ? '' : 's'}
          <label>
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
            />
            Show empty
          </label>
        </span>
        <button
          className="text-button"
          disabled={!selectedIds.length}
          onClick={() => setModal({ type: 'labels', ids: selectedIds })}
        >
          <Printer size={16} />
          Labels{selectedIds.length ? ` (${selectedIds.length})` : ''}
        </button>
      </div>
      {!shown.length ? (
        <Empty
          title={stocks.length ? 'No matching resources' : 'Your reserve starts here.'}
          action={
            !stocks.length && (
              <button
                className="button secondary"
                onClick={() => setModal({ type: 'edit', category: defaultCategory })}
              >
                <Plus size={17} />
                Add your first resource
              </button>
            )
          }
        >
          {stocks.length
            ? 'Try another search, filter, or include empty containers.'
            : 'Add what you have on hand. You can fill in the finer details later.'}
        </Empty>
      ) : (
        <div className="stock-list">
          <div className="stock-head">
            <label>
              <input
                type="checkbox"
                aria-label="Select all visible items"
                checked={shown.length > 0 && shown.every((s) => selected.has(s.id))}
                onChange={(e) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    for (const s of shown)
                      if (e.target.checked) next.add(s.id);
                      else next.delete(s.id);
                    return next;
                  })
                }
              />
            </label>
            <span>RESOURCE</span>
            <span>REMAINING</span>
            <span>STORAGE</span>
            <span>NEXT DATE</span>
            <span />
          </div>
          {shown.map((stock) => {
            const dates = [stock.bestBy, stock.expiresOn, rotationDate(stock)]
              .filter(Boolean)
              .sort();
            return (
              <div className="stock-row" key={stock.id}>
                <input
                  type="checkbox"
                  aria-label={`Select ${stock.name} ${stock.id}`}
                  checked={selected.has(stock.id)}
                  onChange={(e) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(stock.id);
                      else next.delete(stock.id);
                      return next;
                    })
                  }
                />
                <button className="stock-name" onClick={() => navigate(`/item/${stock.id}`)}>
                  {stock.photoIds[0] ? (
                    <img src={`/uploads/${stock.photoIds[0]}`} alt="" />
                  ) : (
                    <CategoryIcon category={stock.category} size={19} />
                  )}
                  <span>
                    <strong>{stock.name}</strong>
                    <small>
                      {stock.brand || stock.subcategory || stock.id}
                      {stock.highPriority && ' · Priority'}
                    </small>
                  </span>
                </button>
                <div className="quantity-cell">
                  <strong>{stock.quantity == null ? 'Unknown' : number(stock.quantity, 2)}</strong>{' '}
                  {stock.quantity != null && <span>{stock.unit}</span>}
                </div>
                <div className="location-cell">
                  <MapPin size={13} />
                  {place(stock, state)}
                </div>
                <div className="date-cell">
                  {dates[0] ? dateLabel(dates[0]) : <span className="subtle">No date set</span>}
                </div>
                <button
                  className="icon-button"
                  aria-label={`Update ${stock.name}`}
                  onClick={() => setModal({ type: 'action', stock })}
                >
                  <Plus size={18} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
export function StockDetail({ id }: { id: string }) {
  const { state, setModal, navigate, mutate, toast } = useApp();
  const stock = state.stocks.find((s) => s.id === id);
  const [archiving, setArchiving] = useState(false);
  if (!stock)
    return (
      <Empty
        title="Resource not found"
        action={
          <button className="button secondary" onClick={() => navigate('/')}>
            Back to overview
          </button>
        }
      >
        It may have been archived or removed from this inventory.
      </Empty>
    );
  const alerts = state.dashboard.alerts.filter((a) => a.stockId === id);
  return (
    <>
      <button className="text-button back-button" onClick={() => navigate(`/${stock.category}`)}>
        <ArrowLeft size={16} />
        Back to {categoryNames[stock.category].toLowerCase()}
      </button>
      <PageHeading
        eyebrow={`${categoryNames[stock.category].toUpperCase()} · ${stock.id}`}
        title={stock.name}
        description={stock.brand || 'Part of your household reserve'}
        action={
          <button
            className="button"
            onClick={() => setModal({ type: 'edit', category: stock.category, stock })}
          >
            <Pencil size={17} />
            Edit resource
          </button>
        }
      />
      <div className="detail-grid">
        <section className="panel">
          <div className="detail-hero">
            <CategoryIcon category={stock.category} />
            <div>
              <strong>{stock.quantity == null ? 'Unknown' : number(stock.quantity, 2)}</strong>
              <span>{stock.quantity == null ? 'remaining amount' : `${stock.unit} remaining`}</span>
            </div>
            {stock.highPriority && <span className="priority-tag">Priority item</span>}
          </div>
          <div className="button-row wrap">
            <button
              className="button secondary"
              onClick={() => setModal({ type: 'action', stock })}
            >
              <Plus size={17} />
              Update stock
            </button>
            {['food', 'dog'].includes(stock.category) && (
              <button
                className="button secondary"
                onClick={() => setModal({ type: 'split', stock })}
              >
                <Split size={17} />
                Split into bags
              </button>
            )}
            <button
              className="button secondary"
              onClick={() => setModal({ type: 'labels', ids: [stock.id] })}
            >
              <Printer size={17} />
              Make label
            </button>
          </div>
          <dl className="detail-facts">
            <div>
              <dt>Storage</dt>
              <dd>
                {place(stock, state)}
                {stock.containerId && (
                  <button
                    className="text-button"
                    onClick={() => navigate(`/container/${stock.containerId}`)}
                  >
                    View bucket <ArrowRight size={14} />
                  </button>
                )}
              </dd>
            </div>
            <div>
              <dt>Packaging</dt>
              <dd>{stock.packaging.replaceAll('_', ' ')}</dd>
            </div>
            <div>
              <dt>Purchase date</dt>
              <dd>{dateLabel(stock.purchasedOn)}</dd>
            </div>
            <div>
              <dt>Best-by date</dt>
              <dd>{dateLabel(stock.bestBy)}</dd>
            </div>
            <div>
              <dt>Expiration date</dt>
              <dd>{dateLabel(stock.expiresOn)}</dd>
            </div>
            <div>
              <dt>Next rotation</dt>
              <dd>{dateLabel(rotationDate(stock))}</dd>
            </div>
            <div>
              <dt>Last rotation</dt>
              <dd>{dateLabel(stock.lastRotatedOn)}</dd>
            </div>
            {stock.rotationMonths && (
              <div>
                <dt>Rotation interval</dt>
                <dd>{stock.rotationMonths} months</dd>
              </div>
            )}
            <div>
              <dt>Purchase batch</dt>
              <dd>{stock.batchId}</dd>
            </div>
            <div>
              <dt>Reminder status</dt>
              <dd>
                {stock.notify
                  ? stock.snoozedUntil
                    ? `Snoozed until ${dateLabel(stock.snoozedUntil)}`
                    : 'Enabled'
                  : 'Disabled'}
              </dd>
            </div>
          </dl>
          {stock.description && (
            <>
              <h3>Description</h3>
              <p className="preserve-lines">{stock.description}</p>
            </>
          )}
          {stock.notes && (
            <>
              <h3>Notes</h3>
              <p className="preserve-lines">{stock.notes}</p>
            </>
          )}
          <div className="button-row wrap">
            <button
              className="text-button"
              onClick={() =>
                setModal({ type: 'edit', category: stock.category, stock, duplicate: true })
              }
            >
              <Copy size={16} />
              Duplicate
            </button>
            <button className="text-button" onClick={() => setModal({ type: 'history', stock })}>
              <History size={16} />
              History
            </button>
            <button className="text-button danger-text" onClick={() => setArchiving(true)}>
              <Trash2 size={16} />
              Archive
            </button>
          </div>
          {archiving && (
            <div className="confirmation">
              <p>
                Archive this resource? It will leave totals and reminders. Its adjustment history
                stays in the database.
              </p>
              <AsyncButton
                className="button danger small"
                action={async () => {
                  await mutate(`/api/stocks/${id}`, 'DELETE', { version: stock.version });
                  toast('Resource archived');
                  navigate(`/${stock.category}`);
                }}
              >
                Archive resource
              </AsyncButton>
              <button className="button small secondary" onClick={() => setArchiving(false)}>
                Keep it
              </button>
            </div>
          )}
        </section>
        <div className="detail-side">
          {stock.photoIds.length > 0 && (
            <section className="panel resource-photos">
              {stock.photoIds.map((photo) => (
                <a key={photo} href={`/uploads/${photo}`} target="_blank" rel="noreferrer">
                  <img alt={`${stock.name} reference photo`} src={`/uploads/${photo}`} />
                </a>
              ))}
            </section>
          )}
          {['food', 'dog'].includes(stock.category) && (
            <section className="panel">
              <h3>Nutrition per serving</h3>
              <p>
                {stock.nutrition.servingSize == null
                  ? 'Serving size not recorded'
                  : `${stock.nutrition.servingSize} ${stock.nutrition.servingUnit}`}
              </p>
              <dl className="detail-facts">
                {(['calories', 'protein', 'carbs', 'fat'] as const).map((k) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>
                      {stock.nutrition[k] == null
                        ? 'Unknown'
                        : `${stock.nutrition[k]} ${k === 'calories' ? 'kcal' : 'g'}`}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {alerts.length > 0 && (
            <section className="panel">
              <h3>Next steps</h3>
              {alerts.map((a) => (
                <p key={a.key} className="item-alert">
                  {a.message}
                </p>
              ))}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
export function ContainersPage({ containerId }: { containerId?: string }) {
  const { state, setModal, navigate } = useApp();
  const [locationId, setLocationId] = useState('');
  const container = state.containers.find((c) => c.id === containerId);
  if (containerId && !container)
    return (
      <Empty title="Bucket not found">
        Return to Storage & buckets to find its current record.
      </Empty>
    );
  if (container)
    return (
      <>
        <button className="text-button back-button" onClick={() => navigate('/containers')}>
          <ArrowLeft size={16} />
          All buckets & locations
        </button>
        <PageHeading
          eyebrow={`STORAGE · ${container.id}`}
          title={bucketName(container)}
          description={`${container.capacityGallons}-gallon bucket · ${state.locations.find((l) => l.id === container.locationId)?.name || 'Location not assigned'}`}
          action={
            <button
              className="button secondary"
              onClick={() => setModal({ type: 'container', id: container.id })}
            >
              <Pencil size={16} />
              Edit bucket
            </button>
          }
        />
        <div className="button-row">
          <button
            className="button secondary"
            onClick={() => setModal({ type: 'labels', ids: [], containerIds: [container.id] })}
          >
            <Printer size={17} />
            Make bucket label
          </button>
          <span className="subtle">
            Permanent number {bucketNumberLabel(container)} · Contents update as you move bags.
          </span>
        </div>
        <StockTable
          stocks={state.stocks.filter((s) => s.containerId === container.id)}
          showLocationFilter={false}
        />
      </>
    );
  const matchesLocation = (id: string | null) =>
    !locationId || (locationId === '__unassigned' ? !id : id === locationId);
  const buckets = state.containers.filter((c) => matchesLocation(c.locationId));
  const stocks = state.stocks.filter((s) =>
    matchesLocation(effectiveLocationId(s, state.containers)),
  );
  const locationName =
    locationId === '__unassigned'
      ? 'Unassigned location'
      : state.locations.find((l) => l.id === locationId)?.name;
  return (
    <>
      <PageHeading
        eyebrow="A PLACE FOR EVERYTHING"
        title="Storage & buckets"
        description="Find supplies across your garage, attic, closets, and anywhere else. Buckets keep their numbers wherever they go."
        action={
          <button className="button" onClick={() => setModal({ type: 'container' })}>
            <Plus size={18} />
            Add bucket
          </button>
        }
      />
      <div className="storage-toolbar">
        <Field label="Browse storage location">
          <select
            aria-label="Browse storage location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">All locations</option>
            {state.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            <option value="__unassigned">Location not assigned</option>
          </select>
        </Field>
        <button
          className="button secondary"
          disabled={!buckets.length}
          onClick={() =>
            setModal({ type: 'labels', ids: [], containerIds: buckets.map((c) => c.id) })
          }
        >
          <Printer size={17} />
          Bucket labels
        </button>
        <button className="text-button" onClick={() => navigate('/settings#storage')}>
          Manage locations <ArrowRight size={16} />
        </button>
      </div>
      <h2 className="storage-section-heading">
        {locationName ? `Buckets · ${locationName}` : 'Your buckets'}
      </h2>
      <div className="container-grid">
        {buckets.map((c) => {
          const contents = state.stocks.filter((s) => s.containerId === c.id && s.quantity !== 0);
          const names = [...new Set(contents.map((s) => s.name))];
          return (
            <button
              key={c.id}
              className="panel container-card"
              onClick={() => navigate(`/container/${c.id}`)}
            >
              <div>
                <Package size={28} strokeWidth={1.3} />
                <span className="bucket-number">{bucketNumberLabel(c)}</span>
              </div>
              <h3>{bucketName(c)}</h3>
              <p>
                <MapPin size={14} />
                {state.locations.find((l) => l.id === c.locationId)?.name ||
                  'Location not assigned'}
              </p>
              <p className="bucket-contents">
                {names.length
                  ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` + ${names.length - 3} more` : ''}`
                  : 'No current contents'}
              </p>
              <footer>
                <span>
                  {contents.length} item{contents.length === 1 ? '' : 's'} · {c.capacityGallons} gal
                  capacity
                </span>
                <ArrowRight size={17} />
              </footer>
            </button>
          );
        })}
      </div>
      {!buckets.length && (
        <Empty title="No buckets here yet">
          Supplies can live directly in a location, or inside a numbered bucket.
        </Empty>
      )}
      <h2 className="storage-section-heading">
        {locationName ? `Resources · ${locationName}` : 'Resources across all locations'}
      </h2>
      <p className="section-description">
        Includes standalone items and bags inside buckets. Each resource shows where to find it.
      </p>
      <StockTable key={locationId} stocks={stocks} showLocationFilter={false} />
    </>
  );
}
export function InventoryModal({
  modal,
  onClose,
}: {
  modal: Exclude<ModalState, { type: 'edit' } | null>;
  onClose: () => void;
}) {
  if (modal.type === 'labels')
    return (
      <LabelsModal ids={modal.ids} containerIds={modal.containerIds || []} onClose={onClose} />
    );
  if (modal.type === 'container') return <ContainerModal id={modal.id} onClose={onClose} />;
  if (modal.type === 'split') return <SplitModal stock={modal.stock} onClose={onClose} />;
  if (modal.type === 'history') return <HistoryModal stock={modal.stock} onClose={onClose} />;
  return <ActionModal stock={modal.stock} onClose={onClose} />;
}
function ActionModal({ stock, onClose }: { stock: Stock; onClose: () => void }) {
  const { state, mutate, toast } = useApp();
  const [action, setAction] = useState('use'),
    [amount, setAmount] = useState<number | null>(null),
    [date, setDate] = useState(calendarDay(new Date(), state.settings.timezone)),
    [locationId, setLocation] = useState(effectiveLocationId(stock, state.containers) || ''),
    [containerId, setContainer] = useState(stock.containerId || ''),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Update your stock"
      subtitle={`${stock.name} · ${stock.quantity == null ? 'Unknown quantity' : `${number(stock.quantity, 2)} ${stock.unit} remaining`}`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await mutate(`/api/stocks/${stock.id}/actions`, 'POST', {
              version: stock.version,
              action,
              amount: amount ?? undefined,
              date,
              locationId: locationId || null,
              containerId: containerId || null,
              note,
            });
            toast('Inventory updated');
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <Field label="Action">
            <select
              aria-label="Inventory action"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setAmount(null);
              }}
            >
              <option value="use">Use some</option>
              <option value="refill">Refill / add more</option>
              <option value="correct">Set remaining amount</option>
              <option value="rotate">Record rotation</option>
              <option value="move">Move to storage</option>
              <option value="empty">Mark empty</option>
            </select>
          </Field>
          {['use', 'refill', 'correct'].includes(action) && (
            <Field
              label={`${action === 'correct' ? 'New remaining amount' : 'Amount'} (${stock.unit})`}
            >
              <Num
                label="Action amount"
                value={amount}
                min={action === 'correct' ? 0 : 0.00000001}
                required
                onChange={setAmount}
              />
            </Field>
          )}
          {action === 'rotate' && (
            <>
              <Field label="Rotation date">
                <input
                  type="date"
                  aria-label="Rotation date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <p className="footnote">
                Records the date and restarts the rotation interval. Use Refill or Set remaining
                amount to change quantity separately.
              </p>
            </>
          )}
          {action === 'move' && (
            <>
              <Field
                label="Location"
                hint={
                  containerId
                    ? 'This bag follows its bucket’s location. Edit the bucket to move all its contents.'
                    : 'Choose where this standalone item is stored.'
                }
              >
                <select
                  aria-label="New storage location"
                  disabled={!!containerId}
                  value={
                    containerId
                      ? state.containers.find((c) => c.id === containerId)?.locationId || ''
                      : locationId
                  }
                  onChange={(e) => setLocation(e.target.value)}
                >
                  <option value="">Not assigned</option>
                  {state.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Bucket">
                <select
                  aria-label="New bucket"
                  value={containerId}
                  onChange={(e) => setContainer(e.target.value)}
                >
                  <option value="">No bucket / standalone</option>
                  {state.containers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {bucketName(c)}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {action === 'empty' && (
            <p>
              This records zero remaining. The unit stays available in inventory when “Show empty”
              is enabled.
            </p>
          )}
          <Field label="Adjustment note (optional)">
            <input
              aria-label="Adjustment note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <ErrorMessage message={error} />
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={busy}>
            {busy ? <Busy /> : 'Save update'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function SplitModal({ stock, onClose }: { stock: Stock; onClose: () => void }) {
  const { state, reload, setModal, toast } = useApp();
  const [count, setCount] = useState(2),
    [parts, setParts] = useState(() =>
      Array.from({ length: 2 }, () => ({
        quantity: stock.quantity == null ? null : stock.quantity / 2,
        containerId: '',
        packaging: 'mylar_1' as StockInput['packaging'],
      })),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const total = round(parts.reduce((a, p) => a + (p.quantity || 0), 0));
  return (
    <Modal
      title="One batch. A few organized bags."
      subtitle={`${stock.name} · ${stock.quantity ?? 'Unknown'} ${stock.unit} available`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setBusy(true);
          try {
            const saved = await api<Stock[]>(`/api/stocks/${stock.id}/split`, 'POST', {
              version: stock.version,
              parts: parts.map((p) => ({ ...p, containerId: p.containerId || null })),
            });
            await reload();
            onClose();
            setModal({ type: 'labels', ids: saved.slice(1).map((s) => s.id) });
            toast('Batch divided without changing your reserve total');
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <p className="footnote">
            Bags inherit this batch’s dates and nutrition. Gallon sizes describe packaging, not food
            weight.
          </p>
          <Field label="Number of bags">
            <input
              aria-label="Number of bags"
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => {
                const n = Math.max(1, Math.min(100, Number(e.target.value) || 1));
                const portion =
                  stock.quantity == null ? null : Math.floor((stock.quantity / n) * 1e6) / 1e6;
                setCount(n);
                setParts(
                  Array.from({ length: n }, (_, i) => ({
                    quantity:
                      stock.quantity == null || portion == null
                        ? null
                        : i === n - 1
                          ? round(stock.quantity - portion * (n - 1))
                          : portion,
                    containerId: parts[i]?.containerId || '',
                    packaging: parts[i]?.packaging || 'mylar_1',
                  })),
                );
              }}
            />
          </Field>
          {parts.map((p, i) => (
            <div className="split-row" key={i}>
              <span>Bag {i + 1}</span>
              <Field label={`Amount (${stock.unit})`}>
                <Num
                  label={`Bag ${i + 1} quantity`}
                  value={p.quantity}
                  required
                  min={0.00000001}
                  onChange={(n) =>
                    setParts((values) =>
                      values.map((v, j) => (i === j ? { ...v, quantity: n } : v)),
                    )
                  }
                />
              </Field>
              <Field label="Packaging">
                <select
                  aria-label={`Bag ${i + 1} packaging`}
                  value={p.packaging}
                  onChange={(e) =>
                    setParts((values) =>
                      values.map((v, j) =>
                        i === j
                          ? { ...v, packaging: e.target.value as StockInput['packaging'] }
                          : v,
                      ),
                    )
                  }
                >
                  {[
                    ['mylar_1', '1-gallon Mylar'],
                    ['mylar_3', '3-gallon Mylar'],
                    ['mylar_5', '5-gallon Mylar'],
                    ['original', 'Original package'],
                  ].map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Bucket">
                <select
                  aria-label={`Bag ${i + 1} bucket`}
                  value={p.containerId}
                  onChange={(e) =>
                    setParts((values) =>
                      values.map((v, j) => (i === j ? { ...v, containerId: e.target.value } : v)),
                    )
                  }
                >
                  <option value="">No bucket</option>
                  {state.containers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {bucketName(c)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ))}
          <p>
            <strong>
              {number(total, 4)} {stock.unit}
            </strong>{' '}
            assigned ·{' '}
            <strong>
              {stock.quantity == null ? 'Unknown' : number(stock.quantity - total, 4)}
            </strong>{' '}
            left in the original unit
          </p>
          <ErrorMessage message={error} />
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button"
            disabled={busy || stock.quantity == null || total > stock.quantity}
          >
            {busy ? (
              <Busy />
            ) : (
              <>
                <Split size={17} />
                Split & make labels
              </>
            )}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function LabelsModal({
  ids,
  containerIds,
  onClose,
}: {
  ids: string[];
  containerIds: string[];
  onClose: () => void;
}) {
  const { state } = useApp();
  const all = [
    ...ids.map((id) => ({
      id,
      name: state.stocks.find((s) => s.id === id)?.name || id,
      container: false,
    })),
    ...containerIds.map((id) => ({
      id,
      name: state.containers.find((c) => c.id === id)
        ? bucketName(state.containers.find((c) => c.id === id)!)
        : id,
      container: true,
    })),
  ];
  const [selected, setSelected] = useState(new Set(all.map((l) => l.id))),
    [preview, setPreview] = useState(all[0]);
  const body = {
    ids: ids.filter((id) => selected.has(id)),
    containerIds: containerIds.filter((id) => selected.has(id)),
  };
  return (
    <Modal
      title="Labels for your reserve"
      subtitle="Phomemo M110 · review, export, then print in Print Master."
      onClose={onClose}
      wide
    >
      <div className="modal-body label-layout">
        <div>
          <p>
            {state.settings.labelWidth} × {state.settings.labelHeight} mm · 203 dpi
          </p>
          <div className="label-selection">
            {all.map((label) => (
              <div key={label.id}>
                <input
                  aria-label={`Include label ${label.id}`}
                  type="checkbox"
                  checked={selected.has(label.id)}
                  onChange={(e) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(label.id);
                      else next.delete(label.id);
                      return next;
                    })
                  }
                />
                <button
                  className={preview?.id === label.id ? 'active' : ''}
                  onClick={() => setPreview(label)}
                >
                  <strong>{label.name}</strong>
                  <small>{label.id}</small>
                </button>
              </div>
            ))}
          </div>
          <p className="footnote">
            QR links use {state.settings.appBaseUrl}. Set a stable home-network address in Settings
            before printing permanent labels.
          </p>
          <p className="footnote">
            Excel exports contain plain text and QR URLs, up to 100 records. In Print Master, map
            the URL column to a QR-code field. PNG exports are for one selected label.
          </p>
        </div>
        <div className="label-preview">
          {preview && (
            <img
              alt="Label preview"
              src={`/api/labels/preview?${preview.container ? 'containerId' : 'stockId'}=${encodeURIComponent(preview.id)}`}
            />
          )}
          <span>Preview · actual print size follows Settings</span>
        </div>
      </div>
      <footer className="modal-footer wrap">
        <AsyncButton
          className="button secondary"
          disabled={selected.size !== 1}
          action={() =>
            download('/api/labels/export', 'haven-label.png', { ...body, format: 'png' })
          }
        >
          <Download size={16} />
          PNG
        </AsyncButton>
        <AsyncButton
          className="button secondary"
          disabled={selected.size < 1 || selected.size > 100}
          action={() =>
            download('/api/labels/export', 'haven-labels.xlsx', { ...body, format: 'xlsx' })
          }
        >
          <Download size={16} />
          Excel batch
        </AsyncButton>
        <AsyncButton
          disabled={selected.size < 1 || selected.size > 100}
          action={() =>
            download('/api/labels/export', 'haven-labels.pdf', { ...body, format: 'pdf' })
          }
        >
          <Printer size={16} />
          Printable PDF
        </AsyncButton>
      </footer>
    </Modal>
  );
}
function ContainerModal({ id, onClose }: { id?: string; onClose: () => void }) {
  const { state, mutate, toast } = useApp(),
    old = state.containers.find((c) => c.id === id);
  const [name, setName] = useState(old?.name || ''),
    [locationId, setLocation] = useState(old?.locationId || ''),
    [capacity, setCapacity] = useState<number | null>(old?.capacityGallons || 5),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={old ? `Edit ${bucketName(old)}` : 'Give a bucket a home'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await mutate(
              old ? `/api/containers/${old.id}` : '/api/containers',
              old ? 'PUT' : 'POST',
              {
                name,
                locationId: locationId || null,
                capacityGallons: capacity,
                version: old?.version,
              },
            );
            onClose();
            toast('Bucket saved');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <p className="section-description">
            {old
              ? `Permanent bucket number: ${bucketNumberLabel(old)}. This stays with the physical bucket when you move or refill it.`
              : 'A permanent number is assigned when you save. Existing bucket numbers never change.'}
          </p>
          <Field label="Nickname (optional)">
            <input
              aria-label="Bucket nickname"
              placeholder="e.g. Breakfast supplies"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Location">
            <select
              aria-label="Bucket location"
              value={locationId}
              onChange={(e) => setLocation(e.target.value)}
            >
              <option value="">Not assigned</option>
              {state.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bucket capacity (gallons)">
            <Num
              label="Bucket capacity"
              value={capacity}
              required
              min={0.01}
              onChange={setCapacity}
            />
          </Field>
          <ErrorMessage message={error} />
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={busy}>
            {busy ? <Busy /> : 'Save bucket'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function HistoryModal({ stock, onClose }: { stock: Stock; onClose: () => void }) {
  const [rows, setRows] = useState<
      { action: string; note: string; createdAt: string; beforeJson: string; afterJson: string }[]
    >([]),
    [error, setError] = useState('');
  useEffect(() => {
    void api<typeof rows>(`/api/stocks/${stock.id}/history`)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [stock.id]);
  return (
    <Modal title="Inventory history" subtitle={`${stock.name} · ${stock.id}`} onClose={onClose}>
      <div className="modal-body">
        <ErrorMessage message={error} />
        {rows.map((row, i) => {
          const before = JSON.parse(row.beforeJson),
            after = JSON.parse(row.afterJson);
          return (
            <div className="history-row" key={i}>
              <strong>{row.action}</strong>
              <time>{new Date(row.createdAt).toLocaleString()}</time>
              <p>
                {before?.quantity ?? 'Unknown'} → {after.quantity ?? 'Unknown'} {after.unit}
              </p>
              {row.note && <p>{row.note}</p>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
