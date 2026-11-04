import { useId } from 'react';
import { Plus } from 'lucide-react';
import { calendarDay, daysBetween, rotationDate, type Stock } from '../shared/model';
import { useApp } from './App';
import { dateLabel, number } from './api';
import { WaterTank } from './WaterTank';

const jugNames = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function WaterStorage() {
  const { state, setModal, navigate } = useApp();
  const today = calendarDay(new Date(), state.settings.timezone);
  const coverage = state.dashboard.water;
  const jugs = state.stocks
    .filter((stock) => stock.category === 'water' && stock.packaging === 'jug')
    .sort((a, b) => jugNames.compare(a.name, b.name));
  const gallons = jugs.reduce((total, jug) => total + (jug.quantity ?? 0), 0);
  const allJugsUnknown = jugs.length > 0 && jugs.every((jug) => jug.quantity == null);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Water storage</h1>
          <p>
            {coverage.known === 0 && coverage.unknown > 0
              ? 'Stored gallons unknown'
              : `${number(coverage.total, 2)} gallons recorded`}
            {' · '}
            {coverage.days == null
              ? 'Set daily needs to calculate coverage'
              : `${number(coverage.days, 1)} days of coverage${coverage.unknown ? ' from recorded amounts' : ''}`}
            {' · '}
            {coverage.target}-day goal
          </p>
        </div>
        <button className="button" onClick={() => setModal({ type: 'edit', category: 'water' })}>
          <Plus size={18} /> Add water
        </button>
      </div>
      <div className="water-overview">
        <WaterTank today={today} />
        <section className="panel water-jugs-panel" aria-labelledby="water-jugs-heading">
          <div className="section-heading">
            <div>
              <h2 id="water-jugs-heading">Indoor water jugs</h2>
              <p>
                {jugs.length} {jugs.length === 1 ? 'jug' : 'jugs'}
                {' · '}
                {allJugsUnknown
                  ? 'Stored gallons unknown'
                  : `${number(gallons, 2)} gallons recorded`}
              </p>
            </div>
            <button
              className="button small secondary"
              onClick={() => setModal({ type: 'water-jugs' })}
            >
              <Plus size={15} /> Add water jugs
            </button>
          </div>
          {jugs.length ? (
            <ul className="jug-shelf" role="list">
              {jugs.map((jug) => (
                <li key={jug.id}>
                  <JugTile jug={jug} today={today} onOpen={() => navigate(`/item/${jug.id}`)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="water-empty">No water jugs recorded.</p>
          )}
        </section>
      </div>
    </>
  );
}

function JugTile({ jug, today, onOpen }: { jug: Stock; today: string; onOpen: () => void }) {
  const dates = [
    { date: jug.expiresOn, label: 'Expires' },
    { date: jug.bestBy, label: 'Best by' },
    { date: rotationDate(jug), label: 'Rotation' },
  ];
  const next = dates.reduce<(typeof dates)[number] | null>(
    (first, entry) => (entry.date && (!first?.date || entry.date < first.date) ? entry : first),
    null,
  );
  const days = next?.date ? daysBetween(today, next.date) : null;
  const lead = jug.leadDays ?? (jug.highPriority ? 90 : 30);
  const [status, tone] =
    days == null
      ? ['No date set', 'neutral']
      : days < 0
        ? ['Overdue', 'due']
        : days === 0
          ? ['Due today', 'due']
          : days <= lead
            ? ['Due soon', 'soon']
            : ['Scheduled', 'scheduled'];
  const quantity =
    jug.quantity == null
      ? 'Amount unknown'
      : jug.quantity === 0
        ? 'Empty'
        : `${number(jug.quantity, 8)} gal`;
  const level = jug.quantity != null && jug.capacity ? Math.min(1, jug.quantity / jug.capacity) : 0;
  const name = jug.name.replace(/^(?:Sealed )?Water jug (\d+)$/i, 'Jug $1');
  const clip = useId();
  const body =
    'M26 12H43V20C56 21 69 30 69 40V83Q69 91 61 91H15Q7 91 7 83V41C7 33 14 26 26 20Z M48 25Q64 28 64 38Q64 42 60 40L49 34Q46 32 48 25Z';

  return (
    <button className="jug-tile" type="button" onClick={onOpen}>
      <svg viewBox="0 0 76 95" aria-hidden="true" className="jug-gauge">
        <defs>
          <clipPath id={clip}>
            <path d={body} clipRule="evenodd" />
          </clipPath>
        </defs>
        <path d={body} fillRule="evenodd" className="vessel-interior" />
        <g clipPath={`url(#${clip})`}>
          <rect x="0" y={91 - level * 70} width="76" height={level * 70} className="vessel-water" />
          <path d="M7 52H69M7 76H69" className="jug-ribs" />
        </g>
        <path d={body} className="jug-outline" />
        <rect x="25" y="7" width="19" height="9" rx="2" className="jug-cap" />
      </svg>
      <strong>{name}</strong>
      <span className="jug-quantity">{quantity}</span>
      <span className={`jug-status jug-status-${tone}`}>{status}</span>
      {next?.date && (
        <span className="jug-date">
          {next.label} <time dateTime={next.date}>{dateLabel(next.date)}</time>
        </span>
      )}
    </button>
  );
}
