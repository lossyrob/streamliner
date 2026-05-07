import { join } from "node:path";

import express, { type ErrorRequestHandler, type Express } from "express";

import type { LaunchClaimStore } from "../launch-claim-contract";
import { getSessionRegistryStore } from "../session-registry/runtime";
import { SessionRegistryFileStore } from "../session-registry/file-store";
import { SESSION_REGISTRY_API_BASE_PATH } from "../session-registry/http-api";
import { LAUNCH_CLAIMS_API_BASE_PATH } from "../session-registry/launch-claims-http-api";
import type { RelaunchDeps } from "../session-registry/relaunch";
import type { SessionRegistryStore } from "../session-registry-contract";
import { getApiLogger } from "./logger";
import { createAccessLogMiddleware } from "./middleware/access-log";
import { NodeLaunchRecordStore } from "./node-launch-record-store";
import { createGraphRouter } from "./routes/graph";
import {
  createLaunchContextsRouter,
  type LaunchContextRouteDeps,
} from "./routes/launch-contexts";
import {
  createLaunchPreparationsRouter,
  type LaunchPreparationRouteDeps,
} from "./routes/launch-preparations";
import { createLaunchClaimsRouter } from "./routes/launch-claims";
import { createNodeLaunchesRouter } from "./routes/node-launches";
import { createNodeLaunchRecordsRouter } from "./routes/node-launch-records";
import { createPawLaunchPromptProfilesRouter } from "./routes/paw-launch-prompt-profiles";
import { createPawWorkflowContextRouter } from "./routes/paw-workflow-context";
import { createRecentsRouter } from "./routes/recents";
import { createSessionsRouter } from "./routes/sessions";
import { createWorkstreamsRouter } from "./routes/workstreams";
import { SessionRegistryEventStream } from "./session-events";
import type { NodeLaunchDeps } from "./node-launch";

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
  now?: () => Date;
  readonlyMode?: boolean;
  relaunchDeps?: Partial<RelaunchDeps>;
  launchContextDeps?: LaunchContextRouteDeps;
  launchPreparationDeps?: LaunchPreparationRouteDeps;
  promptProfilesPath?: string;
  nodeLaunchRecordsPath?: string;
  pawWorkRoot?: string;
  /** Optional launch-claim store. When provided, mounts
   * `GET /api/launch-claims[/:id]` for diagnostic UI consumption. */
  launchClaimStore?: LaunchClaimStore;
  nodeLaunchDeps?: NodeLaunchDeps;
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
  const nodeLaunchRecordStore = options.launchPreparationDeps?.nodeLaunchRecordStore
    ?? new NodeLaunchRecordStore({
      recordsPath: options.nodeLaunchRecordsPath ?? (
        options.launchPreparationDeps?.stateRoot
          ? join(options.launchPreparationDeps.stateRoot, "node-launch-records.json")
          : undefined
      ),
    });

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.use(
    createAccessLogMiddleware({
      logger: getApiLogger().withScope("http"),
      skip: (path) =>
        path.startsWith(`${SESSION_REGISTRY_API_BASE_PATH}/events`) ||
        /^\/api\/launch-preparations\/runs\/[^/]+\/events(?:\?|$)/.test(path),
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
      now: options.now,
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
  if (options.launchClaimStore) {
    app.use(
      LAUNCH_CLAIMS_API_BASE_PATH,
      createLaunchClaimsRouter({ claimStore: options.launchClaimStore }),
    );
  }
  if (options.launchClaimStore) {
    if (store instanceof SessionRegistryFileStore) {
      app.use(
        "/api",
        createNodeLaunchesRouter({
          registryStore: store,
          claimStore: options.launchClaimStore,
          deps: options.nodeLaunchDeps,
        }),
      );
    } else {
      getApiLogger().withScope("node-launch.api").warn(
        "disabled: session registry store does not support launch-claim reserved rows",
        { storeType: store.constructor.name },
      );
    }
  }
  app.use(
    "/api",
    createLaunchPreparationsRouter({
      defaultGraphPath: options.graphPath,
      deps: {
        ...options.launchPreparationDeps,
        nodeLaunchRecordStore,
      },
    }),
  );
  app.use(
    "/api",
    createNodeLaunchRecordsRouter({
      store: nodeLaunchRecordStore,
      claimStore: options.launchClaimStore,
      registryStore: store instanceof SessionRegistryFileStore ? store : undefined,
    }),
  );
  app.use(
    "/api",
    createPawLaunchPromptProfilesRouter({
      profilesPath: options.promptProfilesPath,
    }),
  );
  app.use(
    "/api",
    createPawWorkflowContextRouter({
      pawWorkRoot: options.pawWorkRoot ?? (
        options.launchPreparationDeps?.cwd
          ? join(options.launchPreparationDeps.cwd, ".paw", "work")
          : undefined
      ),
    }),
  );
  app.use(
    SESSION_REGISTRY_API_BASE_PATH,
    createSessionsRouter({
      store,
      eventStream,
      relaunchDeps: options.relaunchDeps,
      launchClaimStore: options.launchClaimStore,
    }),
  );
  app.use(malformedJsonHandler);
  app.use(jsonErrorHandler);

  return {
    app,
    eventStream,
    close: () => eventStream.close(),
  };
}
