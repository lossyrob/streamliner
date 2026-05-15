import { describe, expect, it } from "vitest";

import {
  mergeReviewPromptTemplates,
  renderReviewPromptTemplate,
  type PawReviewPromptTemplate,
} from "./paw-review-prompt-templates";

describe("review prompt template helpers", () => {
  it("renders the GitHub issue token and leaves unknown tokens intact", () => {
    expect(renderReviewPromptTemplate(
      "Review issue {{githubIssue}} with {{unknown}}.",
      { githubIssue: "413" },
    )).toBe("Review issue 413 with {{unknown}}.");
  });

  it("keeps the newest template by id and sorts by name", () => {
    const older: PawReviewPromptTemplate = {
      id: "review",
      name: "Review",
      prompt: "old",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const newer: PawReviewPromptTemplate = {
      id: "review",
      name: "Review",
      prompt: "new",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const other: PawReviewPromptTemplate = {
      id: "alpha",
      name: "Alpha",
      prompt: "alpha",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(mergeReviewPromptTemplates([older], [other, newer])).toEqual([other, newer]);
  });
});
