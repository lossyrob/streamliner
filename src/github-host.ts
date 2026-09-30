export const DEFAULT_GITHUB_HOST = "github.com";

export function normalizeGithubHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().toLowerCase();
  if (host.length > 253 || !host.includes(".")) return null;
  return host.split(".").every((part) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part),
  ) ? host : null;
}

export function githubHost(host?: string): string {
  if (host === undefined) return DEFAULT_GITHUB_HOST;
  const normalized = normalizeGithubHost(host);
  if (!normalized) throw new Error(`Invalid GitHub hostname '${host}'. Use a hostname without a scheme or path.`);
  return normalized;
}

export function isGheCloudHost(host: string): boolean {
  return host.endsWith(".ghe.com");
}

export function githubApiBaseUrl(host?: string): string {
  const hostname = githubHost(host);
  if (hostname === DEFAULT_GITHUB_HOST) return "https://api.github.com";
  if (isGheCloudHost(hostname)) return `https://api.${hostname}`;
  return `https://${hostname}/api/v3`;
}

export interface GithubRepository {
  host?: string;
  owner: string;
  repo: string;
}

export function githubRepositorySlug(ref: GithubRepository): string {
  const host = githubHost(ref.host);
  return `${host === DEFAULT_GITHUB_HOST ? "" : `${host}/`}${ref.owner}/${ref.repo}`;
}

export function githubReferenceUrl(
  ref: GithubRepository & { number: number },
  type: "issue" | "pr" = "issue",
): string {
  return `https://${githubHost(ref.host)}/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/${type === "pr" ? "pull" : "issues"}/${ref.number}`;
}

export function parseGithubRepository(value: string | null | undefined): GithubRepository | null {
  const match = value?.trim().match(/^(?:([^/]+)\/)?([\w.-]+)\/([\w.-]+)$/);
  if (!match) return null;
  const host = match[1] === undefined ? undefined : normalizeGithubHost(match[1]);
  if (host === null) return null;
  return { ...(host ? { host } : {}), owner: match[2], repo: match[3] };
}

export function parseGithubReferenceUrl(value: string | null | undefined):
  (GithubRepository & { number: number; type: "issue" | "pr"; url: string }) | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const host = normalizeGithubHost(parsed.hostname);
    const match = parsed.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/([1-9]\d*)\/?$/i);
    if (!host || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !match) return null;
    const number = Number(match[4]);
    if (!Number.isSafeInteger(number)) return null;
    return {
      host, owner: match[1], repo: match[2], number,
      type: match[3].toLowerCase() === "pull" ? "pr" : "issue",
      url: parsed.href,
    };
  } catch {
    return null;
  }
}

export function githubRepositoryFromRemote(value: string): GithubRepository | null {
  const remote = value.trim().replace(/\/$/, "").replace(/\.git$/i, "");
  const match = remote.match(/^(?:https?:\/\/(?:[^/@]+@)?|ssh:\/\/git@|git@)([^/:]+)[:/]([\w.-]+)\/([\w.-]+)$/i);
  if (!match) return parseGithubRepository(remote);
  const host = match[1].replace(/^github\.com-[\w.-]+$/i, DEFAULT_GITHUB_HOST);
  return parseGithubRepository(`${host}/${match[2]}/${match[3]}`);
}
