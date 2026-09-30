import { describe, expect, it } from "vitest";
import { githubApiBaseUrl, githubRepositoryFromRemote, normalizeGithubHost, parseGithubReferenceUrl } from "./github-host";
import { encodeGithubStatusRef, githubStatusRefKey, parseGithubStatusRef } from "./github-status";
import { issueUrl, trackerLabel, trackerUrl } from "./workstream-links";

describe("GitHub hosts", () => {
  it.each([
    [undefined, "https://api.github.com"],
    ["msft.ghe.com", "https://api.msft.ghe.com"],
    ["github.example.com", "https://github.example.com/api/v3"],
  ])("resolves REST endpoints for %s", (host, expected) => {
    expect(githubApiBaseUrl(host)).toBe(expected);
  });

  it.each(["", "https://msft.ghe.com", "msft.ghe.com/path", "host:443", "user@host.com", "host.com?x", "host.com#x", "host..com"])("rejects invalid host %s", (host) => {
    expect(normalizeGithubHost(host)).toBeNull();
  });

  it("keeps legacy status keys and round trips host-qualified keys", () => {
    const ref = { type: "issue" as const, owner: "org", repo: "repo", number: 42 };
    expect(githubStatusRefKey(ref)).toBe("issue:org/repo#42");
    expect(githubStatusRefKey({ ...ref, host: "github.com" })).toBe(githubStatusRefKey(ref));
    const enterprise = { ...ref, host: "msft.ghe.com" };
    expect(encodeGithubStatusRef(enterprise)).toBe("issue:msft.ghe.com/org/repo#42");
    expect(parseGithubStatusRef(encodeGithubStatusRef(enterprise))).toEqual(enterprise);
    expect(parseGithubStatusRef("issue:evil.com:443/org/repo#42")).toBeNull();
    expect(parseGithubStatusRef("issue:org/repo#9007199254740993")).toBeNull();
  });

  it("builds issue links and distinguishes enterprise labels", () => {
    const tracker = { type: "github" as const, host: "MSFT.GHE.COM", owner: "org", repo: "repo", number: 42 };
    expect(trackerUrl(tracker)).toBe("https://msft.ghe.com/org/repo/issues/42");
    expect(trackerLabel(tracker)).toBe("msft.ghe.com/org/repo#42");
    expect(issueUrl({ ...tracker, host: undefined })).toBe("https://github.com/org/repo/issues/42");
  });

  it.each([
    "https://msft.ghe.com/org/repo.git",
    "https://user@msft.ghe.com/org/repo.git",
    "git@msft.ghe.com:org/repo.git",
    "ssh://git@msft.ghe.com/org/repo.git",
    "msft.ghe.com/org/repo",
  ])("preserves the host of remote %s", (remote) => {
    expect(githubRepositoryFromRemote(remote)).toEqual({ host: "msft.ghe.com", owner: "org", repo: "repo" });
  });

  it("validates enterprise reference URLs", () => {
    expect(parseGithubReferenceUrl("https://msft.ghe.com/org/repo/pull/42")).toMatchObject({ host: "msft.ghe.com", number: 42, type: "pr" });
    expect(parseGithubReferenceUrl("https://github.example.com/org/repo/issues/42")).toMatchObject({ host: "github.example.com", type: "issue" });
    for (const url of [
      "javascript:alert(1)", "https://user@msft.ghe.com/org/repo/pull/42",
      "http://msft.ghe.com/org/repo/pull/42", "https://msft.ghe.com:8443/org/repo/pull/42",
    ]) expect(parseGithubReferenceUrl(url)).toBeNull();
  });
});
