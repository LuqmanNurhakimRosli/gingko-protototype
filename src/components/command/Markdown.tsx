// Minimal markdown for AI text: "## headings", "-"/"*"/"1." lists, **bold**, line
// breaks. Figures the grounding check could not trace are wrapped in <mark>.

import { Fragment, type FC, type ReactNode } from 'react';
import { extractFigures } from '../../copilot/grounding';

function inline(t: string, unverified: Set<string>, key: string): ReactNode {
  return t.split(/\*\*(.+?)\*\*/g).map((part, i) => {
    const out: ReactNode[] = [];
    let last = 0;
    for (const f of unverified.size ? extractFigures(part) : []) {
      if (!unverified.has(f.raw)) continue;
      out.push(part.slice(last, f.start), <mark key={`${key}-${i}-${f.start}`} title="Not found in tool results — check this figure">{f.raw}</mark>);
      last = f.end;
    }
    out.push(part.slice(last));
    return i % 2 ? <strong key={`${key}-${i}`}>{out}</strong> : <Fragment key={`${key}-${i}`}>{out}</Fragment>;
  });
}

const BULLET = /^\s*([-*•]|\d+[.)])\s+/;

export const Markdown: FC<{ text: string; unverified?: Set<string>; className?: string }> = ({ text, unverified = new Set(), className }) => {
  const nodes: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const k = `p${nodes.length}`;
    nodes.push(<p key={k}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l, unverified, `${k}-${i}`)}</Fragment>)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const k = `l${nodes.length}`;
    const items = list.items.map((l, i) => <li key={i}>{inline(l, unverified, `${k}-${i}`)}</li>);
    nodes.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^#{1,4}\s+/.test(line)) {
      flushPara(); flushList();
      const k = `h${nodes.length}`;
      nodes.push(<h4 key={k}>{inline(line.replace(/^#+\s+/, ''), unverified, k)}</h4>);
      continue;
    }
    const m = BULLET.exec(line);
    if (m) {
      flushPara();
      const ordered = /\d/.test(m[1]);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(line.replace(BULLET, ''));
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return <div className={className}>{nodes}</div>;
};
