#!/usr/bin/env node
// Run with: npx tsx scripts/compare-summarizers.ts
// Compares Copilot SDK models summarizing a handful of real sessions under
// ~/.copilot/session-state. Prints a side-by-side table of summary text,
// latency, and character counts per model.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  extractRecentUserTurns,
  getSharedCopilotClient,
  shutdownSharedCopilotClient,
  summarizeSession,
} from "../src/session-registry/session-summarizer";
import { parseWorkspaceYaml } from "../src/session-registry/copilot-session-discovery";

interface CandidateSession {
  id: string;
  directoryPath: string;
  eventsPath: string;
  eventsSize: number;
  mtimeMs: number;
  workspace: Record<string, string>;
}

const MODELS_TO_TEST = [
  process.env.COMPARE_MODEL_1 ?? "gpt-5.4-mini",
  process.env.COMPARE_MODEL_2 ?? "claude-haiku-4.5",
  process.env.COMPARE_MODEL_3 ?? "gpt-5-mini",
];

function resolveSessionRoot(): string {
  return (
    process.env.STREAMLINER_COPILOT_SESSION_STATE_ROOT ??
    resolve(homedir(), ".copilot", "session-state")
  );
}

function discoverCandidates(sessionRoot: string, limit: number): CandidateSession[] {
  if (!existsSync(sessionRoot)) return [];
  const entries = readdirSync(sessionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directoryPath = join(sessionRoot, entry.name);
      const eventsPath = join(directoryPath, "events.jsonl");
      const workspacePath = join(directoryPath, "workspace.yaml");
      if (!existsSync(eventsPath) || !existsSync(workspacePath)) return null;
      const eventsStat = statSync(eventsPath);
      if (eventsStat.size < 2_000) return null;
      const workspace = parseWorkspaceYaml(readFileSync(workspacePath, "utf8"));
      return {
        id: workspace.id?.trim() || entry.name,
        directoryPath,
        eventsPath,
        eventsSize: eventsStat.size,
        mtimeMs: eventsStat.mtimeMs,
        workspace,
      } satisfies CandidateSession;
    })
    .filter((entry): entry is CandidateSession => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return entries.slice(0, limit);
}

async function main(): Promise<void> {
  const limit = Number(process.env.COMPARE_LIMIT ?? 5);
  const sessionRoot = resolveSessionRoot();
  console.log(`[compare] Scanning ${sessionRoot}`);
  const candidates = discoverCandidates(sessionRoot, limit);
  if (candidates.length === 0) {
    console.error("No candidate sessions found.");
    process.exit(1);
  }
  console.log(`[compare] Selected ${candidates.length} session(s). Models: ${MODELS_TO_TEST.join(", ")}`);

  await getSharedCopilotClient();
  console.log("[compare] Copilot client started.");

  interface Row {
    sessionId: string;
    title: string;
    turnCount: number;
    totalTurnChars: number;
    results: Array<{
      model: string;
      summary: string;
      durationMs: number;
      chars: number;
      error?: string;
    }>;
  }

  const rows: Row[] = [];
  for (const candidate of candidates) {
    const turns = await extractRecentUserTurns(candidate.eventsPath, {
      maxTurns: 4,
      maxCharsPerTurn: 1500,
    });
    if (turns.length === 0) {
      console.log(`[compare] Skipping ${candidate.id} (no user turns).`);
      continue;
    }

    const title = candidate.workspace.summary?.trim() || candidate.workspace.repository?.trim() || candidate.id;
    const totalTurnChars = turns.reduce((sum, turn) => sum + turn.content.length, 0);
    const row: Row = {
      sessionId: candidate.id,
      title,
      turnCount: turns.length,
      totalTurnChars,
      results: [],
    };

    for (const model of MODELS_TO_TEST) {
      process.stdout.write(`[compare] ${candidate.id.slice(0, 8)} · ${model} ... `);
      const startedAt = performance.now();
      try {
        const result = await summarizeSession({
          turns,
          context: {
            title: candidate.workspace.summary ?? null,
            repo: candidate.workspace.repository ?? null,
            branch: candidate.workspace.branch ?? null,
            cwd: candidate.workspace.cwd ?? null,
          },
          model,
          timeoutMs: 90_000,
        });
        process.stdout.write(`${result.durationMs}ms\n`);
        row.results.push({
          model,
          summary: result.summary,
          durationMs: result.durationMs,
          chars: result.summary.length,
        });
      } catch (error) {
        const durationMs = Math.round(performance.now() - startedAt);
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(`ERROR (${durationMs}ms): ${message}\n`);
        row.results.push({
          model,
          summary: "",
          durationMs,
          chars: 0,
          error: message,
        });
      }
    }
    rows.push(row);
  }

  console.log("\n=== Per-session results ===");
  for (const row of rows) {
    console.log(`\n[${row.sessionId.slice(0, 8)}] workspace summary: ${JSON.stringify(row.title)}`);
    console.log(`  ${row.turnCount} user turns, ${row.totalTurnChars} chars of context`);
    for (const result of row.results) {
      const label = result.error ? `ERROR: ${result.error}` : JSON.stringify(result.summary);
      console.log(`  - ${result.model.padEnd(22)} ${String(result.durationMs).padStart(6)}ms  ${label}`);
    }
  }

  console.log("\n=== Model averages ===");
  const perModel = new Map<string, { totalMs: number; totalChars: number; successes: number; errors: number }>();
  for (const row of rows) {
    for (const result of row.results) {
      const stats = perModel.get(result.model) ?? { totalMs: 0, totalChars: 0, successes: 0, errors: 0 };
      stats.totalMs += result.durationMs;
      stats.totalChars += result.chars;
      if (result.error) {
        stats.errors += 1;
      } else {
        stats.successes += 1;
      }
      perModel.set(result.model, stats);
    }
  }
  for (const [model, stats] of perModel.entries()) {
    const attempts = stats.successes + stats.errors;
    const avgMs = attempts > 0 ? Math.round(stats.totalMs / attempts) : 0;
    const avgChars = stats.successes > 0 ? Math.round(stats.totalChars / stats.successes) : 0;
    console.log(
      `  ${model.padEnd(22)} avg ${String(avgMs).padStart(5)}ms  avg ${String(avgChars).padStart(3)} chars  ${stats.successes}/${attempts} ok`,
    );
  }

  await shutdownSharedCopilotClient();
}

main().catch(async (err) => {
  console.error("[compare] Fatal error:", err);
  await shutdownSharedCopilotClient();
  process.exit(1);
});
