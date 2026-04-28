import { SessionRegistryFileStore } from "./file-store";

let sharedStore: SessionRegistryFileStore | null = null;

export function getSessionRegistryStore(): SessionRegistryFileStore {
  if (!sharedStore) {
    sharedStore = new SessionRegistryFileStore({
      rootDir: process.env.STREAMLINER_SESSION_REGISTRY_ROOT,
    });
  }

  return sharedStore;
}

export function resetSessionRegistryStoreForTests(): void {
  sharedStore = null;
}
