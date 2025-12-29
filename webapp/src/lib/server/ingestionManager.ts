import { ChildProcess, spawn } from 'child_process';

import { getIngestScriptPath, getPythonPath } from './python';
import appConfig from '../shared/appConfig';

interface IngestionState {
  process: ChildProcess | null;
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
    logs: [],
    isComplete: false,
    exitCode: null,
  };
}

const state = globalWithIngestion._ingestionState;

export const ingestionManager = {
  start: async (deleteArchives: boolean) => {
    if (state.process && !state.isComplete) {
      return state.process;
    }

    const dataDir = appConfig.WORKSPACE_PATH;
    const scriptPath = getIngestScriptPath();
    const pythonPath = await getPythonPath();

    const env = { ...process.env, WORKSPACE_PATH: dataDir, PYTHONUNBUFFERED: '1' };
    const args = ['-u', scriptPath];
    if (deleteArchives) {
      args.push('--delete-archives');
    }

    state.logs = [];
    state.isComplete = false;
    state.exitCode = null;
    state.process = spawn(pythonPath, args, { env });

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

    state.process.stdout?.on('data', (data) => addLog('stdout', data));
    state.process.stderr?.on('data', (data) => addLog('stderr', data));

    state.process.on('close', (code) => {
      state.isComplete = true;
      state.exitCode = code;
      state.process = null;
    });

    return state.process;
  },

  getState: () => ({
    isRunning: !!state.process && !state.isComplete,
    isComplete: state.isComplete,
    exitCode: state.exitCode,
    logs: state.logs,
  }),
};
