import type {
  SessionRegistryListOptions,
} from "./session-registry-contract";
import type {
  SessionRegistryGithubRef,
  SessionRegistryGraphBinding,
  SessionRegistryLifecycleStatus,
  SessionRegistryOrigin,
  SessionRegistryOriginKind,
  SessionRegistryPawLaunch,
  SessionRegistryPawWorkflow,
} from "./session-registry-schema";

interface SessionRegistryTextRecord {
  title: string;
  description: string;
  aiSummary: string | null;
  cwd: string;
  repo: string | null;
  branch: string | null;
  derivedBranch: string | null;
  derivedWorktreePath: string | null;
  derivedGithubRefs: SessionRegistryGithubRef[];
  origin?: SessionRegistryOrigin;
  originKind?: SessionRegistryOriginKind;
  pawLaunch: SessionRegistryPawLaunch | null;
  pawWorkflow: SessionRegistryPawWorkflow | null;
  tags: string[];
  copilotSessionId: string | null;
}

interface SessionRegistryFilterRecord extends SessionRegistryTextRecord {
  graphBinding: SessionRegistryGraphBinding | null;
  lifecycleStatus: SessionRegistryLifecycleStatus;
}

const LAUNCHED_DESCRIPTION_BINDING_PATTERN =
  /^Graph launch for workstream ([^,]+), node (.+)\.$/;

export function buildLaunchedSessionDescription(
  workstreamId: string,
  nodeId: string,
): string {
  return `Graph launch for workstream ${workstreamId}, node ${nodeId}.`;
}

function originKindFor(record: SessionRegistryTextRecord): SessionRegistryOriginKind | null {
  return record.originKind ?? record.origin?.kind ?? null;
}

function partialOriginKindFor(
  record: Pick<SessionRegistryTextRecord, "origin" | "originKind">,
): SessionRegistryOriginKind | null {
  return record.originKind ?? record.origin?.kind ?? null;
}

export function sessionRegistryEffectiveGraphBinding(
  record: Pick<SessionRegistryFilterRecord, "graphBinding" | "description"> &
    Pick<SessionRegistryTextRecord, "origin" | "originKind">,
): SessionRegistryGraphBinding | null {
  if (record.graphBinding) {
    return record.graphBinding;
  }
  if (partialOriginKindFor(record) !== "launched") {
    return null;
  }
  const match = record.description.match(LAUNCHED_DESCRIPTION_BINDING_PATTERN);
  if (!match) {
    return null;
  }
  const [, workstreamId, nodeId] = match;
  return {
    workstreamId,
    nodeId,
    launchClaimId:
      record.origin?.kind === "launched" ? record.origin.launchClaimId ?? null : null,
  };
}

export function sessionRegistryRecordTextMatches(
  record: SessionRegistryTextRecord,
  text: string,
): boolean {
  const refs = record.derivedGithubRefs.map((ref) =>
    [ref.repo, ref.type, `#${ref.number}`, `${ref.type} #${ref.number}`]
      .filter(Boolean)
      .join(" "),
  );
  const pawWorkflowHaystacks = record.pawWorkflow
    ? [
        record.pawWorkflow.status,
        record.pawWorkflow.stage ?? "",
        record.pawWorkflow.workflowKind,
        record.pawWorkflow.workId ?? "",
        record.pawWorkflow.workTitle ?? "",
        record.pawWorkflow.workDir ?? "",
        ...record.pawWorkflow.diagnostics,
      ]
    : [];
  const pawLaunchHaystacks = record.pawLaunch
    ? [
        record.pawLaunch.workId,
        record.pawLaunch.workTitle,
        record.pawLaunch.workflowKind,
        record.pawLaunch.pawWorkDir,
      ]
    : [];
  const haystacks = [
    record.title,
    record.description,
    record.aiSummary ?? "",
    record.cwd,
    record.repo ?? "",
    record.branch ?? "",
    record.derivedBranch ?? "",
    record.derivedWorktreePath ?? "",
    originKindFor(record) ?? "",
    record.copilotSessionId ?? "",
    ...refs,
    ...pawWorkflowHaystacks,
    ...pawLaunchHaystacks,
    ...record.tags,
  ];
  return haystacks.some((value) => value.toLowerCase().includes(text));
}

export function sessionRegistryRecordMatchesOptions(
  record: SessionRegistryFilterRecord,
  options: SessionRegistryListOptions,
): boolean {
  if (!options.includeArchived && record.lifecycleStatus === "archived") {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(options, "repo") &&
    record.repo !== options.repo
  ) {
    return false;
  }
  if (
    options.workstreamId &&
    sessionRegistryEffectiveGraphBinding(record)?.workstreamId !== options.workstreamId
  ) {
    return false;
  }
  if (options.nodeId && sessionRegistryEffectiveGraphBinding(record)?.nodeId !== options.nodeId) {
    return false;
  }
  const text = options.text?.trim().toLowerCase();
  return text ? sessionRegistryRecordTextMatches(record, text) : true;
}
