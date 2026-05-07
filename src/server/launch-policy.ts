import { readFileSync } from "node:fs";

import {
  evaluateNodeLaunchPolicy,
  launchPolicyViolationDetails,
  type WorkstreamLaunchPolicyViolation,
} from "../workstream-launch-policy";
import type {
  WorkstreamDocument,
  WorkstreamLaunchDefaults,
  WorkstreamLaunchPolicy,
} from "../workstream-schema";
import { parseWorkstreamDocument } from "../workstream-view-model";

export type LaunchPolicyGraphErrorCode =
  | "graph_not_configured"
  | "graph_not_found"
  | "invalid_graph"
  | "unknown_node";

export type LaunchPolicyEvaluationResult =
  | {
      ok: true;
      launchPolicy: WorkstreamLaunchPolicy | null;
      launchDefaults: WorkstreamLaunchDefaults | null;
    }
  | { ok: false; kind: "blocked"; violation: WorkstreamLaunchPolicyViolation }
  | {
      ok: false;
      kind: "graph-error";
      code: LaunchPolicyGraphErrorCode;
      statusCode: number;
      message: string;
      input: string;
    };

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === code;
}

export function evaluateLaunchPolicyFromGraph(input: {
  graphPath?: string;
  defaultGraphPath?: string;
  nodeId: string;
}): LaunchPolicyEvaluationResult {
  const graphPath = input.graphPath ?? input.defaultGraphPath;
  if (!graphPath) {
    return {
      ok: false,
      kind: "graph-error",
      code: "graph_not_configured",
      statusCode: 400,
      message: "A graph path is required to evaluate launch policy.",
      input: "graphPath",
    };
  }

  let rawGraph: string;
  try {
    rawGraph = readFileSync(graphPath, "utf8");
  } catch (error: unknown) {
    if (isErrno(error, "ENOENT")) {
      return {
        ok: false,
        kind: "graph-error",
        code: "graph_not_found",
        statusCode: 404,
        message: `Graph file not found: ${graphPath}`,
        input: "graphPath",
      };
    }
    throw error;
  }

  let workstream: WorkstreamDocument;
  try {
    workstream = parseWorkstreamDocument(rawGraph);
  } catch (error: unknown) {
    return {
      ok: false,
      kind: "graph-error",
      code: "invalid_graph",
      statusCode: 400,
      message: error instanceof Error ? error.message : String(error),
      input: "graphPath",
    };
  }

  const node = workstream.nodes.find((candidate) => candidate.id === input.nodeId);
  if (!node) {
    return {
      ok: false,
      kind: "graph-error",
      code: "unknown_node",
      statusCode: 404,
      message: `Unknown node: ${input.nodeId}`,
      input: "nodeId",
    };
  }

  const decision = evaluateNodeLaunchPolicy(workstream, node);
  return decision.allowed
    ? {
        ok: true,
        launchPolicy: workstream.launchPolicy ?? null,
        launchDefaults: workstream.launchDefaults ?? null,
      }
    : { ok: false, kind: "blocked", violation: decision.violation };
}

export function launchPolicyDetails(
  violation: WorkstreamLaunchPolicyViolation,
): Record<string, unknown> {
  return launchPolicyViolationDetails(violation);
}
