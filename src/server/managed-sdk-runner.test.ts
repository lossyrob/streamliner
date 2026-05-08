import { setImmediate as waitForImmediate } from "node:timers/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SessionRegistryManagedLifecycleState,
} from "../session-registry-schema";
import type {
  SessionRegistryRuntimeEvidenceInput,
  SessionRegistryRuntimeProgressEventInput,
} from "../session-registry-contract";
import { mergeSessionRegistryRuntimeMetadata } from "../session-registry/managed-runtime";
import {
  DefaultManagedSdkRunner,
  type ManagedSdkRunnerStartInput,
  type ManagedSdkRunnerStartResult,
} from "./managed-sdk-runner";

const sdkMock = vi.hoisted(() => {
  const createdOptions: unknown[] = [];
  const sessionConfigs: unknown[] = [];
  const session = {
    sessionId: "sdk-test-session",
    workspacePath: undefined as string | undefined,
    abort: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    sendAndWait: vi.fn(async () => ({ data: { content: "Managed turn finished." } })),
  };

  class MockCopilotClient {
    readonly options: unknown;

    constructor(options: unknown) {
      this.options = options;
      createdOptions.push(options);
    }

    start = vi.fn(async () => {});
    stop = vi.fn(async () => []);
    createSession = vi.fn(async (config: unknown) => {
      sessionConfigs.push(config);
      return session;
    });
  }

  return {
    approveAll: vi.fn(() => ({ kind: "allow" })),
    CopilotClient: MockCopilotClient,
    createdOptions,
    session,
    sessionConfigs,
  };
});

vi.mock("@github/copilot-sdk", () => ({
  approveAll: sdkMock.approveAll,
  CopilotClient: sdkMock.CopilotClient,
}));

interface RuntimeCapture {
  evidence: SessionRegistryRuntimeEvidenceInput[];
  progress: SessionRegistryRuntimeProgressEventInput[];
  started: ManagedSdkRunnerStartResult[];
  states: SessionRegistryManagedLifecycleState[];
}

function createCapture(): RuntimeCapture {
  return {
    evidence: [],
    progress: [],
    started: [],
    states: [],
  };
}

function createStartInput(
  capture: RuntimeCapture,
  overrides: Partial<ManagedSdkRunnerStartInput> = {},
): ManagedSdkRunnerStartInput {
  return {
    registryId: "registry-row-1",
    launchClaimId: "claim-1",
    launchNonce: "nonce-1",
    cwd: "C:\\repo",
    branch: "feature/managed",
    prompt: "Run the managed node.",
    cliArgs: ["--yolo"],
    environment: {},
    sessionStateRoot: "C:\\state",
    onLifecycleState: (state) => {
      capture.states.push(state);
    },
    onProgress: (event) => {
      capture.progress.push(event);
    },
    onEvidence: (evidence) => {
      capture.evidence.push(evidence);
    },
    onStarted: (details) => {
      capture.started.push(details);
    },
    ...overrides,
  };
}

async function flushManagedTurn(): Promise<void> {
  await waitForImmediate();
  await Promise.resolve();
}

describe("DefaultManagedSdkRunner", () => {
  beforeEach(() => {
    sdkMock.createdOptions.length = 0;
    sdkMock.sessionConfigs.length = 0;
    vi.clearAllMocks();
    sdkMock.session.workspacePath = undefined;
    sdkMock.session.abort.mockResolvedValue(undefined);
    sdkMock.session.disconnect.mockResolvedValue(undefined);
    sdkMock.session.sendAndWait.mockResolvedValue({ data: { content: "Managed turn finished." } });
    sdkMock.approveAll.mockReturnValue({ kind: "allow" });
  });

  it("passes launch environment through SDK client options without mutating process.env", async () => {
    const capture = createCapture();
    const envKey = "STREAMLINER_TEST_MANAGED_ENV";
    const previousValue = process.env[envKey];
    delete process.env[envKey];

    try {
      const runner = new DefaultManagedSdkRunner();
      await runner.start(createStartInput(capture, {
        cliArgs: ["--yolo", "--model", "test-model"],
        environment: { [envKey]: "claim-scoped-value" },
      }));
      await flushManagedTurn();

      const options = sdkMock.createdOptions[0] as {
        cliArgs?: string[];
        env?: Record<string, string | undefined>;
      };
      expect(options.cliArgs).toEqual(["--yolo", "--model", "test-model"]);
      expect(options.env?.[envKey]).toBe("claim-scoped-value");
      expect(process.env[envKey]).toBeUndefined();
    } finally {
      if (previousValue === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = previousValue;
      }
    }
  });

  it("auto-answers user-input requests without marking the session waiting for builder input", async () => {
    const capture = createCapture();
    const runner = new DefaultManagedSdkRunner();
    await runner.start(createStartInput(capture));
    await flushManagedTurn();

    const config = sdkMock.sessionConfigs[0] as {
      onUserInputRequest?: (request: { question: string; choices?: string[] }) => unknown;
    };
    const response = config.onUserInputRequest?.({
      question: "Continue?",
      choices: ["Continue autonomously"],
    });

    expect(response).toEqual({
      answer: "Continue autonomously",
      wasFreeform: false,
    });
    expect(capture.states).not.toContain("waiting_for_builder");
    expect(capture.progress).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "assistant_status",
        message: expect.stringContaining("auto-answering autonomously"),
      }),
    ]));
  });

  it("does not create review-ready or completion evidence from ordinary assistant prose", async () => {
    const capture = createCapture();
    sdkMock.session.sendAndWait.mockResolvedValueOnce({
      data: { content: "The implementation is done and ready for review." },
    });

    const runner = new DefaultManagedSdkRunner();
    await runner.start(createStartInput(capture));
    await flushManagedTurn();

    expect(capture.evidence).toEqual([]);
    expect(capture.states).not.toContain("review_ready");
  });

  it("detects supported PR URL formats as PR-ready evidence", async () => {
    const capture = createCapture();
    sdkMock.session.sendAndWait.mockResolvedValueOnce({
      data: {
        content: "Created [the PR](https://github.example.com/lossyrob/streamliner/pull-requests/987).",
      },
    });

    const runner = new DefaultManagedSdkRunner();
    await runner.start(createStartInput(capture));
    await flushManagedTurn();

    expect(capture.evidence).toEqual([
      expect.objectContaining({
        kind: "pr_ready",
        repo: "lossyrob/streamliner",
        number: 987,
        url: "https://github.example.com/lossyrob/streamliner/pull-requests/987",
      }),
    ]);
    expect(capture.states).toContain("pr_ready");
  });

  it("ignores PR URLs with unsafe integer pull request numbers", async () => {
    const capture = createCapture();
    sdkMock.session.sendAndWait.mockResolvedValueOnce({
      data: {
        content: "Created https://github.com/lossyrob/streamliner/pull/9007199254740993",
      },
    });

    const runner = new DefaultManagedSdkRunner();
    await runner.start(createStartInput(capture));
    await flushManagedTurn();

    expect(capture.evidence).toEqual([]);
    expect(capture.states).not.toContain("pr_ready");
  });

  it("emits assistant and usage summary telemetry that survives runtime sanitization", async () => {
    const capture = createCapture();
    const runner = new DefaultManagedSdkRunner();
    await runner.start(createStartInput(capture));
    await flushManagedTurn();

    const config = sdkMock.sessionConfigs[0] as {
      onEvent?: (event: { type: string; data?: Record<string, unknown> }) => unknown;
    };
    config.onEvent?.({
      type: "assistant.message",
      data: { content: "raw assistant text that must not persist" },
    });
    config.onEvent?.({
      type: "session.usage_info",
      data: { inputTokens: 12, outputTokens: 34 },
    });

    const runtime = mergeSessionRegistryRuntimeMetadata(
      null,
      {
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
        progressEvents: capture.progress.slice(-2),
      },
      new Date("2026-05-07T12:00:00.000Z"),
    );

    expect(runtime.progressEvents).toEqual([
      expect.objectContaining({
        type: "assistant_status",
        data: { contentLength: 40 },
      }),
      expect.objectContaining({
        type: "usage",
        data: { inputTokens: 12, outputTokens: 34 },
      }),
    ]);
  });
});
