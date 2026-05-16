import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GithubStatusRef } from "../github-status";
import {
  readGithubAuthSettings,
  resolveGithubAuthProfile,
} from "./github-auth-settings";

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-github-auth-"));
  roots.push(root);
  return root;
}

function issueRef(owner = "lossyrob", repo = "streamliner"): GithubStatusRef {
  return { type: "issue", owner, repo, number: 69 };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("GitHub auth settings", () => {
  it("resolves exact repository profiles before owner wildcards", async () => {
    const path = join(createRoot(), "github-auth.json");
    writeFileSync(
      path,
      JSON.stringify({
        profiles: {
          personal: {
            ghConfigDir: "C:\\Users\\robemanuele\\AppData\\Roaming\\gh-pub",
            user: "lossyrob",
          },
          work: {
            user: "work-user",
          },
        },
        repositories: {
          "github.com/lossyrob/*": "work",
          "github.com/lossyrob/streamliner": "personal",
        },
      }),
      "utf8",
    );

    const settings = await readGithubAuthSettings(path);

    expect(resolveGithubAuthProfile(issueRef(), settings)).toEqual({
      ghConfigDir: "C:\\Users\\robemanuele\\AppData\\Roaming\\gh-pub",
      user: "lossyrob",
    });
    expect(resolveGithubAuthProfile(issueRef("lossyrob", "other"), settings)).toEqual({
      user: "work-user",
    });
  });

  it("returns empty settings when no local auth file exists", async () => {
    const settings = await readGithubAuthSettings(join(createRoot(), "missing.json"));

    expect(settings).toEqual({ profiles: {}, repositories: {} });
    expect(resolveGithubAuthProfile(issueRef(), settings)).toBeNull();
  });
});
