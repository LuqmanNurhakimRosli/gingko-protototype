// Phone layout: a draggable bottom sheet over a full-screen map (peek / half / full).

import { useRef, useState, type FC, type ReactNode } from 'react';

export type Snap = 'peek' | 'half' | 'full';
const ORDER: Snap[] = ['peek', 'half', 'full'];

interface Props {
  tabs: { key: string; label: string }[];
  active: string;
  onTab: (k: string) => void;
  snap: Snap;
  onSnap: (s: Snap) => void;
  header: ReactNode;
  children: ReactNode;
}

export const BottomSheet: FC<Props> = ({ tabs, active, onTab, snap, onSnap, header, children }) => {
  const start = useRef<{ y: number; t: number } | null>(null);
  const [drag, setDrag] = useState(0);

  const end = (y: number) => {
    if (!start.current) return;
    const dy = y - start.current.y;
    const fast = Math.abs(dy) / Math.max(1, performance.now() - start.current.t) > 0.5;
    start.current = null;
    setDrag(0);
    const i = ORDER.indexOf(snap);
    if (Math.abs(dy) < 8) { onSnap(ORDER[(i + 1) % ORDER.length]); return; }   // tap cycles
    if (dy < -60 || (fast && dy < 0)) onSnap(ORDER[Math.min(i + 1, 2)]);
    else if (dy > 60 || (fast && dy > 0)) onSnap(ORDER[Math.max(i - 1, 0)]);
  };

  return (
    <section className={`sheet ${snap}`} style={drag ? { transform: `translateY(${Math.max(drag, -200)}px)`, transition: 'none' } : undefined} aria-label="Panels">
      <div
        className="sheet-handle"
        role="button"
        tabIndex={0}
        aria-label={`Panel ${snap}; tap to resize`}
        onPointerDown={e => { start.current = { y: e.clientY, t: performance.now() }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (start.current) setDrag(e.clientY - start.current.y); }}
        onPointerUp={e => end(e.clientY)}
        onPointerCancel={() => { start.current = null; setDrag(0); }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSnap(ORDER[(ORDER.indexOf(snap) + 1) % 3]); } }}
      >
        <span />
      </div>
      <div className="sheet-header">{header}</div>
      <div className="sheet-tabs" role="tablist">
        {tabs.map(t => (
          <button key={t.key} role="tab" aria-selected={active === t.key}
            onClick={() => { onTab(t.key); if (snap === 'peek') onSnap('half'); }}>{t.label}</button>
        ))}
      </div>
      <div className="sheet-body">{children}</div>
    </section>
  );
};
