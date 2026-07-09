export interface PawPromptProfile {
  id: string;
  name: string;
  instructions: string;
  updatedAt: string;
}

export function responseErrorMessage(response: Response, fallback: string): string {
  return `${fallback} (${response.status})`;
}

function profileUpdatedAtMs(profile: PawPromptProfile): number {
  const parsed = Date.parse(profile.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortProfiles(profiles: PawPromptProfile[]): PawPromptProfile[] {
  return [...profiles].sort((left, right) => left.name.localeCompare(right.name));
}

export function mergePromptProfiles(
  current: PawPromptProfile[],
  incoming: PawPromptProfile[],
): PawPromptProfile[] {
  const byId = new Map(current.map((profile) => [profile.id, profile]));
  for (const profile of incoming) {
    const existing = byId.get(profile.id);
    if (!existing || profileUpdatedAtMs(profile) >= profileUpdatedAtMs(existing)) {
      byId.set(profile.id, profile);
    }
  }
  return sortProfiles([...byId.values()]);
}

export async function loadPromptProfiles(): Promise<PawPromptProfile[]> {
  const response = await fetch("/api/paw-launch-prompt-profiles", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(responseErrorMessage(response, "Could not load prompt profiles."));
  }
  const body = await response.json() as { profiles?: PawPromptProfile[] };
  return Array.isArray(body.profiles) ? body.profiles : [];
}

export async function savePromptProfile(input: {
  id?: string;
  name: string;
  instructions: string;
}): Promise<PawPromptProfile> {
  const response = await fetch(
    input.id
      ? `/api/paw-launch-prompt-profiles/${encodeURIComponent(input.id)}`
      : "/api/paw-launch-prompt-profiles",
    {
      method: input.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        instructions: input.instructions,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(responseErrorMessage(response, "Could not save prompt profile."));
  }
  const body = await response.json() as { profile?: PawPromptProfile };
  if (!body.profile) {
    throw new Error("Prompt profile response was missing the saved profile.");
  }
  return body.profile;
}

export async function deletePromptProfile(id: string): Promise<void> {
  const response = await fetch(`/api/paw-launch-prompt-profiles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(responseErrorMessage(response, "Could not delete prompt profile."));
  }
}
