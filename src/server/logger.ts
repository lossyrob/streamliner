import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogFields {
  [key: string]: unknown;
}

interface LogEntry {
  ts: string;
  level: LogLevel;
  scope: string;
  msg: string;
  [key: string]: unknown;
}

export interface ApiLoggerOptions {
  /** Directory where api-YYYY-MM-DD.log files are written. */
  logDir?: string;
  /** Minimum level to emit. */
  level?: LogLevel;
  /** When false, do not mirror entries to the console. */
  mirrorConsole?: boolean;
  /** Override the clock for tests. */
  now?: () => Date;
  /** Console adapter for tests. */
  console?: Pick<Console, "debug" | "info" | "warn" | "error">;
  /** Days of history to keep when purging on first use. */
  retentionDays?: number;
  /** Disable startup retention purge (e.g. for tests). */
  purgeOnStart?: boolean;
}

function defaultLogDir(): string {
  return resolve(homedir(), ".streamliner", "state", "logs");
}

function envLevel(): LogLevel | undefined {
  const raw = process.env.STREAMLINER_LOG_LEVEL?.toLowerCase();
  if (raw && (LOG_LEVELS as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  return undefined;
}

function envMirrorConsole(): boolean | undefined {
  const raw = process.env.STREAMLINER_LOG_CONSOLE;
  if (raw === undefined) return undefined;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

function isVitestRuntime(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function dateStamp(now: Date): string {
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

function normalizeFields(fields: LogFields | undefined): LogFields {
  if (!fields) return {};
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Error) {
      out[key] = { name: value.name, message: value.message, stack: value.stack };
    } else {
      out[key] = value;
    }
  }
  return out;
}

function safeStringify(entry: LogEntry): string {
  try {
    return JSON.stringify(entry);
  } catch {
    return JSON.stringify({
      ts: entry.ts,
      level: entry.level,
      scope: entry.scope,
      msg: entry.msg,
      _serialization_error: true,
    });
  }
}

export class ApiLogger {
  private readonly logDir: string;
  private readonly level: LogLevel;
  private readonly mirrorConsole: boolean;
  private readonly now: () => Date;
  private readonly console: Pick<Console, "debug" | "info" | "warn" | "error">;
  private readonly retentionDays: number;
  private readonly defaultScope: string;
  private dirEnsured = false;

  constructor(options: ApiLoggerOptions = {}, defaultScope = "api") {
    this.logDir = options.logDir ?? process.env.STREAMLINER_LOG_DIR ?? defaultLogDir();
    this.level = options.level ?? envLevel() ?? "info";
    this.mirrorConsole = options.mirrorConsole ?? envMirrorConsole() ?? true;
    this.now = options.now ?? (() => new Date());
    this.console = options.console ?? console;
    this.retentionDays = options.retentionDays ?? 14;
    this.defaultScope = defaultScope;

    if (options.purgeOnStart !== false) {
      this.purgeOldLogsBestEffort();
    }
  }

  /** Log file path for the current day. */
  currentLogFile(): string {
    return join(this.logDir, `api-${dateStamp(this.now())}.log`);
  }

  withScope(scope: string): ScopedLogger {
    return new ScopedLogger(this, scope);
  }

  debug(msg: string, fields?: LogFields): void {
    this.emit("debug", this.defaultScope, msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.emit("info", this.defaultScope, msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.emit("warn", this.defaultScope, msg, fields);
  }
  error(msg: string, fields?: LogFields): void {
    this.emit("error", this.defaultScope, msg, fields);
  }

  emit(level: LogLevel, scope: string, msg: string, fields?: LogFields): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.level]) {
      return;
    }
    const entry: LogEntry = {
      ts: this.now().toISOString(),
      level,
      scope,
      msg,
      ...normalizeFields(fields),
    };
    const line = safeStringify(entry);
    this.appendLine(line);
    if (this.mirrorConsole) {
      this.console[level](line);
    }
  }

  private appendLine(line: string): void {
    try {
      if (!this.dirEnsured) {
        mkdirSync(this.logDir, { recursive: true });
        this.dirEnsured = true;
      }
      appendFileSync(this.currentLogFile(), `${line}\n`, "utf8");
    } catch {
      // Last-resort: drop the file write rather than crash the API server.
    }
  }

  private purgeOldLogsBestEffort(): void {
    try {
      const cutoff = this.now().getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
      const entries = readdirSync(this.logDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !/^api-\d{4}-\d{2}-\d{2}\.log$/.test(entry.name)) continue;
        const full = join(this.logDir, entry.name);
        try {
          const stat = statSync(full);
          if (stat.mtimeMs < cutoff) {
            unlinkSync(full);
          }
        } catch {
          // skip individual file failures
        }
      }
    } catch {
      // log dir may not exist yet — nothing to purge
    }
  }
}

export class ScopedLogger {
  private readonly parent: ApiLogger;
  private readonly scope: string;

  constructor(parent: ApiLogger, scope: string) {
    this.parent = parent;
    this.scope = scope;
  }

  withScope(child: string): ScopedLogger {
    return new ScopedLogger(this.parent, `${this.scope}.${child}`);
  }

  debug(msg: string, fields?: LogFields): void {
    this.parent.emit("debug", this.scope, msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.parent.emit("info", this.scope, msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.parent.emit("warn", this.scope, msg, fields);
  }
  error(msg: string, fields?: LogFields): void {
    this.parent.emit("error", this.scope, msg, fields);
  }
}

let sharedLogger: ApiLogger | null = null;

export function getApiLogger(): ApiLogger {
  if (!sharedLogger) {
    if (isVitestRuntime()) {
      // In tests, use a no-op-ish logger that writes to a tmp dir and skips the
      // console mirror to avoid file-lock contention and stdout noise.
      sharedLogger = new ApiLogger({
        logDir: join(process.env.TEMP ?? "/tmp", "streamliner-test-logs"),
        mirrorConsole: false,
        purgeOnStart: false,
      });
    } else {
      sharedLogger = new ApiLogger();
    }
  }
  return sharedLogger;
}

export function resetApiLoggerForTests(logger: ApiLogger | null = null): void {
  sharedLogger = logger;
}
