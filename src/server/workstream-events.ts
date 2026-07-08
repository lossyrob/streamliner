import { watchFile, unwatchFile, type Stats } from "node:fs";
import { join, resolve } from "node:path";

import type { Request, Response } from "express";

import type {
  WorkstreamRegistryListEntry,
  WorkstreamRegistryListResponse,
  WorkstreamSourceListEntry,
} from "../workstream-registry-contract";
import { statGraphFile } from "./local-files";
import { getApiLogger } from "./logger";
import {
  listRegisteredWorkstreams,
  WORKSTREAM_REGISTRY_PATH,
  type WorkstreamRegistryOptions,
} from "./workstream-registry";
import {
  combineWorkstreamCandidates,
  scanWorkstreamSources,
  WORKSTREAM_SOURCE_REGISTRY_PATH,
} from "./workstream-sources";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_REPLAY_BUFFER_SIZE = 100;
const DEFAULT_WATCH_INTERVAL_MS = 1_000;
const DEFAULT_DEBOUNCE_MS = 200;

type WorkstreamEventName =
  | "snapshot"
  | "workstream.graph.changed"
  | "workstream.registry.changed"
  | "workstream.source.changed"
  | "heartbeat";

type WatchedPathKind = "registry" | "source-registry" | "graph" | "source-root";

interface WorkstreamStreamEvent {
  id: number;
  name: WorkstreamEventName;
  payload: unknown;
}

interface StreamClient {
  res: Response;
  heartbeat: ReturnType<typeof setInterval>;
}

interface WatchedPathDescriptor {
  kind: WatchedPathKind;
  path: string;
  entry?: WorkstreamRegistryListEntry;
  source?: WorkstreamSourceListEntry;
}

export interface WorkstreamEventStreamOptions extends WorkstreamRegistryOptions {
  heartbeatIntervalMs?: number;
  replayBufferSize?: number;
  watchIntervalMs?: number;
  debounceMs?: number;
}

function registryPath(options: WorkstreamRegistryOptions): string {
  return options.registryPath ?? WORKSTREAM_REGISTRY_PATH;
}

function sourceRegistryPath(options: WorkstreamRegistryOptions): string {
  return options.sourceRegistryPath ?? WORKSTREAM_SOURCE_REGISTRY_PATH;
}

function pathKey(path: string): string {
  const absPath = resolve(path);
  return process.platform === "win32" ? absPath.toLowerCase() : absPath;
}

function sourceScanRoot(source: WorkstreamSourceListEntry): string {
  return source.type === "project-root"
    ? join(source.path, ".streamliner", "workstreams")
    : source.path;
}

function isBackendReadableEntry(entry: WorkstreamRegistryListEntry): boolean {
  return entry.source !== "browser-directory";
}

function parseLastEventId(value: string | undefined): number | null {
  if (!value || value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function writeSse(res: Response, event: WorkstreamStreamEvent): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.name}\n`);
  res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
}

function writeHeartbeat(res: Response): void {
  res.write("event: heartbeat\n");
  res.write(`data: ${JSON.stringify({ sentAt: new Date().toISOString() })}\n\n`);
}

function statChanged(current: Stats, previous: Stats): boolean {
  return current.mtimeMs !== previous.mtimeMs || current.size !== previous.size;
}

export class WorkstreamEventStream {
  private nextEventId = 1;
  private readonly clients = new Map<Response, StreamClient>();
  private readonly buffer: WorkstreamStreamEvent[] = [];
  private readonly watchedPaths = new Map<string, WatchedPathDescriptor>();
  private readonly pendingChanges = new Map<string, WatchedPathDescriptor>();
  private readonly options: WorkstreamEventStreamOptions;
  private readonly heartbeatIntervalMs: number;
  private readonly replayBufferSize: number;
  private readonly watchIntervalMs: number;
  private readonly debounceMs: number;
  private readonly logger = getApiLogger().withScope("workstream-events");
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(options: WorkstreamEventStreamOptions = {}) {
    this.options = options;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.replayBufferSize = options.replayBufferSize ?? DEFAULT_REPLAY_BUFFER_SIZE;
    this.watchIntervalMs = options.watchIntervalMs ?? DEFAULT_WATCH_INTERVAL_MS;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.applyWatchedPaths({
      version: 1,
      migrationWarnings: [],
      workstreams: [],
      archivedWorkstreams: [],
      sources: [],
      conflicts: [],
    });
    void this.refreshWatchedPaths().catch((error: unknown) => {
      this.logger.warn("failed to initialize watched workstream paths", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  close(): void {
    this.closed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const descriptor of this.watchedPaths.values()) {
      unwatchFile(descriptor.path);
    }
    this.watchedPaths.clear();
    this.pendingChanges.clear();
    for (const client of this.clients.values()) {
      clearInterval(client.heartbeat);
      client.res.end();
    }
    this.clients.clear();
  }

  handle = (req: Request, res: Response): void => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
      writeHeartbeat(res);
    }, this.heartbeatIntervalMs);
    this.clients.set(res, { res, heartbeat });

    const lastEventId = parseLastEventId(req.header("last-event-id"));
    const replayed = lastEventId !== null ? this.replayAfter(lastEventId, res) : false;
    if (!replayed) {
      void this.writeSnapshot(res).catch((error: unknown) => {
        this.logger.warn("failed to write workstream event snapshot", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    req.on("close", () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  };

  private replayAfter(lastEventId: number, res: Response): boolean {
    const firstBufferedId = this.buffer[0]?.id;
    if (firstBufferedId !== undefined && lastEventId < firstBufferedId - 1) {
      return false;
    }
    if (lastEventId >= this.nextEventId) {
      return false;
    }
    const replay = this.buffer.filter((event) => event.id > lastEventId);
    if (replay.length === 0) {
      return false;
    }
    for (const event of replay) {
      writeSse(res, event);
    }
    return true;
  }

  private async writeSnapshot(res: Response): Promise<void> {
    const snapshot = await this.loadSnapshot();
    this.applyWatchedPaths(snapshot);
    writeSse(
      res,
      this.buildEvent("snapshot", {
        ...snapshot,
        generatedAt: new Date().toISOString(),
      }),
    );
  }

  private async loadSnapshot(): Promise<WorkstreamRegistryListResponse> {
    const { registry, workstreams } = await listRegisteredWorkstreams(this.options);
    return {
      version: registry.version,
      migratedFromRecentsAt: registry.migratedFromRecentsAt,
      migrationWarnings: registry.migrationWarnings,
      ...(await combineWorkstreamCandidates(workstreams, this.options)),
    };
  }

  private async refreshWatchedPaths(): Promise<WorkstreamRegistryListResponse> {
    const snapshot = await this.loadSnapshot();
    if (!this.closed) {
      this.applyWatchedPaths(snapshot);
    }
    return snapshot;
  }

  private applyWatchedPaths(snapshot: WorkstreamRegistryListResponse): void {
    if (this.closed) {
      return;
    }
    const desired = new Map<string, WatchedPathDescriptor>();
    const add = (descriptor: WatchedPathDescriptor) => {
      desired.set(pathKey(descriptor.path), descriptor);
    };

    add({ kind: "registry", path: registryPath(this.options) });
    add({ kind: "source-registry", path: sourceRegistryPath(this.options) });

    for (const entry of [
      ...snapshot.workstreams,
      ...(snapshot.archivedWorkstreams ?? []),
    ]) {
      if (isBackendReadableEntry(entry)) {
        add({ kind: "graph", path: entry.path, entry });
      }
    }

    for (const source of snapshot.sources ?? []) {
      add({ kind: "source-root", path: sourceScanRoot(source), source });
    }

    for (const [key, descriptor] of this.watchedPaths) {
      if (!desired.has(key)) {
        unwatchFile(descriptor.path);
        this.watchedPaths.delete(key);
      }
    }

    for (const [key, descriptor] of desired) {
      const existing = this.watchedPaths.get(key);
      this.watchedPaths.set(key, descriptor);
      if (existing) {
        continue;
      }
      watchFile(descriptor.path, { interval: this.watchIntervalMs }, (current, previous) => {
        this.handleWatchedPathChange(key, current, previous);
      });
    }
  }

  private handleWatchedPathChange(key: string, current: Stats, previous: Stats): void {
    if (this.closed || !statChanged(current, previous)) {
      return;
    }
    const descriptor = this.watchedPaths.get(key);
    if (!descriptor) {
      return;
    }
    this.pendingChanges.set(key, descriptor);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const changes = [...this.pendingChanges.values()];
      this.pendingChanges.clear();
      void this.processChanges(changes).catch((error: unknown) => {
        this.logger.error("failed to process workstream file changes", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.debounceMs);
  }

  private async processChanges(changes: WatchedPathDescriptor[]): Promise<void> {
    if (this.closed || changes.length === 0) {
      return;
    }

    const graphChanges = changes.filter((change) => change.kind === "graph");
    const sourceRootChanges = changes.filter((change) => change.kind === "source-root");
    const sourceRegistryChanged = changes.some((change) => change.kind === "source-registry");
    const registryChanged = changes.some((change) => change.kind === "registry");

    if (sourceRootChanges.length > 0) {
      await scanWorkstreamSources(this.options);
    }

    let snapshot: WorkstreamRegistryListResponse | null = null;
    if (registryChanged || sourceRegistryChanged || sourceRootChanges.length > 0) {
      snapshot = await this.refreshWatchedPaths();
    }

    for (const change of graphChanges) {
      await this.publishGraphChange(change);
    }

    if (registryChanged) {
      this.publish("workstream.registry.changed", {
        changedAt: new Date().toISOString(),
        version: snapshot?.version,
      });
    }

    if (sourceRegistryChanged || sourceRootChanges.length > 0) {
      const sourceEvents = sourceRootChanges.length > 0
        ? sourceRootChanges
        : [{ kind: "source-registry", path: sourceRegistryPath(this.options) } satisfies WatchedPathDescriptor];
      for (const sourceEvent of sourceEvents) {
        this.publish("workstream.source.changed", {
          changedAt: new Date().toISOString(),
          sourceId: sourceEvent.source?.id,
          sourceType: sourceEvent.source?.type,
          path: sourceEvent.source?.path ?? sourceEvent.path,
        });
      }
    }
  }

  private async publishGraphChange(change: WatchedPathDescriptor): Promise<void> {
    const entry = change.entry;
    if (!entry) {
      return;
    }
    const payload: Record<string, unknown> = {
      changedAt: new Date().toISOString(),
      projectKey: entry.projectKey,
      workstreamId: entry.workstreamId,
      path: change.path,
      sourceId: entry.sourceId,
      sourceType: entry.sourceType,
    };
    try {
      const graphInfo = await statGraphFile(change.path);
      payload.lastModified = graphInfo.lastModified;
      payload.mtimeMs = graphInfo.mtimeMs;
    } catch (error: unknown) {
      this.logger.warn("workstream graph changed but could not be statted", {
        path: change.path,
        projectKey: entry.projectKey,
        workstreamId: entry.workstreamId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.publish("workstream.graph.changed", payload);
  }

  private publish(name: WorkstreamEventName, payload: unknown): void {
    const event = this.buildEvent(name, payload);
    this.buffer.push(event);
    if (this.buffer.length > this.replayBufferSize) {
      this.buffer.splice(0, this.buffer.length - this.replayBufferSize);
    }
    for (const client of this.clients.values()) {
      writeSse(client.res, event);
    }
  }

  private buildEvent(name: WorkstreamEventName, payload: unknown): WorkstreamStreamEvent {
    const event = {
      id: this.nextEventId,
      name,
      payload,
    };
    this.nextEventId += 1;
    return event;
  }
}
