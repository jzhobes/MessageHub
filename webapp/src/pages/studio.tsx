import React, { useEffect, useMemo, useRef, useState } from 'react';

import Head from 'next/head';
import Link from 'next/link';
import { FaArrowLeft, FaCog, FaRobot } from 'react-icons/fa';
import { FiMoon, FiSun } from 'react-icons/fi';

import layoutStyles from '@/components/Layout.module.css';
import SetupModal from '@/components/modals/SetupModal';
import ThreadPreviewModal from '@/components/modals/ThreadPreviewModal';
import TextInput from '@/components/TextInput';

import { useForm } from '@/hooks/useForm';
import { usePersonaFilter } from '@/hooks/usePersonaFilter';
import { useTheme } from '@/hooks/useTheme';

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
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
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
  const [analyzingStyle, setAnalyzingStyle] = useState(false);

  // --- Custom Hooks ---
  const { theme, toggleTheme, mounted } = useTheme();
  const { values: config, setField } = useForm(initialState);
  const { values: filters, setField: setFilterField } = useForm(initialFilterState);

  const analyzeWorkerRef = useRef<Worker | null>(null);

  // Fetch initial data
  useEffect(() => {
    async function init() {
      try {
        // Fetch threads (all platforms) using dataset-optimized API
        const res = await fetch(`/api/studio/dataset-threads?platform=all`);
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
        const idRes = await fetch('/api/identity');
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
    const worker = new Worker('/workers/style-worker.js', { type: 'module' });
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

  async function handlePreview() {
    if (selectedIds.size === 0) {
      alert('Select some threads first to preview the dataset.');
      return;
    }

    setPreviewing(true);
    try {
      const names = config.identityNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch('/api/studio/preview-dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadIds: Array.from(selectedIds),
          identityNames: names,
          includeGroupSpeakerNames: config.includeGroupNames,
          mergeSequential: config.mergeSequential,
          removeSystemMessages: config.removeSystemMessages,
          imputeReactions: config.imputeReactions,
          redactPII: config.redactPII,
          personaTag: config.personaTag.trim(),
          customInstructions: config.customInstructions.trim(),
          skipSystemMessages: config.exportTarget === 'customgpt',
          dateRange: calculateDateRange(config.recencyFilter),
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to generate preview');
      }
      const data = await res.json();
      setPreviewData(data.sessions);
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
      const res = await fetch('/api/studio/sample-messages', {
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
      const worker = new Worker('/workers/style-worker.js', { type: 'module' });
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
    setGenerating(true);
    setProgress({ current: 0, total: 0 });

    try {
      const names = config.identityNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      // 1. Create Job
      const res = await fetch('/api/studio/generate-dataset', {
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
          splitDataset: config.exportTarget === 'custom' ? config.customSplit : config.exportTarget === 'customgpt',
          maxTokensPerFile:
            config.exportTarget === 'custom' && config.customSplit
              ? parseInt(config.customFileLimit) || 2000000
              : config.exportTarget === 'customgpt'
                ? 1900000
                : undefined,
          maxTokensPerSession:
            config.exportTarget === 'custom'
              ? parseInt(config.customSessionLimit) || Infinity
              : config.exportTarget === 'customgpt'
                ? 2000 // Increased from 800 for better email/long-thread support
                : 12000, // Increased from 8k for modern GPT-4o style fine-tuning
          personaTag: config.personaTag.trim(),
          customInstructions: config.customInstructions.trim(),
          skipSystemMessages: config.exportTarget === 'customgpt',
          datasetName: config.datasetName.trim(),
          dateRange: calculateDateRange(config.recencyFilter),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert('Error: ' + err.error);
        setGenerating(false);
        return;
      }

      const { jobId } = await res.json();

      // 2. Poll Status
      const poll = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/job-status?id=${jobId}`);
          if (!statusRes.ok) {
            return;
          } // Keep trying

          const job = await statusRes.json();

          setProgress({ current: job.progress ?? 0, total: job.total ?? 0 });

          if (job.status === 'completed') {
            clearInterval(poll);
            setGenerating(false);

            // Trigger Download
            const downloadUrl = `/api/studio/generate-dataset?jobId=${jobId}`;
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `${config.datasetName || 'virtual_me'}.zip`;
            document.body.appendChild(a);
            a.click(); // Browser handles download
            document.body.removeChild(a);
          } else if (job.status === 'failed') {
            clearInterval(poll);
            setGenerating(false);
            alert('Generation failed: ' + (job.error || 'Unknown error'));
          }
        } catch (e) {
          console.error('Polling error', e);
        }
      }, 1000);
    } catch (e) {
      console.error(e);
      alert('Generation failed to start');
      setGenerating(false);
    }
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

  const showTokenBar = config.exportTarget === 'customgpt';
  const tokenLimit = 2000000;
  const tokenPercent = (estimatedTokens / tokenLimit) * 100;
  const tokenBarColor = tokenPercent > 100 ? '#ef4444' : '#10b981';
  const tokenBarWidth = Math.min(tokenPercent, 100);

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

      <SetupModal
        isOpen={showSetup}
        initialStep={2}
        isFirstRun={false}
        onClose={() => setShowSetup(false)}
        onCompleted={() => window.location.reload()}
      />
      <div className={layoutStyles.topBar}>
        <div className={layoutStyles.leftSection}>
          <Link href="/" className={layoutStyles.iconButton} title="Back to MessageHub">
            <FaArrowLeft />
          </Link>

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
          <button
            className={`${layoutStyles.iconButton} ${layoutStyles.headerIconBtn}`}
            title="Setup"
            style={{ marginRight: 8 }}
            onClick={() => setShowSetup(true)}
          >
            <FaCog size={20} />
          </button>
          <button
            className={`${layoutStyles.iconButton} ${layoutStyles.headerIconBtn}`}
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            onClick={toggleTheme}
          >
            {!mounted || theme === 'light' ? <FiMoon size={20} /> : <FiSun size={20} />}
          </button>
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
              onChange={setSelectedIds}
              onPreview={(id) => {
                const t = threads.find((th) => th.id === id);
                if (t) {
                  setActivePreviewThread(t);
                  setIsPreviewThreadOpen(true);
                }
              }}
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
                          : config.exportTarget === 'customgpt'
                            ? '2M Token File Limit (Knowledge)'
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
                        className={`btn-reset ${styles.segmentedBtn} ${config.exportTarget === 'customgpt' ? styles.active : ''}`}
                        onClick={() => setField('exportTarget', 'customgpt')}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600 }}>ChatGPT</span>
                        <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}>Custom GPT</span>
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
                      Dataset Filename
                    </label>
                    <TextInput
                      value={config.datasetName}
                      placeholder="e.g. virtual_me"
                      suffix={<span style={{ color: 'var(--text-secondary)', paddingRight: 12 }}>.jsonl</span>}
                      onChange={(e) => setField('datasetName', e.target.value)}
                    />
                    <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                      Used as the base name for exported files.
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
                    {config.exportTarget === 'customgpt' && (
                      <div>
                        <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                          Profile: ChatGPT Custom GPT Knowledge
                        </strong>
                        <ul style={{ paddingLeft: 16, margin: 0, lineHeight: 1.5 }}>
                          <li>Omit redundant system messages to save tokens.</li>
                          <li>Automatically splits files at 2M tokens for RAG compatibility.</li>
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
                                <input
                                  type="checkbox"
                                  checked={config.customSplit}
                                  style={{
                                    width: 16,
                                    height: 16,
                                    accentColor: 'var(--bubble-sent-bg)',
                                    cursor: 'pointer',
                                  }}
                                  title="Enable file splitting"
                                  onChange={(e) => setField('customSplit', e.target.checked)}
                                />
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
                      Use <strong>Knowledge / Search</strong> (800) to help AI find specific facts in your history. Use{' '}
                      <strong>Fine-Tuning</strong> (8k) to teach the AI your overall writing style.
                    </div>
                  </div>

                  <div style={{ marginBottom: 16, marginTop: 24 }}>
                    <span className={styles.label}>Selected Statistics:</span>
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
                  </div>

                  <div style={{ marginBottom: 20, opacity: showTokenBar ? 1 : 0.4, transition: 'opacity 0.2s' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span className={styles.label}>
                        {showTokenBar ? 'Token Limit (2M Cap)' : 'Token Limit (Disabled)'}
                      </span>
                      <span className={styles.label}>{showTokenBar ? `${Math.round(tokenPercent)}% Full` : 'N/A'}</span>
                    </div>
                    <div className={styles.tokenBarContainer}>
                      <div
                        className={styles.tokenBarFill}
                        style={{
                          width: `${showTokenBar ? tokenBarWidth : 0}%`,
                          backgroundColor: showTokenBar ? tokenBarColor : 'var(--border-color)',
                        }}
                      />
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 4 }}>
                      {showTokenBar ? 'Hard limit for Custom GPT Knowledge files.' : 'No platform-imposed token limit.'}
                    </p>
                  </div>

                  {hasMixedEvents && (
                    <div className={styles.warningHint}>
                      <span style={{ fontSize: 16 }}>⚠️</span>
                      <span>
                        <strong>Mixed Formats Detected:</strong> Facebook Events use a specialized flat JSON format. It
                        is recommended to export Events as a dedicated dataset for optimal knowledge retrieval in Custom
                        GPTs.
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
        onClose={() => setIsPreviewThreadOpen(false)}
        onAfterClose={() => setActivePreviewThread(null)}
      />

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
