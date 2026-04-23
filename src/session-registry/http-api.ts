import type { SessionRegistryPatch, SessionRegistryStore, SessionRegistryUpsertInput } from "../session-registry-contract";

export const SESSION_REGISTRY_API_BASE_PATH = "/api/sessions";

export interface SessionRegistryApiRequest {
  method?: string;
  url: string;
  body?: unknown;
}

export interface SessionRegistryApiResponse {
  statusCode: number;
  body?: unknown;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildErrorResponse(error: unknown): SessionRegistryApiResponse {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("does not exist")) {
    return {
      statusCode: 404,
      body: { error: message },
    };
  }
  if (message.includes("locked")) {
    return {
      statusCode: 423,
      body: { error: message },
    };
  }
  return {
    statusCode: 400,
    body: { error: message },
  };
}

function parseNullableQuery(url: URL, key: string): string | null | undefined {
  if (!url.searchParams.has(key)) {
    return undefined;
  }
  const value = url.searchParams.get(key);
  return value === "null" ? null : value;
}

function decodePathSegments(pathname: string): string[] {
  const suffix = pathname.slice(SESSION_REGISTRY_API_BASE_PATH.length);
  if (suffix.length === 0) {
    return [];
  }
  if (!suffix.startsWith("/")) {
    return ["__no_match__"];
  }
  return suffix
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}

export function handleSessionRegistryApiRequest(
  store: SessionRegistryStore,
  request: SessionRegistryApiRequest,
): SessionRegistryApiResponse | null {
  const url = new URL(request.url, "http://localhost");
  if (!url.pathname.startsWith(SESSION_REGISTRY_API_BASE_PATH)) {
    return null;
  }

  const method = request.method?.toUpperCase() ?? "GET";
  const segments = decodePathSegments(url.pathname);
  if (segments[0] === "__no_match__") {
    return null;
  }

  try {
    if (segments.length === 0) {
      if (method === "GET") {
        const repoFilter = parseNullableQuery(url, "repo");
        return {
          statusCode: 200,
          body: store.listSessions({
            includeArchived: url.searchParams.get("includeArchived") === "true",
            text: url.searchParams.get("text") ?? undefined,
            ...(repoFilter !== undefined ? { repo: repoFilter } : {}),
            workstreamId: url.searchParams.get("workstreamId") ?? undefined,
            nodeId: url.searchParams.get("nodeId") ?? undefined,
          }),
        };
      }

      if (method === "POST") {
        if (!isJsonObject(request.body)) {
          return {
            statusCode: 400,
            body: { error: "Expected a JSON object body for POST /api/sessions." },
          };
        }
        return {
          statusCode: 200,
          body: store.upsertSession(
            request.body as unknown as SessionRegistryUpsertInput,
          ),
        };
      }
    }

    if (segments.length === 1) {
      const [id] = segments;
      if (method === "GET") {
        const record = store.getSession(id);
        return record
          ? { statusCode: 200, body: record }
          : { statusCode: 404, body: { error: `Session ${id} does not exist.` } };
      }

      if (method === "PATCH") {
        if (!isJsonObject(request.body)) {
          return {
            statusCode: 400,
            body: { error: `Expected a JSON object body for PATCH /api/sessions/${id}.` },
          };
        }
        return {
          statusCode: 200,
          body: store.patchSession(id, request.body as SessionRegistryPatch),
        };
      }

      if (method === "DELETE") {
        store.deleteSession(id);
        return { statusCode: 204 };
      }
    }

    if (segments.length === 2 && segments[1] === "archive" && method === "POST") {
      return {
        statusCode: 200,
        body: store.archiveSession(segments[0]),
      };
    }

    return {
      statusCode: 405,
      body: { error: `Unsupported ${method} ${url.pathname}.` },
    };
  } catch (error: unknown) {
    return buildErrorResponse(error);
  }
}
