import { useRef, useState } from 'react';
import { toast } from '../lib/hooks';
import { CLAUDE_PROMPT, parseClaudeFoods, type FoodDraft } from '../lib/food';
import { Sheet } from './Sheet';

/**
 * Photo logging through the Claude app (which runs on the user's own Claude
 * plan): send the photo and a fixed question to Claude with the phone's share
 * menu, then paste Claude's reply back here.
 */
export function ClaudeFoodSheet({ onAdd, onClose }: { onAdd: (foods: FoodDraft[]) => void; onClose: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [reply, setReply] = useState('');
  const foods = parseClaudeFoods(reply);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(CLAUDE_PROMPT).then(
      () => toast('Question copied — paste it into Claude with your photo'),
      () => toast('Couldn’t copy. Long-press the question to copy it.'),
    );
  };

  const share = async (photo: File) => {
    const data = { files: [photo], text: CLAUDE_PROMPT };
    if (navigator.canShare?.(data)) {
      // The share menu may drop the text for some apps, so keep a copy on the clipboard too.
      await navigator.clipboard.writeText(CLAUDE_PROMPT).catch(() => {});
      await navigator.share(data).catch(() => {});
    } else {
      await copyPrompt();
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setReply(text);
      if (parseClaudeFoods(text).length === 0) toast('No food lines found in what you copied');
    } catch {
      toast('Couldn’t read the clipboard. Paste into the box instead.');
    }
  };

  return (
    <Sheet
      title="Photo with Claude"
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={foods.length === 0}
          onClick={() => {
            onAdd(foods);
            onClose();
          }}
        >
          {foods.length ? `Add ${foods.length} item${foods.length === 1 ? '' : 's'} to log` : 'Add to log'}
        </button>
      }
    >
      <p className="small subtle" style={{ marginTop: 0 }}>
        This uses the Claude app on your own Claude plan, so it costs nothing extra. It takes one share and one paste.
      </p>
      <ol className="steps small">
        <li>
          Tap <strong>Take photo</strong>, then pick <strong>Claude</strong> in the share menu and send.
        </li>
        <li>
          When Claude answers, <strong>copy its reply</strong>.
        </li>
        <li>
          Come back here and tap <strong>Paste Claude’s reply</strong>.
        </li>
      </ol>
      <input
        ref={file}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) share(f);
          e.target.value = '';
        }}
      />
      <div className="row">
        <button className="btn" style={{ flex: 1 }} onClick={() => file.current?.click()}>
          Take photo
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={paste}>
          Paste Claude’s reply
        </button>
      </div>
      <button className="btn ghost block" style={{ marginTop: 4 }} onClick={copyPrompt}>
        Copy the question only
      </button>
      <textarea className="input" style={{ marginTop: 10, minHeight: 90 }} placeholder="Claude’s reply appears here. You can also paste it in yourself." value={reply} onChange={(e) => setReply(e.target.value)} />
      {foods.length > 0 && (
        <div className="list" style={{ marginTop: 12 }}>
          {foods.map((f, i) => (
            <div key={i} className="list-item">
              <div className="main">
                {f.name}
                <div className="small subtle">
                  {Math.round(f.per.kcal)} kcal · {Math.round(f.per.protein)}P {Math.round(f.per.carbs)}C {Math.round(f.per.fat)}F
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="tiny subtle">Estimates from a photo are rough, especially portion sizes. You can edit any item after adding it.</p>
    </Sheet>
  );
}
