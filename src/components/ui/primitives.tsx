import { useEffect, type ReactNode } from 'react';

export function Panel({
  title,
  sub,
  actions,
  children,
  pad = true,
  className = '',
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  pad?: boolean;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div>
            <h3>{title}</h3>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="panel-head-actions">{actions}</div>}
        </header>
      )}
      {pad ? <div className="panel-body">{children}</div> : children}
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  foot,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  foot?: ReactNode;
  tone?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="stat" style={{ ['--tone' as string]: tone ?? 'rgba(255,255,255,0.08)' }}>
      <div className="label">
        {icon}
        {label}
      </div>
      <div className="value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export function Chip({ tone = '', children, mono }: { tone?: string; children: ReactNode; mono?: boolean }) {
  return <span className={`chip ${tone} ${mono ? 'mono' : ''}`}>{children}</span>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Callout({
  tone = '',
  icon,
  children,
}: {
  tone?: '' | 'warn' | 'danger' | 'info';
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`callout ${tone}`}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function Modal({
  open,
  title,
  sub,
  children,
  footer,
  onClose,
  wide,
}: {
  open: boolean;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal-wrap" role="dialog" aria-modal="true">
        <div className="modal" style={wide ? { width: 'min(1080px, 97vw)' } : undefined}>
          <div className="modal-head">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div>
                <h2>{title}</h2>
                {sub && <div className="tiny muted" style={{ marginTop: 3 }}>{sub}</div>}
              </div>
              <div className="spacer" />
              <button className="btn ghost sm" onClick={onClose} aria-label="关闭">
                ✕
              </button>
            </div>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </>
  );
}

export function Drawer({
  open,
  title,
  sub,
  onClose,
  children,
  actions,
}: {
  open: boolean;
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 17 }}>{title}</h2>
            {sub && <div className="tiny muted" style={{ marginTop: 3 }}>{sub}</div>}
          </div>
          <div className="spacer" />
          {actions}
          <button className="btn ghost sm" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode; count?: number }[];
}) {
  return (
    <div className="tabs">
      {items.map((it) => (
        <button
          key={it.value}
          className={`tab ${value === it.value ? 'active' : ''}`}
          onClick={() => onChange(it.value)}
        >
          {it.label}
          {typeof it.count === 'number' && <span className="tiny-2" style={{ marginLeft: 6 }}>{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KV({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((i) => (
        <div key={i.k} style={{ display: 'contents' }}>
          <dt>{i.k}</dt>
          <dd>{i.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
