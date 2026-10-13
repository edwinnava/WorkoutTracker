import { useRef, useState } from 'react';
import { IconDown, IconUp } from './Icons';
import { Sheet } from './Sheet';

export interface ReorderItem {
  key: string;
  label: string;
  sub?: string;
}

const ROW_H = 60;

function GripIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {[6, 12, 18].map((y) => (
        <g key={y}>
          <circle cx="9" cy={y} r="1.6" />
          <circle cx="15" cy={y} r="1.6" />
        </g>
      ))}
    </svg>
  );
}

/**
 * Reorder a list by dragging the handle (works with touch) or with the arrow buttons.
 * Changes apply when tapping Done.
 */
export function ReorderSheet({
  title = 'Reorder exercises',
  items,
  onClose,
  onSave,
}: {
  title?: string;
  items: ReorderItem[];
  onClose: () => void;
  onSave: (keys: string[]) => void;
}) {
  const [order, setOrder] = useState(items);
  const [drag, setDrag] = useState<{ key: string; startY: number; dy: number; from: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const move = (from: number, to: number) =>
    setOrder((list) => {
      if (to < 0 || to >= list.length || from === to) return list;
      const next = [...list];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });

  const onPointerDown = (e: React.PointerEvent, key: string) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ key, startY: e.clientY, dy: 0, from: order.findIndex((x) => x.key === key) });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, dy: e.clientY - drag.startY });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const to = Math.max(0, Math.min(order.length - 1, drag.from + Math.round(drag.dy / ROW_H)));
    move(drag.from, to);
    setDrag(null);
  };

  // While dragging, show where the item would land.
  const target = drag ? Math.max(0, Math.min(order.length - 1, drag.from + Math.round(drag.dy / ROW_H))) : -1;

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          onClick={() => {
            onSave(order.map((x) => x.key));
            onClose();
          }}
        >
          Done
        </button>
      }
    >
      <p className="small subtle" style={{ marginTop: 0 }}>
        Drag ⠿ or use the arrows to match the order you’ll do them in the gym.
      </p>
      <div className="list" ref={listRef} style={{ overflow: 'visible' }}>
        {order.map((item, i) => {
          const dragging = drag?.key === item.key;
          let shift = 0;
          if (drag && !dragging) {
            if (drag.from < i && i <= target) shift = -ROW_H;
            if (target <= i && i < drag.from) shift = ROW_H;
          }
          return (
            <div
              key={item.key}
              className="list-item"
              style={{
                height: ROW_H,
                padding: '0 6px 0 4px',
                transform: `translateY(${dragging ? drag.dy : shift}px)`,
                transition: dragging ? 'none' : 'transform 0.15s',
                position: 'relative',
                zIndex: dragging ? 2 : 1,
                background: dragging ? 'var(--surface-2)' : 'var(--surface)',
                boxShadow: dragging ? '0 6px 18px rgba(0,0,0,0.3)' : undefined,
              }}
            >
              <span
                className="icon-btn"
                style={{ touchAction: 'none', cursor: 'grab', color: 'var(--faint)' }}
                onPointerDown={(e) => onPointerDown(e, item.key)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                aria-label={`Drag ${item.label}`}
                role="button"
              >
                <GripIcon />
              </span>
              <span className="badge" style={{ minWidth: 26, justifyContent: 'center' }}>
                {i + 1}
              </span>
              <div className="main">
                <div className="ellipsis" style={{ fontWeight: 600 }}>
                  {item.label}
                </div>
                {item.sub && <div className="tiny subtle ellipsis">{item.sub}</div>}
              </div>
              <button className="icon-btn" disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }} onClick={() => move(i, i - 1)} aria-label={`Move ${item.label} up`}>
                <IconUp size={20} />
              </button>
              <button
                className="icon-btn"
                disabled={i === order.length - 1}
                style={{ opacity: i === order.length - 1 ? 0.3 : 1 }}
                onClick={() => move(i, i + 1)}
                aria-label={`Move ${item.label} down`}
              >
                <IconDown size={20} />
              </button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
