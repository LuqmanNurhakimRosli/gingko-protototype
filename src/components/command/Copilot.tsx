// Ginkgo Command Center — copilot.
// AI mode: a Claude agent that answers by calling tools over the computed grid;
// every figure in its answer is checked against the tool results, and each answer
// shows what it cost (tokens, prompt-cache share, shared-cache hits).
// Template mode (no API key configured, or the AI is unreachable): copilot/explainer.ts
// restates computed values. Internal tool calls are shown as plain-language steps,
// never as raw JSON.

import { useEffect, useEffectEvent, useRef, useState, type FC } from 'react';
import { answer, detectIntent, SUGGESTIONS, type Answer, type CopilotContext, type Intent } from '../../copilot/explainer';
import type { TurnUsage } from '../../copilot/agentClient';
import { modelName } from '../../copilot/models';
import type { Agent, AgentEntry } from '../../copilot/useAgent';
import { Markdown } from './Markdown';

type Msg = { id: number; role: 'user'; text: string } | { id: number; role: 'bot'; a: Answer };

export interface ContextChip { key: string; label: string; onRemove?: () => void }
export interface AskRequest { intent: Intent; label: string; token: number; prompt?: string }

interface Props {
  chips: ContextChip[];
  getContext: () => CopilotContext;
  request: AskRequest | null;
  agent: Agent;
  /** focus the input (e.g. from the map's "Ask Ginkgo" button) */
  focusToken?: number;
  /** 'full' fills a panel (desktop tab); 'dock' sits in a scrolling sheet (phone) */
  layout?: 'full' | 'dock';
}

const AI_SUGGESTIONS: { icon: string; text: string }[] = [
  { icon: '⌂', text: 'Is Taman Sri Muda flood-prone?' },
  { icon: '✚', text: 'Which hospitals in Klang sit in High zones?' },
  { icon: '⇅', text: 'Compare Petaling under Normal and Extreme rain' },
  { icon: '◍', text: 'Where could a new school go in Sepang?' },
  { icon: '?', text: 'Why is this area flagged?' },
  { icon: '✓', text: 'How was the model checked?' },
];

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));
const fmtUsd = (n: number) => (n < 0.01 ? `<US$0.01` : `≈US$${n.toFixed(2)}`);

function usageLine(u: TurnUsage): string {
  const secs = `${(u.ms / 1000).toFixed(1)} s`;
  if (u.rounds > 0 && u.cachedRounds === u.rounds) return `⚡ Shared answer cache · no API cost · ${secs}`;
  const prompt = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  const parts = [
    `${u.rounds} model call${u.rounds === 1 ? '' : 's'}`,
    `${fmtTokens(prompt + u.outputTokens)} tokens${prompt ? ` (${Math.round((100 * u.cacheReadTokens) / prompt)}% prompt-cached)` : ''}`,
  ];
  if (u.costUsd !== null) parts.push(fmtUsd(u.costUsd));
  if (u.cachedRounds) parts.push(`${u.cachedRounds} from shared cache`);
  parts.push(secs);
  return parts.join(' · ');
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
          {e.steps.map(s => <li key={s.id} className={s.ok ? '' : 'err'}><span aria-hidden>{s.ok ? '✓' : '!'}</span> {s.label}</li>)}
        </ol>
      )}
      {e.pending ? (
        <div className="agent-thinking"><span className="dots" aria-hidden><i /><i /><i /></span> {e.steps?.length ? 'Working with the map data…' : 'Thinking…'}</div>
      ) : (
        <>
          <Markdown className="agent-text" text={e.text} unverified={unverified} />
          {e.notice && <div className="callout" style={{ marginTop: 6 }}>{e.notice}</div>}
          {e.grounding && e.grounding.total > 0 && (
            <div className={`grounding ${e.grounding.grounded === e.grounding.total ? 'ok' : 'warn'}`}>
              {e.grounding.grounded === e.grounding.total
                ? `✓ All ${e.grounding.total} figure${e.grounding.total === 1 ? '' : 's'} match the tool results`
                : `⚠ ${e.grounding.total - e.grounding.grounded} of ${e.grounding.total} figures not found in the tool results (highlighted) — check before quoting`}
            </div>
          )}
          {e.usage && <div className="usage-line" title="Tokens and estimated cost of this answer (list prices)">{usageLine(e.usage)}</div>}
        </>
      )}
    </div>
  );
};

const TemplateAnswer: FC<{ a: Answer }> = ({ a }) => (
  <>
    <div className="m-title">{a.title}</div>
    {a.text.map((t, i) => <Markdown key={i} text={t} />)}
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

// ── voice input (Web Speech API; Chrome and Edge send audio to their speech service) ──
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;
const SpeechRecognition: RecognitionCtor | undefined = typeof window === 'undefined' ? undefined
  : (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

export const Copilot: FC<Props> = ({ chips, getContext, request, agent, focusToken, layout = 'dock' }) => {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [listening, setListening] = useState(false);
  const seq = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const rec = useRef<Recognition | null>(null);
  const ai = agent.mode === 'ai';

  const askTemplate = (text: string, intent?: Intent) => {
    const i = intent ?? detectIntent(text);
    const a = answer(getContext(), i);
    setMsgs(m => [...m.slice(-11), { id: ++seq.current, role: 'user', text }, { id: ++seq.current, role: 'bot', a }]);
  };
  const ask = (text: string, intent?: Intent, prompt?: string) =>
    (ai ? agent.ask(prompt ?? text, prompt ? { label: text } : {}) : askTemplate(text, intent));

  // Requests from elsewhere in the app (e.g. "Ask Ginkgo" on a map cell) arrive as a
  // new object each time; the effect event always sees the latest context.
  const onRequest = useEffectEvent((r: AskRequest) => ask(r.label, r.intent, r.prompt));
  useEffect(() => { if (request) onRequest(request); }, [request]);
  useEffect(() => { if (focusToken) input.current?.focus(); }, [focusToken]);

  const count = ai ? agent.entries.length : msgs.length;
  useEffect(() => {
    if (!count) return;
    if (layout === 'full' && scroller.current) scroller.current.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
    else end.current?.scrollIntoView({ block: 'nearest' });
  }, [count, agent.entries, layout]);
  useEffect(() => () => rec.current?.stop(), []);

  const lastUserText = (id: number) => {
    const i = agent.entries.findIndex(x => x.id === id);
    for (let k = i - 1; k >= 0; k--) if (agent.entries[k].role === 'user') return agent.entries[k].text;
    return '';
  };

  const listen = () => {
    if (!SpeechRecognition) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new SpeechRecognition();
    r.lang = navigator.language?.toLowerCase().startsWith('ms') ? 'ms-MY' : 'en-MY';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = e => {
      const last = e.results[e.results.length - 1];
      const text = Array.from(e.results, x => x[0].transcript).join(' ').trim();
      setQ(text);
      if (last.isFinal && text) { ask(text); setQ(''); }
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  const busy = ai && agent.busy;
  const suggestions = ai
    ? AI_SUGGESTIONS.map(s => ({ key: s.text, icon: s.icon, label: s.text, go: () => ask(s.text) }))
    : SUGGESTIONS.map(s => ({ key: s.intent, icon: '›', label: s.label, go: () => ask(s.label, s.intent) }));
  const t = agent.totals;

  return (
    <section className={`copilot ${layout}`} aria-label="Ask Ginkgo">
      <div className="copilot-head">
        <div>
          <div className="card-title">✦ Ask Ginkgo</div>
          <div className="card-sub">Answers from the computed flood layers</div>
        </div>
        <div className="copilot-head-right">
          <span className={`ai-pill ${agent.mode}`}
            title={ai ? `Live AI agent with tool use${t.answers ? ` · this session: ${t.answers} answer${t.answers === 1 ? '' : 's'}, ${fmtUsd(t.costUsd)}, ${t.cachedRounds} cached call${t.cachedRounds === 1 ? '' : 's'}` : ''}` : 'Template answers — no AI model configured'}>
            {agent.mode === 'checking' ? '…' : ai ? `✦ ${modelName(agent.model)}` : 'Template'}
          </span>
          {count > 0 && <button className="btn btn-ghost btn-sm" onClick={() => (ai ? agent.reset() : setMsgs([]))}>New chat</button>}
        </div>
      </div>

      <div className="copilot-scroll" ref={scroller}>
        <div className="chips" aria-label="Copilot context">
          {chips.map(c => (
            <span className="chip ctx" key={c.key}>
              {c.label}
              {c.onRemove && <button onClick={c.onRemove} aria-label={`Remove ${c.label}`}>×</button>}
            </span>
          ))}
        </div>

        {count === 0 ? (
          <div className="copilot-welcome">
            <p>
              {ai
                ? 'Ask in English or Bahasa Melayu. Ginkgo looks things up in the flood layers, shows them on the map, and checks every figure it quotes.'
                : 'Pick a question. Answers are assembled from the computed figures for the current selection.'}
            </p>
            <div className="suggest-grid">
              {suggestions.map(s => (
                <button key={s.key} className="suggest-card" disabled={busy} onClick={s.go}>
                  <span className="ico" aria-hidden>{s.icon}</span><span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="copilot-msgs" aria-live="polite">
            {ai
              ? agent.entries.map(e => e.role === 'user'
                ? <div key={e.id} className="msg-user">{e.label ?? e.text}</div>
                : <AgentAnswer key={e.id} e={e} fallback={e.role === 'error' ? answer(getContext(), detectIntent(lastUserText(e.id))) : null} />)
              : msgs.map(m => m.role === 'user'
                ? <div key={m.id} className="msg-user">{m.text}</div>
                : <div key={m.id} className="msg-bot"><TemplateAnswer a={m.a} /></div>)}
            <div ref={end} />
          </div>
        )}
      </div>

      <div className="copilot-foot">
        {count > 0 && (
          <div className="chips scroll">
            {suggestions.map(s => <button key={s.key} className="chip" disabled={busy} onClick={s.go}>{s.label}</button>)}
          </div>
        )}
        <form className="copilot-input" onSubmit={e => { e.preventDefault(); if (q.trim()) { ask(q.trim()); setQ(''); } }}>
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} disabled={busy}
            placeholder={listening ? 'Listening…' : ai ? 'Ask anything about flood risk in Selangor…' : 'Ask about this area…'} aria-label="Ask Ginkgo" />
          {SpeechRecognition && ai && (
            <button type="button" className={`mic-btn${listening ? ' on' : ''}`} onClick={listen} disabled={busy}
              aria-label={listening ? 'Stop listening' : 'Ask by voice'} title="Ask by voice (your browser's speech service turns speech into text)">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z" /></svg>
            </button>
          )}
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !q.trim()}>Ask</button>
        </form>
        <div className="source-line">
          {ai
            ? 'Claude answers by calling tools over the computed layers; it cannot change any number, and figures it cannot trace to a tool result are flagged.'
            : agent.mode === 'off'
              ? 'Template mode: answers are assembled from the computed figures. Set ANTHROPIC_API_KEY on the server to switch on the Claude agent.'
              : 'Checking for the AI copilot…'}
        </div>
      </div>
    </section>
  );
};
