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
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SCHEMA_VERSION = 1;
const LOCK_WAIT_MILLISECONDS = 25;
const LOCK_TIMEOUT_MILLISECONDS = 5000;
const MAX_LAUNCH_RECORDS = 100;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function defaultStateFile() {
    const copilotHome = process.env.COPILOT_HOME?.trim() || join(homedir(), ".copilot");
    return join(
        copilotHome,
        "extensions",
        "streamliner-spike",
        "artifacts",
        "runtime-v1.json",
    );
}

function emptyState() {
    return {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: null,
        launches: [],
    };
}

function sleep(milliseconds) {
    Atomics.wait(sleepBuffer, 0, 0, milliseconds);
}

export class RuntimeStore {
    constructor(options = {}) {
        this.stateFile = options.stateFile
            || process.env.STREAMLINER_SPIKE_STATE_FILE
            || defaultStateFile();
        this.lockFile = `${this.stateFile}.lock`;
        this.lockTimeoutMilliseconds = options.lockTimeoutMilliseconds
            ?? LOCK_TIMEOUT_MILLISECONDS;
    }

    read() {
        if (!existsSync(this.stateFile)) {
            return emptyState();
        }
        let state;
        try {
            state = JSON.parse(readFileSync(this.stateFile, "utf8"));
        } catch (error) {
            throw new Error(`Cannot read Streamliner spike runtime state: ${error.message}`);
        }
        if (state?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(state.launches)) {
            throw new Error(
                `Unsupported Streamliner spike runtime schema in ${this.stateFile}.`,
            );
        }
        return state;
    }

    mutate(mutator) {
        mkdirSync(dirname(this.stateFile), { recursive: true, mode: 0o700 });
        const lock = this.#acquireLock();
        try {
            const state = this.read();
            const result = mutator(state);
            state.updatedAt = new Date().toISOString();
            if (state.launches.length > MAX_LAUNCH_RECORDS) {
                state.launches = state.launches
                    .sort((left, right) => left.preparedAt.localeCompare(right.preparedAt))
                    .slice(-MAX_LAUNCH_RECORDS);
            }
            this.#writeAtomic(state);
            return result;
        } finally {
            this.#releaseLock(lock);
        }
    }

    #acquireLock() {
        const deadline = Date.now() + this.lockTimeoutMilliseconds;
        while (Date.now() < deadline) {
            const ownerId = randomUUID();
            try {
                const handle = openSync(this.lockFile, "wx", 0o600);
                writeFileSync(handle, JSON.stringify({
                    ownerId,
                    pid: process.pid,
                    createdAt: new Date().toISOString(),
                }), "utf8");
                return { handle, ownerId };
            } catch (error) {
                if (error.code !== "EEXIST") {
                    throw error;
                }
                sleep(LOCK_WAIT_MILLISECONDS);
            }
        }
        throw new Error(`Timed out waiting for runtime-state lock ${this.lockFile}.`);
    }

    #releaseLock(lock) {
        closeSync(lock.handle);
        try {
            const owner = JSON.parse(readFileSync(this.lockFile, "utf8"));
            if (owner.ownerId === lock.ownerId) {
                unlinkSync(this.lockFile);
            }
        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }
    }

    #writeAtomic(state) {
        const temporaryFile = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`;
        writeFileSync(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, {
            encoding: "utf8",
            mode: 0o600,
        });
        renameSync(temporaryFile, this.stateFile);
    }
}
