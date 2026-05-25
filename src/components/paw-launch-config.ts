import type { WorkstreamRuntimeKind } from "../managed-runtime-contract";

export const DEFAULT_PAW_WORKFLOW_INSTRUCTIONS = [
  "Use PAW with a local final-pr-only review policy.",
  "Do not pause for intermediate review unless there is a serious blocker, unsafe ambiguity, missing credentials/infrastructure, or material scope mismatch.",
  "Use GPT 5.5, Claude Opus 4.7, and Claude Opus 4.6 1M for multi-model planning or review choices where PAW asks for concrete models.",
  "Proceed through implementation and documentation, then create the final PR.",
].join("\n");

export type TerminalLaunchMode = "manual";
export type PreferredTerminal = "default" | "windows-terminal" | "powershell";

export interface PawLaunchTerminalConfiguration {
  launchMode: TerminalLaunchMode;
  preferredTerminal: PreferredTerminal;
  title: string;
  tabColor: string | null;
}

export const DEFAULT_PAW_TERMINAL_CONFIGURATION: PawLaunchTerminalConfiguration = {
  launchMode: "manual",
  preferredTerminal: "default",
  title: "",
  tabColor: null,
};

export interface PawLaunchDialogDefaults {
  runtimeKind?: WorkstreamRuntimeKind;
  workflowInstructions: string;
  cliArgsText: string;
  cwd: string;
  inferredCwd: string;
  cwdPreferenceKey: string | null;
  graphPath: string;
  terminalPreference: string;
  githubIssueNumber?: number | null;
  githubIssueRepo?: string | null;
  githubIssueLabel?: string | null;
  githubIssueUrl?: string | null;
  terminal: PawLaunchTerminalConfiguration;
}

export interface PawLaunchDialogConfiguration {
  runtimeKind: WorkstreamRuntimeKind;
  cwd: string;
  workflowInstructions: string;
  cliArgs: string[];
  terminal: PawLaunchTerminalConfiguration;
  launchAfterInit: boolean;
  reviewCompanion: {
    kickoffPrompt: string;
    usePawReviewAgent: boolean;
  } | null;
}
