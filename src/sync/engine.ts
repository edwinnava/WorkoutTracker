import type { Transaction } from 'dexie';
import type { WorkoutDB } from '../db/db';
import type { Workout } from '../db/types';
import { workoutKey } from '../lib/hevy';

/**
 * Two-way sync between the local Dexie database and a remote document store.
 *
 * - Local writes are captured with Dexie hooks and queued in a durable outbox
 *   (localStorage), then pushed as documents. Deletes are pushed as tombstones.
 * - Remote changes are pulled with listeners on `updatedAt > lastSeen` and
 *   applied locally inside transactions marked as remote, so they aren't echoed back.
 * - The first sign-in on a device merges: cloud data wins, local-only records are
 *   uploaded, and Hevy imports done on two devices are de-duplicated.
 * The in-progress workout (`active` table) stays local.
 */

export const SYNC_TABLES = ['workouts', 'routines', 'exercises', 'settings'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
type Row = Record<string, unknown>;

export interface RemoteDoc {
  id: string;
  /** null = deleted (tombstone) */
  data: Row | null;
  updatedAt: number;
}

export interface Remote {
  write(table: SyncTable, id: string, data: Row | null): void;
  fetchAll(table: SyncTable): Promise<RemoteDoc[]>;
  listen(table: SyncTable, since: number, onDocs: (docs: RemoteDoc[]) => void, onError: (e: Error) => void): () => void;
}

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

const UID_KEY = 'sync-uid';
const OUTBOX_KEY = 'sync-outbox';
const sinceKey = (t: SyncTable) => `sync-since-${t}`;

function encodeKey(_table: SyncTable, key: unknown): string {
  return String(key);
}
function decodeKey(table: SyncTable, id: string): string | number {
  return table === 'workouts' ? Number(id) : id;
}

export class SyncEngine {
  private remote: Remote | null = null;
  private uid: string | null = null;
  private unsubs: (() => void)[] = [];
  private remoteTxs = new WeakSet<Transaction>();
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  onStatus: (s: SyncStatus, error?: string) => void = () => {};

  constructor(
    private db: WorkoutDB,
    private kv: KV,
  ) {
    for (const t of SYNC_TABLES) this.installHooks(t);
  }

  /** True once this device has been linked to an account. */
  get linkedUid() {
    return this.kv.get(UID_KEY);
  }

  private installHooks(table: SyncTable) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const tbl = this.db.table(table);
    const relevant = (obj: Row | undefined, mods?: Row) =>
      table !== 'exercises' || !!obj?.custom || !!mods?.custom;
    const record = (key: unknown, tx: Transaction) => {
      if (!self.kv.get(UID_KEY) || self.remoteTxs.has(tx)) return;
      const pending = pendingByTx.get(tx);
      const entry = `${table}|${encodeKey(table, key)}`;
      if (pending) {
        pending.add(entry);
        return;
      }
      const set = new Set([entry]);
      pendingByTx.set(tx, set);
      tx.on('complete', () => {
        self.addToOutbox([...set]);
        self.flush();
      });
    };
    const pendingByTx = new WeakMap<Transaction, Set<string>>();
    tbl.hook('creating', function (primKey, obj, tx) {
      if (!relevant(obj as Row)) return;
      const key = primKey ?? (obj as Row).id ?? (obj as Row).key;
      if (key != null) record(key, tx);
      else this.onsuccess = (k: unknown) => record(k, tx);
    });
    tbl.hook('updating', function (mods, primKey, obj, tx) {
      if (relevant(obj as Row, mods as Row)) record(primKey, tx);
    });
    tbl.hook('deleting', function (primKey, obj, tx) {
      if (relevant(obj as Row)) record(primKey, tx);
    });
  }

  private readOutbox(): string[] {
    try {
      return JSON.parse(this.kv.get(OUTBOX_KEY) ?? '[]');
    } catch {
      return [];
    }
  }
  private addToOutbox(entries: string[]) {
    const set = new Set(this.readOutbox());
    entries.forEach((e) => set.add(e));
    this.kv.set(OUTBOX_KEY, JSON.stringify([...set]));
  }
  private removeFromOutbox(entries: string[]) {
    const done = new Set(entries);
    this.kv.set(OUTBOX_KEY, JSON.stringify(this.readOutbox().filter((e) => !done.has(e))));
  }

  /** Pushes queued local changes. Safe to call often. */
  flush(): Promise<void> {
    if (!this.remote || !this.uid) return Promise.resolve();
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.flushAgain = false;
        const entries = this.readOutbox();
        for (const entry of entries) {
          const [table, id] = entry.split('|') as [SyncTable, string];
          if (!this.remote) return;
          const local = (await this.db.table(table).get(decodeKey(table, id))) as Row | undefined;
          if (table === 'exercises' && local && !local.custom) continue;
          this.remote.write(table, id, local ?? null);
        }
        this.removeFromOutbox(entries);
      } while (this.flushAgain);
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** Applies remote documents locally without echoing them back. */
  async applyRemote(table: SyncTable, docs: RemoteDoc[]) {
    if (docs.length === 0) return;
    const pending = new Set(this.readOutbox());
    const tbl = this.db.table(table);
    await this.db.transaction('rw', tbl, async (tx) => {
      this.remoteTxs.add(tx);
      const puts: Row[] = [];
      const dels: (string | number)[] = [];
      for (const d of docs) {
        // A local change to this record is still waiting to upload; it is newer.
        if (pending.has(`${table}|${d.id}`)) continue;
        if (d.data) puts.push(table === 'exercises' ? { ...d.data, custom: true } : d.data);
        else dels.push(decodeKey(table, d.id));
      }
      if (puts.length) await tbl.bulkPut(puts);
      if (dels.length) await tbl.bulkDelete(dels);
    });
    const max = Math.max(...docs.map((d) => d.updatedAt));
    if (max > this.since(table)) this.kv.set(sinceKey(table), String(max));
  }

  private since(table: SyncTable) {
    return Number(this.kv.get(sinceKey(table)) ?? 0);
  }

  /** First sign-in on this device: merge local data with the account. */
  private async initialMerge() {
    const remote = this.remote!;
    const toUpload: string[] = [];
    for (const table of SYNC_TABLES) {
      const remoteDocs = await remote.fetchAll(table);
      const tbl = this.db.table(table);
      let local = (await tbl.toArray()) as Row[];
      if (table === 'exercises') local = local.filter((e) => e.custom);
      const remoteIds = new Set(remoteDocs.map((d) => d.id));
      const pk = table === 'settings' ? 'key' : 'id';
      let localOnly = local.filter((r) => !remoteIds.has(encodeKey(table, r[pk])));

      if (table === 'workouts') {
        // Same Hevy history imported on two devices gets different ids; keep the cloud copy.
        const remoteKeys = new Set(
          remoteDocs.filter((d) => d.data).map((d) => workoutKey((d.data as unknown as Workout).startTime, (d.data as unknown as Workout).title)),
        );
        const dupes = localOnly.filter((r) => remoteKeys.has(workoutKey(r.startTime as number, r.title as string)));
        if (dupes.length) {
          await this.db.transaction('rw', tbl, async (tx) => {
            this.remoteTxs.add(tx);
            await tbl.bulkDelete(dupes.map((r) => r[pk] as number));
          });
          const dupeIds = new Set(dupes.map((r) => r[pk]));
          localOnly = localOnly.filter((r) => !dupeIds.has(r[pk]));
        }
      }
      await this.applyRemote(table, remoteDocs);
      toUpload.push(...localOnly.map((r) => `${table}|${encodeKey(table, r[pk])}`));
    }
    this.addToOutbox(toUpload);
  }

  async start(remote: Remote, uid: string) {
    this.stop();
    this.onStatus('syncing');
    try {
      const previous = this.kv.get(UID_KEY);
      if (previous && previous !== uid) await this.clearLocal();
      this.remote = remote;
      this.uid = null; // block flushes until merged
      if (previous !== uid) await this.initialMerge();
      this.uid = uid;
      this.kv.set(UID_KEY, uid);
      await this.flush();
      for (const table of SYNC_TABLES) {
        this.unsubs.push(
          remote.listen(
            table,
            this.since(table),
            (docs) => {
              this.applyRemote(table, docs).catch((e) => this.onStatus('error', String(e)));
            },
            (e) => this.onStatus('error', e.message),
          ),
        );
      }
      this.onStatus('synced');
    } catch (e) {
      this.onStatus('error', (e as Error).message);
      throw e;
    }
  }

  stop() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.remote = null;
    this.uid = null;
    this.onStatus('idle');
  }

  hasPendingUploads() {
    return this.readOutbox().length > 0;
  }

  /** Removes all synced data from this device (used on sign-out). Not propagated to the cloud. */
  async clearLocal() {
    const tables = SYNC_TABLES.map((t) => this.db.table(t));
    await this.db.transaction('rw', [...tables, this.db.active], async (tx) => {
      this.remoteTxs.add(tx);
      for (const t of tables) {
        // Keep the built-in exercise library.
        if (t.name === 'exercises') await t.filter((e) => !!e.custom).delete();
        else await t.clear();
      }
      await this.db.active.clear();
    });
    this.kv.remove(UID_KEY);
    this.kv.remove(OUTBOX_KEY);
    for (const t of SYNC_TABLES) this.kv.remove(sinceKey(t));
  }
}

export const browserKV: KV = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage unavailable */
    }
  },
};
