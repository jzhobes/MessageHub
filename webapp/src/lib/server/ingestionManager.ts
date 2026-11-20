import { ChildProcess, spawn } from 'child_process';

import { getIngestScriptPath, getPythonPath } from './python';
import appConfig from '../shared/appConfig';

interface IngestionState {
  process: ChildProcess | null;
  startPromise: Promise<ChildProcess> | null;
  logs: { type: string; payload: string }[];
  isComplete: boolean;
  exitCode: number | null;
}

const globalWithIngestion = global as typeof globalThis & {
  _ingestionState?: IngestionState;
};

if (!globalWithIngestion._ingestionState) {
  globalWithIngestion._ingestionState = {
    process: null,
    startPromise: null,
    logs: [],
    isComplete: false,
    exitCode: null,
  };
}

const state = globalWithIngestion._ingestionState;

export const ingestionManager = {
  start: (deleteArchives: boolean, archives: string[] = []): Promise<ChildProcess> => {
    if (state.process && !state.isComplete) {
      return Promise.resolve(state.process);
    }
    if (state.startPromise) {
      return state.startPromise;
    }

    const startup = (async () => {
      state.logs = [];
      state.isComplete = false;
      state.exitCode = null;

      const dataDir = appConfig.WORKSPACE_PATH;
      const scriptPath = getIngestScriptPath();
      const pythonPath = await getPythonPath();

      const env = { ...process.env, WORKSPACE_PATH: dataDir, PYTHONUNBUFFERED: '1' };
      const args = ['-u', scriptPath];
      if (deleteArchives) {
        args.push('--delete-archives');
      }
      for (const archivePath of archives) {
        args.push('--archive', archivePath);
      }

      const child = spawn(pythonPath, args, { env });
      state.process = child;

      const addLog = (type: string, data: Buffer | string) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            state.logs.push({ type, payload: line.trim() });
            // Limit buffer size to last 500 lines
            if (state.logs.length > 500) {
              state.logs.shift();
            }
          }
        }
      };

      child.stdout?.on('data', (data) => addLog('stdout', data));
      child.stderr?.on('data', (data) => addLog('stderr', data));

      child.on('close', (code) => {
        state.isComplete = true;
        state.exitCode = code;
        state.process = null;
      });

      return child;
    })();

    state.startPromise = startup;
    startup
      .catch(() => {})
      .finally(() => {
        if (state.startPromise === startup) {
          state.startPromise = null;
        }
      });

    return startup;
  },

  getState: () => ({
    isRunning: (!!state.process || !!state.startPromise) && !state.isComplete,
    isComplete: state.isComplete,
    exitCode: state.exitCode,
    logs: state.logs,
  }),
};
