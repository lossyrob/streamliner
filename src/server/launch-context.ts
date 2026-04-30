import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { promisify } from "node:util";

import type {
  WorkstreamDesignReference,
  WorkstreamDocument,
  WorkstreamNode,
  WorkstreamTracker,
} from "../workstream-schema";
import { parseWorkstreamDocument } from "../workstream-view-model";

const execFileAsync = promisify(execFile);

const CONTEXT_FILE_NAME = "context.md";

export type LaunchContextUnavailableKind =
  | "brief"
  | "design"
  | "git"
  | "graph"
  | "local-tracker"
  | "tracker";

export interface LaunchContextUnavailableInput {
  kind: LaunchContextUnavailableKind;
  source: string;
  reason: string;
  detail?: string;
}

export interface LaunchContextSourceFreshness {
  kind: "git-object" | "sha256";
  value: string;
}

export interface LaunchContextSourceReference {
  kind: "graph" | "brief" | "design" | "tracker" | "local-tracker";
  role: string;
  path?: string;
  repoId?: string;
  url?: string;
  freshness?: LaunchContextSourceFreshness;
}

export interface LaunchContextLayer0Selection {
  repoId: string;
  path: string;
  rationale: string;
  included: boolean;
}

export interface LaunchContextMetadata {
  contextId: string;
  launchNonce: string | null;
  launchClaimRef: string | null;
  projectKey: string;
  workstreamId: string;
  nodeId: string;
  targetRepoIds: string[];
  graphPath: string;
  workstreamDir: string;
  repoRoot: string;
  generatedAt: string;
  contextPackagePath: string;
  contextFilePath: string;
  sourceReferences: LaunchContextSourceReference[];
  unavailableInputs: LaunchContextUnavailableInput[];
}

export interface LaunchContextPackage {
  contextId: string;
  contextPackagePath: string;
  contextFilePath: string;
  metadata: LaunchContextMetadata;
  unavailableInputs: LaunchContextUnavailableInput[];
}

export interface PrepareLaunchContextPackageOptions {
  graphPath?: string;
  defaultGraphPath?: string;
  nodeId: string;
  outputDir?: string;
  launchNonce?: string | null;
  stateRoot?: string;
  now?: () => Date;
  createContextId?: (now: Date) => string;
}

export type LaunchContextPreparationErrorCode =
  | "graph_not_configured"
  | "graph_not_found"
  | "invalid_graph"
  | "invalid_node_id"
  | "unknown_node"
  | "invalid_output_dir"
  | "output_dir_exists"
  | "write_failed";

export class LaunchContextPreparationError extends Error {
  code: LaunchContextPreparationErrorCode;
  statusCode: number;

  constructor(
    code: LaunchContextPreparationErrorCode,
    statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "LaunchContextPreparationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

interface LoadedSource {
  reference: LaunchContextSourceReference;
  content?: string;
}

interface BriefSections {
  layer1: string;
  layer2: string;
}

function defaultStateRoot(): string {
  return resolve(process.env.STREAMLINER_STATE_ROOT ?? join(homedir(), ".streamliner", "state"));
}

function normalizeManifestPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function sourceDisplayPath(absPath: string, repoRoot: string): string {
  const rel = relative(repoRoot, absPath);
  if (!rel.startsWith("..") && !isAbsolute(rel)) {
    return normalizeManifestPath(rel);
  }
  return normalizeManifestPath(absPath);
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function createDefaultContextId(now: Date): string {
  const stamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `ctx-${stamp}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function resolveGraphPath(options: PrepareLaunchContextPackageOptions): string {
  const graphPath = options.graphPath ?? options.defaultGraphPath;
  if (!graphPath) {
    throw new LaunchContextPreparationError(
      "graph_not_configured",
      400,
      "No graph configured. Provide graphPath or configure STREAMLINER_GRAPH.",
    );
  }
  return resolve(graphPath);
}

function inferRepoRoot(graphPath: string): { path: string; found: boolean } {
  let current = dirname(graphPath);
  while (dirname(current) !== current) {
    if (basename(current) === ".streamliner") {
      return { path: dirname(current), found: true };
    }
    if (existsSync(join(current, ".git"))) {
      return { path: current, found: true };
    }
    current = dirname(current);
  }
  return { path: dirname(graphPath), found: false };
}

function gitRootFor(repoRoot: string): string | null {
  if (existsSync(join(repoRoot, ".git"))) {
    return repoRoot;
  }
  return null;
}

async function computeFreshness(
  absPath: string,
  repoRoot: string,
  content: string,
  unavailableInputs: LaunchContextUnavailableInput[],
): Promise<LaunchContextSourceFreshness> {
  const gitRoot = gitRootFor(repoRoot);
  if (gitRoot) {
    const relPath = normalizeManifestPath(relative(gitRoot, absPath));
    try {
      await execFileAsync("git", ["-C", gitRoot, "ls-files", "--error-unmatch", relPath]);
      const { stdout } = await execFileAsync("git", ["-C", gitRoot, "hash-object", relPath]);
      return { kind: "git-object", value: stdout.trim() };
    } catch (error: unknown) {
      if (!isErrno(error, "ENOENT")) {
        unavailableInputs.push({
          kind: "git",
          source: relPath,
          reason: "git_metadata_unavailable",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    kind: "sha256",
    value: createHash("sha256").update(content).digest("hex"),
  };
}

async function readSourceFile(options: {
  absPath: string;
  repoRoot: string;
  kind: LaunchContextSourceReference["kind"];
  role: string;
  unavailableKind: LaunchContextUnavailableKind;
  unavailableInputs: LaunchContextUnavailableInput[];
  repoId?: string;
}): Promise<LoadedSource> {
  const displayPath = sourceDisplayPath(options.absPath, options.repoRoot);
  const reference: LaunchContextSourceReference = {
    kind: options.kind,
    role: options.role,
    path: displayPath,
    repoId: options.repoId,
  };

  try {
    const content = await readFile(options.absPath, "utf8");
    reference.freshness = await computeFreshness(
      options.absPath,
      options.repoRoot,
      content,
      options.unavailableInputs,
    );
    return { reference, content };
  } catch (error: unknown) {
    options.unavailableInputs.push({
      kind: options.unavailableKind,
      source: displayPath,
      reason: isErrno(error, "ENOENT") ? "missing" : "read_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
    return { reference };
  }
}

function sectionTitle(line: string): string | null {
  const match = /^##\s+(.+?)\s*$/.exec(line);
  return match?.[1]?.trim() ?? null;
}

function markdownSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const title = sectionTitle(line);
    if (title) {
      if (currentTitle) {
        sections.set(currentTitle, currentLines.join("\n").trim());
      }
      currentTitle = title;
      currentLines = [];
      continue;
    }
    if (currentTitle) {
      currentLines.push(line);
    }
  }

  if (currentTitle) {
    sections.set(currentTitle, currentLines.join("\n").trim());
  }

  return sections;
}

function formatSections(
  sections: Map<string, string>,
  titles: string[],
  fallback: string,
): string {
  if (!titles.some((title) => sections.has(title))) {
    return fallback;
  }
  const blocks = titles.map((title) => {
    const content = sections.get(title);
    return `## ${title}\n\n${content?.trim() || "_Not present._"}`;
  });
  return blocks.join("\n\n");
}

function briefSections(briefContent: string | undefined): BriefSections {
  if (!briefContent) {
    return {
      layer1: "_Brief unavailable._",
      layer2: "_Brief unavailable._",
    };
  }
  const sections = markdownSections(briefContent);
  return {
    layer1: formatSections(
      sections,
      ["Purpose", "Approach", "Design References", "Boundaries"],
      briefContent,
    ),
    layer2: formatSections(
      sections,
      ["Current State", "Decisions", "Open Questions"],
      briefContent,
    ),
  };
}

function parseBriefDesignReferences(
  briefContent: string | undefined,
  fallbackRepoId: string,
): WorkstreamDesignReference[] {
  if (!briefContent) {
    return [];
  }
  const designRefs = new Map<string, WorkstreamDesignReference>();
  const pattern = /(?:(?<repoId>[a-z0-9]+(?:-[a-z0-9]+)*):)?(?<path>docs\/design\/[A-Za-z0-9._/-]+\.md)/g;
  for (const match of briefContent.matchAll(pattern)) {
    const path = match.groups?.path;
    if (path) {
      const repoId = match.groups?.repoId ?? fallbackRepoId;
      const reference = { repoId, path: normalizeManifestPath(path) };
      designRefs.set(designReferenceKey(reference), reference);
    }
  }
  return [...designRefs.values()];
}

function designReferenceKey(reference: Pick<WorkstreamDesignReference, "repoId" | "path">): string {
  return `${reference.repoId}:${normalizeManifestPath(reference.path)}`.toLowerCase();
}

function collectDesignReferences(
  workstream: WorkstreamDocument,
  briefContent: string | undefined,
): Array<WorkstreamDesignReference & { rationale: string }> {
  const references = new Map<string, WorkstreamDesignReference & { rationale: string }>();
  const primaryRepoId = workstream.repos[0]?.id ?? "streamliner";
  const add = (repoId: string, path: string, rationale: string) => {
    const reference = {
      repoId,
      path: normalizeManifestPath(path),
      rationale,
    };
    const key = designReferenceKey(reference);
    if (!references.has(key)) {
      references.set(key, reference);
    }
  };

  add(primaryRepoId, "docs/design/index.md", "design index entry point");
  for (const reference of workstream.designRefs) {
    add(reference.repoId, reference.path, "workstream designRefs");
  }
  for (const reference of parseBriefDesignReferences(briefContent, primaryRepoId)) {
    add(reference.repoId, reference.path, "brief Design References section");
  }

  return [...references.values()];
}

function trackerRef(node: WorkstreamNode): string {
  const tracker = node.tracker;
  if (!tracker) {
    return "none";
  }
  if (tracker.type === "github") {
    return `${tracker.owner}/${tracker.repo}#${tracker.number}`;
  }
  return tracker.path;
}

function nodeSummary(node: WorkstreamNode): string {
  return `- ${node.id}: ${node.title} [${node.status}] (${trackerRef(node)})\n  ${node.summary}`;
}

function checkpointForNode(
  workstream: WorkstreamDocument,
  nodeId: string,
) {
  return workstream.checkpoints.find((checkpoint) => checkpoint.nodeIds.includes(nodeId));
}

function dependentNodes(
  workstream: WorkstreamDocument,
  nodeId: string,
): WorkstreamNode[] {
  return workstream.nodes.filter((node) => node.dependsOn.includes(nodeId));
}

function buildLayer0Content(
  selection: LaunchContextLayer0Selection[],
): string {
  const selected = selection
    .map((entry) =>
      `- ${entry.included ? "read" : "unavailable"}: \`${entry.repoId}:${entry.path}\` - ${entry.rationale}`,
    )
    .join("\n");

  return [
    "## Layer 0 - Design Context References",
    "",
    "Layer 0 is intentionally link-based. Read the authoritative design documents directly from the repository instead of relying on copied excerpts in this generated package.",
    "",
    "### Design Documents to Read",
    "",
    selected || "_No design references selected._",
    "",
  ].join("\n");
}

function buildLayer3Content(options: {
  workstream: WorkstreamDocument;
  node: WorkstreamNode;
  trackerReference: string | null;
}): string {
  const checkpoint = checkpointForNode(options.workstream, options.node.id);
  const upstream = options.node.dependsOn
    .map((id) => options.workstream.nodes.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is WorkstreamNode => candidate !== undefined);
  const siblings = checkpoint
    ? checkpoint.nodeIds
      .filter((id) => id !== options.node.id)
      .map((id) => options.workstream.nodes.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is WorkstreamNode => candidate !== undefined)
    : [];
  const downstream = dependentNodes(options.workstream, options.node.id);

  return [
    "## Layer 3 - Node Context",
    "",
    "### Selected Node",
    "",
    nodeSummary(options.node),
    "",
    "### Checkpoint / Wave Context",
    "",
    checkpoint
      ? `- ${checkpoint.id}: ${checkpoint.title} [${checkpoint.status}]\n  ${checkpoint.summary}`
      : "_Selected node is not listed in a checkpoint._",
    "",
    "### Upstream Nodes",
    "",
    upstream.length > 0 ? upstream.map(nodeSummary).join("\n") : "_No upstream dependency nodes._",
    "",
    "### Same-Checkpoint Sibling Nodes",
    "",
    siblings.length > 0 ? siblings.map(nodeSummary).join("\n") : "_No same-checkpoint sibling nodes._",
    "",
    "### Downstream Nodes",
    "",
    downstream.length > 0 ? downstream.map(nodeSummary).join("\n") : "_No downstream dependent nodes._",
    "",
    "### Selected Node Spec Reference",
    "",
    options.trackerReference ?? "_No tracker or local node spec reference._",
    "",
  ].join("\n");
}

function demoteMarkdownHeadings(markdown: string): string {
  return markdown.replace(/^(#{1,5})(\s+)/gm, "#$1$2");
}

function buildUnavailableInputsContent(
  unavailableInputs: LaunchContextUnavailableInput[],
): string {
  if (unavailableInputs.length === 0) {
    return "";
  }
  const entries = unavailableInputs
    .map((input) => {
      const detail = input.detail ? ` (${input.detail})` : "";
      return `- ${input.kind}: ${input.source} - ${input.reason}${detail}`;
    })
    .join("\n");
  return ["## Unavailable Inputs", "", entries, ""].join("\n");
}

function buildContextContent(options: {
  workstream: WorkstreamDocument;
  node: WorkstreamNode;
  layer0Selection: LaunchContextLayer0Selection[];
  sections: BriefSections;
  trackerReference: string | null;
  unavailableInputs: LaunchContextUnavailableInput[];
}): string {
  const unavailableInputs = buildUnavailableInputsContent(options.unavailableInputs);
  const blocks = [
    `# Launch Context - ${options.node.title}`,
    "",
    `Workstream: ${options.workstream.title} (${options.workstream.id})`,
    `Node: ${options.node.id}`,
    "",
    buildLayer0Content(options.layer0Selection),
    "## Layer 1 - Workstream Intent",
    "",
    demoteMarkdownHeadings(options.sections.layer1),
    "",
    "## Layer 2 - Operational State",
    "",
    demoteMarkdownHeadings(options.sections.layer2),
    "",
    buildLayer3Content({
      workstream: options.workstream,
      node: options.node,
      trackerReference: options.trackerReference,
    }),
  ];
  if (unavailableInputs) {
    blocks.push(unavailableInputs);
  }
  return `${blocks.join("\n")}\n`;
}

async function resolveTrackerReference(options: {
  tracker: WorkstreamTracker | undefined;
  workstreamDir: string;
  repoRoot: string;
  unavailableInputs: LaunchContextUnavailableInput[];
  sourceReferences: LaunchContextSourceReference[];
}): Promise<string | null> {
  if (!options.tracker) {
    return null;
  }

  if (options.tracker.type === "github") {
    const url = `https://github.com/${options.tracker.owner}/${options.tracker.repo}/issues/${options.tracker.number}`;
    options.sourceReferences.push({
      kind: "tracker",
      role: "selected-node-spec",
      url,
    });
    return `- GitHub issue: ${url}`;
  }

  const localPath = resolve(options.workstreamDir, options.tracker.path);
  const source = await readSourceFile({
    absPath: localPath,
    repoRoot: options.repoRoot,
    kind: "local-tracker",
    role: "selected-node-spec",
    unavailableKind: "local-tracker",
    unavailableInputs: options.unavailableInputs,
  });
  options.sourceReferences.push(source.reference);
  return source.reference.path
    ? `- Local node spec: ${source.reference.path}`
    : `- Local node spec: ${options.tracker.path}`;
}

async function readGraph(graphPath: string): Promise<string> {
  try {
    return await readFile(graphPath, "utf8");
  } catch (error: unknown) {
    if (isErrno(error, "ENOENT")) {
      throw new LaunchContextPreparationError(
        "graph_not_found",
        404,
        `Graph file not found: ${graphPath}`,
      );
    }
    throw error;
  }
}

function parseGraph(rawGraph: string): WorkstreamDocument {
  try {
    return parseWorkstreamDocument(rawGraph);
  } catch (error: unknown) {
    throw new LaunchContextPreparationError(
      "invalid_graph",
      400,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function finalPackagePath(options: {
  outputDir?: string;
  stateRoot: string;
  projectKey: string;
  workstreamId: string;
  contextId: string;
}): string {
  if (options.outputDir) {
    if (!isAbsolute(options.outputDir)) {
      throw new LaunchContextPreparationError(
        "invalid_output_dir",
        400,
        "outputDir must be an absolute path.",
      );
    }
    return join(resolve(options.outputDir), options.contextId);
  }

  return join(
    options.stateRoot,
    options.projectKey,
    options.workstreamId,
    "launch-contexts",
    options.contextId,
  );
}

async function ensurePathDoesNotExist(path: string): Promise<void> {
  try {
    await stat(path);
    throw new LaunchContextPreparationError(
      "output_dir_exists",
      409,
      `Launch context output directory already exists: ${path}`,
    );
  } catch (error: unknown) {
    if (isErrno(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}

async function writePackageFiles(options: {
  packagePath: string;
  contextContent: string;
}): Promise<void> {
  await ensurePathDoesNotExist(options.packagePath);
  const parent = dirname(options.packagePath);
  await mkdir(parent, { recursive: true });
  const tempPath = join(parent, `.${basename(options.packagePath)}.tmp-${process.pid}-${randomUUID()}`);

  try {
    await mkdir(tempPath, { recursive: true });
    await writeFile(join(tempPath, CONTEXT_FILE_NAME), options.contextContent, "utf8");
    await rename(tempPath, options.packagePath);
  } catch (error: unknown) {
    await rm(tempPath, { recursive: true, force: true });
    if (error instanceof LaunchContextPreparationError) {
      throw error;
    }
    if (isErrno(error, "EEXIST") || isErrno(error, "EPERM")) {
      throw new LaunchContextPreparationError(
        "output_dir_exists",
        409,
        `Launch context output directory already exists: ${options.packagePath}`,
      );
    }
    throw new LaunchContextPreparationError(
      "write_failed",
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function prepareLaunchContextPackage(
  options: PrepareLaunchContextPackageOptions,
): Promise<LaunchContextPackage> {
  if (!options.nodeId.trim()) {
    throw new LaunchContextPreparationError(
      "invalid_node_id",
      400,
      "nodeId is required.",
    );
  }

  const generatedAtDate = options.now?.() ?? new Date();
  const generatedAt = generatedAtDate.toISOString();
  const contextId = options.createContextId?.(generatedAtDate) ?? createDefaultContextId(generatedAtDate);
  const graphPath = resolveGraphPath(options);
  const rawGraph = await readGraph(graphPath);
  const workstream = parseGraph(rawGraph);
  const node = workstream.nodes.find((candidate) => candidate.id === options.nodeId);
  if (!node) {
    throw new LaunchContextPreparationError(
      "unknown_node",
      404,
      `Unknown workstream node: ${options.nodeId}`,
    );
  }

  const repoRootInfo = inferRepoRoot(graphPath);
  const repoRoot = repoRootInfo.path;
  const workstreamDir = dirname(graphPath);
  const projectKey = workstream.projectKey ?? workstream.id;
  const stateRoot = resolve(options.stateRoot ?? defaultStateRoot());
  const packagePath = finalPackagePath({
    outputDir: options.outputDir,
    stateRoot,
    projectKey,
    workstreamId: workstream.id,
    contextId,
  });
  const contextFilePath = join(packagePath, CONTEXT_FILE_NAME);
  const unavailableInputs: LaunchContextUnavailableInput[] = [];
  const sourceReferences: LaunchContextSourceReference[] = [];
  if (!repoRootInfo.found) {
    unavailableInputs.push({
      kind: "graph",
      source: normalizeManifestPath(graphPath),
      reason: "repo_root_not_found",
      detail: "Could not find a .streamliner or .git ancestor for the graph path.",
    });
  }

  const graphReference: LaunchContextSourceReference = {
    kind: "graph",
    role: "workstream-graph",
    path: sourceDisplayPath(graphPath, repoRoot),
    freshness: await computeFreshness(graphPath, repoRoot, rawGraph, unavailableInputs),
  };
  sourceReferences.push(graphReference);

  const briefSource = await readSourceFile({
    absPath: join(workstreamDir, "brief.md"),
    repoRoot,
    kind: "brief",
    role: "workstream-brief",
    unavailableKind: "brief",
    unavailableInputs,
  });
  sourceReferences.push(briefSource.reference);

  const designReferences = collectDesignReferences(workstream, briefSource.content);
  const primaryRepoId = workstream.repos[0]?.id ?? "streamliner";
  const layer0Selection: LaunchContextLayer0Selection[] = [];
  for (const designReference of designReferences) {
    if (designReference.repoId !== primaryRepoId) {
      const reference: LaunchContextSourceReference = {
        kind: "design",
        role: "layer-0-design",
        path: designReference.path,
        repoId: designReference.repoId,
      };
      sourceReferences.push(reference);
      unavailableInputs.push({
        kind: "design",
        source: `${designReference.repoId}:${designReference.path}`,
        reason: "cross_repo_unavailable",
        detail: "Context assembly currently reads design docs from the primary checkout only.",
      });
      layer0Selection.push({
        repoId: designReference.repoId,
        path: designReference.path,
        rationale: designReference.rationale,
        included: false,
      });
      continue;
    }
    const source = await readSourceFile({
      absPath: join(repoRoot, ...designReference.path.split("/")),
      repoRoot,
      kind: "design",
      role: "layer-0-design",
      unavailableKind: "design",
      unavailableInputs,
      repoId: designReference.repoId,
    });
    sourceReferences.push(source.reference);
    layer0Selection.push({
      repoId: designReference.repoId,
      path: designReference.path,
      rationale: designReference.rationale,
      included: source.content !== undefined,
    });
  }

  const trackerReference = await resolveTrackerReference({
    tracker: node.tracker,
    workstreamDir,
    repoRoot,
    unavailableInputs,
    sourceReferences,
  });

  const sections = briefSections(briefSource.content);
  const contextContent = buildContextContent({
    workstream,
    node,
    layer0Selection,
    sections,
    trackerReference,
    unavailableInputs,
  });
  const metadata: LaunchContextMetadata = {
    contextId,
    launchNonce: options.launchNonce ?? null,
    launchClaimRef: null,
    projectKey,
    workstreamId: workstream.id,
    nodeId: node.id,
    targetRepoIds: [...node.repoIds],
    graphPath: normalizeManifestPath(graphPath),
    workstreamDir: normalizeManifestPath(workstreamDir),
    repoRoot: normalizeManifestPath(repoRoot),
    generatedAt,
    contextPackagePath: normalizeManifestPath(packagePath),
    contextFilePath: normalizeManifestPath(contextFilePath),
    sourceReferences,
    unavailableInputs,
  };

  await writePackageFiles({
    packagePath,
    contextContent,
  });

  return {
    contextId,
    contextPackagePath: normalizeManifestPath(packagePath),
    contextFilePath: normalizeManifestPath(contextFilePath),
    metadata,
    unavailableInputs,
  };
}

