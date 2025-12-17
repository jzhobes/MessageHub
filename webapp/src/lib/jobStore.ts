export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  status: JobStatus;
  progress: number;
  total: number;
  message?: string;
  resultPath?: string;
  error?: string;
  createdAt: number;
}

// Global store to persist across hot reloads in dev
const globalWithJobs = global as typeof globalThis & {
  _jobStore: Map<string, Job>;
};

if (!globalWithJobs._jobStore) {
  globalWithJobs._jobStore = new Map<string, Job>();
}

export const jobStore = {
  create: (id: string) => {
    const job: Job = {
      id,
      status: 'pending',
      progress: 0,
      total: 0,
      createdAt: Date.now(),
    };
    globalWithJobs._jobStore.set(id, job);
    return job;
  },

  get: (id: string) => {
    return globalWithJobs._jobStore.get(id);
  },

  update: (id: string, updates: Partial<Job>) => {
    const job = globalWithJobs._jobStore.get(id);
    if (job) {
      Object.assign(job, updates);
    }
  },

  cleanup: (olderThanMs: number = 3600000, onRemove?: (job: Job) => void) => {
    // Optional: Clear old jobs
    const now = Date.now();
    for (const [id, job] of globalWithJobs._jobStore.entries()) {
      if (now - job.createdAt > olderThanMs) {
        if (onRemove) {
          try {
            onRemove(job);
          } catch (e) {
            console.error('Failed to cleanup job artifact', e);
          }
        }
        globalWithJobs._jobStore.delete(id);
      }
    }
  },
};
