import { describe, expect, it, vi } from "vitest";

import { runNotify } from "./notify";

function writer() {
  let text = "";
  return {
    stream: {
      write(chunk: string) {
        text += chunk;
        return true;
      },
    },
    text() {
      return text;
    },
  };
}

function successResponse(id = 7, title = "T"): Response {
  return new Response(
    JSON.stringify({
      notification: {
        id,
        title,
        body: "B",
        createdAt: "2026-05-30T00:00:00.000Z",
        severity: "info",
        eventKind: "generic",
        workstreamId: null,
        projectKey: null,
        workstreamColor: null,
        workstreamShortName: null,
        nodeId: null,
        sessionId: null,
        link: null,
        source: "cli",
      },
    }),
    { status: 201, headers: { "content-type": "application/json" } },
  );
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("runNotify", () => {
  it("requires title and body", async () => {
    const err = writer();
    const fetchMock = vi.fn();

    await expect(runNotify(["--body", "B"], { fetch: fetchMock, err: err.stream })).resolves.toBe(1);
    expect(err.text()).toContain("--title is required");

    const secondErr = writer();
    await expect(runNotify(["--title", "T"], { fetch: fetchMock, err: secondErr.stream })).resolves.toBe(1);
    expect(secondErr.text()).toContain("--body is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates severity and event enums", async () => {
    const err = writer();
    const fetchMock = vi.fn();

    await expect(
      runNotify(["--title", "T", "--body", "B", "--severity", "fatal"], { fetch: fetchMock, err: err.stream }),
    ).resolves.toBe(1);
    expect(err.text()).toContain("invalid --severity 'fatal'");

    const secondErr = writer();
    await expect(
      runNotify(["--title", "T", "--body", "B", "--event=opened"], { fetch: fetchMock, err: secondErr.stream }),
    ).resolves.toBe(1);
    expect(secondErr.text()).toContain("invalid --event 'opened'");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts absolute https links and rejects relative or disallowed links", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    const out = writer();
    const err = writer();

    await expect(
      runNotify(["--title", "T", "--body", "B", "--link", "https://example.test/path"], {
        fetch: fetchMock,
        out: out.stream,
        err: err.stream,
      }),
    ).resolves.toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({ link: "https://example.test/path" });

    const relativeErr = writer();
    await expect(
      runNotify(["--title", "T", "--body", "B", "--link", "/foo"], { fetch: fetchMock, err: relativeErr.stream }),
    ).resolves.toBe(1);
    expect(relativeErr.text()).toContain("link must be an absolute");

    const schemeErr = writer();
    await expect(
      runNotify(["--title", "T", "--body", "B", "--link", "javascript:alert(1)"], {
        fetch: fetchMock,
        err: schemeErr.stream,
      }),
    ).resolves.toBe(1);
    expect(schemeErr.text()).toContain("link scheme 'javascript:' is not allowed");
  });

  it("shapes the notification request body from flags", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse(42, "T"));
    const out = writer();

    await expect(
      runNotify(
        [
          "--title=T",
          "--body",
          "B",
          "--workstream",
          "ws-1",
          "--project-key",
          "proj",
          "--severity",
          "warn",
          "--event",
          "pr-created",
          "--node",
          "node-1",
          "--session",
          "session-1",
        ],
        { fetch: fetchMock, out: out.stream },
      ),
    ).resolves.toBe(0);

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4319/api/notifications", expect.any(Object));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      title: "T",
      body: "B",
      severity: "warn",
      eventKind: "pr-created",
      workstreamId: "ws-1",
      projectKey: "proj",
      nodeId: "node-1",
      sessionId: "session-1",
    });
  });

  it("prints the created id and title on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse(11, "Created title"));
    const out = writer();

    await expect(runNotify(["--title", "T", "--body", "B"], { fetch: fetchMock, out: out.stream })).resolves.toBe(0);

    expect(out.text()).toContain("11");
    expect(out.text()).toContain("Created title");
  });

  it("returns non-zero and explains network failures", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const err = writer();

    await expect(
      runNotify(["--title", "T", "--body", "B"], {
        fetch: fetchMock,
        err: err.stream,
        apiBaseUrl: "http://127.0.0.1:4319",
      }),
    ).resolves.toBe(1);

    expect(err.text()).toContain("Failed to reach Streamliner API at http://127.0.0.1:4319");
    expect(err.text()).toContain("Streamliner API is running");
  });

  it("returns non-zero and surfaces API error code and error fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(400, { code: "invalid_title", error: "bad title" }));
    const err = writer();

    await expect(runNotify(["--title", "T", "--body", "B"], { fetch: fetchMock, err: err.stream })).resolves.toBe(1);

    expect(err.text()).toContain("invalid_title");
    expect(err.text()).toContain("bad title");
  });
});
