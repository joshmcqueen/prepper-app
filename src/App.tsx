import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  House,
  LayoutDashboard,
  Leaf,
  MapPin,
  Menu,
  Monitor,
  Plus,
  Settings2,
  ShieldCheck,
  Target,
  Users,
  X,
} from 'lucide-react';
import { api, categoryNames, number, type AppState } from './api';
import { AsyncButton, CategoryIcon, Empty, ErrorMessage, Toggle, icons } from './ui';
import type { Category, Coverage, Stock } from '../shared/model';
import { Inventory, ContainersPage, StockDetail, InventoryModal } from './Inventory';
import { StockEditor } from './StockEditor';
import { SettingsPage } from './Settings';

export type ModalState =
  | { type: 'edit'; category: Category; stock?: Stock; duplicate?: boolean }
  | { type: 'action' | 'split' | 'history'; stock: Stock }
  | { type: 'labels'; ids: string[]; containerIds?: string[] }
  | { type: 'container'; id?: string }
  | null;
type Context = {
  state: AppState;
  reload: () => Promise<void>;
  navigate: (path: string) => void;
  setModal: (m: ModalState) => void;
  toast: (message: string) => void;
  mutate: (url: string, method: string, body?: unknown) => Promise<void>;
};
const AppContext = createContext<Context | null>(null);
export function useApp() {
  return useContext(AppContext)!;
}
export function App() {
  const [state, setState] = useState<AppState | null>(null),
    [error, setError] = useState(''),
    [pathname, setPathname] = useState(window.location.pathname),
    [modal, setModal] = useState<ModalState>(null),
    [notification, toast] = useState(''),
    [menu, setMenu] = useState(false);
  const reload = useCallback(async () => {
    const data = await api<AppState>('/api/state');
    setState(data);
    setError('');
  }, []);
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
    const listener = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, [reload]);
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => toast(''), 5000);
    return () => clearTimeout(timer);
  }, [notification]);
  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setPathname(path.split('#')[0]);
    if (path.includes('#'))
      setTimeout(
        () => document.getElementById(path.split('#')[1])?.scrollIntoView({ behavior: 'smooth' }),
        50,
      );
    setMenu(false);
    window.scrollTo(0, 0);
  };
  const mutate = async (url: string, method: string, body?: unknown) => {
    await api(url, method, body);
    await reload();
  };
  if (!state)
    return (
      <main className="loading-screen">
        <div className="brand">
          <span className="brand-mark">
            <House size={22} />
          </span>
          haven<span className="brand-dot">.</span>
        </div>
        {error ? (
          <>
            <ErrorMessage message={error} />
            <AsyncButton action={reload}>Try again</AsyncButton>
          </>
        ) : (
          <p>Opening your household inventory…</p>
        )}
      </main>
    );
  const page = pathname.split('/')[1] || 'dashboard',
    detailId = pathname.split('/')[2];
  const display = page === 'display';
  const context: Context = { state, reload, navigate, setModal, toast, mutate };
  const nav: { path: string; label: string; icon: typeof House }[] = [
    { path: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    ...Object.entries(categoryNames).map(([path, label]) => ({
      path,
      label,
      icon: icons[path as Category],
    })),
    { path: 'attention', label: 'Needs attention', icon: Bell },
  ];
  return (
    <AppContext.Provider value={context}>
      <div className={`app ${display ? 'display-mode' : ''}`}>
        {!display && (
          <>
            <div
              className={`sidebar-shade ${menu ? 'visible' : ''}`}
              onClick={() => setMenu(false)}
            />
            <aside className={`sidebar ${menu ? 'open' : ''}`}>
              <a
                href="/"
                className="brand"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/');
                }}
              >
                <span className="brand-mark">
                  <House size={21} strokeWidth={1.8} />
                </span>
                haven<span className="brand-dot">.</span>
              </a>
              <div className="sidebar-eyebrow">HOUSEHOLD PREPAREDNESS</div>
              <nav aria-label="Main navigation">
                {nav.map(({ path, label, icon: Icon }) => (
                  <a
                    href={`/${path}`}
                    key={path}
                    className={page === path || (path === 'dashboard' && !page) ? 'active' : ''}
                    aria-current={page === path ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/${path}`);
                    }}
                  >
                    <Icon size={19} strokeWidth={1.7} />
                    <span>{label}</span>
                    {path === 'attention' && state.dashboard.alerts.length > 0 && (
                      <b className="nav-count">{state.dashboard.alerts.length}</b>
                    )}
                  </a>
                ))}
              </nav>
              <button className="sidebar-link" onClick={() => navigate('/containers')}>
                <MapPin size={18} />
                Storage & buckets
                <ChevronRight size={15} />
              </button>
              <div className="sidebar-bottom">
                <div className="goal-note">
                  <span>
                    <Target size={18} />A little, often.
                  </span>
                  <p>Every addition brings your household closer to ready.</p>
                  <button onClick={() => navigate('/settings')}>
                    Your coverage goals <ArrowRight size={14} />
                  </button>
                </div>
                <a
                  href="/settings"
                  className={page === 'settings' ? 'sidebar-link selected' : 'sidebar-link'}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/settings');
                  }}
                >
                  <Settings2 size={18} />
                  Settings
                </a>
                <div className="local-status">
                  <i />
                  Stored on your home server
                </div>
              </div>
            </aside>
          </>
        )}
        <div className="workspace">
          {!display && (
            <header className="topbar">
              <button
                className="icon-button menu-button"
                aria-label={menu ? 'Close navigation' : 'Open navigation'}
                onClick={() => setMenu(!menu)}
              >
                {menu ? <X size={22} /> : <Menu size={22} />}
              </button>
              <div className="breadcrumb">
                Your household <ChevronRight size={14} />
                <strong>
                  {page === 'dashboard'
                    ? 'Overview'
                    : categoryNames[page as Category] ||
                      {
                        attention: 'Needs attention',
                        settings: 'Settings',
                        containers: 'Storage & buckets',
                        container: 'Bucket contents',
                        item: 'Inventory item',
                      }[page] ||
                      'Overview'}
                </strong>
              </div>
              <div className="household-chip">
                <Users size={16} />
                {state.settings.adults} adults <span>·</span> 1 dog
              </div>
              <button
                className="top-alert icon-button"
                aria-label="View notifications"
                onClick={() => navigate('/attention')}
              >
                <Bell size={19} />
                {state.dashboard.alerts.length > 0 && <i />}
              </button>
            </header>
          )}
          <main className="main-content">
            {state.demo && !display && (
              <div className="demo-banner">
                <span>
                  Sample data · explore freely. These are fictional supplies and planning inputs.
                </span>
                <button onClick={() => navigate('/settings#database')}>
                  Reset or reseed <ArrowRight size={13} />
                </button>
              </div>
            )}
            {error && <ErrorMessage message={error} />}
            {page === 'dashboard' ? (
              <DashboardPage />
            ) : Object.keys(categoryNames).includes(page) ? (
              <Inventory category={page as Category} />
            ) : page === 'settings' ? (
              <SettingsPage />
            ) : page === 'containers' || page === 'container' ? (
              <ContainersPage containerId={page === 'container' ? detailId : undefined} />
            ) : page === 'item' ? (
              <StockDetail id={detailId} />
            ) : page === 'attention' || page === 'display' ? (
              <AttentionPage display={display} />
            ) : (
              <DashboardPage />
            )}
          </main>
          {!display && (
            <footer className="page-footer">
              <span>
                <ShieldCheck size={14} />A clearer picture. A little more peace of mind.
              </span>
              <span>Haven · Your household reserve</span>
            </footer>
          )}
        </div>
        {notification && (
          <div className="toast" role="status">
            <Check size={18} />
            {notification}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => toast('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {modal?.type === 'edit' ? (
          <StockEditor
            category={modal.category}
            stock={modal.stock}
            duplicate={modal.duplicate}
            onClose={() => setModal(null)}
          />
        ) : (
          modal && <InventoryModal modal={modal} onClose={() => setModal(null)} />
        )}
      </div>
    </AppContext.Provider>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function CoverageCard({
  category,
  compact = false,
}: {
  category: 'food' | 'water' | 'fuel' | 'dog';
  compact?: boolean;
}) {
  const { state, navigate } = useApp(),
    coverage: Coverage = state.dashboard[category];
  const percent =
    coverage.days == null ? null : Math.min(100, (coverage.days / coverage.target) * 100);
  const daysLabel =
    category === 'fuel' && state.settings.naturalGasAvailable
      ? 'Utility available'
      : coverage.days == null
        ? 'Needs setup'
        : coverage.unknown
          ? 'days from recorded amounts'
          : 'days of coverage';
  return (
    <button
      className={`coverage-card ${category} ${compact ? 'compact' : ''}`}
      onClick={() => navigate(`/${category}`)}
    >
      <div className="card-top">
        <CategoryIcon category={category} />
        <span>{category === 'dog' ? 'Dog food' : categoryNames[category]}</span>
        <ArrowRight size={18} />
      </div>
      <div className="coverage-value">
        {coverage.days == null ? <span className="unknown">—</span> : number(coverage.days, 1)}
        <span>{daysLabel}</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={`${categoryNames[category]} progress toward coverage goal`}
        aria-valuenow={percent ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${percent ?? 0}%` }} />
      </div>
      <div className="progress-caption">
        <span>
          {percent == null ? 'Set daily needs to calculate' : `${number(percent)}% of goal`}
        </span>
        <strong>{coverage.target}-day goal</strong>
      </div>
      <div className="coverage-total">
        <strong>
          {number(
            category === 'dog' ? coverage.total / 453.59237 : coverage.total,
            category === 'food' ? 0 : 1,
          )}
        </strong>{' '}
        {category === 'dog' ? 'lb of food' : coverage.unit} in storage
        {coverage.unknown > 0 && (
          <small>
            {coverage.unknown} item{coverage.unknown === 1 ? '' : 's'} need more details
          </small>
        )}
      </div>
    </button>
  );
}
function DashboardPage() {
  const { state, navigate, setModal, mutate, toast } = useApp();
  const { dashboard, settings } = state;
  const needsSetup =
    !settings.caloriesPerAdult ||
    settings.waterPerAdult == null ||
    settings.dogWaterGallons == null ||
    !settings.dogRationGrams;
  return (
    <>
      <PageHeading
        eyebrow="YOUR READINESS, AT A GLANCE"
        title="A little more prepared."
        description="Know what you have. See what’s next. Build peace of mind."
        action={
          <button className="button" onClick={() => setModal({ type: 'edit', category: 'food' })}>
            <Plus size={18} />
            Add a resource
          </button>
        }
      />
      <div className="overview-strip">
        <span>
          <span className="small-dot" /> {settings.householdName}
        </span>
        <span>
          <Users size={15} />
          {settings.adults} adults + your dog
        </span>
        <button onClick={() => navigate('/settings')}>
          <Target size={15} />
          {settings.targets.food}-day food goal
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="coverage-grid">
        {(['food', 'water', 'fuel'] as const).map((category) => (
          <CoverageCard key={category} category={category} />
        ))}
      </div>
      {needsSetup && (
        <div className="setup-banner">
          <span className="setup-symbol">
            <Settings2 size={23} />
          </span>
          <div>
            <h3>Make these numbers yours.</h3>
            <p>Set your household’s daily needs to turn inventory totals into days of coverage.</p>
          </div>
          <button className="button secondary" onClick={() => navigate('/settings')}>
            Set daily needs <ArrowRight size={16} />
          </button>
        </div>
      )}
      <div className="dashboard-middle">
        <section className="panel attention-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">YOUR NEXT STEPS</span>
              <h2>Needs a little attention</h2>
            </div>
            <button className="text-button" onClick={() => navigate('/attention')}>
              View all <ArrowRight size={16} />
            </button>
          </div>
          <AlertList limit={4} />
        </section>
        <section className="dog-panel">
          <div className="section-heading">
            <CategoryIcon category="dog" />
            <span className="subtle">PART OF THE PLAN, TOO</span>
          </div>
          <h2>Don’t forget the dog.</h2>
          <p>Keep their own food reserve in view.</p>
          <div className="dog-metric">
            <strong>{dashboard.dog.days == null ? '—' : number(dashboard.dog.days, 1)}</strong>
            <span>
              {dashboard.dog.days == null
                ? 'Set a daily ration for coverage'
                : 'days of food for your dog'}
            </span>
          </div>
          <div className="progress-track">
            <span
              style={{
                width: `${Math.min(100, ((dashboard.dog.days || 0) / settings.targets.dog) * 100)}%`,
              }}
            />
          </div>
          <div className="progress-caption">
            <span>{number(dashboard.dog.total / 453.59237, 1)} lb stored</span>
            <span>{settings.targets.dog}-day goal</span>
          </div>
          <button className="text-button" onClick={() => navigate('/dog')}>
            View dog supplies <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">SMALL STEPS, STRONGER RESERVES</span>
              <h2>
                {dashboard.totalItems
                  ? 'Keep building your reserve'
                  : 'Start with what you already have'}
              </h2>
            </div>
            <Leaf size={24} className="sage" />
          </div>
          <div className="starter-actions">
            <div>
              <span className="step-number">01</span>
              <div>
                <strong>Catalog your first food</strong>
                <p>A photo, a few details, and you’re on your way.</p>
              </div>
              <button
                className="icon-button"
                aria-label="Add food"
                onClick={() => setModal({ type: 'edit', category: 'food' })}
              >
                <Plus size={20} />
              </button>
            </div>
            <div>
              <span className="step-number">02</span>
              <div>
                <strong>Bring in your water reserve</strong>
                <p>Six 5-gallon jugs + your outdoor 200-gallon tank.</p>
              </div>
              {state.setup.water ? (
                <Check className="sage" size={20} />
              ) : (
                <AsyncButton
                  className="button small secondary"
                  action={async () => {
                    await mutate('/api/setup', 'POST', { water: true });
                    toast('Added 230 gallons. Add rotation dates after checking your water.');
                  }}
                >
                  Confirm & add
                </AsyncButton>
              )}
            </div>
            <div>
              <span className="step-number">03</span>
              <div>
                <strong>Give your buckets a home</strong>
                <p>Set up 12 empty buckets, ready for labeled bags.</p>
              </div>
              {state.setup.buckets ? (
                <Check className="sage" size={20} />
              ) : (
                <AsyncButton
                  className="button small secondary"
                  action={async () => {
                    await mutate('/api/setup', 'POST', { buckets: true });
                    toast('Created 12 empty buckets');
                  }}
                >
                  Create buckets
                </AsyncButton>
              )}
            </div>
          </div>
        </section>
        <section className="panel food-mix">
          <div className="section-heading">
            <div>
              <span className="eyebrow">WHAT’S IN YOUR PANTRY</span>
              <h2>Your food mix</h2>
            </div>
            <CategoryIcon category="food" size={17} />
          </div>
          {dashboard.foodTypes.length ? (
            <div className="mix-chart">
              {dashboard.foodTypes.slice(0, 5).map((t) => (
                <div key={t.name}>
                  <span>
                    {t.name}
                    <strong>{number(t.calories)} kcal</strong>
                  </span>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${dashboard.food.total ? (t.calories / dashboard.food.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mix-empty">
              <div className="empty-bars">
                <i />
                <i />
                <i />
                <i />
              </div>
              <p>
                Your pantry picture will grow
                <br />
                as you catalog food.
              </p>
            </div>
          )}
          <small>Based on recorded calories. Items with missing nutrition are excluded.</small>
        </section>
      </div>
    </>
  );
}
export function AlertList({ limit, filter = 'all' }: { limit?: number; filter?: string }) {
  const { state, navigate } = useApp();
  const alerts = state.dashboard.alerts.filter(
    (a) => filter === 'all' || (filter === 'priority' ? a.highPriority : a.type === filter),
  );
  if (!alerts.length)
    return (
      <Empty title="A clear list. A fresh start.">
        Add your supplies and their dates. We’ll keep the next steps together here.
      </Empty>
    );
  return (
    <div className="alert-list">
      {alerts.slice(0, limit).map((alert) => (
        <button
          key={alert.key}
          className="alert-row"
          onClick={() => navigate(alert.stockId ? `/item/${alert.stockId}` : `/${alert.category}`)}
        >
          <CategoryIcon category={alert.category} size={18} />
          <span>
            <strong>
              {alert.name}
              {alert.highPriority && <span className="priority-tag">Priority</span>}
            </strong>
            <small>{alert.message}</small>
          </span>
          <span className={`status-pill ${alert.days != null && alert.days < 0 ? 'overdue' : ''}`}>
            {alert.type === 'setup'
              ? 'Needs details'
              : alert.type === 'low_stock'
                ? 'Low stock'
                : alert.days != null && alert.days < 0
                  ? 'Overdue'
                  : 'Upcoming'}
          </span>
          <ChevronRight size={16} />
        </button>
      ))}
    </div>
  );
}
function AttentionPage({ display }: { display: boolean }) {
  const { navigate, reload, toast } = useApp();
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    if (!display) return;
    const timer = setInterval(
      () =>
        void reload().catch(() =>
          toast('Connection lost. Displayed inventory may be out of date.'),
        ),
      60000,
    );
    return () => clearInterval(timer);
  }, [display, reload, toast]);
  return (
    <>
      <PageHeading
        eyebrow={display ? 'HAVEN · HOUSEHOLD STATUS' : 'KEEP YOUR RESERVE READY'}
        title="Needs attention"
        description="Dates, rotations, and low stock, all in one place."
        action={
          <button
            className="button secondary"
            onClick={() => navigate(display ? '/attention' : '/display')}
          >
            <Monitor size={18} />
            {display ? 'Exit display' : 'Display mode'}
          </button>
        }
      />
      <div className="tabs" aria-label="Filter attention items">
        {[
          ['all', 'All items'],
          ['best_by', 'Best by'],
          ['expiration', 'Expiration'],
          ['rotation', 'Rotation'],
          ['low_stock', 'Low stock'],
          ['priority', 'Priority'],
          ['setup', 'Needs details'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? 'active' : ''}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="panel">
        <AlertList filter={filter} />
      </section>
      <p className="footnote">
        <CircleHelp size={15} />
        Date reminders help you review your supplies; they don’t assess whether an item is safe to
        use.
      </p>
    </>
  );
}
