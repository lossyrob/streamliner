import express, { type ErrorRequestHandler, type Express } from "express";

import { getSessionRegistryStore } from "../session-registry/runtime";
import { SESSION_REGISTRY_API_BASE_PATH } from "../session-registry/http-api";
import type { RelaunchDeps } from "../session-registry/relaunch";
import type { SessionRegistryStore } from "../session-registry-contract";
import { getApiLogger } from "./logger";
import { createAccessLogMiddleware } from "./middleware/access-log";
import { createGraphRouter } from "./routes/graph";
import {
  createLaunchContextsRouter,
  type LaunchContextRouteDeps,
} from "./routes/launch-contexts";
import {
  createLaunchPreparationsRouter,
  type LaunchPreparationRouteDeps,
} from "./routes/launch-preparations";
import { createRecentsRouter } from "./routes/recents";
import { createSessionsRouter } from "./routes/sessions";
import { createWorkstreamsRouter } from "./routes/workstreams";
import { SessionRegistryEventStream } from "./session-events";

export interface StreamlinerApiApp {
  app: Express;
  eventStream: SessionRegistryEventStream;
  close: () => void;
}

export interface StreamlinerApiAppOptions {
  store?: SessionRegistryStore;
  graphPath?: string;
  recentsPath?: string;
  workstreamRegistryPath?: string;
  workstreamSourceRegistryPath?: string;
  readonlyMode?: boolean;
  relaunchDeps?: Partial<RelaunchDeps>;
  launchContextDeps?: LaunchContextRouteDeps;
  launchPreparationDeps?: LaunchPreparationRouteDeps;
}

const malformedJsonHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (
    error instanceof SyntaxError &&
    "status" in error &&
    (error as { status?: unknown }).status === 400 &&
    "body" in error
  ) {
    res.status(400).json({ error: "Malformed JSON request body." });
    return;
  }
  next(error);
};

const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  const maybeStatus = (error as { status?: unknown; statusCode?: unknown }).status
    ?? (error as { statusCode?: unknown }).statusCode;
  const status = typeof maybeStatus === "number" && maybeStatus >= 400 && maybeStatus < 600
    ? maybeStatus
    : 500;
  const message = error instanceof Error ? error.message : "Internal server error.";
  res.status(status).json({ error: message });
};

const READONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createStreamlinerApiApp(
  options: StreamlinerApiAppOptions = {},
): StreamlinerApiApp {
  const app = express();
  const store = options.store ?? getSessionRegistryStore();
  const eventStream = new SessionRegistryEventStream(store);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.use(
    createAccessLogMiddleware({
      logger: getApiLogger().withScope("http"),
      skip: (path) => path.startsWith(`${SESSION_REGISTRY_API_BASE_PATH}/events`),
    }),
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  if (options.readonlyMode) {
    app.use((req, res, next) => {
      if (READONLY_METHODS.has(req.method)) {
        next();
        return;
      }
      res.status(403).json({
        code: "preview_readonly",
        error: "This Streamliner preview is read-only. Restart with --mode sandbox to allow mutations.",
      });
    });
  }
  app.use(
    "/api",
    createWorkstreamsRouter({
      registryPath: options.workstreamRegistryPath,
      sourceRegistryPath: options.workstreamSourceRegistryPath,
      recentsPath: options.recentsPath,
    }),
  );
  app.use("/api", createRecentsRouter({ recentsPath: options.recentsPath }));
  app.use(
    "/api",
    createGraphRouter({
      defaultGraphPath: options.graphPath,
      recentsPath: options.recentsPath,
    }),
  );
  app.use(
    "/api",
    createLaunchContextsRouter({
      defaultGraphPath: options.graphPath,
      deps: options.launchContextDeps,
    }),
  );
  app.use(
    "/api",
    createLaunchPreparationsRouter({
      defaultGraphPath: options.graphPath,
      deps: options.launchPreparationDeps,
    }),
  );
  app.use(
    SESSION_REGISTRY_API_BASE_PATH,
    createSessionsRouter({ store, eventStream, relaunchDeps: options.relaunchDeps }),
  );
  app.use(malformedJsonHandler);
  app.use(jsonErrorHandler);

  return {
    app,
    eventStream,
    close: () => eventStream.close(),
  };
}
