import { resolve } from "node:path";

import {
  getDefaultSessionRegistryRoot,
  SessionRegistryFileStore,
} from "./file-store";

let sharedStore: SessionRegistryFileStore | null = null;

export function resolveSessionRegistryRoot(): string {
  return resolve(
    process.env.STREAMLINER_SESSION_REGISTRY_ROOT ?? getDefaultSessionRegistryRoot(),
  );
}

export function getSessionRegistryStore(): SessionRegistryFileStore {
  if (!sharedStore) {
    sharedStore = new SessionRegistryFileStore({
      rootDir: resolveSessionRegistryRoot(),
    });
  }

  return sharedStore;
}

export function resetSessionRegistryStoreForTests(): void {
  sharedStore = null;
}
