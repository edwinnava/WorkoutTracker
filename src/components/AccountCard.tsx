import { useState } from 'react';
import { signIn, signOut, useAccount } from '../sync/state';
import { toast } from '../lib/hooks';

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function SignInButton({ label = 'Sign in with Google' }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn block"
      style={{ background: '#fff', color: '#1f1f1f', border: '1px solid #dadce0' }}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signIn();
        } catch (e) {
          alert(`Sign-in failed: ${(e as Error).message}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <GoogleLogo /> {busy ? 'Signing in…' : label}
    </button>
  );
}

export function SyncBadge() {
  const a = useAccount();
  if (!a.user) return null;
  if (!a.online) return <span className="badge warn">Offline · will sync later</span>;
  if (a.status === 'syncing') return <span className="badge accent">Syncing…</span>;
  if (a.status === 'error') return <span className="badge warn" title={a.error}>Sync problem</span>;
  return <span className="badge success">✓ Synced</span>;
}

export function AccountCard() {
  const a = useAccount();
  if (!a.configured) return null;
  if (!a.ready) {
    return (
      <div className="card">
        <span className="subtle small">Loading account…</span>
      </div>
    );
  }
  if (!a.user) {
    return (
      <div className="card">
        <h3>Back up &amp; sync</h3>
        <p className="small subtle" style={{ margin: '6px 0 12px' }}>
          Sign in to save your workouts to your account automatically and use them on any device. Everything already on this device
          will be added to your account.
        </p>
        <SignInButton />
        {a.error && <p className="small" style={{ color: 'var(--danger)' }}>{a.error}</p>}
      </div>
    );
  }
  return (
    <div className="card">
      <div className="row">
        {a.user.photoURL ? (
          <img src={a.user.photoURL} alt="" width={44} height={44} style={{ borderRadius: '50%' }} referrerPolicy="no-referrer" />
        ) : (
          <div className="ex-icon">{a.user.name[0]}</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ellipsis" style={{ fontWeight: 600 }}>
            {a.user.name}
          </div>
          <div className="small subtle ellipsis">{a.user.email}</div>
        </div>
        <SyncBadge />
      </div>
      {a.status === 'error' && a.error && (
        <p className="small" style={{ color: 'var(--danger)', marginBottom: 0 }}>
          {a.error}
        </p>
      )}
      <button
        className="btn block sm"
        style={{ marginTop: 12 }}
        onClick={async () => {
          if (!confirm('Sign out? Your data stays safe in your account and will be removed from this device.')) return;
          if (await signOut()) toast('Signed out');
        }}
      >
        Sign out
      </button>
    </div>
  );
}
