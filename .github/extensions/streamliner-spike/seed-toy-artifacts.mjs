import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(extensionRoot, "fixtures", "artifact-tree");
const requestedRef = process.argv[2] || "refs/heads/streamliner-artifacts-spike";
const requestedRepo = process.argv[3] || process.cwd();

function git(cwd, args, options = {}) {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        ...options,
    }).trim();
}

function writeTree(repoRoot, directory) {
    const entries = [];
    for (const item of readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))) {
        const path = join(directory, item.name);
        if (item.isDirectory()) {
            entries.push(`040000 tree ${writeTree(repoRoot, path)}\t${item.name}`);
        } else if (item.isFile()) {
            const canonicalContent = Buffer.from(
                readFileSync(path, "utf8").replace(/\r\n?/g, "\n"),
                "utf8",
            );
            const blob = git(repoRoot, ["hash-object", "-w", "--stdin"], {
                input: canonicalContent,
            });
            entries.push(`100644 blob ${blob}\t${item.name}`);
        }
    }
    return git(repoRoot, ["mktree"], { input: `${entries.join("\n")}\n` });
}

git(requestedRepo, ["check-ref-format", requestedRef]);
const repoRoot = git(requestedRepo, ["rev-parse", "--show-toplevel"]);
const branchBefore = git(repoRoot, ["branch", "--show-current"]);
const headBefore = git(repoRoot, ["rev-parse", "HEAD"]);
const tree = writeTree(repoRoot, fixtureRoot);
const deterministicEnvironment = {
    ...process.env,
    GIT_AUTHOR_NAME: "Streamliner Spike",
    GIT_AUTHOR_EMAIL: "streamliner-spike@example.invalid",
    GIT_AUTHOR_DATE: "2026-08-20T19:00:00Z",
    GIT_COMMITTER_NAME: "Streamliner Spike",
    GIT_COMMITTER_EMAIL: "streamliner-spike@example.invalid",
    GIT_COMMITTER_DATE: "2026-08-20T19:00:00Z",
};
const commit = git(repoRoot, ["commit-tree", tree], {
    input: "Seed App-native Streamliner spike artifacts\n",
    env: deterministicEnvironment,
});
git(repoRoot, ["update-ref", requestedRef, commit]);
const branchAfter = git(repoRoot, ["branch", "--show-current"]);
const headAfter = git(repoRoot, ["rev-parse", "HEAD"]);
if (branchBefore !== branchAfter || headBefore !== headAfter) {
    throw new Error("Artifact seeding changed the source worktree checkout.");
}

process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    artifactRef: requestedRef,
    artifactRevision: commit,
    artifactTree: tree,
    workstreamPath: ".streamliner/workstreams/app-native-spike",
    readyNodeId: "app-native-implementation",
    sourceCheckoutUnchanged: true,
    fixtureRoot: relative(repoRoot, fixtureRoot).replaceAll("\\", "/"),
}, null, 2)}\n`);
