import { createServer } from "node:http";

import {
  ensureSessionRegistryBackgroundWorkerStarted,
  stopSessionRegistryBackgroundWorker,
} from "../session-registry/background-worker";
import { getSessionRegistryStore } from "../session-registry/runtime";
import { createStreamlinerApiApp } from "./app";
import { readStreamlinerApiConfig } from "./config";
import { acquireApiProcessLock, StreamlinerApiLockError } from "./process-lock";

const config = readStreamlinerApiConfig();
let releaseApiLock: () => void = () => {};
try {
  releaseApiLock = acquireApiProcessLock();
} catch (error: unknown) {
  if (error instanceof StreamlinerApiLockError) {
    console.error(`[streamliner-api] ${error.message}`);
    console.error(
      "[streamliner-api] Stop the existing API process or remove a stale api.lock after verifying no Streamliner API is running.",
    );
  } else {
    console.error("[streamliner-api] failed to acquire API process lock", error);
  }
  process.exit(1);
}
const registryStore = getSessionRegistryStore();
const api = createStreamlinerApiApp({
  store: registryStore,
  graphPath: config.graphPath,
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
  ensureSessionRegistryBackgroundWorkerStarted(registryStore);
}

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `[streamliner-api] ${config.host}:${config.port} is already in use. Stop the existing API process or set STREAMLINER_API_PORT.`,
    );
  } else {
    console.error("[streamliner-api] server error", error);
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
  console.log(`Streamliner API listening on http://${config.host}:${config.port}`);
});
