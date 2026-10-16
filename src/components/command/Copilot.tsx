// Ginkgo Command Center — copilot dock.
// AI mode: a Claude agent that answers by calling tools over the computed grid;
// every figure in its answer is checked against the tool results.
// Template mode (no API key configured, or the AI is unreachable): copilot/explainer.ts
// restates computed values. Internal tool calls are shown as plain-language steps,
// never as raw JSON.

import { Fragment, useEffect, useEffectEvent, useRef, useState, type FC, type ReactNode } from 'react';
import { answer, detectIntent, SUGGESTIONS, type Answer, type CopilotContext, type Intent } from '../../copilot/explainer';
import { extractFigures } from '../../copilot/grounding';
import type { Agent, AgentEntry } from '../../copilot/useAgent';

type Msg = { id: number; role: 'user'; text: string } | { id: number; role: 'bot'; a: Answer };

export interface ContextChip { key: string; label: string; onRemove?: () => void }
export interface AskRequest { intent: Intent; label: string; token: number }

interface Props {
  chips: ContextChip[];
  getContext: () => CopilotContext;
  request: AskRequest | null;
  agent: Agent;
  /** focus the input (e.g. from the map's "Ask Ginkgo" button) */
  focusToken?: number;
}

const AI_SUGGESTIONS = [
  'Is Taman Sri Muda flood-prone?',
  'Which hospitals in Klang sit in High zones?',
  'Compare Petaling under Normal and Extreme rain',
  'Where could a new school go in Sepang?',
  'Why is this area flagged?',
  'How was the model checked?',
];

const MODEL_NAME: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5', 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-haiku-5-5': 'Claude Haiku 5.5',
  'claude-fable-5-1': 'Claude Fable 5.1',
};

/** **bold** + figure highlighting for numbers the grounding check could not trace. */
function inline(t: string, unverified: Set<string>, key: string): ReactNode {
  return t.split(/\*\*(.+?)\*\*/g).map((part, i) => {
    const marked: ReactNode[] = [];
    let last = 0;
    for (const f of unverified.size ? extractFigures(part) : []) {
      if (!unverified.has(f.raw)) continue;
      marked.push(part.slice(last, f.start), <mark key={`${key}-${i}-${f.start}`} title="Not found in tool results — check this figure">{f.raw}</mark>);
      last = f.end;
    }
    marked.push(part.slice(last));
    return i % 2 ? <strong key={`${key}-${i}`}>{marked}</strong> : <Fragment key={`${key}-${i}`}>{marked}</Fragment>;
  });
}

function richBlock(text: string, unverified: Set<string> = new Set()): ReactNode {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((b, bi) => {
    const lines = b.split('\n');
    if (lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
      return <ul key={bi}>{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), unverified, `${bi}-${li}`)}</li>)}</ul>;
    }
    return <p key={bi}>{lines.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l.replace(/^#+\s*/, ''), unverified, `${bi}-${li}`)}</Fragment>)}</p>;
  });
}

const AgentAnswer: FC<{ e: AgentEntry; fallback: Answer | null }> = ({ e, fallback }) => {
  if (e.role === 'error') {
    return (
      <div className="msg-bot">
        <div className="callout warn">AI copilot unavailable: {e.text}{fallback ? ' Here is the template answer instead.' : ''}</div>
        {fallback && <TemplateAnswer a={fallback} />}
      </div>
    );
  }
  const unverified = new Set((e.grounding?.numbers ?? []).filter(n => !n.grounded).map(n => n.raw));
  return (
    <div className="msg-bot">
      {e.steps && e.steps.length > 0 && (
        <ol className="agent-steps" aria-label="What the copilot did">
          {e.steps.map(s => <li key={s.id} className={s.ok ? '' : 'err'}>{s.ok ? '✓' : '!'} {s.label}</li>)}
        </ol>
      )}
      {e.pending ? (
        <div className="agent-thinking"><span className="dots" aria-hidden><i /><i /><i /></span> Working…</div>
      ) : (
        <>
          <div className="agent-text">{richBlock(e.text, unverified)}</div>
          {e.notice && <div className="callout" style={{ marginTop: 6 }}>{e.notice}</div>}
          {e.grounding && e.grounding.total > 0 && (
            <div className={`grounding ${e.grounding.grounded === e.grounding.total ? 'ok' : 'warn'}`}>
              {e.grounding.grounded === e.grounding.total
                ? `✓ All ${e.grounding.total} figure${e.grounding.total === 1 ? '' : 's'} match the tool results`
                : `⚠ ${e.grounding.total - e.grounding.grounded} of ${e.grounding.total} figures not found in the tool results (highlighted) — check before quoting`}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const TemplateAnswer: FC<{ a: Answer }> = ({ a }) => (
  <>
    <div className="m-title">{a.title}</div>
    {a.text.map((t, i) => <p key={i}>{inline(t, new Set(), String(i))}</p>)}
    {a.evidence.length > 0 && (
      <div className="evidence">
        {a.evidence.map((e, i) => (
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
  </>
);

export const Copilot: FC<Props> = ({ chips, getContext, request, agent, focusToken }) => {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const seq = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const ai = agent.mode === 'ai';

  const askTemplate = (text: string, intent?: Intent) => {
    const i = intent ?? detectIntent(text);
    const a = answer(getContext(), i);
    setMsgs(m => [...m.slice(-11), { id: ++seq.current, role: 'user', text }, { id: ++seq.current, role: 'bot', a }]);
  };
  const ask = (text: string, intent?: Intent) => (ai ? agent.ask(text) : askTemplate(text, intent));

  // Requests from elsewhere in the app (e.g. "Ask copilot" on a map cell) arrive as a
  // new object each time; the effect event always sees the latest context.
  const onRequest = useEffectEvent((r: AskRequest) => ask(r.label, r.intent));
  useEffect(() => { if (request) onRequest(request); }, [request]);
  useEffect(() => { if (focusToken) input.current?.focus(); }, [focusToken]);

  const count = ai ? agent.entries.length : msgs.length;
  useEffect(() => { if (count) end.current?.scrollIntoView({ block: 'nearest' }); }, [count, agent.entries]);

  const lastUserText = (id: number) => {
    const i = agent.entries.findIndex(x => x.id === id);
    for (let k = i - 1; k >= 0; k--) if (agent.entries[k].role === 'user') return agent.entries[k].text;
    return '';
  };

  return (
    <section className="card copilot" aria-label="Copilot">
      <div className="card-head">
        <div>
          <div className="card-title">Copilot</div>
          <div className="card-sub">Explains the computed numbers — never makes them up</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`ai-pill ${agent.mode}`} title={ai ? 'Live AI agent with tool use' : 'Template answers — no AI model configured'}>
            {agent.mode === 'checking' ? '…' : ai ? `✦ ${MODEL_NAME[agent.model ?? ''] ?? agent.model ?? 'Claude'}` : 'Template'}
          </span>
          {count > 0 && <button className="btn btn-ghost btn-sm" onClick={() => (ai ? agent.reset() : setMsgs([]))}>New chat</button>}
        </div>
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
        {ai
          ? agent.entries.map(e => e.role === 'user'
            ? <div key={e.id} className="msg-user">{e.text}</div>
            : <AgentAnswer key={e.id} e={e} fallback={e.role === 'error' ? answer(getContext(), detectIntent(lastUserText(e.id))) : null} />)
          : msgs.map(m => m.role === 'user'
            ? <div key={m.id} className="msg-user">{m.text}</div>
            : <div key={m.id} className="msg-bot"><TemplateAnswer a={m.a} /></div>)}
        <div ref={end} />
      </div>

      <div className="chips">
        {ai
          ? AI_SUGGESTIONS.map(s => <button key={s} className="chip" disabled={agent.busy} onClick={() => ask(s)}>{s}</button>)
          : SUGGESTIONS.map(s => <button key={s.intent} className="chip" onClick={() => ask(s.label, s.intent)}>{s.label}</button>)}
      </div>
      <form className="copilot-input" onSubmit={e => { e.preventDefault(); if (q.trim()) { ask(q.trim()); setQ(''); } }}>
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} disabled={ai && agent.busy}
          placeholder={ai ? 'Ask anything about flood risk in Selangor…' : 'Ask about this area…'} aria-label="Ask the copilot" />
        <button className="btn btn-primary btn-sm" type="submit" disabled={ai && agent.busy}>Ask</button>
      </form>
      <div className="source-line">
        {ai
          ? 'Claude answers by calling tools over the computed layers; it cannot change any number, and figures it cannot trace to a tool result are flagged.'
          : agent.mode === 'off'
            ? 'Template mode: answers are assembled from the computed figures. Set ANTHROPIC_API_KEY on the server to switch on the Claude agent.'
            : 'Checking for the AI copilot…'}
      </div>
    </section>
  );
};
