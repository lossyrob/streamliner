import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import type { SessionRegistryListItem } from "../session-registry-contract";
import type {
  SessionRegistryPawArtifactEvidence,
  SessionRegistryPawArtifactKind,
  SessionRegistryPawWorkflow,
  SessionRegistryPawWorkflowDiagnosticCode,
  SessionRegistryPawWorkflowKind,
  SessionRegistryPawWorkflowStage,
} from "../session-registry-schema";
import type { SessionRegistryDerivedStatePatch } from "./file-store";

const DEFAULT_MAX_ENTRIES = 250;
const DEFAULT_MAX_DEPTH = 5;

const STAGE_RANK: Record<SessionRegistryPawWorkflowStage, number> = {
  init: 0,
  planning: 1,
  implementation: 2,
  review: 3,
  finalization: 4,
};

interface PawArtifactIndexOptions {
  expectedWorkDir: string;
  maxEntries?: number;
  now?: () => Date;
}

interface ArtifactClassification {
  kind: SessionRegistryPawArtifactKind;
  stage: SessionRegistryPawWorkflowStage | null;
}

interface ScanArtifact extends SessionRegistryPawArtifactEvidence {
  fullPath: string;
}

interface ScanResult {
  artifacts: ScanArtifact[];
  unknownArtifacts: ScanArtifact[];
  diagnostics: SessionRegistryPawWorkflowDiagnosticCode[];
  rootReadFailed: boolean;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function statMtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function slashPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function normalizeWorkflowKind(value: string | null): SessionRegistryPawWorkflowKind {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "paw-lite") {
    return "paw-lite";
  }
  if (normalized === "paw-review") {
    return "paw-review";
  }
  if (normalized === "paw") {
    return "paw";
  }
  return "unknown";
}

function readWorkflowContextIdentity(workDir: string): {
  workId: string | null;
  workTitle: string | null;
  workflowKind: SessionRegistryPawWorkflowKind;
} {
  const contextPath = join(workDir, "WorkflowContext.md");
  if (!existsSync(contextPath)) {
    return {
      workId: basename(workDir) || null,
      workTitle: null,
      workflowKind: "unknown",
    };
  }

  let content: string;
  try {
    content = readFileSync(contextPath, "utf8");
  } catch {
    return {
      workId: basename(workDir) || null,
      workTitle: null,
      workflowKind: "unknown",
    };
  }
  const lineValue = (label: string): string | null => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = content.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "im"));
    return match?.[1]?.trim() || null;
  };
  return {
    workId: lineValue("Work ID") ?? (basename(workDir) || null),
    workTitle: lineValue("Work Title"),
    workflowKind: normalizeWorkflowKind(lineValue("Workflow Identity")),
  };
}

function classifyArtifact(relativePath: string): ArtifactClassification | null {
  const normalized = slashPath(relativePath);
  const lower = normalized.toLowerCase();
  const leaf = basename(lower);

  if (lower === "workflowcontext.md" || lower === "streamliner/context.md") {
    return { kind: "context", stage: "init" };
  }
  if (lower === "reviewcontext.md") {
    return { kind: "review", stage: "review" };
  }
  if (lower === "workshaping.md") {
    return { kind: "planning", stage: "planning" };
  }
  if (lower === "spec.md") {
    return { kind: "specification", stage: "planning" };
  }
  if (lower === "coderesearch.md") {
    return { kind: "research", stage: "planning" };
  }
  if (
    lower === "implementationplan.md" ||
    lower === "plan.md" ||
    lower === "planreview.md"
  ) {
    return { kind: "planning", stage: "planning" };
  }
  if (lower.startsWith("reviews/planning/") && lower.endsWith(".md")) {
    return { kind: "planning", stage: "planning" };
  }
  if (
    lower === "reviews/final-review.md" ||
    lower === "final-review.md" ||
    lower === "finalreview.md" ||
    lower === "implementationreview.md" ||
    (lower.startsWith("reviews/") && lower.endsWith(".md"))
  ) {
    return { kind: "review", stage: "review" };
  }
  if (
    lower === "pr.md" ||
    lower === "finalpr.md" ||
    lower === "final-pr.md" ||
    lower === "pullrequest.md" ||
    lower === "pull-request.md" ||
    lower.startsWith("final-pr/")
  ) {
    return { kind: "finalization", stage: "finalization" };
  }
  if (
    lower === "docs.md" ||
    lower.startsWith("implementation/") ||
    lower.startsWith("phases/") ||
    /^phase[-_\d].*\.md$/.test(leaf) ||
    (/implementation/.test(leaf) && lower !== "implementationplan.md")
  ) {
    return { kind: "implementation", stage: "implementation" };
  }
  return null;
}

function shouldSkipDirectory(name: string): boolean {
  return name === ".git" || name === "node_modules";
}

function collectArtifacts(
  workDir: string,
  options: { maxEntries: number; maxDepth: number },
): ScanResult {
  const artifacts: ScanArtifact[] = [];
  const unknownArtifacts: ScanArtifact[] = [];
  const diagnostics: SessionRegistryPawWorkflowDiagnosticCode[] = [];
  let rootReadFailed = false;
  let truncated = false;
  let entriesSeen = 0;

  const visit = (dir: string, depth: number): void => {
    if (entriesSeen >= options.maxEntries) {
      truncated = true;
      return;
    }
    if (depth > options.maxDepth) {
      return;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      if (depth === 0) {
        rootReadFailed = true;
      }
      diagnostics.push("paw_artifact_scan_error");
      return;
    }

    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (entriesSeen >= options.maxEntries) {
        truncated = true;
        return;
      }
      entriesSeen += 1;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name)) {
          visit(fullPath, depth + 1);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const path = slashPath(relative(workDir, fullPath));
      const classified = classifyArtifact(path) ?? { kind: "unknown" as const, stage: null };
      const evidence: ScanArtifact = {
        path,
        fullPath,
        kind: classified.kind,
        stage: classified.stage,
        mtimeMs: statMtimeMs(fullPath),
      };
      if (classified.kind === "unknown") {
        unknownArtifacts.push(evidence);
      } else {
        artifacts.push(evidence);
      }
    }
  };

  visit(workDir, 0);
  if (truncated) {
    diagnostics.push("paw_artifact_scan_truncated");
  }
  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  unknownArtifacts.sort((left, right) => left.path.localeCompare(right.path));
  return {
    artifacts,
    unknownArtifacts,
    diagnostics: [...new Set(diagnostics)],
    rootReadFailed,
  };
}

function latestArtifact(
  artifacts: readonly SessionRegistryPawArtifactEvidence[],
): SessionRegistryPawArtifactEvidence | null {
  let latest: SessionRegistryPawArtifactEvidence | null = null;
  let latestMtimeMs: number | null = null;
  for (const artifact of artifacts) {
    if (artifact.mtimeMs === null) {
      continue;
    }
    if (latestMtimeMs === null || artifact.mtimeMs > latestMtimeMs) {
      latest = artifact;
      latestMtimeMs = artifact.mtimeMs;
    }
  }
  return latest;
}

function latestStage(
  artifacts: readonly SessionRegistryPawArtifactEvidence[],
): SessionRegistryPawWorkflowStage | null {
  let stage: SessionRegistryPawWorkflowStage | null = null;
  for (const artifact of artifacts) {
    if (!artifact.stage) {
      continue;
    }
    if (!stage || STAGE_RANK[artifact.stage] > STAGE_RANK[stage]) {
      stage = artifact.stage;
    }
  }
  return stage;
}

function workflowFingerprint(workflow: SessionRegistryPawWorkflow | null): string {
  if (!workflow) {
    return "null";
  }
  const { scannedAt, ...material } = workflow;
  void scannedAt;
  return JSON.stringify(material);
}

function buildWorkflow(
  workDir: string,
  scan: ScanResult,
  scannedAt: string,
): SessionRegistryPawWorkflow {
  if (scan.rootReadFailed) {
    return unavailableWorkflow(workDir, scannedAt, [
      "paw_workdir_unavailable",
      "paw_artifact_scan_error",
    ]);
  }
  const identity = readWorkflowContextIdentity(workDir);
  const artifacts =
    scan.artifacts.length > 0 ? scan.artifacts : scan.unknownArtifacts.slice(0, 20);
  const materialArtifacts = artifacts.map((artifact) => ({
    path: artifact.path,
    kind: artifact.kind,
    stage: artifact.stage,
    mtimeMs: artifact.mtimeMs,
  }));
  const latest = latestArtifact(materialArtifacts);
  const stage = latestStage(materialArtifacts);
  const diagnostics = new Set(scan.diagnostics);
  const status =
    scan.artifacts.length > 0
      ? "recognized"
      : "unknown";
  if (status === "unknown") {
    diagnostics.add("paw_artifact_layout_unknown");
  }

  return {
    status,
    stage,
    workflowKind: identity.workflowKind,
    workId: identity.workId,
    workTitle: identity.workTitle,
    workDir,
    artifacts: materialArtifacts,
    artifactCount:
      scan.artifacts.length > 0 ? scan.artifacts.length : scan.unknownArtifacts.length,
    latestArtifactPath: latest?.path ?? null,
    latestArtifactMtimeMs: latest?.mtimeMs ?? null,
    scannedAt,
    diagnostics: [...diagnostics],
  };
}

function unavailableWorkflow(
  workDir: string | null,
  scannedAt: string,
  diagnostics: SessionRegistryPawWorkflowDiagnosticCode[] = ["paw_workdir_unavailable"],
): SessionRegistryPawWorkflow {
  return {
    status: "unavailable",
    stage: null,
    workflowKind: "unknown",
    workId: workDir ? basename(workDir) || null : null,
    workTitle: null,
    workDir,
    artifacts: [],
    artifactCount: 0,
    latestArtifactPath: null,
    latestArtifactMtimeMs: null,
    scannedAt,
    diagnostics,
  };
}

function shouldPatch(
  previous: SessionRegistryPawWorkflow | null,
  next: SessionRegistryPawWorkflow | null,
): boolean {
  return workflowFingerprint(previous) !== workflowFingerprint(next);
}

export function indexPawWorkflow(
  session: SessionRegistryListItem,
  options: PawArtifactIndexOptions,
): SessionRegistryDerivedStatePatch | null {
  const scannedAt = (options.now ?? (() => new Date()))().toISOString();
  const explicitWorkDir = options.expectedWorkDir.trim();

  const nextWorkflow: SessionRegistryPawWorkflow | null = explicitWorkDir
    ? (() => {
        const workDir = resolve(explicitWorkDir);
        return isDirectory(workDir)
          ? buildWorkflow(
              workDir,
              collectArtifacts(workDir, {
                maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
                maxDepth: DEFAULT_MAX_DEPTH,
              }),
              scannedAt,
            )
          : unavailableWorkflow(workDir, scannedAt);
      })()
    : null;

  return shouldPatch(session.pawWorkflow ?? null, nextWorkflow)
    ? { pawWorkflow: nextWorkflow }
    : null;
}
