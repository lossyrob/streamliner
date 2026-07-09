import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createPawReviewPromptTemplatesRouter } from "./paw-review-prompt-templates";

const roots: string[] = [];

function createApp() {
  const root = mkdtempSync(join(tmpdir(), "streamliner-review-templates-"));
  roots.push(root);
  const app = express();
  app.use(express.json());
  app.use("/api", createPawReviewPromptTemplatesRouter({
    templatesPath: join(root, "templates.json"),
  }));
  return app;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("paw review prompt templates route", () => {
  it("creates, lists, and updates templates", async () => {
    const app = createApp();

    const createResponse = await request(app)
      .post("/api/paw-review-prompt-templates")
      .send({ name: "PAW Review", prompt: "Review #{{githubIssue}}" })
      .expect(201);

    expect(createResponse.body.template).toMatchObject({
      id: "paw-review",
      name: "PAW Review",
      prompt: "Review #{{githubIssue}}",
    });

    await request(app)
      .put("/api/paw-review-prompt-templates/paw-review")
      .send({ name: "PAW Review", prompt: "Updated #{{githubIssue}}" })
      .expect(200);

    const listResponse = await request(app)
      .get("/api/paw-review-prompt-templates")
      .expect(200);

    expect(listResponse.body.templates).toMatchObject([
      {
        id: "paw-review",
        name: "PAW Review",
        prompt: "Updated #{{githubIssue}}",
      },
    ]);
  });

  it("deletes templates", async () => {
    const app = createApp();

    await request(app)
      .post("/api/paw-review-prompt-templates")
      .send({ name: "PAW Review", prompt: "Review #{{githubIssue}}" })
      .expect(201);

    await request(app)
      .delete("/api/paw-review-prompt-templates/paw-review")
      .expect(204);

    const listResponse = await request(app)
      .get("/api/paw-review-prompt-templates")
      .expect(200);

    expect(listResponse.body.templates).toEqual([]);
  });

  it("rejects duplicate template names", async () => {
    const app = createApp();

    await request(app)
      .post("/api/paw-review-prompt-templates")
      .send({ name: "PAW Review", prompt: "one" })
      .expect(201);

    await request(app)
      .post("/api/paw-review-prompt-templates")
      .send({ name: "paw review", prompt: "two" })
      .expect(409);
  });
});
