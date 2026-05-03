export const DEFAULT_REVIEW_MODELS = "gpt-5.5, claude-opus-4.7, claude-opus-4.6-1m";

export type WorkflowMode = "full" | "minimal" | "custom";
export type ReviewStrategy = "local" | "prs";
export type ReviewPolicy = "every-stage" | "milestones" | "planning-only" | "final-pr-only";
export type SessionPolicy = "continuous" | "pause-after-stage";
export type Enablement = "enabled" | "disabled";
export type ReviewMode = "single-model" | "multi-model" | "society-of-thought";
export type ModelReviewMode = "single-model" | "multi-model";
export type ReviewInteractive = "true" | "false" | "smart";
export type ReviewInteractionMode = "parallel" | "debate";
export type WorkflowIdentity = "paw" | "paw-lite";
export type ArtifactLifecycle = "commit-and-clean" | "commit-and-persist" | "never-commit";
export type TerminalLaunchMode = "manual";
export type PreferredTerminal = "default" | "windows-terminal" | "powershell";

export interface PawLaunchWorkflowConfiguration {
  workflowIdentity: WorkflowIdentity;
  workflowMode: WorkflowMode;
  reviewStrategy: ReviewStrategy;
  reviewPolicy: ReviewPolicy;
  sessionPolicy: SessionPolicy;
  planningDocsReview: Enablement;
  finalAgentReview: Enablement;
  finalReviewMode: ReviewMode;
  finalReviewInteractive: ReviewInteractive;
  finalReviewModels: string;
  finalReviewSpecialists: string;
  finalReviewInteractionMode: ReviewInteractionMode;
  finalReviewSpecialistModels: string;
  finalReviewPerspectives: string;
  finalReviewPerspectiveCap: number;
  implementationModel: string;
  planGenerationMode: ModelReviewMode;
  planGenerationModels: string;
  planningReviewMode: ReviewMode;
  planningReviewInteractive: ReviewInteractive;
  planningReviewModels: string;
  planningReviewSpecialists: string;
  planningReviewInteractionMode: ReviewInteractionMode;
  planningReviewSpecialistModels: string;
  planningReviewPerspectives: string;
  planningReviewPerspectiveCap: number;
  customWorkflowInstructions: string;
  initialPrompt: string;
  remote: string;
  artifactLifecycle: ArtifactLifecycle;
  artifactPaths: string;
}

export interface PawLaunchTerminalConfiguration {
  launchMode: TerminalLaunchMode;
  preferredTerminal: PreferredTerminal;
}

export const DEFAULT_PAW_WORKFLOW_CONFIGURATION: PawLaunchWorkflowConfiguration = {
  workflowIdentity: "paw",
  workflowMode: "full",
  reviewStrategy: "local",
  reviewPolicy: "final-pr-only",
  sessionPolicy: "continuous",
  planningDocsReview: "enabled",
  finalAgentReview: "disabled",
  finalReviewMode: "multi-model",
  finalReviewInteractive: "smart",
  finalReviewModels: DEFAULT_REVIEW_MODELS,
  finalReviewSpecialists: "all",
  finalReviewInteractionMode: "parallel",
  finalReviewSpecialistModels: "none",
  finalReviewPerspectives: "auto",
  finalReviewPerspectiveCap: 2,
  implementationModel: "none",
  planGenerationMode: "multi-model",
  planGenerationModels: DEFAULT_REVIEW_MODELS,
  planningReviewMode: "multi-model",
  planningReviewInteractive: "smart",
  planningReviewModels: DEFAULT_REVIEW_MODELS,
  planningReviewSpecialists: "all",
  planningReviewInteractionMode: "parallel",
  planningReviewSpecialistModels: "none",
  planningReviewPerspectives: "auto",
  planningReviewPerspectiveCap: 2,
  customWorkflowInstructions:
    "final-pr-review-only; continue through implementation and documentation without intermediate local review pauses, and create the final PR unless a serious blocker is encountered.",
  initialPrompt: "streamliner-launch-kickoff",
  remote: "origin",
  artifactLifecycle: "commit-and-clean",
  artifactPaths: "auto-derived",
};

export const DEFAULT_PAW_TERMINAL_CONFIGURATION: PawLaunchTerminalConfiguration = {
  launchMode: "manual",
  preferredTerminal: "default",
};

export interface PawLaunchDialogDefaults {
  workTitle: string;
  workId: string;
  baseBranch: string;
  targetBranch: string;
  cliArgsText: string;
  graphPath: string;
  terminalPreference: string;
  paw: PawLaunchWorkflowConfiguration;
  terminal: PawLaunchTerminalConfiguration;
}

export interface PawLaunchDialogConfiguration {
  workTitle: string;
  workId: string;
  baseBranch: string;
  targetBranch: string;
  cliArgs: string[];
  customMessage: string | null;
  paw: PawLaunchWorkflowConfiguration;
  terminal: PawLaunchTerminalConfiguration;
}
