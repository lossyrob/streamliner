import type {
  SessionRegistryActivityStatus,
  SessionRegistryGithubRef,
  SessionRegistryRuntimeEvidence,
  SessionRegistryRuntimeMetadata,
  SessionRegistryRuntimeProgressEvent,
} from "./session-registry-schema";

// Forward compatibility policy: unknown managed-runtime literals from stored
// projections are invalid for this reader, so callers should drop the projection
// to null and keep the owning session/launch record rather than throwing.
export const WORKSTREAM_RUNTIME_KINDS = [
  "terminal-cli",
  "managed-sdk",
] as const;
export type WorkstreamRuntimeKind = (typeof WORKSTREAM_RUNTIME_KINDS)[number];

export const MANAGED_RUNTIME_OWNERS = [
  "builder-terminal",
  "streamliner-sdk",
] as const;
export type ManagedRuntimeOwner = (typeof MANAGED_RUNTIME_OWNERS)[number];

export const MANAGED_RUNTIME_PERMISSION_PROFILES = [
  "managed-autonomous",
] as const;
export type ManagedRuntimePermissionProfile =
  (typeof MANAGED_RUNTIME_PERMISSION_PROFILES)[number];

export const MANAGED_RUNTIME_LIFECYCLE_STATES = [
  "preparing",
  "starting",
  "running",
  "idle",
  "waiting_for_builder",
  "interrupt_requested",
  "interrupted",
  "canceled",
  "failed",
  "pr_ready",
  "review_ready",
  "completed",
  "cleanup_ready",
  "cleaning_up",
  "cleaned_up",
  "terminal_takeover",
] as const;
export type ManagedRuntimeLifecycleState =
  (typeof MANAGED_RUNTIME_LIFECYCLE_STATES)[number];

export const MANAGED_RUNTIME_PROGRESS_EVENT_LIMIT = 8;
export const MANAGED_RUNTIME_PROGRESS_EVENT_INPUT_CAP = 1000;
export const MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH = 240;
export const MANAGED_RUNTIME_REPLAY_RETAINED_EVENT_LIMIT = 50;

const MANAGED_RUNTIME_CLEANLY_ENDED_STATES = new Set<ManagedRuntimeLifecycleState>([
  "canceled",
  "completed",
  "cleaned_up",
]);

export const MANAGED_RUNTIME_PROGRESS_KINDS = [
  "lifecycle",
  "assistant-status",
  "tool",
  "background",
  "permission",
  "mcp",
  "skill",
  "review",
  "pull-request",
  "cleanup",
  "usage",
  "summary",
] as const;
export type ManagedRuntimeProgressKind =
  (typeof MANAGED_RUNTIME_PROGRESS_KINDS)[number];

export const MANAGED_RUNTIME_LINK_KINDS = [
  "pull-request",
  "completion",
  "blocker",
  "error",
  "review",
  "cleanup",
] as const;
export type ManagedRuntimeLinkKind = (typeof MANAGED_RUNTIME_LINK_KINDS)[number];

export type ManagedRuntimeActionKind =
  | "interrupt"
  | "cancel"
  | "terminal-takeover"
  | "cleanup";

export const MANAGED_RUNTIME_ACTION_ROUTE_SUFFIXES = {
  interrupt: "interrupt",
  cancel: "cancel",
  "terminal-takeover": "takeover",
  cleanup: "cleanup",
} as const satisfies Record<ManagedRuntimeActionKind, string>;

export interface ManagedRuntimeSafeLink {
  label: string;
  url?: string | null;
}

export interface ManagedRuntimeProgressEvent {
  timestamp: string;
  phase: string;
  summary: string;
  kind?: ManagedRuntimeProgressKind;
  status?: "info" | "success" | "warning" | "error";
  link?: ManagedRuntimeSafeLink | null;
  detail?: string | null;
  count?: number | null;
  correlationId?: string | null;
}

export interface ManagedRuntimeLink {
  kind: ManagedRuntimeLinkKind;
  label: string;
  url?: string | null;
  summary?: string | null;
}

export type ManagedRuntimeWaitingReasonCode =
  | "cleanup_blocked"
  | "cancellation_timeout"
  | "sdk_process_loss"
  | "permission_failure"
  | "manual_takeover_required"
  | "builder_input_required"
  | "unknown";

export interface ManagedRuntimeWaitingReason {
  code: ManagedRuntimeWaitingReasonCode;
  label: string;
  suggestedAction: string;
  detail?: string | null;
  blockerCode?: string | null;
}

export type ManagedRuntimeTrustCheckStatus = "pass" | "fail" | "unknown";

export interface ManagedRuntimeTrustCheck {
  label: string;
  status: ManagedRuntimeTrustCheckStatus;
  summary: string;
}

export interface ManagedRuntimePrReadyTrustContext {
  url?: string | null;
  repo?: string | null;
  number?: number | null;
  summary?: string | null;
  branchName?: string | null;
  baseBranch?: string | null;
  branchToBaseDiffUrl?: string | null;
  worktreePath?: string | null;
  worktreeClean?: boolean | null;
  headSha?: string | null;
  prHeadSha?: string | null;
  prHeadMatchesBranch?: boolean | null;
  checks: ManagedRuntimeTrustCheck[];
}

export interface ManagedRuntimeReplayWindow {
  retainedEventCount: number;
  retainedEventLimit: number;
  truncated: boolean;
}

export interface ManagedRuntimeActionAvailability {
  action: ManagedRuntimeActionKind;
  label: string;
  available: boolean;
  reason?: string | null;
}

export interface ManagedRuntimeSdkMetadata {
  sdkSessionId?: string | null;
  sdkWorkspacePath?: string | null;
  sdkStateRoot?: string | null;
}

export interface ManagedRuntimeProjection {
  runtimeKind: "managed-sdk";
  runtimeOwner: ManagedRuntimeOwner;
  permissionProfile: ManagedRuntimePermissionProfile;
  lifecycleState: ManagedRuntimeLifecycleState;
  lifecycleUpdatedAt?: string | null;
  summary?: string | null;
  blockerSummary?: string | null;
  errorSummary?: string | null;
  sdk?: ManagedRuntimeSdkMetadata | null;
  progress?: ManagedRuntimeProgressEvent[];
  links?: ManagedRuntimeLink[];
  actions?: ManagedRuntimeActionAvailability[];
  waitingReason?: ManagedRuntimeWaitingReason | null;
  prReady?: ManagedRuntimePrReadyTrustContext | null;
  replay?: ManagedRuntimeReplayWindow | null;
}

export interface ManagedRuntimeProjectionContext {
  repo?: string | null;
  branch?: string | null;
  cwd?: string | null;
  derivedBranch?: string | null;
  derivedWorktreePath?: string | null;
  derivedGithubRefs?: readonly SessionRegistryGithubRef[];
}

export interface ManagedRuntimeProjectionSession extends ManagedRuntimeProjectionContext {
  runtime?: SessionRegistryRuntimeMetadata | null;
}

export function isManagedRuntimeLifecycleCleanlyEnded(
  lifecycleState: ManagedRuntimeLifecycleState | null | undefined,
): boolean {
  return lifecycleState !== null
    && lifecycleState !== undefined
    && MANAGED_RUNTIME_CLEANLY_ENDED_STATES.has(lifecycleState);
}

export function managedRuntimeActivityStatusForLifecycle(
  lifecycleState: ManagedRuntimeLifecycleState | null | undefined,
): SessionRegistryActivityStatus | null {
  switch (lifecycleState) {
    case "preparing":
    case "starting":
    case "running":
    case "interrupt_requested":
    case "cleaning_up":
    case "terminal_takeover":
      return "working";
    case "idle":
    case "waiting_for_builder":
    case "pr_ready":
    case "review_ready":
    case "cleanup_ready":
      return "waiting_for_input";
    case "interrupted":
      return "interrupted";
    case "canceled":
    case "completed":
    case "cleaned_up":
      return "exited";
    case "failed":
    case null:
    case undefined:
      return null;
    default: {
      const _exhaustive: never = lifecycleState;
      return _exhaustive;
    }
  }
}

const MANAGED_RUNTIME_PROGRESS_STATUSES = [
  "info",
  "success",
  "warning",
  "error",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalSafeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function isManagedRuntimeOwner(value: unknown): value is ManagedRuntimeOwner {
  return typeof value === "string" && MANAGED_RUNTIME_OWNERS.includes(value as ManagedRuntimeOwner);
}

function isManagedRuntimePermissionProfile(
  value: unknown,
): value is ManagedRuntimePermissionProfile {
  return (
    typeof value === "string" &&
    MANAGED_RUNTIME_PERMISSION_PROFILES.includes(value as ManagedRuntimePermissionProfile)
  );
}

function isManagedRuntimeLifecycleState(
  value: unknown,
): value is ManagedRuntimeLifecycleState {
  return (
    typeof value === "string" &&
    MANAGED_RUNTIME_LIFECYCLE_STATES.includes(value as ManagedRuntimeLifecycleState)
  );
}

function isManagedRuntimeProgressKind(
  value: unknown,
): value is ManagedRuntimeProgressKind {
  return (
    typeof value === "string" &&
    MANAGED_RUNTIME_PROGRESS_KINDS.includes(value as ManagedRuntimeProgressKind)
  );
}

function isManagedRuntimeProgressStatus(
  value: unknown,
): value is ManagedRuntimeProgressEvent["status"] {
  return (
    typeof value === "string" &&
    MANAGED_RUNTIME_PROGRESS_STATUSES.includes(
      value as NonNullable<ManagedRuntimeProgressEvent["status"]>,
    )
  );
}

function isManagedRuntimeLinkKind(value: unknown): value is ManagedRuntimeLinkKind {
  return typeof value === "string" && MANAGED_RUNTIME_LINK_KINDS.includes(value as ManagedRuntimeLinkKind);
}

function isManagedRuntimeActionKind(
  value: unknown,
): value is ManagedRuntimeActionKind {
  return value === "interrupt" ||
    value === "cancel" ||
    value === "terminal-takeover" ||
    value === "cleanup";
}

function isManagedRuntimeWaitingReasonCode(
  value: unknown,
): value is ManagedRuntimeWaitingReasonCode {
  return value === "cleanup_blocked" ||
    value === "cancellation_timeout" ||
    value === "sdk_process_loss" ||
    value === "permission_failure" ||
    value === "manual_takeover_required" ||
    value === "builder_input_required" ||
    value === "unknown";
}

function isManagedRuntimeTrustCheckStatus(
  value: unknown,
): value is ManagedRuntimeTrustCheckStatus {
  return value === "pass" || value === "fail" || value === "unknown";
}

function assertUnhandledManagedLifecycleState(state: never): never {
  throw new Error(`unhandled managed lifecycle state: ${String(state)}`);
}

function progressEventSummary(value: string): string {
  if (value.length <= MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH) {
    return value;
  }
  const maxBodyLength = MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH - 3;
  let summary = "";
  for (const char of value) {
    if (summary.length + char.length > maxBodyLength) {
      break;
    }
    summary += char;
  }
  return `${summary}...`;
}

export function formatManagedRuntimeLabel(value: string): string {
  return value.replace(/[_-]+/g, " ");
}

export function managedLifecycleStatusClass(
  state: ManagedRuntimeLifecycleState,
): "green" | "amber" | "red" | "muted" | "accent" {
  switch (state) {
    case "running":
    case "idle":
    case "pr_ready":
    case "review_ready":
    case "cleanup_ready":
    case "cleaning_up":
      return "green";
    case "completed":
    case "cleaned_up":
    case "terminal_takeover":
      return "muted";
    case "preparing":
    case "starting":
    case "waiting_for_builder":
    case "interrupt_requested":
      return "amber";
    case "interrupted":
    case "canceled":
    case "failed":
      return "red";
    default:
      return assertUnhandledManagedLifecycleState(state);
  }
}

export function managedRuntimeProgressEvents(
  events: readonly unknown[] | null | undefined,
  limit = MANAGED_RUNTIME_PROGRESS_EVENT_LIMIT,
): ManagedRuntimeProgressEvent[] {
  if (!events || limit <= 0) {
    return [];
  }
  return events
    .slice(-MANAGED_RUNTIME_PROGRESS_EVENT_INPUT_CAP)
    .filter(isRecord)
    .filter(
      (event) =>
        typeof event.timestamp === "string" &&
        typeof event.phase === "string" &&
        typeof event.summary === "string",
    )
    .slice(-limit)
    .map((event) => {
      const progressEvent: ManagedRuntimeProgressEvent = {
        timestamp: event.timestamp as string,
        phase: event.phase as string,
        summary: progressEventSummary(event.summary as string),
      };
      if (isManagedRuntimeProgressKind(event.kind)) {
        progressEvent.kind = event.kind;
      }
      if (isManagedRuntimeProgressStatus(event.status)) {
        progressEvent.status = event.status;
      }
      if (isRecord(event.link) && typeof event.link.label === "string") {
        progressEvent.link = {
          label: event.link.label,
          url: optionalString(event.link.url),
        };
      }
      if (typeof event.detail === "string") {
        progressEvent.detail = progressEventSummary(event.detail);
      }
      if (typeof event.count === "number") {
        progressEvent.count = event.count;
      }
      return progressEvent;
    });
}

export function defaultManagedRuntimeActions(): ManagedRuntimeActionAvailability[] {
  return [
    {
      action: "interrupt",
      label: "Interrupt",
      available: false,
      reason: "Interrupt is unavailable for this background session state.",
    },
    {
      action: "cancel",
      label: "Cancel",
      available: false,
      reason: "Cancel is unavailable for this background session state.",
    },
    {
      action: "terminal-takeover",
      label: "Terminal takeover",
      available: false,
      reason: "Terminal takeover is unavailable for this background session state.",
    },
    {
      action: "cleanup",
      label: "Cleanup",
      available: false,
      reason: "Cleanup is unavailable until merged PR cleanup is ready.",
    },
  ];
}

export function resolveManagedRuntimeActions(
  projection: ManagedRuntimeProjection | null | undefined,
): ManagedRuntimeActionAvailability[] {
  const actions = projection?.actions ?? [];
  return actions.length > 0 ? actions : defaultManagedRuntimeActions();
}

const RUNTIME_PROGRESS_KINDS_BY_EVENT_TYPE: Partial<
  Record<SessionRegistryRuntimeProgressEvent["type"], ManagedRuntimeProgressKind>
> = {
  lifecycle: "lifecycle",
  assistant_status: "assistant-status",
  tool_started: "tool",
  tool_completed: "tool",
  subagent_status: "background",
  permission_decision: "permission",
  mcp_status: "mcp",
  skill_status: "skill",
  evidence: "summary",
  terminal_takeover: "summary",
  error: "summary",
  usage: "usage",
};

const SDK_INTERRUPT_STATES = new Set<ManagedRuntimeLifecycleState>([
  "running",
  "idle",
  "waiting_for_builder",
]);

const SDK_CANCEL_STATES = new Set<ManagedRuntimeLifecycleState>([
  "preparing",
  "starting",
  "running",
  "idle",
  "waiting_for_builder",
  "interrupt_requested",
  "failed",
]);

const SDK_TAKEOVER_STATES = new Set<ManagedRuntimeLifecycleState>([
  "running",
  "idle",
  "waiting_for_builder",
  "interrupt_requested",
  "interrupted",
  "pr_ready",
  "review_ready",
  "cleanup_ready",
]);

function managedRuntimeActionsFromMetadata(
  runtime: SessionRegistryRuntimeMetadata,
): ManagedRuntimeActionAvailability[] {
  const state = runtime.lifecycleState;
  if (!state) {
    return defaultManagedRuntimeActions();
  }
  const sdkOwned = runtime.runtimeOwner === "streamliner-sdk";
  const terminalOwnedReason = runtime.runtimeOwner === "builder-terminal"
    ? "Terminal owns this session after takeover."
    : "Streamliner does not own this runtime.";
  const interruptAvailable = sdkOwned && SDK_INTERRUPT_STATES.has(state);
  const cancelAvailable = sdkOwned && SDK_CANCEL_STATES.has(state);
  const takeoverAvailable = sdkOwned &&
    Boolean(runtime.sdkSessionId) &&
    SDK_TAKEOVER_STATES.has(state);
  const cleanupAvailable = isManagedRuntimeCleanupAvailable(runtime);
  return [
    {
      action: "interrupt",
      label: "Interrupt",
      available: interruptAvailable,
      reason: interruptAvailable
        ? null
        : sdkOwned
          ? `Interrupt is unavailable while lifecycle is ${formatManagedRuntimeLabel(state)}.`
          : terminalOwnedReason,
    },
    {
      action: "cancel",
      label: "Cancel",
      available: cancelAvailable,
      reason: cancelAvailable
        ? null
        : sdkOwned
          ? `Cancel is unavailable while lifecycle is ${formatManagedRuntimeLabel(state)}.`
          : terminalOwnedReason,
    },
    {
      action: "terminal-takeover",
      label: "Terminal takeover",
      available: takeoverAvailable,
      reason: takeoverAvailable
        ? null
        : !sdkOwned
          ? terminalOwnedReason
          : !runtime.sdkSessionId
            ? "Terminal takeover requires an SDK session id."
            : `Terminal takeover is unavailable while lifecycle is ${formatManagedRuntimeLabel(state)}.`,
    },
    {
      action: "cleanup",
      label: "Cleanup",
      available: cleanupAvailable,
      reason: cleanupAvailable
        ? null
        : state === "cleaned_up"
          ? "Cleanup already completed."
          : state === "cleaning_up"
            ? "Cleanup is already running."
            : "Cleanup is unavailable until merged PR cleanup is ready.",
    },
  ];
}

export function isManagedRuntimeCleanupAvailable(
  runtime: Pick<SessionRegistryRuntimeMetadata, "lifecycleState" | "evidence">,
): boolean {
  const state = runtime.lifecycleState;
  const cleanupReady = state === "cleanup_ready" ||
    runtime.evidence.some((evidence) => evidence.kind === "cleanup_ready");
  return cleanupReady && state !== "cleaning_up" && state !== "cleaned_up";
}

function progressStatusForRuntimeEvent(
  event: SessionRegistryRuntimeProgressEvent,
): ManagedRuntimeProgressEvent["status"] {
  if (event.type === "error") {
    return "error";
  }
  if (event.type === "subagent_status" && runtimeProgressDataBoolean(event, "success") === false) {
    return "error";
  }
  if (event.type === "subagent_status" && runtimeProgressDataBoolean(event, "success") === true) {
    return "success";
  }
  if (event.type === "tool_completed" && runtimeProgressDataBoolean(event, "success") === false) {
    return "error";
  }
  if (event.type === "tool_completed" || event.type === "evidence") {
    return "success";
  }
  if (event.type === "permission_decision") {
    return "warning";
  }
  return "info";
}

function runtimeProgressDataString(
  event: SessionRegistryRuntimeProgressEvent,
  key: string,
): string | null {
  const value = event.data?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function runtimeProgressDataBoolean(
  event: SessionRegistryRuntimeProgressEvent,
  key: string,
): boolean | null {
  const value = event.data?.[key];
  return typeof value === "boolean" ? value : null;
}

function runtimeProgressDataNumber(
  event: SessionRegistryRuntimeProgressEvent,
  key: string,
): number | null {
  const value = event.data?.[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function runtimeProgressKind(
  event: SessionRegistryRuntimeProgressEvent,
): ManagedRuntimeProgressKind {
  if (
    event.type === "assistant_status" &&
    runtimeProgressDataString(event, "assistantEventKind") !== "message"
  ) {
    return "summary";
  }
  return RUNTIME_PROGRESS_KINDS_BY_EVENT_TYPE[event.type] ?? "summary";
}

function runtimeToolLabel(event: SessionRegistryRuntimeProgressEvent): string | null {
  const toolName = runtimeProgressDataString(event, "toolName") ??
    runtimeProgressDataString(event, "name");
  if (!toolName) {
    return null;
  }
  return toolName.replace(/^functions\./, "");
}

function runtimeProgressDetail(
  event: SessionRegistryRuntimeProgressEvent,
): string | null {
  switch (event.type) {
    case "tool_started":
    case "tool_completed":
      return runtimeProgressDataString(event, "displayDetail") ??
        runtimeProgressDataString(event, "displayPath") ??
        runtimeToolLabel(event);
    case "subagent_status":
      return runtimeProgressDataString(event, "displayDetail") ??
        runtimeProgressDataString(event, "agentName") ??
        runtimeProgressDataString(event, "model");
    case "skill_status":
      return runtimeProgressDataString(event, "skillName") ??
        runtimeProgressDataString(event, "name");
    default:
      return null;
  }
}

function runtimeProgressCount(
  event: SessionRegistryRuntimeProgressEvent,
): number | null {
  return runtimeProgressDataNumber(event, "outputLineCount") ??
    runtimeProgressDataNumber(event, "lineCount");
}

function runtimeProgressSummary(
  event: SessionRegistryRuntimeProgressEvent,
): string {
  const toolLabel = runtimeToolLabel(event);
  switch (event.type) {
    case "assistant_status": {
      const intent = runtimeProgressDataString(event, "intent");
      const content = runtimeProgressDataString(event, "displayMessage") ??
        runtimeProgressDataString(event, "content");
      if (content) {
        return progressEventSummary(content);
      }
      if (intent) {
        return progressEventSummary(intent);
      }
      if (event.message === "Assistant status updated.") {
        return "Thinking...";
      }
      if (event.message === "Assistant message received.") {
        return "Assistant responded.";
      }
      return progressEventSummary(event.message);
    }
    case "tool_started":
      return runtimeProgressDataString(event, "displayTitle") ??
        (toolLabel
          ? `Running ${toolLabel}.`
          : progressEventSummary(event.message));
    case "tool_completed": {
      const success = runtimeProgressDataBoolean(event, "success");
      return runtimeProgressDataString(event, "displayTitle") ??
        (toolLabel
          ? `${success === false ? "Failed" : "Ran"} ${toolLabel}.`
           : progressEventSummary(event.message));
    }
    case "subagent_status":
      return runtimeProgressDataString(event, "displayTitle") ??
        progressEventSummary(event.message);
    case "skill_status": {
      const skillName = runtimeProgressDataString(event, "skillName") ??
        runtimeProgressDataString(event, "name");
      return skillName
        ? `Invoked ${skillName}.`
        : progressEventSummary(event.message);
    }
    default:
      return progressEventSummary(event.message);
  }
}

function evidenceLinkKind(
  evidence: SessionRegistryRuntimeEvidence,
): ManagedRuntimeLinkKind {
  switch (evidence.kind) {
    case "pr_ready":
      return "pull-request";
    case "review_ready":
      return "review";
    case "cleanup_ready":
    case "cleaned_up":
      return "cleanup";
    case "terminal_takeover":
    case "completed":
      return "completion";
    default: {
      const _exhaustive: never = evidence.kind;
      return _exhaustive;
    }
  }
}

function latestRuntimeSummary(
  runtime: SessionRegistryRuntimeMetadata,
): string | null {
  const evidenceSummary = [...runtime.evidence]
    .reverse()
    .find((evidence) => evidence.summary?.trim())?.summary;
  if (evidenceSummary) {
    return evidenceSummary;
  }
  for (const event of [...runtime.progressEvents].reverse()) {
    if (!event.message.trim() || isNoisyRuntimeProgressEvent(event)) {
      continue;
    }
    return runtimeProgressSummary(event);
  }
  return null;
}

function isNoisyRuntimeProgressEvent(event: SessionRegistryRuntimeProgressEvent): boolean {
  return event.type === "lifecycle" &&
    event.message === "Managed SDK lifecycle changed to running.";
}

function latestProgressDataString(
  runtime: SessionRegistryRuntimeMetadata,
  keys: readonly string[],
): string | null {
  for (const event of [...runtime.progressEvents].reverse()) {
    const data = event.data;
    if (!data) {
      continue;
    }
    for (const key of keys) {
      const value = data[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }
  }
  return null;
}

function latestProgressDataBoolean(
  runtime: SessionRegistryRuntimeMetadata,
  keys: readonly string[],
): boolean | null {
  for (const event of [...runtime.progressEvents].reverse()) {
    const data = event.data;
    if (!data) {
      continue;
    }
    for (const key of keys) {
      const value = data[key];
      if (typeof value === "boolean") {
        return value;
      }
    }
  }
  return null;
}

function latestRuntimeProgressEvent(
  runtime: SessionRegistryRuntimeMetadata,
): SessionRegistryRuntimeProgressEvent | null {
  return runtime.progressEvents.at(-1) ?? null;
}

function latestRuntimeEvidence(
  runtime: SessionRegistryRuntimeMetadata,
  kind: SessionRegistryRuntimeEvidence["kind"],
): SessionRegistryRuntimeEvidence | null {
  return [...runtime.evidence].reverse().find((evidence) => evidence.kind === kind) ?? null;
}

function latestDerivedPullRequest(
  context: ManagedRuntimeProjectionContext,
): SessionRegistryGithubRef | null {
  return [...(context.derivedGithubRefs ?? [])]
    .reverse()
    .find((ref) => ref.type === "pr") ?? null;
}

function isSafeGithubRepoSlug(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

function safeGithubUrl(value: string | null, pathPattern: RegExp): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "github.com" &&
      pathPattern.test(parsed.pathname)) {
      return `https://github.com${parsed.pathname}`;
    }
  } catch {
    return null;
  }
  return null;
}

function safeGithubPullRequestUrl(value: string | null): string | null {
  return safeGithubUrl(value, /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*\/?$/);
}

function safeGithubCompareUrl(value: string | null): string | null {
  return safeGithubUrl(value, /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/compare\/[^/?#]+$/);
}

function githubPullRequestUrl(repo: string | null, number: number | null): string | null {
  if (!repo || number === null || number < 1 || !isSafeGithubRepoSlug(repo)) {
    return null;
  }
  return `https://github.com/${repo}/pull/${number}`;
}

function isSafeCompareRef(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !/[\s~^:?*[\\\]]/.test(value);
}

function branchToBaseDiffUrl(
  repo: string | null,
  baseBranch: string | null,
  branchName: string | null,
): string | null {
  if (
    !repo ||
    !baseBranch ||
    !branchName ||
    !isSafeGithubRepoSlug(repo) ||
    !isSafeCompareRef(baseBranch) ||
    !isSafeCompareRef(branchName)
  ) {
    return null;
  }
  return `https://github.com/${repo}/compare/${
    encodeURIComponent(baseBranch)
  }...${encodeURIComponent(branchName)}`;
}

function trustCheck(
  label: string,
  status: ManagedRuntimeTrustCheckStatus,
  summary: string,
): ManagedRuntimeTrustCheck {
  return { label, status, summary };
}

function prReadyTrustContext(
  runtime: SessionRegistryRuntimeMetadata,
  context: ManagedRuntimeProjectionContext,
): ManagedRuntimePrReadyTrustContext | null {
  const evidence = latestRuntimeEvidence(runtime, "pr_ready");
  const derivedPullRequest = latestDerivedPullRequest(context);
  const prLifecycleActive =
    runtime.lifecycleState === "pr_ready" ||
    runtime.lifecycleState === "review_ready" ||
    runtime.lifecycleState === "cleanup_ready" ||
    runtime.lifecycleState === "cleaning_up" ||
    runtime.lifecycleState === "cleaned_up";
  if (!prLifecycleActive && !evidence) {
    return null;
  }
  const repo = evidence?.repo ?? derivedPullRequest?.repo ?? context.repo ?? null;
  const number = evidence?.number ?? derivedPullRequest?.number ?? null;
  const url = safeGithubPullRequestUrl(evidence?.url ?? derivedPullRequest?.url ?? null) ??
    githubPullRequestUrl(repo, number);
  if (!url && !repo && number === null) {
    return null;
  }

  const branchName = latestProgressDataString(runtime, ["branchName", "branch"]) ??
    context.derivedBranch ??
    context.branch ??
    null;
  const baseBranch = latestProgressDataString(runtime, [
    "baseBranch",
    "baseRef",
    "targetBranch",
  ]);
  const explicitDiffUrl = latestProgressDataString(runtime, [
    "branchToBaseDiffUrl",
    "diffUrl",
    "compareUrl",
  ]);
  const diffUrl = safeGithubCompareUrl(explicitDiffUrl) ??
    branchToBaseDiffUrl(repo, baseBranch, branchName);
  const worktreePath = latestProgressDataString(runtime, ["worktreePath"]) ??
    context.derivedWorktreePath ??
    context.cwd ??
    null;
  const worktreeClean = latestProgressDataBoolean(runtime, [
    "worktreeClean",
    "cleanWorktree",
  ]);
  const progressHeadSha = latestProgressDataString(runtime, [
    "headSha",
    "branchHeadSha",
    "currentHeadSha",
  ]);
  const progressPrHeadSha = latestProgressDataString(runtime, [
    "prHeadSha",
    "headRefOid",
  ]);
  const headSha = progressHeadSha;
  const prHeadSha = progressPrHeadSha ?? evidence?.sha ?? null;
  const explicitHeadMatch = latestProgressDataBoolean(runtime, [
    "prHeadMatchesBranch",
    "headMatchesBranch",
  ]);
  const prHeadMatchesBranch = explicitHeadMatch ??
    (headSha && prHeadSha ? headSha === prHeadSha : null);
  const checks: ManagedRuntimeTrustCheck[] = [];
  if (diffUrl) {
    checks.push(trustCheck(
      "Branch-to-base diff",
      "pass",
      "A branch-to-base diff link is available.",
    ));
  }
  if (worktreeClean !== null) {
    checks.push(trustCheck(
      "Worktree cleanliness",
      worktreeClean ? "pass" : "fail",
      worktreeClean ? "Worktree is clean." : "Worktree has uncommitted changes.",
    ));
  }
  if (prHeadSha) {
    checks.push(trustCheck(
      "PR head recorded",
      "pass",
      "PR head SHA is available for deterministic comparison.",
    ));
  }
  if (prHeadMatchesBranch !== null) {
    checks.push(trustCheck(
      "PR/head-state check",
      prHeadMatchesBranch ? "pass" : "fail",
      prHeadMatchesBranch
        ? "Recorded PR head matches the branch head."
        : "Recorded PR head does not match the branch head.",
    ));
  }

  return {
    url,
    repo,
    number,
    summary: evidence?.summary ?? null,
    branchName,
    baseBranch,
    branchToBaseDiffUrl: diffUrl,
    worktreePath,
    worktreeClean,
    headSha,
    prHeadSha,
    prHeadMatchesBranch,
    checks,
  };
}

function waitingReasonDetails(
  code: ManagedRuntimeWaitingReasonCode,
): Pick<ManagedRuntimeWaitingReason, "label" | "suggestedAction"> {
  switch (code) {
    case "cleanup_blocked":
      return {
        label: "Cleanup blocked",
        suggestedAction: "Review the cleanup blocker, fix the local or GitHub state, then retry cleanup.",
      };
    case "cancellation_timeout":
      return {
        label: "Cancellation timeout",
        suggestedAction: "Wait for the SDK session to settle, retry interrupt/cancel, or use terminal takeover if control is needed.",
      };
    case "sdk_process_loss":
      return {
        label: "SDK process lost",
        suggestedAction: "Resume the background session or take over in a terminal before continuing.",
      };
    case "permission_failure":
      return {
        label: "Permission failure",
        suggestedAction: "Check the managed-autonomous permission setup and relaunch or take over in a terminal.",
      };
    case "manual_takeover_required":
      return {
        label: "Manual takeover required",
        suggestedAction: "Open terminal takeover to continue in Copilot CLI.",
      };
    case "builder_input_required":
      return {
        label: "Builder input requested",
        suggestedAction: "Take over in a terminal or relaunch with enough context for autonomous completion.",
      };
    case "unknown":
      return {
        label: "Waiting for builder",
        suggestedAction: "Inspect the latest sanitized progress and choose an available managed runtime action.",
      };
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

function classifyWaitingReason(
  runtime: SessionRegistryRuntimeMetadata,
): ManagedRuntimeWaitingReason | null {
  if (runtime.lifecycleState !== "waiting_for_builder") {
    return null;
  }
  const latest = latestRuntimeProgressEvent(runtime);
  const message = latest?.message ?? latestRuntimeSummary(runtime) ?? "";
  const lower = message.toLowerCase();
  const blockerCode = latestProgressDataString(runtime, [
    "firstBlockerCode",
    "blockerCode",
  ]);
  let code: ManagedRuntimeWaitingReasonCode = "unknown";
  if (blockerCode) {
    code = "cleanup_blocked";
  } else if (
    lower.includes("no active managed sdk session") ||
    lower.includes("sdk process") ||
    lower.includes("process loss") ||
    lower.includes("attached to this api process")
  ) {
    code = "sdk_process_loss";
  } else if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("inconclusive")
  ) {
    code = "cancellation_timeout";
  } else if (lower.includes("permission")) {
    code = "permission_failure";
  } else if (lower.includes("takeover") || lower.includes("terminal")) {
    code = "manual_takeover_required";
  } else if (lower.includes("builder input") || lower.includes("input requested")) {
    code = "builder_input_required";
  }
  const details = waitingReasonDetails(code);
  return {
    code,
    ...details,
    detail: message || null,
    blockerCode,
  };
}

function replayWindow(runtime: SessionRegistryRuntimeMetadata): ManagedRuntimeReplayWindow {
  return {
    retainedEventCount: runtime.progressEvents.length,
    retainedEventLimit: MANAGED_RUNTIME_REPLAY_RETAINED_EVENT_LIMIT,
    truncated: runtime.progressEvents.length >= MANAGED_RUNTIME_REPLAY_RETAINED_EVENT_LIMIT,
  };
}

export function managedRuntimeProjectionFromMetadata(
  runtime: SessionRegistryRuntimeMetadata | null | undefined,
  context: ManagedRuntimeProjectionContext = {},
): ManagedRuntimeProjection | null {
  if (
    !runtime ||
    runtime.runtimeKind !== "managed-sdk" ||
    !isManagedRuntimeOwner(runtime.runtimeOwner) ||
    !runtime.lifecycleState
  ) {
    return null;
  }

  const summary = latestRuntimeSummary(runtime);
  const progress: ManagedRuntimeProgressEvent[] = runtime.progressEvents.map((event) => ({
    timestamp: event.timestamp,
    phase: event.type,
    summary: runtimeProgressSummary(event),
    kind: runtimeProgressKind(event),
    status: progressStatusForRuntimeEvent(event),
    detail: runtimeProgressDetail(event),
    count: runtimeProgressCount(event),
    correlationId: runtimeProgressDataString(event, "toolCallId") ??
      runtimeProgressDataString(event, "agentId"),
  }));
  const links: ManagedRuntimeLink[] = runtime.evidence.map((evidence) => ({
    kind: evidenceLinkKind(evidence),
    label: formatManagedRuntimeLabel(evidence.kind),
    url: evidence.url,
    summary: evidence.summary,
  }));

  return {
    runtimeKind: "managed-sdk",
    runtimeOwner: runtime.runtimeOwner,
    permissionProfile: "managed-autonomous",
    lifecycleState: runtime.lifecycleState,
    lifecycleUpdatedAt: runtime.lastStateChangedAt ?? runtime.startedAt,
    summary,
    blockerSummary: runtime.lifecycleState === "waiting_for_builder" ? summary : null,
    errorSummary: runtime.lifecycleState === "failed" ? summary : null,
    sdk: {
      sdkSessionId: runtime.sdkSessionId,
      sdkWorkspacePath: runtime.sdkWorkspacePath,
      sdkStateRoot: runtime.sdkStateRoot,
    },
    progress,
    links,
    actions: managedRuntimeActionsFromMetadata(runtime),
    waitingReason: classifyWaitingReason(runtime),
    prReady: prReadyTrustContext(runtime, context),
    replay: replayWindow(runtime),
  };
}

export function managedRuntimeProjectionFromSession(
  session: ManagedRuntimeProjectionSession | null | undefined,
): ManagedRuntimeProjection | null {
  return managedRuntimeProjectionFromMetadata(session?.runtime, session ?? {});
}

function sanitizeWaitingReason(value: unknown): ManagedRuntimeWaitingReason | null {
  if (
    !isRecord(value) ||
    !isManagedRuntimeWaitingReasonCode(value.code) ||
    typeof value.label !== "string" ||
    typeof value.suggestedAction !== "string"
  ) {
    return null;
  }
  return {
    code: value.code,
    label: value.label,
    suggestedAction: value.suggestedAction,
    detail: optionalString(value.detail),
    blockerCode: optionalString(value.blockerCode),
  };
}

function sanitizeTrustChecks(value: unknown): ManagedRuntimeTrustCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((check): ManagedRuntimeTrustCheck[] => {
    if (
      !isRecord(check) ||
      typeof check.label !== "string" ||
      !isManagedRuntimeTrustCheckStatus(check.status) ||
      typeof check.summary !== "string"
    ) {
      return [];
    }
    return [{
      label: check.label,
      status: check.status,
      summary: check.summary,
    }];
  });
}

function sanitizePrReadyTrustContext(value: unknown): ManagedRuntimePrReadyTrustContext | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    url: safeGithubPullRequestUrl(optionalString(value.url)),
    repo: optionalString(value.repo),
    number: optionalSafeNumber(value.number),
    summary: optionalString(value.summary),
    branchName: optionalString(value.branchName),
    baseBranch: optionalString(value.baseBranch),
    branchToBaseDiffUrl: safeGithubCompareUrl(optionalString(value.branchToBaseDiffUrl)),
    worktreePath: optionalString(value.worktreePath),
    worktreeClean: optionalBoolean(value.worktreeClean),
    headSha: optionalString(value.headSha),
    prHeadSha: optionalString(value.prHeadSha),
    prHeadMatchesBranch: optionalBoolean(value.prHeadMatchesBranch),
    checks: sanitizeTrustChecks(value.checks),
  };
}

function sanitizeReplayWindow(value: unknown): ManagedRuntimeReplayWindow | null {
  if (!isRecord(value)) {
    return null;
  }
  const retainedEventCount = optionalSafeNumber(value.retainedEventCount);
  const retainedEventLimit = optionalSafeNumber(value.retainedEventLimit);
  if (retainedEventCount === null || retainedEventLimit === null) {
    return null;
  }
  return {
    retainedEventCount,
    retainedEventLimit,
    truncated: optionalBoolean(value.truncated) ?? false,
  };
}

export function sanitizeManagedRuntimeProjection(
  value: unknown,
): ManagedRuntimeProjection | null {
  if (
    !isRecord(value) ||
    value.runtimeKind !== "managed-sdk" ||
    !isManagedRuntimeOwner(value.runtimeOwner) ||
    !isManagedRuntimePermissionProfile(value.permissionProfile) ||
    !isManagedRuntimeLifecycleState(value.lifecycleState)
  ) {
    return null;
  }

  const sdk = isRecord(value.sdk)
    ? {
        sdkSessionId: optionalString(value.sdk.sdkSessionId),
        sdkWorkspacePath: optionalString(value.sdk.sdkWorkspacePath),
        sdkStateRoot: optionalString(value.sdk.sdkStateRoot),
      }
    : null;
  const links = Array.isArray(value.links)
    ? value.links.flatMap((link): ManagedRuntimeLink[] => {
        if (
          !isRecord(link) ||
          !isManagedRuntimeLinkKind(link.kind) ||
          typeof link.label !== "string"
        ) {
          return [];
        }
        return [{
          kind: link.kind,
          label: link.label,
          url: optionalString(link.url),
          summary: optionalString(link.summary),
        }];
      })
    : [];
  const actions = Array.isArray(value.actions)
    ? value.actions.flatMap((action): ManagedRuntimeActionAvailability[] => {
        if (
          !isRecord(action) ||
          !isManagedRuntimeActionKind(action.action) ||
          typeof action.label !== "string" ||
          typeof action.available !== "boolean"
        ) {
          return [];
        }
        return [{
          action: action.action,
          label: action.label,
          available: action.available,
          reason: optionalString(action.reason),
        }];
      })
    : [];

  return {
    runtimeKind: "managed-sdk",
    runtimeOwner: value.runtimeOwner,
    permissionProfile: value.permissionProfile,
    lifecycleState: value.lifecycleState,
    lifecycleUpdatedAt: optionalString(value.lifecycleUpdatedAt),
    summary: optionalString(value.summary),
    blockerSummary: optionalString(value.blockerSummary),
    errorSummary: optionalString(value.errorSummary),
    sdk,
    progress: managedRuntimeProgressEvents(
      Array.isArray(value.progress) ? value.progress : [],
    ),
    links,
    actions,
    waitingReason: sanitizeWaitingReason(value.waitingReason),
    prReady: sanitizePrReadyTrustContext(value.prReady),
    replay: sanitizeReplayWindow(value.replay),
  };
}
