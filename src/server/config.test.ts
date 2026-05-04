import { describe, expect, it } from "vitest";

import { readStreamlinerApiConfig } from "./config";

describe("readStreamlinerApiConfig", () => {
  it("reads preview isolation settings from the environment", () => {
    expect(readStreamlinerApiConfig({
      STREAMLINER_API_HOST: "127.0.0.1",
      STREAMLINER_API_PORT: "4987",
      STREAMLINER_WORKSTREAM_REGISTRY: "state/workstreams.json",
      STREAMLINER_WORKSTREAM_SOURCE_REGISTRY: "state/sources.json",
      STREAMLINER_RECENTS_PATH: "state/recents.json",
      STREAMLINER_PREVIEW_READONLY: "1",
    })).toEqual(expect.objectContaining({
      host: "127.0.0.1",
      port: 4987,
      previewReadonly: true,
      workstreamRegistryPath: expect.stringContaining("workstreams.json"),
      workstreamSourceRegistryPath: expect.stringContaining("sources.json"),
      recentsPath: expect.stringContaining("recents.json"),
    }));
  });

  it("leaves preview readonly disabled by default", () => {
    expect(readStreamlinerApiConfig({}).previewReadonly).toBe(false);
  });
});
