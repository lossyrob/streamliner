import { expect, test, type Page, type Route } from "@playwright/test";

interface SessionRegistryListItem {
  id: string;
  title: string;
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
  trustedSignalSource: "copilot-cli-hook" | null;
  trustedStartedAt: string | null;
  trustedEndedAt: string | null;
  trustedLastSignalAt: string | null;
  trustedStartSource: "new" | "resume" | "startup" | null;
  trustedEndReason: string | null;
  trustedExecutionKind: "copilot_cli" | "agency" | null;
  trustedInitialPromptLength: number | null;
  trustedLastPromptLength: number | null;
}

function buildTrustedSession(
  overrides: Partial<SessionRegistryListItem> = {},
): SessionRegistryListItem {
  return {
    id: "trusted-session",
    title: "Follow Paw-Lite Process",
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
    aiSummary: "Debugging hooks and session registry filtering",
    aiSummaryModel: "gpt-5.4-mini",
    aiSummaryUpdatedAt: "2026-04-24T22:54:16.000Z",
    aiSummaryEventsFingerprint: "events|userTurns=12",
    aiSummaryStatus: "ready",
    aiSummaryError: null,
    observedSessionKind: "interactive",
    copilotProcessState: "live",
    copilotProcessId: 34392,
    trustedSignalSource: "copilot-cli-hook",
    trustedStartedAt: "2026-04-24T22:48:16.000Z",
    trustedEndedAt: null,
    trustedLastSignalAt: "2026-04-24T22:48:16.000Z",
    trustedStartSource: "resume",
    trustedEndReason: null,
    trustedExecutionKind: "copilot_cli",
    trustedInitialPromptLength: 452,
    trustedLastPromptLength: 452,
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

test("session color quick-pick closes immediately and Done saves without refetch", async ({
  page,
}) => {
  const api = await mockSessionsApi(page, { patchDelayMs: 1_000 });

  await page.goto("/?view=sessions");

  const row = page.getByRole("button", { name: /Follow Paw-Lite Process/ });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("gpt-5.4-mini");
  const initialListRequests = api.listRequests;

  await row.click();
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
