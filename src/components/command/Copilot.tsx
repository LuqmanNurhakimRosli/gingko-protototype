// Ginkgo Command Center — copilot dock.
// Answers come from copilot/explainer.ts, which only restates computed values.
// Answers render as text + evidence rows; internal calls are never shown raw.

import { Fragment, useEffect, useEffectEvent, useRef, useState, type FC, type ReactNode } from 'react';
import { answer, detectIntent, SUGGESTIONS, type Answer, type CopilotContext, type Intent } from '../../copilot/explainer';

type Msg = { id: number; role: 'user'; text: string } | { id: number; role: 'bot'; a: Answer };

export interface ContextChip { key: string; label: string; onRemove?: () => void }
export interface AskRequest { intent: Intent; label: string; token: number }

interface Props {
  chips: ContextChip[];
  getContext: () => CopilotContext;
  request: AskRequest | null;
}

function rich(t: string): ReactNode {
  return t.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>));
}

export const Copilot: FC<Props> = ({ chips, getContext, request }) => {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const seq = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  const ask = (text: string, intent?: Intent) => {
    const i = intent ?? detectIntent(text);
    const a = answer(getContext(), i);
    setMsgs(m => [...m.slice(-11), { id: ++seq.current, role: 'user', text }, { id: ++seq.current, role: 'bot', a }]);
  };

  // Requests from elsewhere in the app (e.g. "Ask copilot" on a map cell) arrive as a
  // new object each time; the effect event always sees the latest context.
  const onRequest = useEffectEvent((r: AskRequest) => ask(r.label, r.intent));
  useEffect(() => {
    if (request) onRequest(request);
  }, [request]);

  useEffect(() => { if (msgs.length) end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs]);

  return (
    <section className="card copilot" aria-label="Copilot">
      <div className="card-head">
        <div>
          <div className="card-title">Copilot</div>
          <div className="card-sub">Explains the computed numbers — never makes them up</div>
        </div>
        {msgs.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setMsgs([])}>Clear</button>}
      </div>

      <div className="chips" aria-label="Copilot context">
        {chips.map(c => (
          <span className="chip ctx" key={c.key}>
            {c.label}
            {c.onRemove && <button onClick={c.onRemove} aria-label={`Remove ${c.label}`}>×</button>}
          </span>
        ))}
      </div>

      <div className="copilot-msgs" aria-live="polite">
        {msgs.map(m => m.role === 'user' ? (
          <div key={m.id} className="msg-user">{m.text}</div>
        ) : (
          <div key={m.id} className="msg-bot">
            <div className="m-title">{m.a.title}</div>
            {m.a.text.map((t, i) => <p key={i}>{rich(t)}</p>)}
            {m.a.evidence.length > 0 && (
              <div className="evidence">
                {m.a.evidence.map((e, i) => (
                  <div className="ev" key={i}>
                    <span className="k">{e.label}</span>
                    <span className="v">{e.value}</span>
                    {e.source && (
                      <span className="s">
                        {e.source.startsWith('http') ? <a href={e.source} target="_blank" rel="noreferrer">source ↗</a> : e.source}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>

      <div className="chips">
        {SUGGESTIONS.map(s => (
          <button key={s.intent} className="chip" onClick={() => ask(s.label, s.intent)}>{s.label}</button>
        ))}
      </div>
      <form className="copilot-input" onSubmit={e => { e.preventDefault(); if (q.trim()) { ask(q.trim()); setQ(''); } }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ask about this area…" aria-label="Ask the copilot" />
        <button className="btn btn-primary btn-sm" type="submit">Ask</button>
      </form>
      <div className="source-line">
        This build’s copilot is a template explainer: it picks the right computed figures and phrases them. It has no generative model and cannot change any number.
      </div>
    </section>
  );
};
