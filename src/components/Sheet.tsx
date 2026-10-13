import { useEffect, type ReactNode } from 'react';
import { IconX } from './Icons';

export function Sheet({
  title,
  onClose,
  children,
  footer,
  full,
  headerRight,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  full?: boolean;
  headerRight?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={'sheet' + (full ? ' full' : '')} onClick={(e) => e.stopPropagation()} role="dialog">
        {title !== undefined && (
          <div className="sheet-head">
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <IconX />
            </button>
            <h2 className="ellipsis">{title}</h2>
            {headerRight}
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
}

export function ActionMenu({ items, onClose, title }: { items: MenuItem[]; onClose: () => void; title?: string }) {
  return (
    <Sheet onClose={onClose} title={title}>
      <div className="menu" style={{ padding: 0 }}>
        {items.map((it) => (
          <button
            key={it.label}
            className={it.danger ? 'danger' : ''}
            onClick={() => {
              onClose();
              it.onClick();
            }}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
