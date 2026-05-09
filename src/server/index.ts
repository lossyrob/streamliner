import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  ensureSessionRegistryBackgroundWorkerStarted,
  stopSessionRegistryBackgroundWorker,
} from "../session-registry/background-worker";
import {
  getLaunchClaimStore,
  getSessionRegistryStore,
} from "../session-registry/runtime";
import { createStreamlinerApiApp } from "./app";
import { readStreamlinerApiConfig } from "./config";
import { loadDotEnvFile } from "./env";
import { getApiLogger } from "./logger";
import { acquireApiProcessLock, StreamlinerApiLockError } from "./process-lock";

loadDotEnvFile();

const logger = getApiLogger().withScope("api");
const config = readStreamlinerApiConfig();
logger.info("copilot plugin cache", cachedStreamlinerHooksDigest());
let releaseApiLock: () => void = () => {};
try {
  releaseApiLock = acquireApiProcessLock({ host: config.host, port: config.port });
} catch (error: unknown) {
  if (error instanceof StreamlinerApiLockError) {
    logger.error("failed to acquire API process lock (already held)", { err: error });
    logger.error(
      "Stop the existing API process or remove a stale api.lock after verifying no Streamliner API is running.",
    );
  } else {
    logger.error("failed to acquire API process lock", { err: error });
  }
  process.exit(1);
}
const registryStore = getSessionRegistryStore();
const launchClaimStore = getLaunchClaimStore();
const api = createStreamlinerApiApp({
  store: registryStore,
  graphPath: config.graphPath,
  workstreamRegistryPath: config.workstreamRegistryPath,
  workstreamSourceRegistryPath: config.workstreamSourceRegistryPath,
  recentsPath: config.recentsPath,
  readonlyMode: config.previewReadonly,
  launchClaimStore,
});
const server = createServer(api.app);

let shuttingDown = false;

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  api.close();
  if (server.listening) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
  await stopSessionRegistryBackgroundWorker();
  releaseApiLock();
  process.exitCode = exitCode;
}

if (process.env.STREAMLINER_INTERNAL_DISABLE_SESSION_WORKER !== "1") {
  ensureSessionRegistryBackgroundWorkerStarted(registryStore, {
    logger: getApiLogger().withScope("worker"),
    claimStore: launchClaimStore,
    claimLogger: getApiLogger(),
  });
}

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error("address in use", {
      host: config.host,
      port: config.port,
      hint: "Stop the existing API process or set STREAMLINER_API_PORT.",
    });
  } else {
    logger.error("server error", { err: error });
  }
  void shutdown(1);
});

process.on("SIGINT", () => {
  void shutdown(0);
});
process.on("SIGTERM", () => {
  void shutdown(0);
});

server.listen(config.port, config.host, () => {
  logger.info("listening", {
    url: `http://${config.host}:${config.port}`,
    logFile: getApiLogger().currentLogFile(),
  });
});

function cachedStreamlinerHooksDigest():
  | { status: "found"; hooksPath: string; sha256: string }
  | { status: "not-found"; pluginCacheRoot: string }
  | { status: "error"; pluginCacheRoot: string; error: string } {
  const pluginCacheRoot = join(homedir(), ".copilot", "installed-plugins");
  try {
    if (!existsSync(pluginCacheRoot)) {
      return { status: "not-found", pluginCacheRoot };
    }
    for (const marketplace of readdirSync(pluginCacheRoot)) {
      const hooksPath = join(pluginCacheRoot, marketplace, "streamliner", "hooks.json");
      if (!existsSync(hooksPath) || !statSync(hooksPath).isFile()) {
        continue;
      }
      const contents = readFileSync(hooksPath);
      return {
        status: "found",
        hooksPath,
        sha256: createHash("sha256").update(contents).digest("hex"),
      };
    }
    return { status: "not-found", pluginCacheRoot };
  } catch (error: unknown) {
    return {
      status: "error",
      pluginCacheRoot,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
