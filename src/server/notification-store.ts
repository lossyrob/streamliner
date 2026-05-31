import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { NotificationRecord } from "../notification-contract";
import { defaultNotificationStorePath } from "./notification-config";

export interface NotificationStoreOptions {
  /** Path to the append-only NDJSON file. Defaults to the state dir. */
  storePath?: string;
  now?: () => Date;
}

/** Fields the caller provides; `id` and `createdAt` are assigned by the store. */
export type NotificationDraft = Omit<NotificationRecord, "id" | "createdAt">;

function parseLine(line: string): NotificationRecord | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { id?: unknown }).id === "number"
    ) {
      return parsed as NotificationRecord;
    }
  } catch {
    // Skip malformed/torn lines defensively; the store is append-only so a
    // partial trailing write should not poison reads.
  }
  return null;
}

/**
 * Durable append-only notification store backed by an NDJSON file.
 *
 * The complete on-disk file is the source of truth for gap-free SSE replay:
 * there is no rotation in the MVP. Writes are serialized through an internal
 * mutation queue (mirrors `workstream-registry.ts`) so concurrent POSTs get
 * strictly unique, monotonic ids and never produce torn lines.
 */
export class NotificationStore {
  private readonly storePath: string;
  private readonly now: () => Date;
  private mutationQueue: Promise<void> = Promise.resolve();
  private nextId: number | null = null;

  constructor(options: NotificationStoreOptions = {}) {
    this.storePath = options.storePath ?? defaultNotificationStorePath();
    this.now = options.now ?? (() => new Date());
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.mutationQueue;
    let release: () => void = () => {};
    this.mutationQueue = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    await prior.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async readAll(): Promise<NotificationRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.storePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const records: NotificationRecord[] = [];
    for (const line of raw.split("\n")) {
      const record = parseLine(line);
      if (record) {
        records.push(record);
      }
    }
    return records;
  }

  private async ensureNextId(): Promise<number> {
    if (this.nextId !== null) {
      return this.nextId;
    }
    const records = await this.readAll();
    const maxId = records.reduce((max, record) => Math.max(max, record.id), 0);
    this.nextId = maxId + 1;
    return this.nextId;
  }

  /** Highest id assigned so far (0 if empty). Used to seed the SSE cursor. */
  async maxId(): Promise<number> {
    return (await this.ensureNextId()) - 1;
  }

  async append(draft: NotificationDraft): Promise<NotificationRecord> {
    return this.withMutation(async () => {
      const id = await this.ensureNextId();
      const record: NotificationRecord = {
        ...draft,
        id,
        createdAt: this.now().toISOString(),
      };
      await mkdir(dirname(this.storePath), { recursive: true });
      await appendFile(this.storePath, `${JSON.stringify(record)}\n`, "utf8");
      this.nextId = id + 1;
      return record;
    });
  }

  /** Single record by id, or `null` if no record with that id exists. */
  async get(id: number): Promise<NotificationRecord | null> {
    const records = await this.readAll();
    return records.find((record) => record.id === id) ?? null;
  }

  /** Records with `id > afterId`, oldest-first, optionally capped to `limit`. */
  async listSince(afterId: number, limit?: number): Promise<NotificationRecord[]> {
    const records = (await this.readAll()).filter((record) => record.id > afterId);
    records.sort((a, b) => a.id - b.id);
    return typeof limit === "number" ? records.slice(-limit) : records;
  }

  /** Most recent records, oldest-last (snapshot order), capped to `limit`. */
  async listRecent(limit = 100): Promise<NotificationRecord[]> {
    const records = await this.readAll();
    records.sort((a, b) => a.id - b.id);
    return records.slice(-limit);
  }
}
