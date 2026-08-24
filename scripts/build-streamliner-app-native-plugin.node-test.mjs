import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { COMPATIBILITY_MANIFEST } from "../.github/extensions/streamliner-spike/lib/compatibility.mjs";
import {
    buildStreamlinerAppNativePlugin,
    EXTENSION_SOURCE_ROOT,
} from "./build-streamliner-app-native-plugin.mjs";

test("plugin assembly is complete, hook-free, and reproducible", () => {
    const root = mkdtempSync(join(tmpdir(), "streamliner-app-native-plugin-"));
    try {
        const first = buildStreamlinerAppNativePlugin({
            outputRoot: join(root, "first"),
        });
        const second = buildStreamlinerAppNativePlugin({
            outputRoot: join(root, "second"),
        });

        assert.equal(first.packageDigest, second.packageDigest);
        assert.deepEqual(first.packageManifest, second.packageManifest);
        assert.equal(
            readFileSync(
                join(first.outputRoot, "package-manifest.json"),
                "utf8",
            ),
            readFileSync(
                join(second.outputRoot, "package-manifest.json"),
                "utf8",
            ),
        );

        const plugin = JSON.parse(
            readFileSync(join(first.outputRoot, "plugin.json"), "utf8"),
        );
        assert.equal(plugin.name, COMPATIBILITY_MANIFEST.package.name);
        assert.equal(plugin.version, COMPATIBILITY_MANIFEST.package.version);
        assert.equal(plugin.agents, "agents/");
        assert.equal(plugin.skills, "skills/");
        assert.equal(plugin.extensions, "extensions/streamliner-spike");
        assert.equal("hooks" in plugin, false);

        const paths = first.packageManifest.files.map((file) => file.path);
        for (const requiredPath of [
            "agents/streamliner-app-native-worker.agent.md",
            "skills/streamliner-app-native-launch/SKILL.md",
            "extensions/streamliner-spike/extension.mjs",
            "extensions/streamliner-spike/compatibility.json",
            "extensions/streamliner-spike/assets/react-flow-v1/index.html",
            "extensions/streamliner-spike/assets/portfolio-v1/index.html",
        ]) {
            assert.equal(paths.includes(requiredPath), true, requiredPath);
        }
        assert.equal(
            paths.some((path) => path.toLowerCase().endsWith("hooks.json")),
            false,
        );
        assert.equal(
            paths.some((path) =>
                path.includes("/fixtures/")
                || path.includes("/portfolio-ui/")
                || path.includes("/ui/src/")
                || path.endsWith("/spike.node-test.mjs")
                || path.endsWith("/build-ui.mjs")
            ),
            false,
        );

        const agent = readFileSync(
            join(
                first.outputRoot,
                "agents",
                "streamliner-app-native-worker.agent.md",
            ),
            "utf8",
        );
        assert.match(agent, /first action must call `streamliner_spike_claim_launch`/);
        assert.match(agent, /second action must call `streamliner_spike_initialize_paw`/);
        assert.match(agent, /same App-created session, worktree, and branch/);
        assert.match(agent, /native `send_session_message`/);

        const skill = readFileSync(
            join(
                first.outputRoot,
                "skills",
                "streamliner-app-native-launch",
                "SKILL.md",
            ),
            "utf8",
        );
        assert.match(skill, /Call `streamliner_spike_claim_launch`.*first action/);
        assert.match(skill, /Call `streamliner_spike_initialize_paw`.*second action/);
        assert.match(skill, /current App-created session, worktree, and branch/);
        assert.match(skill, /native `send_session_message`/);

        assert.equal(
            readFileSync(
                join(
                    first.outputRoot,
                    "extensions",
                    "streamliner-spike",
                    "compatibility.json",
                ),
                "utf8",
            ),
            readFileSync(join(EXTENSION_SOURCE_ROOT, "compatibility.json"), "utf8")
                .replace(/\r\n?/g, "\n"),
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
