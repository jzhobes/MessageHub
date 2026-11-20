import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Head from 'next/head';
import Link from 'next/link';
import { FaArrowLeft, FaCog, FaRobot } from 'react-icons/fa';
import { FiMoon, FiSun } from 'react-icons/fi';

import layoutStyles from '@/components/Layout.module.css';
import DemoInfoModal from '@/components/modals/DemoInfoModal';
import SetupModal from '@/components/modals/SetupModal';
import ThreadPreviewModal from '@/components/modals/ThreadPreviewModal';
import TextInput from '@/components/TextInput';
import Tooltip from '@/components/Tooltip';

import { useDatasetGeneration } from '@/hooks/useDatasetGeneration';
import { useForm } from '@/hooks/useForm';
import { usePersonaFilter } from '@/hooks/usePersonaFilter';
import { useTheme } from '@/hooks/useTheme';

import { apiFetch } from '@/lib/client/apiClient';
import { IS_DEMO_MODE, withBasePath } from '@/lib/client/env';
import { getPlatformLabel } from '@/lib/shared/platforms';
import { DatasetEntry, Thread } from '@/lib/shared/types';
import styles from '@/pages/studio.module.css';
import { StudioConfig } from '@/sections/StudioConfig';
import { StudioControls } from '@/sections/StudioControls';
import { StudioThreadList } from '@/sections/StudioThreadList';

/**
 * Main state for the DataForge Studio configuration.
 */
const initialState = {
  identityNames: '',
  personaTag: '',
  customInstructions: '',
  includeGroupNames: true,
  mergeSequential: true,
  removeSystemMessages: true,
  imputeReactions: true,
  redactPII: true,
  exportTarget: 'customgpt',
  customSplit: false,
  customSessionLimit: '8000',
  customFileLimit: '2000000',
  datasetName: 'virtual_me',
  recencyFilter: 'all',
};

const initialFilterState = {
  filterPlatforms: new Set<string>(),
  filterTypes: new Set<string>(), // Empty = All types
  excludeNoise: true,
  minQuality: 30,
};

// Templates moved to StudioConfig.tsx
function calculateDateRange(recency: string): { start: number; end: number } | undefined {
  if (recency === 'all') {
    return undefined;
  }

  const now = Date.now();
  let ms = 0;
  switch (recency) {
    case '6m':
      ms = 6 * 30 * 24 * 60 * 60 * 1000;
      break;
    case '1y':
      ms = 365 * 24 * 60 * 60 * 1000;
      break;
    case '2y':
      ms = 2 * 365 * 24 * 60 * 60 * 1000;
      break;
    case '5y':
      ms = 5 * 365 * 24 * 60 * 60 * 1000;
      break;
    default:
      return undefined;
  }

  return { start: now - ms, end: now };
}

export default function Studio() {
  // --- Core State ---
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // --- UI State ---
  const [warmupStatus, setWarmupStatus] = useState<string | null>(null);
  const [warmupProgress, setWarmupProgress] = useState(0);
  const [warmupDetails, setWarmupDetails] = useState<string | null>(null);
  const [fadingOut, setFadingOut] = useState(false);
  const [activePreviewThread, setActivePreviewThread] = useState<Thread | null>(null);
  const [isPreviewThreadOpen, setIsPreviewThreadOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewData, setPreviewData] = useState<DatasetEntry[] | null>(null);
  const [previewMarkdownFiles, setPreviewMarkdownFiles] = useState<{ fileName: string; content: string }[] | null>(
    null,
  );
  const [analyzingStyle, setAnalyzingStyle] = useState(false);

  // --- ChatGPT Project Day-Selection State ---
  const [selectedDaysByThread, setSelectedDaysByThread] = useState<Record<string, string[]>>({});
  const [dayStatsByThread, setDayStatsByThread] = useState<
    Record<string, Record<string, { totalMsgs: number; myMsgs: number }>>
  >({});
  const [eventCountsByThread, setEventCountsByThread] = useState<Record<string, number>>({});
  const [scanningThreadIds, setScanningThreadIds] = useState<Set<string>>(new Set());
  const manuallyEditedThreadsRef = useRef<Set<string>>(new Set());
  const scannedRecencyByThreadRef = useRef<Record<string, string>>({});
  const inFlightScanRecencyRef = useRef<Record<string, string>>({});
  const scanAbortRef = useRef<AbortController | null>(null);

  // --- Custom Hooks ---
  const { generating, progress, generate: startDatasetGeneration } = useDatasetGeneration();
  const { theme, toggleTheme, mounted } = useTheme();
  const { values: config, setField } = useForm(initialState);
  const { values: filters, setField: setFilterField } = useForm(initialFilterState);

  const isProjectMode = config.exportTarget === 'customgpt';

  const analyzeWorkerRef = useRef<Worker | null>(null);

  // Terminate style analysis worker on unmount
  useEffect(() => {
    return () => {
      analyzeWorkerRef.current?.terminate();
      analyzeWorkerRef.current = null;
    };
  }, []);

  // Fetch initial data
  useEffect(() => {
    async function init() {
      try {
        // Fetch threads (all platforms) using dataset-optimized API
        const res = await apiFetch(`/api/studio/dataset-threads?platform=all`);
        let allThreads: Thread[] = [];

        if (res.ok) {
          const data = await res.json();
          // Tag with platform if not already (API provides it)
          allThreads = data.map((t: Thread) => ({
            ...t,
            platform_source: getPlatformLabel(t.platform || ''),
          }));
        }

        setThreads(allThreads);

        // Fetch Identity
        const idRes = await apiFetch('/api/identity');
        if (idRes.ok) {
          const idData = await idRes.json();
          setField('identityNames', idData.names.join(', '));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [setField]);

  // Warmup AI Model on Mount
  useEffect(() => {
    const worker = new Worker(withBasePath('/workers/style-worker.js'), { type: 'module' });
    worker.postMessage({ type: 'preload' });

    worker.onmessage = (e) => {
      const { type, message, progress, details } = e.data;
      if (type === 'progress') {
        // Only show if it's actually doing something (loading model)
        setWarmupStatus(message);
        if (progress) {
          setWarmupProgress(progress);
        }
        if (details) {
          setWarmupDetails(details);
        }
      } else if (type === 'preload:complete') {
        setWarmupStatus('AI Ready');
        setWarmupProgress(100);
        setWarmupDetails(null);

        // Start fade out after 2.5s
        setTimeout(() => setFadingOut(true), 2500);

        // Remove completely after 3s (allowing 0.5s for fade out)
        setTimeout(() => {
          setWarmupStatus(null);
          setWarmupProgress(0);
          setFadingOut(false);
        }, 3000);
        worker.terminate();
      }
    };

    return () => worker.terminate();
  }, []);

  const { excludeNoise, minQuality, filterPlatforms, filterTypes } = filters;

  // Filtered List
  const visibleThreads = useMemo(() => {
    const NOISE_REGEX =
      /\b(verify|code|otp|dhl|ups|usps|fedex|delivery|order|track|notification|alert|info|reply|service|uber|doordash|grab|lyft|banking|bank|security|auth|ticket|support|no-reply|noreply|mailer|daemon|facebook|instagram|google)\b/i;

    return threads.filter((t) => {
      // 0. Quality Filter
      if ((t.qualityScore || 0) < minQuality) {
        return false;
      }
      // 1. Platform Filter
      if (filterPlatforms.size > 0 && t.platform && !filterPlatforms.has(t.platform)) {
        return false;
      }
      // 2. Type Filter
      if (filterTypes.size > 0 && t.type && !filterTypes.has(t.type)) {
        return false;
      }
      // 3. Noise Filter
      if (excludeNoise) {
        if ((t.myMessageCount || 0) === 0) {
          return false;
        }
        if (NOISE_REGEX.test(t.title)) {
          return false;
        }
      }
      return true;
    });
  }, [threads, excludeNoise, filterPlatforms, filterTypes, minQuality]);

  // --- Style Filtering ---
  const { activePersonas, scanningLabels, handleTogglePersona, personaCounts } = usePersonaFilter({
    visibleThreads,
    setSelectedIds,
  });

  const platformCounts = useMemo(() => {
    const NOISE_REGEX =
      /\b(verify|code|otp|dhl|ups|usps|fedex|delivery|order|track|notification|alert|info|reply|service|uber|doordash|grab|lyft|banking|bank|security|auth|ticket|support|no-reply|noreply|mailer|daemon|facebook|instagram|google)\b/i;

    const counts: Record<string, number> = {};
    let total = 0;

    threads.forEach((t) => {
      // Respect Quality Filter
      if ((t.qualityScore || 0) < minQuality) {
        return;
      }

      // Respect Noise Filter for counts
      if (excludeNoise) {
        if ((t.myMessageCount || 0) === 0) {
          return;
        }
        if (NOISE_REGEX.test(t.title)) {
          return;
        }
      }
      const p = t.platform || 'Other';
      counts[p] = (counts[p] || 0) + 1;

      if (t.platform === 'facebook' && t.type) {
        const typeKey = t.type; // Use the type label directly (message, post, event)
        counts[typeKey] = (counts[typeKey] || 0) + 1;
        // Also keep composite for the component fallback if needed
        counts[`facebook:${t.type}`] = (counts[`facebook:${t.type}`] || 0) + 1;
      }

      total++;
    });
    counts['All'] = total;
    return counts;
  }, [threads, excludeNoise, minQuality]);
  const visibleSelectedThreads = useMemo(
    () => visibleThreads.filter((t) => selectedIds.has(t.id)),
    [visibleThreads, selectedIds],
  );

  // Auto-scan best days for newly selected threads (or on recency change for non-edited threads) in Project mode.
  // Waits while persona scanning is actively streaming selections, debounces rapid clicks,
  // deduplicates in-flight IDs, and sends sequential chunks so bulk selection never floods the server.
  useEffect(() => {
    if (!isProjectMode || selectedIds.size === 0 || scanningLabels.size > 0) {
      return;
    }

    const recency = config.recencyFilter;
    const toScan = Array.from(selectedIds).filter((id) => {
      if (inFlightScanRecencyRef.current[id] === recency) {
        return false;
      }
      const prevRecency = scannedRecencyByThreadRef.current[id];
      if (!prevRecency) {
        return true;
      }
      if (prevRecency !== recency && !manuallyEditedThreadsRef.current.has(id)) {
        return true;
      }
      return false;
    });

    if (toScan.length === 0) {
      return;
    }

    const timer = setTimeout(() => {
      const CHUNK_SIZE = 15;
      const names = config.identityNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      const dateRange = calculateDateRange(recency);

      // Re-filter at fire time so we never duplicate an ID that started scanning during debounce
      const pendingIds = toScan.filter((id) => {
        if (inFlightScanRecencyRef.current[id] === recency) {
          return false;
        }
        const prevRecency = scannedRecencyByThreadRef.current[id];
        return !prevRecency || (prevRecency !== recency && !manuallyEditedThreadsRef.current.has(id));
      });

      if (pendingIds.length === 0) {
        return;
      }

      pendingIds.forEach((id) => {
        inFlightScanRecencyRef.current[id] = recency;
      });
      setScanningThreadIds((prev) => {
        const next = new Set(prev);
        pendingIds.forEach((id) => next.add(id));
        return next;
      });

      const controller = new AbortController();
      scanAbortRef.current = controller;

      (async () => {
        try {
          for (let i = 0; i < pendingIds.length; i += CHUNK_SIZE) {
            if (controller.signal.aborted) {
              break;
            }
            const chunk = pendingIds.slice(i, i + CHUNK_SIZE);
            try {
              const res = await apiFetch('/api/studio/sample-thread-days', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  threadIds: chunk,
                  identityNames: names,
                  dateRange,
                  timeZone,
                }),
                signal: controller.signal,
              });
              if (!res.ok || controller.signal.aborted) {
                continue;
              }
              const data = await res.json();
              if (controller.signal.aborted || !data?.results) {
                continue;
              }

              const results = data.results as Record<
                string,
                {
                  selectedDays: string[];
                  dayStats: Record<string, { totalMsgs: number; myMsgs: number }>;
                  totalSelectedMsgs: number;
                  isEvent?: boolean;
                }
              >;

              setSelectedDaysByThread((prev) => {
                const next = { ...prev };
                for (const id of chunk) {
                  if (results[id] && !manuallyEditedThreadsRef.current.has(id)) {
                    next[id] = results[id].selectedDays || [];
                  }
                }
                return next;
              });

              setDayStatsByThread((prev) => {
                const next = { ...prev };
                for (const id of chunk) {
                  if (results[id]) {
                    next[id] = results[id].dayStats || {};
                  }
                }
                return next;
              });

              setEventCountsByThread((prev) => {
                const next = { ...prev };
                for (const id of chunk) {
                  if (results[id]?.isEvent) {
                    next[id] = results[id].totalSelectedMsgs || 0;
                  }
                }
                return next;
              });

              for (const id of chunk) {
                scannedRecencyByThreadRef.current[id] = recency;
              }
            } catch (e) {
              if (e instanceof Error && e.name === 'AbortError') {
                break;
              }
              console.error('Failed to scan thread days:', e);
            } finally {
              chunk.forEach((id) => {
                if (inFlightScanRecencyRef.current[id] === recency) {
                  delete inFlightScanRecencyRef.current[id];
                }
              });
              setScanningThreadIds((prev) => {
                const next = new Set(prev);
                chunk.forEach((id) => next.delete(id));
                return next;
              });
            }
          }
        } finally {
          pendingIds.forEach((id) => {
            if (inFlightScanRecencyRef.current[id] === recency) {
              delete inFlightScanRecencyRef.current[id];
            }
          });
          setScanningThreadIds((prev) => {
            const next = new Set(prev);
            pendingIds.forEach((id) => next.delete(id));
            return next;
          });
        }
      })();
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [isProjectMode, selectedIds, scanningLabels.size, config.recencyFilter, config.identityNames]);

  // Abort any in-flight sample-thread-days requests on unmount or when recency/mode changes
  useEffect(() => {
    return () => {
      scanAbortRef.current?.abort();
      scanAbortRef.current = null;
      inFlightScanRecencyRef.current = {};
    };
  }, [isProjectMode, config.recencyFilter]);

  const handleToggleDay = useCallback((threadId: string, dayKey: string) => {
    manuallyEditedThreadsRef.current.add(threadId);
    setSelectedDaysByThread((prev) => {
      const current = new Set(prev[threadId] || []);
      const willAdd = !current.has(dayKey);
      if (willAdd) {
        current.add(dayKey);
      } else {
        current.delete(dayKey);
      }
      if (willAdd) {
        setSelectedIds((prevIds) => {
          if (prevIds.has(threadId)) {
            return prevIds;
          }
          const nextIds = new Set(prevIds);
          nextIds.add(threadId);
          return nextIds;
        });
      }
      return { ...prev, [threadId]: Array.from(current).sort() };
    });
  }, []);

  const handleClearDays = useCallback((threadId: string) => {
    manuallyEditedThreadsRef.current.delete(threadId);
    delete scannedRecencyByThreadRef.current[threadId];
    setSelectedDaysByThread((prev) => ({ ...prev, [threadId]: [] }));
    setSelectedIds((prevIds) => {
      if (!prevIds.has(threadId)) {
        return prevIds;
      }
      const nextIds = new Set(prevIds);
      nextIds.delete(threadId);
      return nextIds;
    });
  }, []);

  const handleOpenThreadPreview = useCallback(
    (id: string) => {
      const found = threads.find((t) => t.id === id);
      if (!found) {
        return;
      }
      setActivePreviewThread(found);
      setIsPreviewThreadOpen(true);

      // Populate dayStats for unselected threads opened in Project mode so Day Header counts render
      if (isProjectMode && !dayStatsByThread[id] && !id.startsWith('fb-event-')) {
        const names = config.identityNames
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
        apiFetch('/api/studio/sample-thread-days', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadIds: [id],
            identityNames: names,
            timeZone,
          }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.results?.[id]) {
              setDayStatsByThread((prev) => ({
                ...prev,
                [id]: data.results[id].dayStats || {},
              }));
            }
          })
          .catch(() => {});
      }
    },
    [threads, isProjectMode, dayStatsByThread, config.identityNames],
  );

  async function handlePreview() {
    if (visibleSelectedThreads.length === 0) {
      alert('Select some threads first to preview the dataset.');
      return;
    }

    setPreviewing(true);
    try {
      const names = config.identityNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

      const res = await apiFetch('/api/studio/preview-dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadIds: visibleSelectedThreads.map((t) => t.id),
          identityNames: names,
          includeGroupSpeakerNames: config.includeGroupNames,
          mergeSequential: config.mergeSequential,
          removeSystemMessages: config.removeSystemMessages,
          imputeReactions: config.imputeReactions,
          redactPII: config.redactPII,
          personaTag: config.personaTag.trim(),
          customInstructions: config.customInstructions.trim(),
          skipSystemMessages: isProjectMode,
          outputFormat: isProjectMode ? 'markdown' : 'jsonl',
          selectedDaysByThread: isProjectMode ? selectedDaysByThread : undefined,
          datasetName: config.datasetName.trim() || 'virtual_me',
          timeZone,
          dateRange: calculateDateRange(config.recencyFilter),
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to generate preview');
      }
      const data = await res.json();
      if (data.format === 'markdown') {
        setPreviewMarkdownFiles(data.files || []);
        setPreviewData(null);
      } else {
        setPreviewData(data.sessions);
        setPreviewMarkdownFiles(null);
      }
    } catch (e) {
      console.error(e);
      alert('Preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleAnalyzeStyle() {
    if (selectedIds.size === 0) {
      alert('Select some threads first to analyze your style.');
      return;
    }

    setAnalyzingStyle(true);
    setStatusMessage('Fetching sample messages...');
    setField('personaTag', ''); // Clear input on start

    try {
      // 1. Fetch sample messages
      const res = await apiFetch('/api/studio/sample-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadIds: visibleSelectedThreads.map((t) => t.id),
          limit: 100,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to fetch sample messages');
      }
      const { messages } = await res.json();

      if (messages.length === 0) {
        alert('No messages found from you in the selected threads.');
        setAnalyzingStyle(false);
        return;
      }

      // 2. Run Worker
      setStatusMessage('Initializing AI...');
      analyzeWorkerRef.current?.terminate();
      const worker = new Worker(withBasePath('/workers/style-worker.js'), { type: 'module' });
      analyzeWorkerRef.current = worker;

      worker.onmessage = (e) => {
        const { type, message, suggestions, error, progress } = e.data;
        if (type === 'analyze:status') {
          setStatusMessage(message);
          setDownloadProgress(0);
        } else if (type === 'progress') {
          setStatusMessage(message);
          if (progress) {
            setDownloadProgress(progress);
          }
        } else if (type === 'analyze:result') {
          setAnalyzingStyle(false);
          setStatusMessage(null);
          setDownloadProgress(0);
          const nextTags = [...new Set(suggestions)];
          setField('personaTag', nextTags.join(', '));
          analyzeWorkerRef.current = null;
          worker.terminate();
        } else if (type === 'error') {
          // If the error string contains the known harmless warning, ignore it
          if (error && typeof error === 'string' && error.includes('VerifyEachNodeIsAssignedToAnEp')) {
            return;
          }
          setAnalyzingStyle(false);
          setStatusMessage(null);
          setDownloadProgress(0);
          alert('AI Analysis failed: ' + error);
          analyzeWorkerRef.current = null;
          worker.terminate();
        }
      };

      worker.postMessage({ type: 'analyze', messages });
    } catch (e) {
      console.error(e);
      alert('Analysis failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
      setAnalyzingStyle(false);
    }
  }

  async function handleGenerate() {
    if (visibleSelectedThreads.length === 0) {
      return;
    }

    const names = config.identityNames
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

    await startDatasetGeneration(
      {
        threadIds: visibleSelectedThreads.map((t) => t.id),
        identityNames: names,
        includeGroupSpeakerNames: config.includeGroupNames,
        mergeSequential: config.mergeSequential,
        removeSystemMessages: config.removeSystemMessages,
        imputeReactions: config.imputeReactions,
        redactPII: config.redactPII,
        splitDataset: config.exportTarget === 'custom' ? config.customSplit : isProjectMode,
        maxTokensPerFile:
          config.exportTarget === 'custom' && config.customSplit
            ? parseInt(config.customFileLimit) || 2000000
            : isProjectMode
              ? 1900000
              : undefined,
        maxTokensPerSession:
          config.exportTarget === 'custom'
            ? parseInt(config.customSessionLimit) || Infinity
            : isProjectMode
              ? 2000 // Increased from 800 for better email/long-thread support
              : 12000, // Increased from 8k for modern GPT-4o style fine-tuning
        personaTag: config.personaTag.trim(),
        customInstructions: config.customInstructions.trim(),
        skipSystemMessages: isProjectMode,
        outputFormat: isProjectMode ? 'markdown' : 'jsonl',
        selectedDaysByThread: isProjectMode ? selectedDaysByThread : undefined,
        timeZone,
        datasetName: config.datasetName.trim(),
        dateRange: calculateDateRange(config.recencyFilter),
      },
      config.datasetName,
    );
  }

  // Realistic Token Estimation
  const estimatedTokens = useMemo(() => {
    let total = 0;
    visibleSelectedThreads.forEach((t) => {
      // 0. Recency Heuristic: If thread's last message is older than the filter, skip estimation for it.
      const range = calculateDateRange(config.recencyFilter);
      if (range && t.timestamp < range.start) {
        return;
      }

      // average message length in characters
      const avgLen = t.myAvgMessageLength || 40;
      const msgCount = t.messageCount || 0;

      // Realistic Turn-based heuristic
      const myCount = t.myMessageCount || 0;
      const otherCount = Math.max(0, msgCount - myCount);

      let effectiveMsgs = 0;
      if (t.platform === 'google_mail' || t.platform === 'gmail') {
        // Enforced 1:1. Only pairs where we have both an inbound and an outbound.
        effectiveMsgs = Math.min(myCount, otherCount) * 2;
      } else if (t.type === 'post' || t.type === 'event') {
        // Each post/event becomes a session with a synthetic user prompt + assistant response.
        effectiveMsgs = myCount * 2;
      } else {
        // Regular chat: we drop one-sided sessions.
        if (myCount > 0 && otherCount > 0) {
          effectiveMsgs = Math.min(myCount, otherCount) * 2;
        }
      }

      // 1. Content Tokens: Roughly 4 characters per token
      let tokens = (effectiveMsgs * avgLen) / 4.0;

      // 2. Message Overhead: ~5 tokens per message for JSON framing and roles
      tokens += effectiveMsgs * 5;

      // 3. System message & Persona overhead
      if (config.exportTarget !== 'customgpt') {
        const estSessions = t.platform === 'google_mail' || t.platform === 'gmail' ? Math.min(myCount, otherCount) : 1;

        let systemOverhead = 60; // Base system prompt
        if (config.personaTag) {
          systemOverhead += 15;
        }
        if (config.customInstructions) {
          systemOverhead += 30;
        }

        tokens += estSessions * systemOverhead;
      }

      total += tokens;
    });

    return Math.round(total);
  }, [visibleSelectedThreads, config.exportTarget, config.personaTag, config.customInstructions, config.recencyFilter]);

  const projectStats = useMemo(() => {
    let totalDays = 0;
    let totalMessages = 0;
    for (const t of visibleSelectedThreads) {
      if (t.id.startsWith('fb-event-')) {
        totalMessages += eventCountsByThread[t.id] ?? t.messageCount ?? 0;
        continue;
      }
      const days = selectedDaysByThread[t.id] || [];
      totalDays += days.length;
      const stats = dayStatsByThread[t.id] || {};
      for (const d of days) {
        totalMessages += stats[d]?.totalMsgs || 0;
      }
    }
    return { totalDays, totalMessages };
  }, [visibleSelectedThreads, selectedDaysByThread, dayStatsByThread, eventCountsByThread]);

  // Validity Calculation
  const avgSelectedScore = useMemo(() => {
    if (visibleSelectedThreads.length === 0) {
      return 0;
    }
    const totalScore = visibleSelectedThreads.reduce((acc, t) => acc + (t.qualityScore ?? 0), 0);
    return Math.round(totalScore / visibleSelectedThreads.length);
  }, [visibleSelectedThreads]);

  function getValidityLabel(score: number) {
    if (score >= 80) {
      return { label: 'Excellent', color: '#10b981' };
    }
    if (score >= 60) {
      return { label: 'Good', color: '#3b82f6' };
    }
    if (score >= 40) {
      return { label: 'Mixed', color: '#f59e0b' };
    }
    return { label: 'Low Quality', color: '#ef4444' };
  }

  const validity = getValidityLabel(avgSelectedScore);

  const hasMixedEvents = useMemo(() => {
    const hasEvents = visibleSelectedThreads.some((t) => t.type === 'event');
    const hasOthers = visibleSelectedThreads.some((t) => t.type !== 'event');
    return hasEvents && hasOthers;
  }, [visibleSelectedThreads]);

  return (
    <div className={layoutStyles.container} data-theme={theme}>
      <Head>
        <title>DataForge AI - MessageHub</title>
      </Head>

      {IS_DEMO_MODE ? (
        <DemoInfoModal isOpen={showSetup} onClose={() => setShowSetup(false)} />
      ) : (
        <SetupModal
          isOpen={showSetup}
          initialStep={2}
          isFirstRun={false}
          onClose={() => setShowSetup(false)}
          onCompleted={() => window.location.reload()}
        />
      )}
      <div className={layoutStyles.topBar}>
        <div className={layoutStyles.leftSection}>
          <Tooltip content="Back to MessageHub" align="start">
            <Link href="/" className={layoutStyles.iconButton} aria-label="Back to MessageHub">
              <FaArrowLeft />
            </Link>
          </Tooltip>

          <div className={styles.mobileHidden} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Link aria-label="Back to MessageHub" className={layoutStyles.appTitle} href="/" prefetch={false}>
              <span>💬</span>
              <span>MessageHub</span>
            </Link>

            <span style={{ fontSize: '1.5rem', color: 'var(--text-secondary)', fontWeight: 300 }}>/</span>
          </div>

          <div className={layoutStyles.appTitle} style={{ cursor: 'default', whiteSpace: 'nowrap' }}>
            <FaRobot style={{ marginRight: 8, flexShrink: 0 }} />
            <span>DataForge AI</span>
          </div>

          <div className={styles.headerTagline}>[Craft your authentic AI persona]</div>
        </div>

        <div className={layoutStyles.searchSection} />

        <div className={layoutStyles.themeToggleWrapper}>
          {IS_DEMO_MODE ? (
            <Tooltip content="About Interactive Demo" align="end">
              <button
                className={layoutStyles.demoBadge}
                aria-label="About Interactive Demo"
                type="button"
                onClick={() => setShowSetup(true)}
              >
                <span className={layoutStyles.demoBadgeDot} />
                <span>Demo</span>
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="Setup" align="end">
              <button
                className={`${layoutStyles.iconButton} ${layoutStyles.headerIconBtn}`}
                aria-label="Setup"
                style={{ marginRight: 8 }}
                onClick={() => setShowSetup(true)}
              >
                <FaCog size={20} />
              </button>
            </Tooltip>
          )}
          <Tooltip content={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'} align="end">
            <button
              className={`${layoutStyles.iconButton} ${layoutStyles.headerIconBtn}`}
              aria-label={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
              onClick={toggleTheme}
            >
              {!mounted || theme === 'light' ? <FiMoon size={20} /> : <FiSun size={20} />}
            </button>
          </Tooltip>
        </div>
      </div>

      <div className={layoutStyles.bodyContent}>
        <div className={styles.container} style={{ height: '100%', width: '100%' }}>
          {/* Left Pane: Selection */}
          <div className={styles.leftPane}>
            <div className={styles.paneHeader}>Select Threads</div>

            <StudioControls
              visibleThreads={visibleThreads}
              selectedIds={selectedIds}
              filterPlatforms={filters.filterPlatforms}
              filterTypes={filters.filterTypes}
              activePersonas={activePersonas}
              scanningLabels={scanningLabels}
              excludeNoise={filters.excludeNoise}
              minQuality={filters.minQuality}
              analyzing={scanningLabels.size > 0}
              platformCounts={platformCounts}
              personaCounts={personaCounts}
              onSelectionChange={setSelectedIds}
              onFilterChange={(val) => setFilterField('filterPlatforms', val)}
              onTogglePersona={handleTogglePersona}
              onControlChange={setFilterField}
            />

            <StudioThreadList
              loading={loading}
              threads={visibleThreads}
              selectedIds={selectedIds}
              isProjectMode={isProjectMode}
              selectedDaysByThread={selectedDaysByThread}
              dayStatsByThread={dayStatsByThread}
              scanningThreadIds={scanningThreadIds}
              onChange={setSelectedIds}
              onPreview={handleOpenThreadPreview}
            />
          </div>

          {/* Main Content Area */}
          <div className={styles.mainPane}>
            <div className={styles.contentWrapper}>
              <div className={styles.configPane}>
                <StudioConfig
                  config={config}
                  analyzingStyle={analyzingStyle}
                  selectedCount={visibleSelectedThreads.length}
                  statusMessage={statusMessage}
                  downloadProgress={downloadProgress}
                  onFieldChange={setField}
                  onAnalyzeStyle={handleAnalyzeStyle}
                />
              </div>

              <div className={styles.outputPane}>
                <div className={styles.outputBubble}>
                  <h3 className={styles.sectionTitle} style={{ marginTop: 0 }}>
                    Quality & Output
                  </h3>

                  <div style={{ marginBottom: 24 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 8,
                        alignItems: 'center',
                      }}
                    >
                      <span className={styles.label}>Target Platform</span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {config.exportTarget === 'finetune'
                          ? 'Single File (Max Context)'
                          : isProjectMode
                            ? 'Markdown Reference Files'
                            : 'Manual Setup'}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 0,
                      }}
                    >
                      <button
                        className={`btn-reset ${styles.segmentedBtn} ${isProjectMode ? styles.active : ''}`}
                        onClick={() => setField('exportTarget', 'customgpt')}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600 }}>ChatGPT</span>
                        <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}>Project</span>
                      </button>
                      <button
                        className={`btn-reset ${styles.segmentedBtn} ${config.exportTarget === 'finetune' ? styles.active : ''}`}
                        onClick={() => setField('exportTarget', 'finetune')}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600 }}>OpenAI</span>
                        <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}>Fine-Tuning</span>
                      </button>
                      <button
                        className={`btn-reset ${styles.segmentedBtn} ${config.exportTarget === 'custom' ? styles.active : ''}`}
                        onClick={() => setField('exportTarget', 'custom')}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600 }}>Custom</span>
                      </button>
                    </div>
                  </div>

                  <div style={{ marginBottom: 24 }}>
                    <label className={styles.label} style={{ marginBottom: 8, display: 'block' }}>
                      {isProjectMode ? 'Filename' : 'Dataset Filename'}
                    </label>
                    <TextInput
                      value={config.datasetName}
                      placeholder="e.g. virtual_me"
                      suffix={
                        <span style={{ color: 'var(--text-secondary)', paddingRight: 12 }}>
                          {isProjectMode ? '.md' : '.jsonl'}
                        </span>
                      }
                      onChange={(e) => setField('datasetName', e.target.value)}
                    />
                    <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                      {isProjectMode
                        ? 'All selected content is combined into one Markdown file with this name. A separate verification summary is included.'
                        : 'Used as the base name for exported files.'}
                    </p>
                  </div>

                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      background: 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-1)',
                      border: '1px solid var(--border-color)',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {config.exportTarget === 'finetune' && (
                      <div>
                        <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                          Profile: OpenAI API Fine-Tuning
                        </strong>
                        <ul style={{ paddingLeft: 16, margin: 0, lineHeight: 1.5 }}>
                          <li>Generates a single optimized JSONL file.</li>
                          <li>Enforces an 8,000 token limit per line (Safe context).</li>
                        </ul>
                      </div>
                    )}
                    {isProjectMode && (
                      <div>
                        <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                          Profile: ChatGPT Project Reference Files
                        </strong>
                        <ul style={{ paddingLeft: 16, margin: 0, lineHeight: 1.5 }}>
                          <li>Exports verbatim Markdown samples split by type (Groups, DMs, Posts, Emails, Events).</li>
                          <li>
                            Auto-selects ~100 representative messages per thread; click any thread to adjust days.
                          </li>
                        </ul>
                      </div>
                    )}
                    {config.exportTarget === 'custom' && (
                      <div>
                        <div style={{ marginBottom: 12 }}>
                          <label className={styles.label} style={{ marginBottom: 4, display: 'block' }}>
                            Max Tokens Per File
                          </label>
                          <TextInput
                            value={config.customFileLimit}
                            disabled={!config.customSplit}
                            placeholder="e.g. 2000000"
                            adornment={
                              <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px' }}>
                                <Tooltip content="Enable file splitting">
                                  <input
                                    type="checkbox"
                                    checked={config.customSplit}
                                    aria-label="Enable file splitting"
                                    style={{
                                      width: 16,
                                      height: 16,
                                      accentColor: 'var(--bubble-sent-bg)',
                                      cursor: 'pointer',
                                    }}
                                    onChange={(e) => setField('customSplit', e.target.checked)}
                                  />
                                </Tooltip>
                              </div>
                            }
                            onChange={(e) => setField('customFileLimit', e.target.value)}
                          />
                          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                            {config.customSplit
                              ? 'Files will be split when this token limit is reached.'
                              : 'Unchecked: Dataset will be exported as a single file.'}
                          </p>
                        </div>
                        <div>
                          <label className={styles.label} style={{ marginBottom: 4, display: 'block' }}>
                            Max Tokens Per Session (Line)
                          </label>
                          <TextInput
                            value={config.customSessionLimit}
                            placeholder="e.g. 8000"
                            onChange={(e) => setField('customSessionLimit', e.target.value)}
                          />
                          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                            Recommended: 800 for Knowledge / Search, 8,000+ for Fine-Tuning.
                          </p>
                        </div>
                      </div>
                    )}
                    <div
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: '1px solid var(--border-color)',
                        fontSize: 11,
                        fontStyle: 'italic',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <strong>Quick Tip:</strong>
                      <br />
                      {isProjectMode ? (
                        <>
                          Select up to <strong>~5 group chats</strong> and <strong>~5 DMs</strong> (~1,000 total
                          messages) for balanced voice coverage, then upload the generated <code>.md</code> files to
                          your ChatGPT Project.
                        </>
                      ) : (
                        <>
                          Use <strong>Knowledge / Search</strong> (800) to help AI find specific facts in your history.
                          Use <strong>Fine-Tuning</strong> (8k) to teach the AI your overall writing style.
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ marginBottom: 20, marginTop: 24 }}>
                    <span className={styles.label}>Selected Statistics:</span>
                    {isProjectMode ? (
                      <div className={styles.statsGroup}>
                        <div>
                          <div className={styles.statValue}>{visibleSelectedThreads.length.toLocaleString()}</div>
                          <div className={styles.statLabel}>Threads</div>
                        </div>
                        <div>
                          <div className={styles.statValue}>{projectStats.totalDays.toLocaleString()}</div>
                          <div className={styles.statLabel}>Days</div>
                        </div>
                        <div>
                          <div className={styles.statValue}>
                            {scanningThreadIds.size > 0 ? '...' : projectStats.totalMessages.toLocaleString()}
                          </div>
                          <div className={styles.statLabel}>Messages</div>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.statsGroup}>
                        <div>
                          <div className={styles.statValue}>{visibleSelectedThreads.length.toLocaleString()}</div>
                          <div className={styles.statLabel}>Threads</div>
                        </div>
                        <div>
                          <div className={styles.statValue}>~{estimatedTokens.toLocaleString()}</div>
                          <div className={styles.statLabel}>Est. Tokens</div>
                        </div>
                        <div>
                          <div className={styles.statValue} style={{ color: validity.color }}>
                            {avgSelectedScore}
                          </div>
                          <div className={styles.statLabel}>Avg Quality ({validity.label})</div>
                        </div>
                      </div>
                    )}
                  </div>

                  {!isProjectMode && hasMixedEvents && (
                    <div className={styles.warningHint}>
                      <span style={{ fontSize: 16 }}>⚠️</span>
                      <span>
                        <strong>Mixed Formats Detected:</strong> Facebook Events use a specialized flat JSON format. It
                        is recommended to export Events as a dedicated dataset for optimal knowledge retrieval.
                      </span>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 12 }}>
                    <button
                      className="btn-secondary"
                      disabled={generating || previewing || visibleSelectedThreads.length === 0}
                      style={{ padding: '12px 20px' }}
                      onClick={handlePreview}
                    >
                      {previewing ? '...' : 'Preview'}
                    </button>
                    <button
                      className="btn-primary"
                      disabled={generating || previewing || visibleSelectedThreads.length === 0}
                      style={{ flex: 1, padding: '12px 20px' }}
                      onClick={handleGenerate}
                    >
                      {generating
                        ? `Processing... ${progress.total > 0 ? Math.round((progress.current / progress.total) * 100) + '%' : ''}`
                        : `Generate (${visibleSelectedThreads.length.toLocaleString()})`}
                    </button>
                  </div>
                  {generating && (
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 8 }}>
                      This may take a minute...
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ThreadPreviewModal
        isOpen={isPreviewThreadOpen}
        thread={activePreviewThread}
        selectionEnabled={isProjectMode}
        selectedDays={activePreviewThread ? new Set(selectedDaysByThread[activePreviewThread.id] || []) : undefined}
        dayStats={activePreviewThread ? dayStatsByThread[activePreviewThread.id] : undefined}
        onToggleDay={activePreviewThread ? (dayKey) => handleToggleDay(activePreviewThread.id, dayKey) : undefined}
        onClearDays={activePreviewThread ? () => handleClearDays(activePreviewThread.id) : undefined}
        onClose={() => setIsPreviewThreadOpen(false)}
        onAfterClose={() => setActivePreviewThread(null)}
      />

      {/* Markdown Project Preview Modal */}
      {previewMarkdownFiles && (
        <div className={styles.modalOverlay} onClick={() => setPreviewMarkdownFiles(null)}>
          <div className={styles.previewModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.previewModalHeader}>
              <h3>ChatGPT Project Markdown Preview</h3>
              <button className={styles.closeBtn} onClick={() => setPreviewMarkdownFiles(null)}>
                &times;
              </button>
            </div>
            <div className={styles.previewModalBody}>
              <p className={styles.helperText} style={{ marginBottom: 16 }}>
                Sample Markdown output from up to your first 3 selected threads.
              </p>
              {previewMarkdownFiles.length === 0 ? (
                <p className={styles.helperText}>No exportable messages found for the selected days.</p>
              ) : (
                previewMarkdownFiles.map((file, i) => (
                  <div key={i} className={styles.previewSession}>
                    <div className={styles.sessionBadge}>{file.fileName}</div>
                    <pre className={styles.messageContent} style={{ padding: '12px', margin: 0 }}>
                      {file.content}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dataset Preview Modal */}
      {previewData && (
        <div className={styles.modalOverlay} onClick={() => setPreviewData(null)}>
          <div className={styles.previewModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.previewModalHeader}>
              <h3>Dataset Preview (Most Recent 5 Sessions)</h3>
              <button className={styles.closeBtn} onClick={() => setPreviewData(null)}>
                &times;
              </button>
            </div>
            <div className={styles.previewModalBody}>
              <p className={styles.helperText} style={{ marginBottom: 16 }}>
                This is exactly how your data will be formatted for fine-tuning.
              </p>
              {previewData.map((session, i) => (
                <div key={i} className={styles.previewSession}>
                  <div className={styles.sessionBadge}>Session {i + 1}</div>
                  {session.messages.map((msg, j) => (
                    <div key={j} className={styles.previewMessage} data-role={msg.role}>
                      <div className={styles.messageRole}>{msg.role.toUpperCase()}</div>
                      <pre className={styles.messageContent}>{msg.content}</pre>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Floating Warmup Status */}
      {warmupStatus && (
        <div
          className={fadingOut ? styles.animateFadeOut : styles.animateSlideIn}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            padding: '10px 16px',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 6,
            minWidth: 200,
            maxWidth: 300,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 100,
            fontSize: 13,
            fontWeight: 500,
            backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
            {warmupStatus === 'AI Ready' ? (
              <span style={{ color: 'var(--bubble-sent-bg)', fontWeight: 'bold' }}>✓</span>
            ) : (
              <span style={{ fontSize: 16 }}>🤖</span>
            )}
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {warmupStatus}
            </span>
          </div>
          {warmupProgress > 0 && warmupProgress < 100 && (
            <div className={styles.miniProgress} style={{ width: '100%', margin: 0, height: 3 }}>
              <div className={styles.miniProgressFill} style={{ width: `${warmupProgress}%` }} />
            </div>
          )}
          {warmupDetails && (
            <div style={{ width: '100%', textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>
              {warmupDetails}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
