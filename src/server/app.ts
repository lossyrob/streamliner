import { join, resolve as resolvePath } from "node:path";

import express, { type ErrorRequestHandler, type Express } from "express";

import type { LaunchClaimStore } from "../launch-claim-contract";
import { getSessionRegistryStore } from "../session-registry/runtime";
import { SessionRegistryFileStore } from "../session-registry/file-store";
import { SESSION_REGISTRY_API_BASE_PATH } from "../session-registry/http-api";
import { LAUNCH_CLAIMS_API_BASE_PATH } from "../session-registry/launch-claims-http-api";
import type { RelaunchDeps } from "../session-registry/relaunch";
import type { SessionRegistryStore } from "../session-registry-contract";
import type { ManagedCleanupDeps } from "./managed-cleanup";
import { getApiLogger } from "./logger";
import { createAccessLogMiddleware } from "./middleware/access-log";
import { NodeLaunchRecordStore } from "./node-launch-record-store";
import type { GithubStatusServiceOptions } from "./github-status-service";
import { createGraphRouter } from "./routes/graph";
import { createGithubStatusRouter } from "./routes/github-status";
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
import { createPawReviewPromptTemplatesRouter } from "./routes/paw-review-prompt-templates";
import { createPawWorkflowContextRouter } from "./routes/paw-workflow-context";
import { createCompanionTerminalLaunchesRouter } from "./routes/companion-terminal-launches";
import { createProtoCanvasRouter } from "./routes/proto-canvas";
import { createRecentsRouter } from "./routes/recents";
import { createSessionLaunchSettingsRouter } from "./routes/session-launch-settings";
import { createSessionsRouter } from "./routes/sessions";
import { createWorkstreamsRouter } from "./routes/workstreams";
import { SessionRegistryEventStream } from "./session-events";
import type { NodeLaunchDeps } from "./node-launch";
import { DefaultManagedSdkRunner } from "./managed-sdk-runner";
import { ManagedRuntimePatchCoalescer } from "./managed-runtime-patch-coalescer";
import {
  DEFAULT_COPILOT_CLI_ARGS,
  readSessionLaunchSettings,
  readSessionLaunchSettingsSync,
  SessionLaunchSettingsError,
} from "./session-launch-settings";

export interface StreamlinerApiApp {
  app: Express;
  eventStream: SessionRegistryEventStream;
  close: () => void;
}

function loadRelaunchDefaultCliArgs(settingsPath?: string): string[] {
  try {
    return readSessionLaunchSettingsSync(settingsPath).defaultCliArgs;
  } catch (error: unknown) {
    if (
      error instanceof SessionLaunchSettingsError &&
      error.code === "session_launch_settings_malformed"
    ) {
      return [...DEFAULT_COPILOT_CLI_ARGS];
    }
    throw error;
  }
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
  managedCleanupDeps?: Partial<ManagedCleanupDeps>;
  promptProfilesPath?: string;
  reviewPromptTemplatesPath?: string;
  sessionLaunchSettingsPath?: string;
  nodeLaunchRecordsPath?: string;
  pawWorkRoot?: string;
  /** Optional launch-claim store. When provided, mounts
   * `GET /api/launch-claims[/:id]` for diagnostic UI consumption. */
  launchClaimStore?: LaunchClaimStore;
  nodeLaunchDeps?: NodeLaunchDeps;
  githubStatusDeps?: GithubStatusServiceOptions;
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
  // Recover orphaned launch operations from the previous API process.
  // LaunchPreparationRunManager state lives in memory only, so any operation
  // persisted as active or prepared with pending post-preparation launch intent
  // at the moment the server restarts has no live run to attach to. Mark them
  // failed up front so the UI doesn't render them as forever-stuck.
  void nodeLaunchRecordStore
    .recoverOrphanedOperations()
    .then((recovered) => {
      if (recovered.length === 0) {
        return;
      }
      getApiLogger().withScope("node-launch-records").warn(
        "Recovered orphaned launch operations on startup.",
        {
          count: recovered.length,
          operations: recovered.map((operation) => ({
            graphPath: operation.graphPath,
            nodeId: operation.nodeId,
            previousStatus: "preparing|launching|managed_starting",
            preparationRunId: operation.preparationRunId,
            startedAt: operation.startedAt,
          })),
        },
      );
    })
    .catch((error: unknown) => {
      getApiLogger().withScope("node-launch-records").error(
        "Failed to recover orphaned launch operations on startup.",
        { error: error instanceof Error ? error.message : String(error) },
      );
    });
  const managedSdkRunner =
    options.nodeLaunchDeps?.managedSdkRunner ?? new DefaultManagedSdkRunner();
  const runtimePatchCoalescer =
    options.nodeLaunchDeps?.runtimePatchCoalescer ??
    new ManagedRuntimePatchCoalescer({
      patchRuntimeMetadata: store.patchRuntimeMetadata.bind(store),
    });
  const nodeLaunchDeps: NodeLaunchDeps = {
    ...options.nodeLaunchDeps,
    managedSdkRunner,
    runtimePatchCoalescer,
  };

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
    createGithubStatusRouter({
      serviceOptions: options.githubStatusDeps,
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
          nodeLaunchRecordStore,
          deps: nodeLaunchDeps,
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
        registryStore: store instanceof SessionRegistryFileStore ? store : undefined,
        launchClaimStore: options.launchClaimStore,
        nodeLaunchDeps,
        loadDefaultCliArgs: options.launchPreparationDeps?.loadDefaultCliArgs
          ?? (async () => {
            const settings = await readSessionLaunchSettings(options.sessionLaunchSettingsPath);
            return settings.defaultCliArgs;
          }),
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
    createPawReviewPromptTemplatesRouter({
      templatesPath: options.reviewPromptTemplatesPath,
    }),
  );
  app.use(
    "/api",
    createCompanionTerminalLaunchesRouter({
      launchTerminal: options.nodeLaunchDeps?.launchTerminal,
    }),
  );
  app.use(
    "/api",
    createSessionLaunchSettingsRouter({
      settingsPath: options.sessionLaunchSettingsPath,
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
      nodeLaunchRecordStore,
    }),
  );
  app.use(
    SESSION_REGISTRY_API_BASE_PATH,
    createSessionsRouter({
      store,
      eventStream,
      relaunchDeps: {
        ...options.relaunchDeps,
        loadDefaultCliArgs: options.relaunchDeps?.loadDefaultCliArgs
          ?? (() => loadRelaunchDefaultCliArgs(options.sessionLaunchSettingsPath)),
      },
      managedSdkRunner,
      runtimePatchCoalescer,
      managedCleanupDeps: options.managedCleanupDeps,
      now: options.now,
      launchClaimStore: options.launchClaimStore,
    }),
  );
  app.use(
    "/api/_proto/canvas",
    createProtoCanvasRouter(),
  );

  // Static prototype page. Visit http://<api-host>:<api-port>/_proto/canvas/
  // for the DBAgent portfolio canvas. Hard-coded to read from the planning
  // repo via the /api/_proto/canvas/* routes above.
  app.use(
    "/_proto/canvas",
    express.static(resolvePath(process.cwd(), "_proto", "canvas"), {
      etag: false,
      lastModified: false,
      setHeaders: (res) => {
        // Aggressive no-cache so prototype iteration is immediate.
        res.setHeader("Cache-Control", "no-store");
      },
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
