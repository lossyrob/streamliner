import { expect, test, type Page, type Route } from "@playwright/test";

interface SessionRegistryListItem {
  id: string;
  title: string;
  titleSource: "auto" | "user";
  description: string;
  lifecycleStatus: "active" | "paused" | "archived" | "ended";
  lastSeenAt: string | null;
  updatedAt: string;
  color: string | null;
  cwd: string;
  repo: string | null;
  branch: string | null;
  tags: string[];
  originKind: "manual" | "launched" | "observed";
  graphBinding: null;
  copilotSessionId: string | null;
  aiSummary: string | null;
  aiSummaryModel: string | null;
  aiSummaryUpdatedAt: string | null;
  aiSummaryEventsFingerprint: string | null;
  aiSummaryStatus: "missing" | "pending" | "ready" | "error";
  aiSummaryError: string | null;
  observedSessionKind: "interactive" | "helper" | null;
  copilotProcessState: "live" | "stale_lock" | "none" | null;
  copilotProcessId: number | null;
  activityStatus: "unknown" | "working" | "waiting_for_input" | "interrupted" | "exited";
  activityStatusUpdatedAt: string | null;
  trustedSignalSource: "copilot-cli-hook" | null;
  trustedStartedAt: string | null;
  trustedEndedAt: string | null;
  trustedLastSignalAt: string | null;
  trustedStartSource: "new" | "resume" | "startup" | null;
  trustedEndReason: string | null;
  trustedExecutionKind: "copilot_cli" | "agency" | null;
  trustedInitialPromptLength: number | null;
  trustedLastPromptLength: number | null;
  derivedWorktreePath: string | null;
  derivedBranch: string | null;
  derivedGithubRefs: Array<{
    type: "issue" | "pr" | "unknown";
    repo: string | null;
    number: number;
    url: string | null;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    source: string;
  }>;
  derivedContextUpdatedAt: string | null;
  derivedContextEventsOffset: number;
  derivedContextEventsSize: number;
  derivedContextEventsMtimeMs: number | null;
}

function buildTrustedSession(
  overrides: Partial<SessionRegistryListItem> = {},
): SessionRegistryListItem {
  return {
    id: "trusted-session",
    title: "Follow Paw-Lite Process",
    titleSource: "user",
    description: "lossyrob/streamliner · feature/manual-session-registry",
    lifecycleStatus: "active",
    lastSeenAt: "2026-04-24T22:48:16.000Z",
    updatedAt: "2026-04-24T22:54:16.000Z",
    color: "#5b7fff",
    cwd: "C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
    repo: "lossyrob/streamliner",
    branch: "feature/manual-session-registry",
    tags: [],
    originKind: "observed",
    graphBinding: null,
    copilotSessionId: "trusted-session",
    aiSummary:
      "This session started as follow-up work on trusted Copilot session tracking. The latest discussion is refining session cards so the editable title stays separate from a richer conversation description.",
    aiSummaryModel: "gpt-5.4-mini",
    aiSummaryUpdatedAt: "2026-04-24T22:54:16.000Z",
    aiSummaryEventsFingerprint: "events|userTurns=12",
    aiSummaryStatus: "ready",
    aiSummaryError: null,
    observedSessionKind: "interactive",
    copilotProcessState: "live",
    copilotProcessId: 34392,
    activityStatus: "waiting_for_input",
    activityStatusUpdatedAt: "2026-04-24T22:54:16.000Z",
    trustedSignalSource: "copilot-cli-hook",
    trustedStartedAt: "2026-04-24T22:48:16.000Z",
    trustedEndedAt: null,
    trustedLastSignalAt: "2026-04-24T22:48:16.000Z",
    trustedStartSource: "resume",
    trustedEndReason: null,
    trustedExecutionKind: "copilot_cli",
    trustedInitialPromptLength: 452,
    trustedLastPromptLength: 452,
    derivedWorktreePath: "C:/Users/robemanuele/proj/streamliner/manual-session-registry",
    derivedBranch: "feature/manual-session-registry",
    derivedGithubRefs: [
      {
        type: "pr",
        repo: "lossyrob/streamliner",
        number: 14,
        url: "https://github.com/lossyrob/streamliner/pull/14",
        firstSeenAt: "2026-04-24T22:50:00.000Z",
        lastSeenAt: "2026-04-24T22:50:00.000Z",
        source: "gh",
      },
      {
        type: "issue",
        repo: null,
        number: 13,
        url: null,
        firstSeenAt: "2026-04-24T22:51:00.000Z",
        lastSeenAt: "2026-04-24T22:51:00.000Z",
        source: "user",
      },
    ],
    derivedContextUpdatedAt: "2026-04-24T22:55:00.000Z",
    derivedContextEventsOffset: 1200,
    derivedContextEventsSize: 1200,
    derivedContextEventsMtimeMs: 1777080900000,
    ...overrides,
  };
}

function toSessionRecord(session: SessionRegistryListItem) {
  const { originKind, ...record } = session;
  return {
    ...record,
    origin: { kind: originKind },
  };
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface MockSessionsApiOptions {
  patchDelayMs?: number;
}

async function mockSessionsApi(page: Page, options: MockSessionsApiOptions = {}) {
  let session = buildTrustedSession();
  let listRequests = 0;
  const patches: unknown[] = [];
  let completedPatches = 0;

  await page.route("**/api/sessions**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === "GET" && url.pathname === "/api/sessions") {
      listRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([session]),
      });
      return;
    }

    if (method === "PATCH" && url.pathname === "/api/sessions/trusted-session") {
      const patch = request.postDataJSON() as Partial<SessionRegistryListItem>;
      patches.push(patch);
      session = {
        ...session,
        ...patch,
        updatedAt: "2026-04-24T23:16:00.000Z",
      };
      const responseSession = session;
      await delay(options.patchDelayMs ?? 0);
      completedPatches += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(toSessionRecord(responseSession)),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: `Unexpected ${method} ${url.pathname}` }),
    });
  });

  return {
    get listRequests() {
      return listRequests;
    },
    get patches() {
      return patches;
    },
    get completedPatches() {
      return completedPatches;
    },
  };
}

async function installClipboardMock(page: Page) {
  await page.addInitScript(() => {
    const copiedTexts: string[] = [];
    Object.defineProperty(window, "__streamlinerCopiedTexts", {
      value: copiedTexts,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          copiedTexts.push(text);
        },
      },
      configurable: true,
    });
  });
}

async function readClipboardWrites(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...((window as Window & { __streamlinerCopiedTexts: string[] })
      .__streamlinerCopiedTexts ?? []),
  ]);
}

test("sessions API handles malformed JSON and persists create, reload, archive, delete", async ({
  page,
  request,
}) => {
  const malformedResponse = await request.post("/api/sessions", {
    data: Buffer.from("{"),
    headers: { "Content-Type": "application/json" },
  });
  expect(malformedResponse.status()).toBe(400);
  await expect(malformedResponse.json()).resolves.toEqual({
    error: "Malformed JSON request body.",
  });

  const title = `Unmocked smoke ${Date.now()}`;
  let createdId: string | null = null;
  try {
    const createResponse = await request.post("/api/sessions", {
      data: {
        title,
        cwd: "C:\\streamliner-e2e",
        origin: { kind: "manual" },
      },
    });
    expect(createResponse.status()).toBe(200);
    createdId = ((await createResponse.json()) as { id: string }).id;

    await page.goto("/?view=sessions");
    const row = page.getByRole("button", { name: new RegExp(title) });
    await expect(row).toBeVisible();

    await page.reload();
    await expect(row).toBeVisible();

    const archiveResponse = await request.post(`/api/sessions/${createdId}/archive`);
    expect(archiveResponse.status()).toBe(200);
    await page.reload();
    await expect(row).toHaveCount(0);

    await page.getByRole("button", { name: "Show archived" }).click();
    await expect(row).toBeVisible();

    const deleteResponse = await request.delete(`/api/sessions/${createdId}`);
    expect(deleteResponse.status()).toBe(204);
    createdId = null;
    await page.reload();
    await expect(row).toHaveCount(0);
  } finally {
    if (createdId) {
      await request.delete(`/api/sessions/${createdId}`);
    }
  }
});

test("session cards and detail view copy restart commands and session ids", async ({
  page,
}) => {
  await installClipboardMock(page);
  await mockSessionsApi(page);

  await page.goto("/?view=sessions");

  const row = page.getByRole("button", { name: /Follow Paw-Lite Process/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("trusted-session");

  await page.getByRole("button", { name: "Copy session ID trusted-session" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(() => readClipboardWrites(page)).toEqual(["trusted-session"]);

  await page.getByRole("button", { name: "Copy restart command" }).click();
  const expectedRestartCommand =
    "Set-Location -LiteralPath 'C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry'; copilot --resume 'trusted-session'";
  await expect.poll(() => readClipboardWrites(page)).toEqual([
    "trusted-session",
    expectedRestartCommand,
  ]);
  await expect(page.getByRole("dialog")).toBeHidden();

  await row.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(expectedRestartCommand)).toBeVisible();

  await dialog.getByRole("button", { name: "Copy restart command" }).click();
  await expect.poll(() => readClipboardWrites(page)).toEqual([
    "trusted-session",
    expectedRestartCommand,
    expectedRestartCommand,
  ]);
});

test("GitHub ref chips link to issues and PRs without opening the card", async ({
  page,
}) => {
  await mockSessionsApi(page);

  await page.goto("/?view=sessions");

  const row = page.getByRole("button", { name: /Follow Paw-Lite Process/ });
  await expect(row).toBeVisible();

  const prLink = page.getByRole("link", { name: "Open PR #14 in GitHub" });
  await expect(prLink).toHaveAttribute(
    "href",
    "https://github.com/lossyrob/streamliner/pull/14",
  );
  await expect(prLink).toHaveAttribute("target", "_blank");

  const issueLink = page.getByRole("link", { name: "Open Issue #13 in GitHub" });
  await expect(issueLink).toHaveAttribute(
    "href",
    "https://github.com/lossyrob/streamliner/issues/13",
  );
  await expect(issueLink).toHaveAttribute("target", "_blank");

  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open PR #14 in GitHub"]',
    );
    if (!link) {
      throw new Error("Expected PR link to be rendered.");
    }
    link.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("dialog")).toBeHidden();

  await row.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open PR #14 in GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/lossyrob/streamliner/pull/14",
  );
  await expect(
    dialog.getByRole("link", { name: "Open Issue #13 in GitHub" }),
  ).toHaveAttribute("href", "https://github.com/lossyrob/streamliner/issues/13");
});

test("session color quick-pick closes immediately and Done saves without refetch", async ({
  page,
}) => {
  const api = await mockSessionsApi(page, { patchDelayMs: 1_000 });

  await page.goto("/?view=sessions");

  const row = page.getByRole("button", { name: /Follow Paw-Lite Process/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("richer conversation description");
  await expect(row).toContainText("waiting for you");
  await expect(row).not.toContainText("gpt-5.4-mini");
  const initialListRequests = api.listRequests;

  await row.click();
  await expect(page.getByRole("heading", { name: "Conversation" })).toBeVisible();
  await expect(page.getByText(/Started:/)).toBeVisible();
  await expect(page.getByText(/Latest:/)).toBeVisible();
  await expect(page.getByText("Activity note")).toBeVisible();
  await page.getByRole("button", { name: "Show terminal color quick picks" }).click();
  const palette = page.getByLabel("Terminal color quick picks", { exact: true });
  await expect(palette).toBeVisible();

  await page.getByRole("button", { name: "Use terminal color #ff8c0a" }).click();
  await expect(palette).toBeHidden();

  await page.getByLabel("Session title").fill("Terminal A session");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 500 });
  await expect(page.getByRole("button", { name: /Terminal A session/ })).toBeVisible();

  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0]).toMatchObject({
    title: "Terminal A session",
    color: "#ff8c0a",
  });
  expect(api.listRequests).toBe(initialListRequests);
  await expect.poll(() => api.completedPatches).toBe(1);
});

test("Done saves edits made before dirty state re-renders", async ({ page }) => {
  const api = await mockSessionsApi(page, { patchDelayMs: 500 });

  await page.goto("/?view=sessions");
  await page.getByRole("button", { name: /Follow Paw-Lite Process/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.evaluate(() => {
    const titleInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Session title"]',
    );
    const doneButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Done",
    ) as HTMLButtonElement | undefined;
    if (!titleInput || !doneButton) {
      throw new Error("Session title input or Done button was not found.");
    }

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(titleInput, "Immediate Done session");
    titleInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    doneButton.click();
  });

  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 500 });
  await expect(page.getByRole("button", { name: /Immediate Done session/ })).toBeVisible();
  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0]).toMatchObject({
    title: "Immediate Done session",
  });
});

test("starting a new session saves edits made before dirty state re-renders", async ({
  page,
}) => {
  const api = await mockSessionsApi(page, { patchDelayMs: 500 });

  await page.goto("/?view=sessions");
  await page.getByRole("button", { name: /Follow Paw-Lite Process/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.evaluate(() => {
    const titleInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Session title"]',
    );
    const newSessionButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "+ New session",
    ) as HTMLButtonElement | undefined;
    if (!titleInput || !newSessionButton) {
      throw new Error("Session title input or New session button was not found.");
    }

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(titleInput, "Immediate New Session save");
    titleInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    newSessionButton.click();
  });

  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0]).toMatchObject({
    title: "Immediate New Session save",
  });
  await expect(page.getByRole("heading", { name: "Create session" })).toBeVisible();
});

test("delayed autosave responses do not replace newer title edits", async ({ page }) => {
  const api = await mockSessionsApi(page, { patchDelayMs: 700 });

  await page.goto("/?view=sessions");

  await page.getByRole("button", { name: /Follow Paw-Lite Process/ }).click();
  const titleInput = page.getByLabel("Session title");

  await titleInput.fill("Terminal A");
  await expect.poll(() => api.patches.length).toBe(1);

  await titleInput.fill("Terminal Alpha");
  await expect.poll(() => api.completedPatches).toBeGreaterThanOrEqual(1);
  await expect(titleInput).toHaveValue("Terminal Alpha");

  await expect.poll(() => api.patches.length).toBeGreaterThanOrEqual(2);
  await expect.poll(() => api.completedPatches).toBeGreaterThanOrEqual(2);
  await expect(titleInput).toHaveValue("Terminal Alpha");
});
