import process from "node:process";

import {
  DEFAULT_EVENT_KIND,
  DEFAULT_SEVERITY,
  isEventKind,
  isSeverity,
  NOTIFICATIONS_API_BASE_PATH,
  validateToastLink,
  type EventKind,
  type NotificationCreateResponse,
  type NotificationRequest,
  type Severity,
} from "../../notification-contract";
import { resolveApiBaseUrl } from "../api-base";

type WritableStream = Pick<NodeJS.WritableStream, "write">;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface NotifyDeps {
  fetch?: FetchLike;
  out?: WritableStream;
  err?: WritableStream;
  apiBaseUrl?: string;
}

interface NotifyOptions {
  title?: string;
  body?: string;
  workstreamId?: string;
  projectKey?: string;
  severity?: string;
  eventKind?: string;
  link?: string;
  nodeId?: string;
  sessionId?: string;
}

const flagMap: Record<string, keyof NotifyOptions> = {
  "--title": "title",
  "--body": "body",
  "--workstream": "workstreamId",
  "--project-key": "projectKey",
  "--severity": "severity",
  "--event": "eventKind",
  "--link": "link",
  "--node": "nodeId",
  "--session": "sessionId",
};

function parseArgs(argv: string[]): { ok: true; options: NotifyOptions } | { ok: false; error: string } {
  const options: NotifyOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      return { ok: false, error: `unexpected argument '${arg}'` };
    }

    const equalsIndex = arg.indexOf("=");
    const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    const key = flagMap[flag];
    if (key === undefined) {
      return { ok: false, error: `unknown option '${flag}'` };
    }

    let value: string;
    if (equalsIndex === -1) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        return { ok: false, error: `option '${flag}' requires a value` };
      }
      value = next;
      index += 1;
    } else {
      value = arg.slice(equalsIndex + 1);
    }
    options[key] = value;
  }
  return { ok: true, options };
}

function usageError(err: WritableStream, message: string): number {
  err.write(`${message}\n`);
  return 1;
}

function apiErrorMessage(status: number, body: unknown): string {
  if (body !== null && typeof body === "object") {
    const fields = body as { code?: unknown; error?: unknown };
    const parts = [fields.code, fields.error].filter((part): part is string => typeof part === "string");
    if (parts.length > 0) {
      return `Streamliner API request failed (${status}): ${parts.join(" - ")}`;
    }
  }
  return `Streamliner API request failed (${status})`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function runNotify(argv: string[], deps: NotifyDeps = {}): Promise<number> {
  const out = deps.out ?? process.stdout;
  const err = deps.err ?? process.stderr;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const apiBaseUrl = deps.apiBaseUrl ?? resolveApiBaseUrl();

  if (fetchImpl === undefined) {
    err.write("global fetch is unavailable; run this CLI with Node.js 18 or newer\n");
    return 1;
  }

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    return usageError(err, parsed.error);
  }

  const { options } = parsed;
  if (options.title === undefined || options.title.trim().length === 0) {
    return usageError(err, "--title is required");
  }
  if (options.body === undefined || options.body.trim().length === 0) {
    return usageError(err, "--body is required");
  }

  const severityValue = options.severity ?? DEFAULT_SEVERITY;
  if (!isSeverity(severityValue)) {
    return usageError(err, `invalid --severity '${severityValue}'`);
  }
  const severity: Severity = severityValue;

  const eventKindValue = options.eventKind ?? DEFAULT_EVENT_KIND;
  if (!isEventKind(eventKindValue)) {
    return usageError(err, `invalid --event '${eventKindValue}'`);
  }
  const eventKind: EventKind = eventKindValue;

  let link: string | undefined;
  if (options.link !== undefined) {
    const validation = validateToastLink(options.link);
    if (!validation.ok) {
      return usageError(err, `invalid --link: ${validation.reason}`);
    }
    link = validation.url;
  }

  const request: NotificationRequest = {
    title: options.title,
    body: options.body,
    severity,
    eventKind,
  };
  if (options.workstreamId !== undefined) {
    request.workstreamId = options.workstreamId;
  }
  if (options.projectKey !== undefined) {
    request.projectKey = options.projectKey;
  }
  if (options.nodeId !== undefined) {
    request.nodeId = options.nodeId;
  }
  if (options.sessionId !== undefined) {
    request.sessionId = options.sessionId;
  }
  if (link !== undefined) {
    request.link = link;
  }

  const url = `${apiBaseUrl}${NOTIFICATIONS_API_BASE_PATH}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    err.write(
      `Failed to reach Streamliner API at ${apiBaseUrl}. Ensure the Streamliner API is running.${detail}\n`,
    );
    return 1;
  }

  const body = await readJson(response);
  if (!response.ok) {
    err.write(`${apiErrorMessage(response.status, body)}\n`);
    return 1;
  }

  const createResponse = body as NotificationCreateResponse;
  out.write(`Created notification ${createResponse.notification.id}: ${createResponse.notification.title}\n`);
  return 0;
}
