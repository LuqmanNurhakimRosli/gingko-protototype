// Hover/focus tooltip state for the command-center charts.

import { useCallback, useState } from 'react';

export interface TipRow { label: string; value: string; color?: string }
export interface TipContent { title: string; rows: TipRow[] }
export interface TipState extends TipContent { x: number; y: number }

export function useTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback((el: HTMLElement | { clientX: number; clientY: number }, content: TipContent) => {
    let x: number, y: number;
    if ('getBoundingClientRect' in el) {
      const r = el.getBoundingClientRect();
      x = r.right + 8; y = r.top;
    } else { x = el.clientX + 14; y = el.clientY + 10; }
    x = Math.min(x, window.innerWidth - 220);
    y = Math.min(y, window.innerHeight - 120);
    setTip({ ...content, x, y });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}
