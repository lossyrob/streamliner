import express, { type ErrorRequestHandler, type Express } from "express";

import { getSessionRegistryStore } from "../session-registry/runtime";
import { SESSION_REGISTRY_API_BASE_PATH } from "../session-registry/http-api";
import type { RelaunchDeps } from "../session-registry/relaunch";
import type { SessionRegistryStore } from "../session-registry-contract";
import { createFilePickerRouter } from "./routes/file-picker";
import { createGraphRouter } from "./routes/graph";
import { createRecentsRouter } from "./routes/recents";
import { createSessionsRouter } from "./routes/sessions";
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
  relaunchDeps?: Partial<RelaunchDeps>;
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

export function createStreamlinerApiApp(
  options: StreamlinerApiAppOptions = {},
): StreamlinerApiApp {
  const app = express();
  const store = options.store ?? getSessionRegistryStore();
  const eventStream = new SessionRegistryEventStream(store);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api", createRecentsRouter({ recentsPath: options.recentsPath }));
  app.use("/api", createFilePickerRouter());
  app.use(
    "/api",
    createGraphRouter({
      defaultGraphPath: options.graphPath,
      recentsPath: options.recentsPath,
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
