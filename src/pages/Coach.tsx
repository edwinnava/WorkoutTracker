import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../lib/hooks';
import { applyUndo, getServer, listModels, loadChat, newChat, normalizeUrl, saveChat, sendMessage, setServer, type ChatItem, type ChatState } from '../lib/coachChat';
import { IconBack, IconCheck, IconEdit, IconLink, IconSend, IconSparkle } from '../components/Icons';
import { Sheet } from '../components/Sheet';

const STARTERS = ['Should I be pushing harder on anything?', 'What are my weak points right now?', 'Plan next week around how I’ve been feeling', 'Is my routine missing anything?'];

/** Renders the coach's plain-text replies: paragraphs, "- " bullets and **bold**. */
function RichText({ text }: { text: string }) {
  const bold = (s: string): ReactNode[] => s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{bold(l)}</li>)}</ul>);
    list = [];
  };
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (m) list.push(m[1]);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length}>{bold(line.replace(/^#+\s*/, ''))}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

function ServerSheet({ onClose, first }: { onClose: () => void; first?: boolean }) {
  const saved = getServer();
  const [url, setUrl] = useState(saved?.url ?? '');
  const [models, setModels] = useState<string[]>(saved ? [saved.model] : []);
  const [model, setModel] = useState(saved?.model ?? '');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const list = await listModels(url);
      setModels(list);
      setModel((m) => (list.includes(m) ? m : list[0]));
      setUrl(normalizeUrl(url));
      setStatus({ ok: true, text: `Connected. Found ${list.length} model${list.length === 1 ? '' : 's'}.` });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : 'Could not connect.' });
    } finally {
      setTesting(false);
    }
  };
  const save = () => {
    setServer({ url: normalizeUrl(url), model });
    toast('Coach connected');
    onClose();
  };

  return (
    <Sheet title={first ? 'Connect your PC' : 'Coach settings'} onClose={onClose}>
      <p className="small subtle" style={{ marginTop: 0 }}>
        The coach is an AI model running on your own PC, so it’s free to use. Your PC needs to be on with the model server running.
      </p>
      <ol className="steps small">
        <li>
          On the PC, start <strong>LM Studio</strong>’s local server with <strong>CORS</strong> turned on.
        </li>
        <li>
          Share it with <strong>Tailscale</strong> and copy the <code>https://…ts.net</code> address it gives you.
        </li>
        <li>Paste that address below and tap Test connection.</li>
      </ol>
      <label className="field">
        <span>PC address</span>
        <input
          className="input"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="https://my-pc.example.ts.net"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setStatus(null);
          }}
        />
      </label>
      <button className="btn block" onClick={test} disabled={!url.trim() || testing}>
        {testing ? 'Testing…' : 'Test connection'}
      </button>
      {status && (
        <p className="small" style={{ color: status.ok ? 'var(--success)' : 'var(--danger)', margin: '10px 0 0' }}>
          {status.text}
        </p>
      )}
      {models.length > 0 && (
        <label className="field" style={{ marginTop: 14 }}>
          <span>Model</span>
          <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="tiny subtle">The address is stored only on this phone. Your training data goes to your PC and nowhere else.</p>
      <button className="btn primary block" onClick={save} disabled={!url.trim() || !model}>
        Save
      </button>
      {saved && (
        <button
          className="btn ghost danger block"
          style={{ marginTop: 6 }}
          onClick={() => {
            setServer(null);
            onClose();
          }}
        >
          Disconnect
        </button>
      )}
    </Sheet>
  );
}

export default function Coach() {
  const navigate = useNavigate();
  const [hasKey, setHasKey] = useState(() => !!getServer());
  const [keyOpen, setKeyOpen] = useState(false);
  const [chat, setChat] = useState<ChatState | null>(() => loadChat());
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and React would treat a returned value as the effect's cleanup.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [chat?.items, busy]);
  useEffect(() => () => abort.current?.abort(), []);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    if (!hasKey) return setKeyOpen(true);
    setInput('');
    setBusy(true);
    abort.current = new AbortController();
    try {
      const start = chat?.snapshot ? chat : { ...(await newChat()), items: chat?.items ?? [] };
      const done = await sendMessage(start, t, setChat, abort.current.signal);
      saveChat(done);
      // Nothing was kept from a failed message: put the text back so it's easy to retry.
      if (done.items.at(-1)?.kind === 'error') setInput(t);
    } catch (e) {
      // Anything unexpected (e.g. while gathering your training data) is shown rather than swallowed.
      setChat((c) => ({ snapshot: '', messages: [], updatedAt: Date.now(), ...c, items: [...(c?.items ?? []), { kind: 'error', text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}` }] }));
      setInput(t);
    } finally {
      setBusy(false);
    }
  };

  const undo = async (idx: number) => {
    if (!chat) return;
    const item = chat.items[idx];
    if (item.kind !== 'action' || !item.undo || item.undone) return;
    await applyUndo(item.undo);
    const next = { ...chat, items: chat.items.map((it, i) => (i === idx ? { ...it, undone: true } : it)) as ChatItem[] };
    setChat(next);
    saveChat(next);
    toast('Change undone');
  };

  const reset = () => {
    abort.current?.abort();
    setChat(null);
    saveChat(null);
  };

  const items = chat?.items ?? [];
  const waiting = busy && items.at(-1)?.kind !== 'assistant';

  return (
    <div className="coach">
      <div className="coach-head">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <IconBack />
        </button>
        <h2 style={{ flex: 1 }}>Coach</h2>
        {items.length > 0 && (
          <button className="btn ghost sm" onClick={reset}>
            <IconEdit size={16} /> New chat
          </button>
        )}
        <button className="icon-btn" onClick={() => setKeyOpen(true)} aria-label="Coach settings">
          <IconLink size={20} />
        </button>
      </div>

      <div className="coach-body">
        {items.length === 0 && (
          <div className="coach-empty">
            <div className="coach-mark">
              <IconSparkle size={26} />
            </div>
            <h2>Ask your coach</h2>
            <p className="subtle small">
              It can see your workouts, routines and feedback, and it can update your routines, schedule and weight jumps for you. Every change it makes can be undone.
            </p>
            {!hasKey && (
              <button className="btn primary" style={{ marginTop: 8 }} onClick={() => setKeyOpen(true)}>
                <IconLink size={18} /> Connect your PC to start
              </button>
            )}
            <div className="coach-starters">
              {STARTERS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((it, i) =>
          it.kind === 'action' ? (
            <div key={i} className={'coach-action' + (it.undone ? ' undone' : '')}>
              <IconCheck size={16} />
              <span className="main">{it.text}</span>
              {it.undo && !it.undone && (
                <button className="btn ghost sm" onClick={() => undo(i)} disabled={busy}>
                  Undo
                </button>
              )}
              {it.undone && <span className="tiny">Undone</span>}
            </div>
          ) : (
            <div key={i} className={'bubble ' + it.kind}>
              {it.kind === 'assistant' ? <RichText text={it.text} /> : it.text}
            </div>
          ),
        )}
        {waiting && (
          <div className="bubble assistant typing" aria-label="Coach is thinking">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form
        className="coach-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          className="input"
          rows={1}
          placeholder="Ask about your training…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!input.trim()} aria-label="Send">
            <IconSend size={18} />
          </button>
        )}
      </form>

      {keyOpen && (
        <ServerSheet
          first={!hasKey}
          onClose={() => {
            setKeyOpen(false);
            setHasKey(!!getServer());
          }}
        />
      )}
    </div>
  );
}
