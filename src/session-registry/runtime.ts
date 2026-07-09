import { resolve } from "node:path";

import {
  getDefaultSessionRegistryRoot,
  SessionRegistryFileStore,
} from "./file-store";
import {
  getDefaultLaunchClaimRoot,
  LaunchClaimFileStore,
} from "./launch-claim-store";

let sharedStore: SessionRegistryFileStore | null = null;
let sharedClaimStore: LaunchClaimFileStore | null = null;

export function resolveSessionRegistryRoot(): string {
  return resolve(
    process.env.STREAMLINER_SESSION_REGISTRY_ROOT ?? getDefaultSessionRegistryRoot(),
  );
}

export function resolveLaunchClaimRoot(): string {
  return resolve(
    process.env.STREAMLINER_LAUNCH_CLAIMS_ROOT ?? getDefaultLaunchClaimRoot(),
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

export function getLaunchClaimStore(): LaunchClaimFileStore {
  if (!sharedClaimStore) {
    sharedClaimStore = new LaunchClaimFileStore({
      rootDir: resolveLaunchClaimRoot(),
    });
  }
  return sharedClaimStore;
}

export function resetSessionRegistryStoreForTests(): void {
  sharedStore = null;
}

export function resetLaunchClaimStoreForTests(): void {
  sharedClaimStore = null;
}
