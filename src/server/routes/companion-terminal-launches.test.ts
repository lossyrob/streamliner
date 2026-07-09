import express, { type NextFunction, type Request, type Response } from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCompanionTerminalLaunchesRouter,
  launchCompanionTerminal,
} from "./companion-terminal-launches";
import { LaunchClaimFileStore } from "../../session-registry/launch-claim-store";
import { SessionRegistryFileStore } from "../../session-registry/file-store";
import type { TerminalLaunchOptions, TerminalLaunchResult } from "../terminal-launch";

type TerminalLaunchMethodForTest = TerminalLaunchResult["method"];

function terminalResult(
  method: TerminalLaunchMethodForTest,
  pid: number,
): TerminalLaunchResult {
  return { method, pid };
}

function createApp() {
  const launchTerminal = vi.fn((options: TerminalLaunchOptions) => {
    void options;
    return {
      method: "windows-terminal" as const,
      pid: 1234,
    };
  });
  const app = express();
  app.use(express.json());
  app.use("/api", createCompanionTerminalLaunchesRouter({ launchTerminal }));
  app.use((
    error: Error & { statusCode?: number },
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    void _next;
    res.status(error.statusCode ?? 500).json({ error: error.message });
  });
  return { app, launchTerminal };
}

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-companion-launch-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("companion terminal launches route", () => {
  it("launches a Copilot terminal with the supplied prompt and terminal metadata, prepending --agent=PAW-Review", async () => {
    const { app, launchTerminal } = createApp();

    const response = await request(app)
      .post("/api/companion-terminal-launches")
      .send({
        cwd: "C:\\repo",
        kickoffPrompt: "Review issue 413",
        cliArgs: ["--yolo"],
        preferredTerminal: "windows-terminal",
        title: "Node REVIEW",
        tabColor: "#336699",
      })
      .expect(201);

    expect(response.body.terminal).toEqual({ method: "windows-terminal", pid: 1234 });
    expect(response.body.command.cliArgs).toEqual(["--agent=PAW-Review", "--yolo"]);
    expect(launchTerminal).toHaveBeenCalledTimes(1);
    const options = launchTerminal.mock.calls[0][0] as TerminalLaunchOptions;
    expect(options.cwd).toBe("C:\\repo");
    expect(options.prepareCopilotCli).toBe(true);
    expect(options.preferredTerminal).toBe("windows-terminal");
    expect(options.title).toBe("Node REVIEW");
    expect(options.tabColor).toBe("#336699");
    expect(options.command).toContain("copilot");
    expect(options.command).toContain("--agent=PAW-Review");
    expect(options.command).toContain("--yolo");
    expect(options.command).toContain("-i");
  });

  it.each(["mac-terminal", "iterm2"] as const)(
    "passes %s preference through to launchTerminal options",
    async (preferredTerminal) => {
      const launchTerminal = vi.fn((options: TerminalLaunchOptions) => {
        void options;
        return terminalResult(preferredTerminal, 2345);
      });
      const app = express();
      app.use(express.json());
      app.use("/api", createCompanionTerminalLaunchesRouter({ launchTerminal }));

      const response = await request(app)
        .post("/api/companion-terminal-launches")
        .send({
          cwd: "C:\\repo",
          kickoffPrompt: "Review issue 421",
          preferredTerminal,
        })
        .expect(201);

      expect(response.body.terminal).toEqual({ method: preferredTerminal, pid: 2345 });
      const options = launchTerminal.mock.calls[0][0] as TerminalLaunchOptions;
      expect(options.preferredTerminal).toBe(preferredTerminal);
      expect(options.prepareCopilotCli).toBe(true);
      expect(options.command).toContain("--agent=PAW-Review");
      expect(options.command).toContain("-i");
    },
  );

  it("rejects unknown preferred terminals with the accepted values", async () => {
    const { app, launchTerminal } = createApp();

    const response = await request(app)
      .post("/api/companion-terminal-launches")
      .send({
        cwd: "C:\\repo",
        kickoffPrompt: "Review issue 421",
        preferredTerminal: "fish",
      })
      .expect(400);

    expect(response.body.error).toBe(
      "preferredTerminal must be one of: default, mac-terminal, iterm2, windows-terminal, powershell.",
    );
    expect(launchTerminal).not.toHaveBeenCalled();
  });

  it("forces --agent=PAW-Review even when no cliArgs are supplied", async () => {
    const { app, launchTerminal } = createApp();

    const response = await request(app)
      .post("/api/companion-terminal-launches")
      .send({
        cwd: "C:\\repo",
        kickoffPrompt: "Review issue 414",
      })
      .expect(201);

    expect(response.body.command.cliArgs).toEqual(["--agent=PAW-Review"]);
    const options = launchTerminal.mock.calls[0][0] as TerminalLaunchOptions;
    expect(options.command).toContain("--agent=PAW-Review");
  });

  it("dedups a caller-supplied --agent=... so PAW-Review cannot be overridden", async () => {
    const { app, launchTerminal } = createApp();

    const response = await request(app)
      .post("/api/companion-terminal-launches")
      .send({
        cwd: "C:\\repo",
        kickoffPrompt: "Review issue 415",
        cliArgs: ["--agent=PAW", "--yolo"],
      })
      .expect(201);

    expect(response.body.command.cliArgs).toEqual(["--agent=PAW-Review", "--yolo"]);
    const options = launchTerminal.mock.calls[0][0] as TerminalLaunchOptions;
    expect(options.command).toContain("--agent=PAW-Review");
    expect(options.command).not.toContain("'--agent=PAW'");
  });

  it("dedups the separate-token form (--agent VALUE) too", async () => {
    const { app } = createApp();

    const response = await request(app)
      .post("/api/companion-terminal-launches")
      .send({
        cwd: "C:\\repo",
        kickoffPrompt: "Review issue 416",
        cliArgs: ["--agent", "PAW", "--yolo"],
      })
      .expect(201);

    expect(response.body.command.cliArgs).toEqual(["--agent=PAW-Review", "--yolo"]);
  });

  it("omits PAW-Review agent injection when requested for an ad hoc review", async () => {
    const { app, launchTerminal } = createApp();

    const response = await request(app)
      .post("/api/companion-terminal-launches")
      .send({
        cwd: "C:\\repo",
        kickoffPrompt: "Review issue 417",
        cliArgs: ["--agent=Custom", "--yolo"],
        usePawReviewAgent: false,
      })
      .expect(201);

    expect(response.body.command.cliArgs).toEqual(["--agent=Custom", "--yolo"]);
    const options = launchTerminal.mock.calls[0][0] as TerminalLaunchOptions;
    expect(options.command).not.toContain("--agent=PAW-Review");
    expect(options.command).toContain("--agent=Custom");
  });

  it("can reserve a launch claim so companion sessions inherit node title, color, and graph binding", async () => {
    const root = makeTempRoot();
    const registryStore = new SessionRegistryFileStore({
      rootDir: join(root, "registry"),
    });
    const claimStore = new LaunchClaimFileStore({
      rootDir: join(root, "claims"),
    });
    const launchTerminal = vi.fn((options: TerminalLaunchOptions) => {
      void options;
      return {
        method: "windows-terminal" as const,
        pid: 5678,
      };
    });
    const app = express();
    app.use(express.json());
    app.use("/api", createCompanionTerminalLaunchesRouter({
      launchTerminal,
      registryStore,
      claimStore,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    }));

    const response = await request(app)
      .post("/api/companion-terminal-launches")
      .send({
        cwd: "C:\\repo",
        kickoffPrompt: "Review issue 418",
        cliArgs: ["--yolo"],
        preferredTerminal: "windows-terminal",
        title: "Node REVIEW",
        tabColor: "#336699",
        launchBinding: {
          workstreamId: "session-launching-and-tracking",
          nodeId: "launch-claim-binding",
          branch: "feature/launch-claim-binding",
          contextId: "ctx-1",
        },
      })
      .expect(201);

    expect(response.body.launchClaim).toEqual(expect.objectContaining({
      status: "pending",
      reservedRegistryId: expect.any(String),
    }));
    const reservedId = response.body.launchClaim.reservedRegistryId as string;
    const reserved = registryStore.getSession(reservedId);
    expect(reserved).toEqual(expect.objectContaining({
      title: "Node REVIEW",
      color: "#336699",
      graphBinding: expect.objectContaining({
        workstreamId: "session-launching-and-tracking",
        nodeId: "launch-claim-binding",
      }),
    }));
    const options = launchTerminal.mock.calls[0][0] as TerminalLaunchOptions;
    expect(options.env).toEqual(expect.objectContaining({
      STREAMLINER_LAUNCH_CLAIM_ID: response.body.launchClaim.launchClaimId,
    }));
    expect(options.prepareCopilotCli).toBe(true);
    expect(options.command).toContain("-i");
  });

  it("fails instead of silently skipping binding when launchBinding is supplied without stores", async () => {
    await expect(
      launchCompanionTerminal({
        cwd: "C:\\repo",
        kickoffPrompt: "Review issue 419",
        launchBinding: {
          workstreamId: "session-launching-and-tracking",
          nodeId: "launch-claim-binding",
        },
      }, {
        launchTerminal: () => ({ method: "windows-terminal", pid: 1234 }),
      }),
    ).rejects.toMatchObject({
      message: "Companion launch binding requires session registry and launch-claim stores.",
      statusCode: 503,
    });
  });

  it("marks the companion launch claim failed when terminal spawning fails", async () => {
    const root = makeTempRoot();
    const registryStore = new SessionRegistryFileStore({
      rootDir: join(root, "registry"),
    });
    const claimStore = new LaunchClaimFileStore({
      rootDir: join(root, "claims"),
    });

    await expect(
      launchCompanionTerminal({
        cwd: "C:\\repo",
        kickoffPrompt: "Review issue 420",
        title: "Node REVIEW",
        launchBinding: {
          workstreamId: "session-launching-and-tracking",
          nodeId: "launch-claim-binding",
        },
      }, {
        registryStore,
        claimStore,
        launchTerminal: () => {
          throw new Error("wt unavailable");
        },
      }),
    ).rejects.toThrow("wt unavailable");

    const [claimEntry] = claimStore.listClaims();
    const claim = claimStore.getClaim(claimEntry.launchClaimId);
    expect(claim).toEqual(expect.objectContaining({
      status: "failed",
      failureCode: "terminal-spawn-failed",
    }));
  });

  it("rejects non-loopback forwarded requests", async () => {
    const { app, launchTerminal } = createApp();

    await request(app)
      .post("/api/companion-terminal-launches")
      .set("x-forwarded-for", "203.0.113.1")
      .send({
        cwd: "C:\\repo",
        kickoffPrompt: "Review issue 413",
      })
      .expect(403);

    expect(launchTerminal).not.toHaveBeenCalled();
  });
});
