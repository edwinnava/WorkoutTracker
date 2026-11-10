import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../lib/hooks';
import { applyUndo, getApiKey, loadChat, newChat, saveChat, sendMessage, setApiKey, type ChatItem, type ChatState } from '../lib/coachChat';
import { IconBack, IconCheck, IconEdit, IconKey, IconSend, IconSparkle } from '../components/Icons';
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

function KeySheet({ onClose, first }: { onClose: () => void; first?: boolean }) {
  const [key, setKey] = useState(getApiKey());
  const save = () => {
    setApiKey(key);
    toast(key.trim() ? 'Key saved on this phone' : 'Key removed');
    onClose();
  };
  return (
    <Sheet title={first ? 'Connect Claude' : 'Coach settings'} onClose={onClose}>
      <p className="small subtle" style={{ marginTop: 0 }}>
        The coach runs on Claude and needs an Anthropic API key. This is separate from a Claude Pro or Max plan and is billed by use — usually a few cents per conversation.
      </p>
      <ol className="steps small">
        <li>
          Open <strong>console.anthropic.com</strong> and sign in (you can use the same email as your Claude account).
        </li>
        <li>
          Go to <strong>Billing</strong> and add a small amount of credit, such as $5.
        </li>
        <li>
          Go to <strong>API keys</strong>, tap <strong>Create key</strong>, and copy it. It starts with <code>sk-ant-</code>.
        </li>
        <li>Paste it below.</li>
      </ol>
      <label className="field">
        <span>API key</span>
        <input className="input" type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <p className="tiny subtle">
        The key is stored only on this phone and isn’t backed up or synced. Your training data is sent to Anthropic when you chat with the coach, and nowhere else.
      </p>
      <button className="btn primary block" onClick={save} disabled={!key.trim() && !getApiKey()}>
        Save
      </button>
    </Sheet>
  );
}

export default function Coach() {
  const navigate = useNavigate();
  const [hasKey, setHasKey] = useState(() => !!getApiKey());
  const [keyOpen, setKeyOpen] = useState(false);
  const [chat, setChat] = useState<ChatState | null>(() => loadChat());
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [chat?.items, busy]);
  useEffect(() => () => abort.current?.abort(), []);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    if (!hasKey) return setKeyOpen(true);
    setInput('');
    setBusy(true);
    abort.current = new AbortController();
    try {
      const done = await sendMessage(chat ?? (await newChat()), t, setChat, abort.current.signal);
      saveChat(done);
      // Nothing was kept from a failed message: put the text back so it's easy to retry.
      if (done.items.at(-1)?.kind === 'error') setInput(t);
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
          <IconKey size={20} />
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
                <IconKey size={18} /> Connect Claude to start
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
        <KeySheet
          first={!hasKey}
          onClose={() => {
            setKeyOpen(false);
            setHasKey(!!getApiKey());
          }}
        />
      )}
    </div>
  );
}
