import {
  CopilotClient as LegacyClient,
  approveAll as legacyApproveAll,
  defineTool as legacyDefineTool,
  type CopilotSession as LegacySession,
  type SessionConfig as LegacySessionConfig,
  type SessionEvent as LegacySessionEvent,
} from "@github/copilot-sdk";
import {
  CopilotClient,
  RuntimeConnection,
  approveAll,
  defineTool,
  type SessionConfig,
  type SessionEvent,
} from "@github/copilot-sdk-preparation";

import { type PreparationProfile, validatePreparationCli, validatePreparationProfile } from "./launch-preparation-profile";

export type PreparationEvent = LegacySessionEvent | SessionEvent;

export interface PreparationSession extends Pick<LegacySession,
  "sessionId" | "workspacePath" | "disconnect"> {
  send(message: { prompt: string }): Promise<string>;
  sendAndWait(message: { prompt: string }, timeoutMs?: number): Promise<{ data: { content: string } } | undefined>;
  on(handler: (event: PreparationEvent) => void): () => void;
}

export function definePreparationTool<T>(name: string, config: {
  description: string;
  parameters: Record<string, unknown>;
  skipPermission: boolean;
  handler: (args: T) => Promise<unknown>;
}) {
  return {
    legacy: legacyDefineTool<T>(name, config),
    current: defineTool<T>(name, config),
  };
}

type PreparationSessionConfig = Pick<LegacySessionConfig,
  "clientName" | "workingDirectory" | "configDir" | "enableConfigDiscovery" |
  "streaming" | "skillDirectories" | "agent" | "systemMessage"> & {
  tools: Array<{
    legacy: NonNullable<LegacySessionConfig["tools"]>[number];
    current: NonNullable<SessionConfig["tools"]>[number];
  }>;
  customAgents?: Array<Pick<NonNullable<SessionConfig["customAgents"]>[number],
    "name" | "displayName" | "description" | "tools" | "skills" | "prompt">>;
  onEvent?: (event: PreparationEvent) => void;
};

// Only an explicit, validated preparation CLI opts into the newer SDK.
// In particular, ordinary preparation must keep the legacy bundled CLI resolution.
export async function createPreparationClient(profile: PreparationProfile, cwd: string) {
  await validatePreparationCli(profile);
  if (profile.cliPath !== undefined) {
    const client = new CopilotClient({
      connection: RuntimeConnection.forStdio({ path: profile.cliPath }),
      workingDirectory: cwd,
      logLevel: "error",
    });
    const sessionConfig = ({ tools, configDir, ...config }: PreparationSessionConfig): SessionConfig => ({
      ...config,
      ...profile.session,
      configDirectory: configDir,
      tools: tools.map((tool) => tool.current),
      onPermissionRequest: approveAll,
    });
    return {
      start: () => client.start(),
      stop: () => client.stop(),
      async createSession(config: PreparationSessionConfig): Promise<PreparationSession> {
        await validatePreparationProfile(client, profile);
        return client.createSession(sessionConfig(config));
      },
      async resumeSession(sessionId: string, config: PreparationSessionConfig): Promise<PreparationSession> {
        await validatePreparationProfile(client, profile);
        return client.resumeSession(sessionId, sessionConfig(config));
      },
    };
  }

  const client = new LegacyClient({ cwd, logLevel: "error" });
  const sessionConfig = ({ tools, ...config }: PreparationSessionConfig): LegacySessionConfig => ({
    ...config,
    model: profile.session.model,
    ...(profile.session.reasoningEffort !== undefined ? { reasoningEffort: profile.session.reasoningEffort } : {}),
    tools: tools.map((tool) => tool.legacy),
    onPermissionRequest: legacyApproveAll,
  });
  return {
    start: () => client.start(),
    stop: () => client.stop(),
    async createSession(config: PreparationSessionConfig): Promise<PreparationSession> {
      await validatePreparationProfile(client, profile);
      return client.createSession(sessionConfig(config));
    },
    async resumeSession(sessionId: string, config: PreparationSessionConfig): Promise<PreparationSession> {
      await validatePreparationProfile(client, profile);
      return client.resumeSession(sessionId, sessionConfig(config));
    },
  };
}
