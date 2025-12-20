import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { FaArrowLeft, FaCog, FaRobot } from 'react-icons/fa';
import { FiMoon, FiSun } from 'react-icons/fi';
import Checkbox from '@/components/Checkbox';
import TextareaAuto from '@/components/TextareaAuto';
import TextInput from '@/components/TextInput';
import ThreadPreviewModal from '@/components/modals/ThreadPreviewModal';
import SetupModal from '@/components/modals/SetupModal';
import { useForm } from '@/hooks/useForm';
import { useTheme } from '@/hooks/useTheme';
import { Thread } from '@/lib/shared/types';
import { StudioControls } from '@/sections/StudioControls';
import { StudioThreadList } from '@/sections/StudioThreadList';
import layoutStyles from '@/components/Layout.module.css';
import styles from './studio.module.css';

const initialState = {
  identityNames: '',
  personaTag: '',
  customInstructions: '',
  includeGroupNames: true,
  mergeSequential: true,
  removeSystemMessages: true,
  imputeReactions: true,
  redactPII: true,
};

const PERSONA_TEMPLATES = [
  { label: 'Work', text: 'Professional, Concise' },
  { label: 'Social', text: 'Casual, Friendly, Lowercase' },
  { label: 'Witty', text: 'Sarcastic, Witty, Short' },
];

const INSTRUCTION_TEMPLATES = [
  { label: 'Strict', text: 'Answer directly and concisely. No filler.' },
  { label: 'Casual', text: 'Use lowercase, minimal punctuation, and casual slang.' },
  { label: 'Roleplay', text: 'You are a helpful assistant. Keep answers professional but friendly.' },
];

export default function Studio() {
  // ... existing code ...

  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [loading, setLoading] = useState(true);
  // Multi-select filter state (empty set = 'All')
  const [filterPlatforms, setFilterPlatforms] = useState(new Set<string>());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  // Preview Modal
  const [activePreviewThread, setActivePreviewThread] = useState<Thread | null>(null);
  const [isPreviewThreadOpen, setIsPreviewThreadOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  const { theme, toggleTheme, mounted } = useTheme();

  // Configuration State
  const { values: config, setField } = useForm(initialState);

  // Fetch initial data
  useEffect(() => {
    async function init() {
      try {
        // Fetch threads (all platforms) using dataset-optimized API
        const res = await fetch(`/api/dataset-threads?platform=all`);
        let allThreads: Thread[] = [];

        if (res.ok) {
          const data = await res.json();
          // Tag with platform if not already (API provides it)
          allThreads = data.map((t: Thread) => ({
            ...t,
            platform_source: t.platform, // map back for existing logic
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

  // Filtered List
  const visibleThreads = useMemo(() => {
    // If set is empty, show all. Otherwise check if platform label is in set.
    return threads.filter((t) => filterPlatforms.size === 0 || (t.platform && filterPlatforms.has(t.platform)));
  }, [threads, filterPlatforms]);

  const handleGenerate = async () => {
    if (selectedIds.size === 0) {
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
      const res = await fetch('/api/generate-dataset', {
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
            const downloadUrl = `/api/generate-dataset?jobId=${jobId}`;
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = 'virtual_me_dataset.zip';
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
  };

  // Rough Token Estimation
  const selectedThreads = threads.filter((t) => selectedIds.has(t.id));
  const totalFilesEstimated = selectedThreads.reduce((acc, t) => acc + (t.pageCount ?? 1), 0);
  const estimatedTokens = totalFilesEstimated * 100 * 50; // Very rough
  const maxTokens = 2000000;
  const fillPercent = Math.min((estimatedTokens / maxTokens) * 100, 100);

  // Validity Calculation
  const avgSelectedScore = useMemo(() => {
    if (selectedIds.size === 0) {
      return 0;
    }
    const selected = threads.filter((t) => selectedIds.has(t.id));
    const totalScore = selected.reduce((acc, t) => acc + (t.qualityScore ?? 0), 0);
    return Math.round(totalScore / selected.length);
  }, [selectedIds, threads]);

  const getValidityLabel = (score: number) => {
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
  };

  const validity = getValidityLabel(avgSelectedScore);

  return (
    <div className={layoutStyles.container} data-theme={theme}>
      <Head>
        <title>DataForge AI - MessageHub</title>
      </Head>

      <SetupModal
        isOpen={showSetup}
        onClose={() => setShowSetup(false)}
        onCompleted={() => window.location.reload()}
        initialStep={2}
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
            onClick={() => setShowSetup(true)}
            title="Setup"
            style={{ marginRight: 8 }}
          >
            <FaCog size={20} />
          </button>
          <button
            className={`${layoutStyles.iconButton} ${layoutStyles.headerIconBtn}`}
            onClick={toggleTheme}
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
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
              onChange={setSelectedIds}
              filterPlatforms={filterPlatforms}
              onFilterChange={setFilterPlatforms}
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
                <div style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 30 }}>
                  <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>Identity Configuration</h3>
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>Your Names (Active Speaker)</label>
                      <p className={styles.helperText}>
                        We scan for these names to identify &quot;You&quot; in the chat. Separated by commas.
                      </p>
                      <TextInput
                        value={config.identityNames}
                        onChange={(e) => setField('identityNames', e.target.value)}
                      />
                    </div>

                    <div className={`${styles.inputGroup} ${styles.inputGroupItem}`}>
                      <label className={styles.label}>Persona Tag (Optional)</label>
                      <p className={styles.helperText}>
                        Example: &quot;Professional, Tech&quot;, &quot;Casual, Sarcastic&quot;. Multiple tags supported
                        (comma separated).
                      </p>
                      <TextInput
                        placeholder="e.g. Casual, Friendly"
                        value={config.personaTag}
                        onChange={(e) => setField('personaTag', e.target.value)}
                      />
                      <div className={styles.templateContainer}>
                        <span className={styles.templateLabel}>Templates:</span>
                        {PERSONA_TEMPLATES.map((t) => (
                          <div
                            key={t.label}
                            className={styles.templateChip}
                            onClick={() => {
                              const current = config.personaTag.trim();
                              const newText = current ? `${current}, ${t.text}` : t.text;
                              setField('personaTag', newText);
                            }}
                          >
                            + {t.label}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className={`${styles.inputGroup} ${styles.inputGroupItem}`}>
                      <label className={styles.label}>Custom System Instructions (Optional)</label>
                      <p className={styles.helperText}>
                        Appended to the System Prompt. e.g. &quot;Do not use emojis.&quot;
                      </p>
                      <TextareaAuto
                        placeholder="Additional instructions..."
                        value={config.customInstructions}
                        onChange={(e) => setField('customInstructions', e.target.value)}
                        minRows={3}
                        maxRows={8}
                      />
                      <div className={styles.templateContainer}>
                        <span className={styles.templateLabel}>Templates:</span>
                        {INSTRUCTION_TEMPLATES.map((t) => (
                          <div
                            key={t.label}
                            className={styles.templateChip}
                            onClick={() => {
                              const current = config.customInstructions.trim();
                              const newText = current ? `${current}\n${t.text}` : t.text;
                              setField('customInstructions', newText);
                            }}
                          >
                            + {t.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>Content Strategy</h3>
                    <Checkbox
                      id="chkGroup"
                      label="Include Speaker Names (Group Chats)"
                      checked={config.includeGroupNames}
                      onChange={(c) => setField('includeGroupNames', c)}
                      description='Required for the model to understand group dynamics. Example: "[Alice]: How are you?" instead of just "How are you?".'
                    />

                    <Checkbox
                      id="chkMerge"
                      label="Merge Sequential Messages (Recommended)"
                      checked={config.mergeSequential}
                      onChange={(c) => setField('mergeSequential', c)}
                      description="Combines rapid-fire messages into a single turn to ensure cleaner User → Assistant patterns."
                      style={{ marginTop: 12 }}
                    />

                    <Checkbox
                      id="chkReactions"
                      label="Convert Reactions to Text (Highly Recommended)"
                      checked={config.imputeReactions}
                      onChange={(c) => setField('imputeReactions', c)}
                      description="Treats your reactions (👍, ❤️) as replies. Saves thousands of sessions where you acknowledged but didn't type."
                      style={{ marginTop: 12 }}
                    />

                    <Checkbox
                      id="chkPII"
                      label="Redact PII (Emails & Phone #s)"
                      checked={config.redactPII}
                      onChange={(c) => setField('redactPII', c)}
                      description="Scrubs personally identifiable information by replacing detected emails and phone numbers with [REDACTED_EMAIL] and [REDACTED_PHONE] placeholders."
                      style={{ marginTop: 12 }}
                    />

                    <Checkbox
                      id="chkSystem"
                      label="Remove System/Admin Messages"
                      checked={config.removeSystemMessages}
                      onChange={(c) => setField('removeSystemMessages', c)}
                      description='Filters out platform noise like "You missed a call", "Alice named the group", etc.'
                      style={{ marginTop: 12 }}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.outputPane}>
                <div className={styles.outputBubble}>
                  <h3 className={styles.sectionTitle} style={{ marginTop: 0 }}>
                    Quality & Output
                  </h3>

                  <div style={{ marginBottom: 16 }}>
                    <span className={styles.label}>Selected Statistics:</span>
                    <div className={styles.statsGroup}>
                      <div>
                        <div className={styles.statValue}>{selectedIds.size}</div>
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

                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span className={styles.label}>Token Limit (OpenAI Fine-tuning)</span>
                      <span className={styles.label}>{Math.round(fillPercent)}% Full</span>
                    </div>
                    <div className={styles.tokenBarContainer}>
                      <div
                        className={styles.tokenBarFill}
                        style={{ width: `${fillPercent}%`, background: fillPercent > 90 ? '#ef4444' : '#10b981' }}
                      />
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 4 }}>
                      Max 2M tokens recommended for initial fine-tuning jobs.
                    </p>
                  </div>

                  <button
                    className={styles.generateBtn}
                    onClick={handleGenerate}
                    disabled={generating || selectedIds.size === 0}
                  >
                    {generating
                      ? `Processing... ${progress.total > 0 ? Math.round((progress.current / progress.total) * 100) + '%' : ''}`
                      : `Generate Dataset (${selectedIds.size})`}
                  </button>
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
        onClose={() => setIsPreviewThreadOpen(false)}
        onAfterClose={() => setActivePreviewThread(null)}
        thread={activePreviewThread}
      />
    </div>
  );
}
