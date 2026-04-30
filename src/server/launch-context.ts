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

export const LAUNCH_CONTEXT_MANIFEST_SCHEMA_VERSION = 1 as const;
export const LAUNCH_CONTEXT_GENERATOR_VERSION = 1 as const;

const LAYER_FILE_NAMES = {
  "layer-0-design": "layer-0-design.md",
  "layer-1-intent": "layer-1-intent.md",
  "layer-2-state": "layer-2-state.md",
  "layer-3-node": "layer-3-node.md",
} as const;

type LaunchContextLayerId = keyof typeof LAYER_FILE_NAMES;

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

export interface LaunchContextLayerFile {
  id: LaunchContextLayerId;
  path: string;
  relativePath: string;
  sources: LaunchContextSourceReference[];
}

export interface LaunchContextLayer0Selection {
  repoId: string;
  path: string;
  rationale: string;
  included: boolean;
}

export interface LaunchContextManifest {
  schemaVersion: typeof LAUNCH_CONTEXT_MANIFEST_SCHEMA_VERSION;
  generatorVersion: typeof LAUNCH_CONTEXT_GENERATOR_VERSION;
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
  manifestPath: string;
  layers: LaunchContextLayerFile[];
  sourceReferences: LaunchContextSourceReference[];
  layer0Selection: LaunchContextLayer0Selection[];
  unavailableInputs: LaunchContextUnavailableInput[];
}

export interface LaunchContextPackage {
  contextId: string;
  contextPackagePath: string;
  manifestPath: string;
  manifest: LaunchContextManifest;
  unavailableInputs: LaunchContextUnavailableInput[];
}

export interface GithubIssueTrackerRequest {
  owner: string;
  repo: string;
  number: number;
}

export interface TrackerResolution {
  content?: string;
  unavailableInputs?: LaunchContextUnavailableInput[];
}

export type LaunchContextTrackerResolver = (
  request: GithubIssueTrackerRequest,
) => Promise<TrackerResolution>;

export interface PrepareLaunchContextPackageOptions {
  graphPath?: string;
  defaultGraphPath?: string;
  nodeId: string;
  outputDir?: string;
  launchNonce?: string | null;
  stateRoot?: string;
  now?: () => Date;
  createContextId?: (now: Date) => string;
  trackerResolver?: LaunchContextTrackerResolver;
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
  return absPath;
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

function inferRepoRoot(graphPath: string): string {
  let current = dirname(graphPath);
  while (dirname(current) !== current) {
    if (basename(current) === ".streamliner") {
      return dirname(current);
    }
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    current = dirname(current);
  }
  return dirname(graphPath);
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
  const blocks = titles.map((title) => {
    const content = sections.get(title);
    return `## ${title}\n\n${content?.trim() || "_Not present._"}`;
  });
  return blocks.length > 0 ? blocks.join("\n\n") : fallback;
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

function parseBriefDesignReferencePaths(briefContent: string | undefined): string[] {
  if (!briefContent) {
    return [];
  }
  const designRefs = new Set<string>();
  const pattern = /(?:streamliner:)?(docs\/design\/[A-Za-z0-9._/-]+\.md)/g;
  for (const match of briefContent.matchAll(pattern)) {
    if (match[1]) {
      designRefs.add(normalizeManifestPath(match[1]));
    }
  }
  return [...designRefs];
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
  for (const path of parseBriefDesignReferencePaths(briefContent)) {
    add(primaryRepoId, path, "brief Design References section");
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

function generationHeader(options: {
  contextId: string;
  launchNonce: string | null;
  workstreamId: string;
  nodeId: string;
  generatedAt: string;
  briefFreshness?: LaunchContextSourceFreshness;
}): string {
  const briefFreshness = options.briefFreshness
    ? `${options.briefFreshness.kind}:${options.briefFreshness.value}`
    : "unavailable";
  return [
    "<!--",
    "Generated by Streamliner launch context assembly.",
    `Context ID: ${options.contextId}`,
    `Launch nonce: ${options.launchNonce ?? "<preview>"}`,
    `Workstream: ${options.workstreamId}`,
    `Node: ${options.nodeId}`,
    `Brief freshness: ${briefFreshness}`,
    `Generated at: ${options.generatedAt}`,
    "Do not edit - regenerated for each launch context preparation.",
    "-->",
    "",
  ].join("\n");
}

function fenceSource(path: string, content: string): string {
  return [
    `## ${path}`,
    "",
    `--- BEGIN ${path} ---`,
    content.trimEnd(),
    `--- END ${path} ---`,
  ].join("\n");
}

function buildLayer0Content(
  header: string,
  loadedDesignSources: LoadedSource[],
  selection: LaunchContextLayer0Selection[],
): string {
  const selected = selection
    .map((entry) =>
      `- ${entry.included ? "included" : "unavailable"}: ${entry.path} (${entry.rationale})`,
    )
    .join("\n");
  const docs = loadedDesignSources
    .filter((source) => source.content)
    .map((source) => fenceSource(source.reference.path ?? "design", source.content ?? ""))
    .join("\n\n");

  return `${header}# Layer 0 - Project Design Context\n\n## Layer 0 Selection\n\n${selected || "_No design references selected._"}\n\n${docs || "_No design content available._"}\n`;
}

function buildLayer3Content(options: {
  header: string;
  workstream: WorkstreamDocument;
  node: WorkstreamNode;
  trackerContent: string | null;
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
    `${options.header}# Layer 3 - Node Context`,
    "",
    "## Selected Node",
    "",
    nodeSummary(options.node),
    "",
    "## Checkpoint / Wave Context",
    "",
    checkpoint
      ? `- ${checkpoint.id}: ${checkpoint.title} [${checkpoint.status}]\n  ${checkpoint.summary}`
      : "_Selected node is not listed in a checkpoint._",
    "",
    "## Upstream Nodes",
    "",
    upstream.length > 0 ? upstream.map(nodeSummary).join("\n") : "_No upstream dependency nodes._",
    "",
    "## Same-Checkpoint Sibling Nodes",
    "",
    siblings.length > 0 ? siblings.map(nodeSummary).join("\n") : "_No same-checkpoint sibling nodes._",
    "",
    "## Downstream Nodes",
    "",
    downstream.length > 0 ? downstream.map(nodeSummary).join("\n") : "_No downstream dependent nodes._",
    "",
    "## Selected Node Tracker Context",
    "",
    options.trackerContent ?? "_No tracker content available._",
    "",
  ].join("\n");
}

async function defaultGithubIssueTrackerResolver(
  request: GithubIssueTrackerRequest,
): Promise<TrackerResolution> {
  const repo = `${request.owner}/${request.repo}`;
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "issue",
        "view",
        String(request.number),
        "--repo",
        repo,
        "--json",
        "title,body,url,state",
      ],
      { timeout: 10_000 },
    );
    const parsed = JSON.parse(stdout) as {
      title?: unknown;
      body?: unknown;
      url?: unknown;
      state?: unknown;
    };
    const title = typeof parsed.title === "string" ? parsed.title : `Issue #${request.number}`;
    const state = typeof parsed.state === "string" ? parsed.state : "unknown";
    const url = typeof parsed.url === "string" ? parsed.url : `https://github.com/${repo}/issues/${request.number}`;
    const body = typeof parsed.body === "string" ? parsed.body : "";
    return {
      content: [`# ${title}`, "", `State: ${state}`, `URL: ${url}`, "", body].join("\n"),
    };
  } catch (error: unknown) {
    return {
      unavailableInputs: [
        {
          kind: "tracker",
          source: `https://github.com/${repo}/issues/${request.number}`,
          reason: "github_issue_unavailable",
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

async function resolveTrackerContent(options: {
  tracker: WorkstreamTracker | undefined;
  workstreamDir: string;
  repoRoot: string;
  unavailableInputs: LaunchContextUnavailableInput[];
  sourceReferences: LaunchContextSourceReference[];
  trackerResolver: LaunchContextTrackerResolver;
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
    const resolution = await options.trackerResolver({
      owner: options.tracker.owner,
      repo: options.tracker.repo,
      number: options.tracker.number,
    });
    for (const unavailable of resolution.unavailableInputs ?? []) {
      options.unavailableInputs.push(unavailable);
    }
    return resolution.content ?? null;
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
  return source.content ?? null;
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
    return resolve(options.outputDir);
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
      400,
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
  contextId: string;
  manifest: LaunchContextManifest;
  layerContents: Record<LaunchContextLayerId, string>;
}): Promise<void> {
  await ensurePathDoesNotExist(options.packagePath);
  const parent = dirname(options.packagePath);
  await mkdir(parent, { recursive: true });
  const tempPath = join(parent, `.${basename(options.packagePath)}.tmp-${process.pid}-${randomUUID()}`);

  try {
    const contextDir = join(tempPath, "context");
    await mkdir(contextDir, { recursive: true });
    for (const [layerId, fileName] of Object.entries(LAYER_FILE_NAMES) as Array<[LaunchContextLayerId, string]>) {
      await writeFile(join(contextDir, fileName), options.layerContents[layerId], "utf8");
    }
    await writeFile(
      join(tempPath, "manifest.json"),
      `${JSON.stringify(options.manifest, null, 2)}\n`,
      "utf8",
    );
    await rename(tempPath, options.packagePath);
  } catch (error: unknown) {
    await rm(tempPath, { recursive: true, force: true });
    if (error instanceof LaunchContextPreparationError) {
      throw error;
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

  const repoRoot = inferRepoRoot(graphPath);
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
  const manifestPath = join(packagePath, "manifest.json");
  const contextDir = join(packagePath, "context");
  const unavailableInputs: LaunchContextUnavailableInput[] = [];
  const sourceReferences: LaunchContextSourceReference[] = [];

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
  const loadedDesignSources: LoadedSource[] = [];
  const layer0Selection: LaunchContextLayer0Selection[] = [];
  for (const designReference of designReferences) {
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
    loadedDesignSources.push(source);
    layer0Selection.push({
      repoId: designReference.repoId,
      path: designReference.path,
      rationale: designReference.rationale,
      included: source.content !== undefined,
    });
  }

  const trackerContent = await resolveTrackerContent({
    tracker: node.tracker,
    workstreamDir,
    repoRoot,
    unavailableInputs,
    sourceReferences,
    trackerResolver: options.trackerResolver ?? defaultGithubIssueTrackerResolver,
  });

  const sections = briefSections(briefSource.content);
  const header = generationHeader({
    contextId,
    launchNonce: options.launchNonce ?? null,
    workstreamId: workstream.id,
    nodeId: node.id,
    generatedAt,
    briefFreshness: briefSource.reference.freshness,
  });
  const layerContents: Record<LaunchContextLayerId, string> = {
    "layer-0-design": buildLayer0Content(header, loadedDesignSources, layer0Selection),
    "layer-1-intent": `${header}# Layer 1 - Workstream Intent\n\n${sections.layer1}\n`,
    "layer-2-state": `${header}# Layer 2 - Operational State\n\n${sections.layer2}\n`,
    "layer-3-node": buildLayer3Content({
      header,
      workstream,
      node,
      trackerContent,
    }),
  };
  const layerSources: Record<LaunchContextLayerId, LaunchContextSourceReference[]> = {
    "layer-0-design": loadedDesignSources.map((source) => source.reference),
    "layer-1-intent": [briefSource.reference],
    "layer-2-state": [briefSource.reference],
    "layer-3-node": [
      graphReference,
      ...sourceReferences.filter((source) =>
        source.kind === "tracker" || source.kind === "local-tracker"
      ),
    ],
  };
  const layers = (Object.entries(LAYER_FILE_NAMES) as Array<[LaunchContextLayerId, string]>).map(
    ([id, fileName]) => ({
      id,
      path: join(contextDir, fileName),
      relativePath: normalizeManifestPath(join("context", fileName)),
      sources: layerSources[id],
    }),
  );
  const manifest: LaunchContextManifest = {
    schemaVersion: LAUNCH_CONTEXT_MANIFEST_SCHEMA_VERSION,
    generatorVersion: LAUNCH_CONTEXT_GENERATOR_VERSION,
    contextId,
    launchNonce: options.launchNonce ?? null,
    launchClaimRef: null,
    projectKey,
    workstreamId: workstream.id,
    nodeId: node.id,
    targetRepoIds: [...node.repoIds],
    graphPath,
    workstreamDir,
    repoRoot,
    generatedAt,
    contextPackagePath: packagePath,
    manifestPath,
    layers,
    sourceReferences,
    layer0Selection,
    unavailableInputs,
  };

  await writePackageFiles({
    packagePath,
    contextId,
    manifest,
    layerContents,
  });

  return {
    contextId,
    contextPackagePath: packagePath,
    manifestPath,
    manifest,
    unavailableInputs,
  };
}

