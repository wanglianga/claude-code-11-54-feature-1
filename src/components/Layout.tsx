import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Database,
  GitCompareArrows,
  Layers,
  LayoutDashboard,
  ListChecks,
  MapPin,
  PlayCircle,
  ScanSearch,
  ShieldCheck,
  Timer,
  FileText,
  Info,
  Thermometer as ThermometerIcon,
} from 'lucide-react';
import { store, useStore } from '../state/store';
import { bytes } from '../lib/format';
import { fmtLocal, fmtLocalFull } from '../lib/time';

const NAV = [
  { to: '/sources', label: '来源登记', icon: Database, key: 'sources' },
  { to: '/coverage', label: '覆盖对齐', icon: Layers, key: 'coverage' },
  { to: '/mapping', label: '楼栋映射', icon: MapPin, key: 'mapping' },
  { to: '/runs', label: '运行', icon: PlayCircle, key: 'runs' },
  { to: '/results', label: '分析结果', icon: LayoutDashboard, key: 'results' },
  { to: '/bias', label: '位置偏差', icon: ThermometerIcon, key: 'bias' },
  { to: '/complaints', label: '投诉证据', icon: ListChecks, key: 'complaints' },
  { to: '/reports', label: '运行报告', icon: FileText, key: 'reports' },
  { to: '/method', label: '方法与规则', icon: Info, key: 'method' },
];

const TITLES: Record<string, { title: string; sub: string }> = {
  sources: { title: '来源登记', sub: '登记每份文件的来源、哈希、字段解释与数据覆盖范围' },
  coverage: { title: '覆盖对齐', sub: '把读数、气象与工单对齐到本地供热日，先看有没有数据，再谈有没有问题' },
  mapping: { title: '楼栋映射', sub: '维护楼栋、探头与投诉地址的对应关系；修订只影响新运行' },
  runs: { title: '分析运行', sub: '固定输入、规则与截止时点，生成可回查的运行快照' },
  results: { title: '分析结果', sub: '以楼栋 × 供热日覆盖面为底表，投诉作为解释线索关联' },
  bias: { title: '位置偏差', sub: '区分外墙安装的固定位置效应与探头漂移，给出原始、调整与不可区分区间三视图' },
  complaints: { title: '投诉证据', sub: '逐条查看投诉发生时有什么证据，以及不确定性来自哪里' },
  reports: { title: '运行报告', sub: '报告固定引用一次运行的输入与规则，不随后续数据变化' },
  method: { title: '方法与规则', sub: '分类阈值的来源、判定路径与已知局限' },
};

export function Layout() {
  const state = useStore();
  const location = useLocation();
  const key = location.pathname.replace('/', '').split('/')[0] || 'sources';
  const meta = TITLES[key] ?? TITLES.sources;
  const [online, setOnline] = useState(true);
  void online;

  useEffect(() => {
    store.init().catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const latest = state.runs[0];
  const storagePct = state.storage.quota ? Math.min(100, (state.storage.usage / state.storage.quota) * 100) : 0;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Thermometer />
          </div>
          <div>
            <div className="brand-name">热衡</div>
            <div className="brand-sub">Comparability</div>
          </div>
        </div>
        <nav className="nav">
          <div className="nav-label">数据准备</div>
          {NAV.slice(0, 3).map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
          <div className="nav-label">分析</div>
          {NAV.slice(3, 6).map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
          <div className="nav-label">交付</div>
          {NAV.slice(6).map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-note">
            <div className="row" style={{ gap: 6 }}>
              <ShieldCheck size={13} color="var(--teal)" />
              <span style={{ color: 'var(--ink-2)', fontWeight: 560 }}>纯本地处理</span>
            </div>
            <div style={{ marginTop: 4 }}>数据仅保存在本浏览器 IndexedDB，不上传任何真实住户资料。</div>
            <div className="storage-bar">
              <div style={{ width: `${Math.max(2, storagePct)}%` }} />
            </div>
            <div style={{ marginTop: 5, fontFamily: 'var(--mono)', fontSize: 10 }}>
              {bytes(state.storage.usage)} / {state.storage.quota ? bytes(state.storage.quota) : '—'}
            </div>
          </div>
          <div className="sidebar-note">
            <div className="row" style={{ gap: 6 }}>
              <Timer size={13} color="var(--accent)" />
              <span style={{ color: 'var(--ink-2)', fontWeight: 560 }}>运行版本</span>
            </div>
            <div style={{ marginTop: 4 }} className="mono">
              {state.ready ? (latest ? latest.engineVersion : 'engine-1.5.0') : '加载中…'}
            </div>
            <div style={{ marginTop: 2 }}>
              {state.batches.length} 批次 · {state.runs.length} 运行
            </div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <strong>{meta.title}</strong>
            <span>{meta.sub}</span>
          </div>
          <div className="topbar-actions">
            {latest ? (
              <span className="chip teal" title={`运行截止 ${fmtLocalFull(latest.dataCutoffTs)}`}>
                <ScanSearch size={12} />
                最新运行 {fmtLocal(latest.createdAt)}
              </span>
            ) : (
              <span className="chip muted">尚无运行</span>
            )}
            {state.lateData.length > 0 && (
              <NavLink to="/results?late=1" className="chip medium">
                <GitCompareArrows size={12} />
                {state.lateData.length} 批迟到数据
              </NavLink>
            )}
            <NavLink to="/runs" className="btn primary sm">
              <PlayCircle size={13} />
              启动分析
            </NavLink>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
      <Toasts />
      <BusyOverlay />
    </div>
  );
}

function NavItem({ item }: { item: { to: string; label: string; icon: typeof Database } }) {
  const { to, label, icon: Icon } = item;
  const state = useStore();
  let badge: string | number | null = null;
  if (to === '/sources') badge = state.batches.length || null;
  if (to === '/mapping') badge = state.assertions.filter((a) => !a.superseded).length || null;
  if (to === '/runs') badge = state.runs.length || null;
  if (to === '/complaints' && state.runs[0]) badge = state.runs[0].result.complaints.filter((c) => c.status === 'unassigned' || c.status === 'unverifiable').length || null;
  if (to === '/results' && state.runs[0]?.result.blindSpots.length) badge = state.runs[0].result.blindSpots.length;
  return (
    <NavLink to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <Icon size={15} />
      <span>{label}</span>
      {badge !== null && <span className="nav-badge">{badge}</span>}
    </NavLink>
  );
}

function Thermometer() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
      <path d="M14 14.76V5a2 2 0 0 0-4 0v9.76a4 4 0 1 0 4 0Z" />
      <path d="M12 9v6" />
    </svg>
  );
}

function Toasts() {
  const state = useStore();
  return (
    <div className="toasts">
      {state.toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind}`}
          onClick={() => store.dismissToast(t.id)}
          style={{ cursor: 'pointer' }}
        >
          <div style={{ flex: 1 }}>
            <strong>{t.title}</strong>
            {t.detail && <p>{t.detail}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function BusyOverlay() {
  const state = useStore();
  if (!state.busy) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(7,12,16,0.55)',
        backdropFilter: 'blur(2px)',
        zIndex: 70,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div className="panel" style={{ width: 'min(420px, 92vw)', padding: 20 }}>
        <div className="row" style={{ gap: 10 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              display: 'grid',
              placeItems: 'center',
              background: 'var(--accent-dim)',
              color: 'var(--accent)',
            }}
          >
            <ScanSearch size={14} />
          </div>
          <div>
            <div style={{ fontWeight: 620 }}>{state.busy.message}</div>
            {state.busy.detail && <div className="tiny muted">{state.busy.detail}</div>}
          </div>
        </div>
        <div className="progress" style={{ marginTop: 14 }}>
          <div style={{ width: `${state.busy.percent ?? 30}%` }} />
        </div>
        <div className="tiny-2" style={{ marginTop: 7 }}>
          大文件解析与窗口匹配在 WebWorker 中完成，界面保持响应。
        </div>
      </div>
    </div>
  );
}

export function PageHead({
  title,
  lede,
  actions,
}: {
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {lede && <div className="lede">{lede}</div>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  );
}
