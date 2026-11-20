import { withBasePath } from '@/lib/client/env';
import { setDemoMediaManifest } from '@/lib/client/mediaUrl';

import type { DemoContentRow, DemoDataBundle, DemoThreadRow } from './demoTypes';

export interface DemoStore {
  data: DemoDataBundle;
  threadsById: Map<string, DemoThreadRow>;
  labelsByThread: Map<string, Set<string>>;
  contentByThread: Map<string, DemoContentRow[]>;
  contentById: Map<number, DemoContentRow>;
  myNames: string[];
}

let cachedStore: DemoStore | null = null;
let loadPromise: Promise<DemoStore> | null = null;

function buildStore(data: DemoDataBundle): DemoStore {
  const threadsById = new Map<string, DemoThreadRow>();
  for (const t of data.threads) {
    threadsById.set(t.id, t);
  }

  const labelsByThread = new Map<string, Set<string>>();
  for (const tl of data.thread_labels) {
    let set = labelsByThread.get(tl.thread_id);
    if (!set) {
      set = new Set<string>();
      labelsByThread.set(tl.thread_id, set);
    }
    set.add(tl.label);
  }

  const contentByThread = new Map<string, DemoContentRow[]>();
  const contentById = new Map<number, DemoContentRow>();
  for (const row of data.content) {
    contentById.set(row.id, row);
    let list = contentByThread.get(row.thread_id);
    if (!list) {
      list = [];
      contentByThread.set(row.thread_id, list);
    }
    list.push(row);
  }

  // Keep newest messages first, just like the SQLite query.
  for (const list of contentByThread.values()) {
    list.sort((a, b) => b.timestamp_ms - a.timestamp_ms || a.id - b.id);
  }

  const myNamesSet = new Set<string>(['Me']);
  for (const ident of data.identities || []) {
    if ((ident.is_me === 1 || ident.is_me === true) && (ident.id_type === 'name' || ident.id_type === 'email')) {
      myNamesSet.add(ident.id_value);
    }
  }

  setDemoMediaManifest(data.mediaManifest || {});

  return {
    data,
    threadsById,
    labelsByThread,
    contentByThread,
    contentById,
    myNames: Array.from(myNamesSet),
  };
}

/**
 * Load `/demo/data.json` on first use, build the lookup indexes, and register the media manifest
 * for `getMediaUrl`.
 */
export async function loadDemoData(): Promise<DemoStore> {
  if (cachedStore) {
    return cachedStore;
  }

  if (!loadPromise) {
    loadPromise = globalThis
      .fetch(withBasePath('/demo/data.json'))
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load demo data (${res.status})`);
        }
        const bundle = (await res.json()) as DemoDataBundle;
        cachedStore = buildStore(bundle);
        return cachedStore;
      })
      .catch((err) => {
        loadPromise = null;
        throw err;
      });
  }

  return loadPromise;
}

/**
 * Set or clear the in-memory `DemoDataBundle` for tests.
 */
export function setDemoDataForTest(bundle: DemoDataBundle | null): void {
  loadPromise = null;
  if (!bundle) {
    cachedStore = null;
    setDemoMediaManifest({});
    return;
  }
  cachedStore = buildStore(bundle);
}
