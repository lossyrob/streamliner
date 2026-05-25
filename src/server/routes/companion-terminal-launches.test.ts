import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createCompanionTerminalLaunchesRouter } from "./companion-terminal-launches";
import type { TerminalLaunchOptions } from "../terminal-launch";

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
  return { app, launchTerminal };
}

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
    expect(options.command).toContain("Review issue 413");
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
