import { homedir } from "node:os";
import { join } from "node:path";

import {
    readJsonIfExists,
    withFileLock,
    writeJsonAtomic,
} from "./locked-json-file.mjs";
import {
    assertRuntimeStateSchema,
    RUNTIME_STATE_SCHEMA_VERSION,
} from "./compatibility.mjs";

const MAX_LAUNCH_RECORDS = 100;

function defaultStateFile() {
    const copilotHome = process.env.COPILOT_HOME?.trim() || join(homedir(), ".copilot");
    return join(
        copilotHome,
        "extensions",
        "streamliner-spike",
        "artifacts",
        `runtime-v${RUNTIME_STATE_SCHEMA_VERSION}.json`,
    );
}

function emptyState() {
    return {
        schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
        updatedAt: null,
        launches: [],
    };
}

export class RuntimeStore {
    constructor(options = {}) {
        this.stateFile = options.stateFile
            || process.env.STREAMLINER_SPIKE_STATE_FILE
            || defaultStateFile();
        this.lockFile = `${this.stateFile}.lock`;
        this.lockTimeoutMilliseconds = options.lockTimeoutMilliseconds ?? 5000;
    }

    read() {
        let state;
        try {
            state = readJsonIfExists(this.stateFile, emptyState());
        } catch (error) {
            throw new Error(`Cannot read Streamliner spike runtime state: ${error.message}`);
        }
        assertRuntimeStateSchema(state?.schemaVersion, this.stateFile);
        if (!Array.isArray(state.launches)) {
            throw new Error(
                `Invalid Streamliner spike runtime state in ${this.stateFile}: launches must be an array.`,
            );
        }
        return state;
    }

    mutate(mutator) {
        return withFileLock(
            this.lockFile,
            () => {
                const state = this.read();
                const result = mutator(state);
                state.updatedAt = new Date().toISOString();
                if (state.launches.length > MAX_LAUNCH_RECORDS) {
                    state.launches = state.launches
                        .sort((left, right) => left.preparedAt.localeCompare(right.preparedAt))
                        .slice(-MAX_LAUNCH_RECORDS);
                }
                writeJsonAtomic(this.stateFile, state);
                return result;
            },
            this.lockTimeoutMilliseconds,
        );
    }
}
