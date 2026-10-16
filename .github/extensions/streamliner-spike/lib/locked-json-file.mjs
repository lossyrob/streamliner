import { randomUUID } from "node:crypto";
import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const LOCK_WAIT_MILLISECONDS = 25;
const DEFAULT_LOCK_TIMEOUT_MILLISECONDS = 5000;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleep(milliseconds) {
    Atomics.wait(sleepBuffer, 0, 0, milliseconds);
}

export function withFileLock(
    lockFile,
    callback,
    timeoutMilliseconds = DEFAULT_LOCK_TIMEOUT_MILLISECONDS,
) {
    mkdirSync(dirname(lockFile), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + timeoutMilliseconds;
    let lock = null;
    while (Date.now() < deadline) {
        const ownerId = randomUUID();
        try {
            const handle = openSync(lockFile, "wx", 0o600);
            writeFileSync(handle, JSON.stringify({
                ownerId,
                pid: process.pid,
                createdAt: new Date().toISOString(),
            }), "utf8");
            lock = { handle, ownerId };
            break;
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
            sleep(LOCK_WAIT_MILLISECONDS);
        }
    }
    if (!lock) {
        throw new Error(`Timed out waiting for file lock ${lockFile}.`);
    }
    try {
        return callback();
    } finally {
        closeSync(lock.handle);
        try {
            const owner = JSON.parse(readFileSync(lockFile, "utf8"));
            if (owner.ownerId === lock.ownerId) unlinkSync(lockFile);
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }
}

export function writeJsonAtomic(file, value) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporaryFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
    });
    renameSync(temporaryFile, file);
}

export function readJsonIfExists(file, fallback) {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf8"));
}
