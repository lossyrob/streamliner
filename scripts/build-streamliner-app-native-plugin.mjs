#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import {
    dirname,
    extname,
    isAbsolute,
    join,
    parse,
    relative,
    resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import { COMPATIBILITY_MANIFEST } from "../.github/extensions/streamliner-spike/lib/compatibility.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");
export const PLUGIN_SOURCE_ROOT = join(
    REPOSITORY_ROOT,
    "copilot-plugin",
    "streamliner-app-native-spike",
);
export const EXTENSION_SOURCE_ROOT = join(
    REPOSITORY_ROOT,
    ".github",
    "extensions",
    "streamliner-spike",
);
export const DEFAULT_PACKAGE_ROOT = join(
    REPOSITORY_ROOT,
    "dist",
    "streamliner-app-native-spike",
);
const EXTENSION_RUNTIME_ENTRIES = [
    "assets",
    "compatibility.json",
    "extension.mjs",
    "lib",
];

const TEXT_EXTENSIONS = new Set([
    ".css",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
]);

function lexicalCompare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedRelative(root, path) {
    return relative(root, path).replaceAll("\\", "/");
}

function pathContains(parent, child) {
    const childRelative = relative(parent, child);
    return childRelative === ""
        || (!childRelative.startsWith("..") && !isAbsolute(childRelative));
}

function samePath(left, right) {
    return pathContains(left, right) && pathContains(right, left);
}

function assertOwnedOutputRoot(outputRoot) {
    const markerPath = join(outputRoot, "package-manifest.json");
    let marker;
    try {
        marker = JSON.parse(readFileSync(markerPath, "utf8"));
    } catch (error) {
        throw new Error(
            `Refusing to remove unowned plugin package output ${outputRoot}; expected a valid ${markerPath}: ${error.message}`,
        );
    }
    if (
        marker?.schemaVersion !== 1
        || marker.name !== COMPATIBILITY_MANIFEST.package.name
        || marker.version !== COMPATIBILITY_MANIFEST.package.version
        || marker.source?.plugin !== "copilot-plugin/streamliner-app-native-spike"
        || marker.source?.extension !== ".github/extensions/streamliner-spike"
    ) {
        throw new Error(
            `Refusing to remove unowned plugin package output ${outputRoot}; ${markerPath} does not identify this builder.`,
        );
    }
}

function assertSafeOutputRoot(outputRoot) {
    if (outputRoot === parse(outputRoot).root) {
        throw new Error("Plugin package output cannot be a filesystem root.");
    }
    const outputExists = existsSync(outputRoot);
    if (outputExists) {
        const output = lstatSync(outputRoot);
        if (output.isSymbolicLink() || !output.isDirectory()) {
            throw new Error(
                `Plugin package output must be a real directory, not a file or symbolic link: ${outputRoot}`,
            );
        }
    }
    for (const protectedRoot of [
        REPOSITORY_ROOT,
        PLUGIN_SOURCE_ROOT,
        EXTENSION_SOURCE_ROOT,
    ]) {
        const containsProtectedSource = pathContains(outputRoot, protectedRoot);
        const nestedInProtectedSource = protectedRoot !== REPOSITORY_ROOT
            && pathContains(protectedRoot, outputRoot);
        if (containsProtectedSource || nestedInProtectedSource) {
            throw new Error(
                `Plugin package output ${outputRoot} overlaps protected source ${protectedRoot}.`,
            );
        }
    }
    const isDefaultOutput = samePath(outputRoot, DEFAULT_PACKAGE_ROOT);
    const isInsideRepository = pathContains(REPOSITORY_ROOT, outputRoot);
    if (isInsideRepository && !isDefaultOutput && !outputExists) {
        throw new Error(
            `Custom plugin package output inside the repository is not allowed until it is marked as builder-owned: ${outputRoot}. Use the dedicated default ${DEFAULT_PACKAGE_ROOT} or an output outside the repository.`,
        );
    }
    if (outputExists && !isDefaultOutput) {
        assertOwnedOutputRoot(outputRoot);
    }
}

function filesUnder(root) {
    const files = [];
    function visit(directory) {
        const entries = readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => lexicalCompare(left.name, right.name));
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                throw new Error(`Plugin package sources cannot contain symlinks: ${path}`);
            }
            if (entry.isDirectory()) {
                visit(path);
            } else if (entry.isFile()) {
                files.push(path);
            }
        }
    }
    visit(root);
    return files;
}

function normalizedContent(path) {
    const content = readFileSync(path);
    if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) return content;
    return Buffer.from(content.toString("utf8").replace(/\r\n?/g, "\n"), "utf8");
}

function copyTree(sourceRoot, destinationRoot) {
    for (const sourcePath of filesUnder(sourceRoot)) {
        const destinationPath = join(
            destinationRoot,
            normalizedRelative(sourceRoot, sourcePath),
        );
        mkdirSync(dirname(destinationPath), { recursive: true });
        writeFileSync(destinationPath, normalizedContent(sourcePath));
    }
}

function copyExtensionRuntime(destinationRoot) {
    for (const entry of EXTENSION_RUNTIME_ENTRIES) {
        const sourcePath = join(EXTENSION_SOURCE_ROOT, entry);
        const destinationPath = join(destinationRoot, entry);
        const source = statSync(sourcePath);
        if (source.isDirectory()) {
            copyTree(sourcePath, destinationPath);
        } else if (source.isFile()) {
            mkdirSync(dirname(destinationPath), { recursive: true });
            writeFileSync(destinationPath, normalizedContent(sourcePath));
        } else {
            throw new Error(`Unsupported extension runtime source: ${sourcePath}`);
        }
    }
}

function sha256(content) {
    return createHash("sha256").update(content).digest("hex");
}

function packageFiles(outputRoot) {
    return filesUnder(outputRoot).map((path) => ({
        path: normalizedRelative(outputRoot, path),
        sha256: sha256(readFileSync(path)),
        bytes: statSync(path).size,
    }));
}

function validatePluginSource() {
    const manifest = JSON.parse(
        readFileSync(join(PLUGIN_SOURCE_ROOT, "plugin.json"), "utf8"),
    );
    if (manifest.name !== COMPATIBILITY_MANIFEST.package.name) {
        throw new Error(
            `Plugin name ${manifest.name} does not match compatibility package ${COMPATIBILITY_MANIFEST.package.name}.`,
        );
    }
    if (manifest.version !== COMPATIBILITY_MANIFEST.package.version) {
        throw new Error(
            `Plugin version ${manifest.version} does not match compatibility version ${COMPATIBILITY_MANIFEST.package.version}.`,
        );
    }
    if (
        manifest.agents !== "agents/"
        || manifest.skills !== "skills/"
        || manifest.extensions !== "extensions/streamliner-spike"
    ) {
        throw new Error("Plugin component paths do not match the canonical package layout.");
    }
    if ("hooks" in manifest) {
        throw new Error("The App-native spike plugin must not include lifecycle hooks.");
    }
    const hook = filesUnder(PLUGIN_SOURCE_ROOT).find(
        (path) => normalizedRelative(PLUGIN_SOURCE_ROOT, path).toLowerCase() === "hooks.json",
    );
    if (hook) {
        throw new Error("The App-native spike plugin must not include hooks.json.");
    }
    return manifest;
}

export function buildStreamlinerAppNativePlugin(options = {}) {
    const outputRoot = resolve(options.outputRoot || DEFAULT_PACKAGE_ROOT);
    assertSafeOutputRoot(outputRoot);
    const plugin = validatePluginSource();

    rmSync(outputRoot, { recursive: true, force: true });
    mkdirSync(outputRoot, { recursive: true });
    copyTree(PLUGIN_SOURCE_ROOT, outputRoot);
    copyExtensionRuntime(join(outputRoot, "extensions", "streamliner-spike"));

    const files = packageFiles(outputRoot);
    const packageDigest = sha256(
        files.map((file) => `${file.path}\0${file.sha256}\0${file.bytes}`).join("\n"),
    );
    const packageManifest = {
        schemaVersion: 1,
        name: plugin.name,
        version: plugin.version,
        source: {
            plugin: "copilot-plugin/streamliner-app-native-spike",
            extension: ".github/extensions/streamliner-spike",
        },
        packageDigest,
        files,
    };
    writeFileSync(
        join(outputRoot, "package-manifest.json"),
        `${JSON.stringify(packageManifest, null, 2)}\n`,
        "utf8",
    );
    return {
        outputRoot,
        packageDigest,
        fileCount: files.length + 1,
        packageManifest,
    };
}

function outputArgument(args) {
    if (args.length === 0) return DEFAULT_PACKAGE_ROOT;
    if (args.length === 2 && args[0] === "--out" && args[1]) {
        return args[1];
    }
    throw new Error("Usage: node scripts/build-streamliner-app-native-plugin.mjs [--out <directory>]");
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
    const result = buildStreamlinerAppNativePlugin({
        outputRoot: outputArgument(process.argv.slice(2)),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
