import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { FaArrowLeft, FaRobot } from 'react-icons/fa';
import { FiMoon, FiSun } from 'react-icons/fi';

import { useForm } from '@/hooks/useForm';
import { useTheme } from '@/hooks/useTheme';
import { Thread } from '@/lib/shared/types';
import { StudioControls } from '@/sections/StudioControls';
import { StudioThreadList } from '@/sections/StudioThreadList';
import ThreadPreviewModal from '@/components/ThreadPreviewModal';

import layoutStyles from '@/styles/Layout.module.css';
import styles from '@/styles/Studio.module.css';

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

export default function Studio() {
  // State
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [loading, setLoading] = useState(true);
  // Multi-select filter state (empty set = 'All')
  const [filterPlatforms, setFilterPlatforms] = useState(new Set<string>());
  const [generating, setGenerating] = useState(false);
  // Preview Modal
  const [previewThread, setPreviewThread] = useState<Thread | null>(null);

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

    try {
      const names = config.identityNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

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
        return;
      }

      // Trigger Download
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'virtual_me_dataset.zip';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  // Rough Token Estimation
  const selectedThreads = threads.filter((t) => selectedIds.has(t.id));
  const totalFilesEstimated = selectedThreads.reduce((acc, t) => acc + (t.file_count || 1), 0);
  const estimatedTokens = totalFilesEstimated * 100 * 50; // Very rough
  const maxTokens = 2000000;
  const fillPercent = Math.min((estimatedTokens / maxTokens) * 100, 100);

  // Validity Calculation
  const avgSelectedScore = useMemo(() => {
    if (selectedIds.size === 0) {
      return 0;
    }
    const selected = threads.filter((t) => selectedIds.has(t.id));
    const totalScore = selected.reduce((acc, t) => acc + (t.qualityScore || 0), 0);
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
          <button className={`${layoutStyles.iconButton} ${layoutStyles.headerIconBtn}`} onClick={toggleTheme} title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}>
            {!mounted || theme === 'light' ? <FiMoon size={20} /> : <FiSun size={20} />}
          </button>
        </div>
      </div>

      <div className={layoutStyles.bodyContent}>
        <div className={styles.container} style={{ height: '100%', width: '100%' }}>
          {/* Left Pane: Selection */}
          <div className={styles.leftPane}>
            <div className={styles.paneHeader}>Select Threads</div>

            <StudioControls visibleThreads={visibleThreads} selectedIds={selectedIds} onChange={setSelectedIds} filterPlatforms={filterPlatforms} onFilterChange={setFilterPlatforms} />

            <StudioThreadList
              loading={loading}
              threads={visibleThreads}
              selectedIds={selectedIds}
              onChange={setSelectedIds}
              onPreview={(id) => {
                const t = threads.find((th) => th.id === id);
                if (t) {
                  setPreviewThread(t);
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
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: 4 }}>We scan for these names to identify &quot;You&quot; in the chat. Separated by commas.</p>
                      <input type="text" className={styles.input} value={config.identityNames} onChange={(e) => setField('identityNames', e.target.value)} />
                    </div>

                    <div className={styles.inputGroup} style={{ marginTop: 12 }}>
                      <label className={styles.label}>Persona Tag (Optional)</label>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: 4 }}>
                        Example: &quot;Professional, Tech&quot;, &quot;Casual, Sarcastic&quot;. Multiple tags supported (comma separated).
                      </p>
                      <input type="text" className={styles.input} placeholder="e.g. Casual, Friendly" value={config.personaTag} onChange={(e) => setField('personaTag', e.target.value)} />
                    </div>

                    <div className={styles.inputGroup} style={{ marginTop: 12 }}>
                      <label className={styles.label}>Custom System Instructions (Optional)</label>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: 4 }}>Appended to the System Prompt. e.g. &quot;Do not use emojis.&quot;</p>
                      <textarea
                        className={styles.input}
                        style={{ height: 60, fontFamily: 'inherit', resize: 'none' }}
                        placeholder="Additional instructions..."
                        value={config.customInstructions}
                        onChange={(e) => setField('customInstructions', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>Content Strategy</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <input type="checkbox" id="chkGroup" style={{ width: 18, height: 18 }} checked={config.includeGroupNames} onChange={(e) => setField('includeGroupNames', e.target.checked)} />
                      <label htmlFor="chkGroup" className={styles.label} style={{ cursor: 'pointer' }}>
                        Include Speaker Names (Group Chats)
                      </label>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 8, marginBottom: 4, lineHeight: 1.4 }}>
                      Required for the model to understand group dynamics. Example: <em>&quot;[Alice]: How are you?&quot;</em> instead of just <em>&quot;How are you?&quot;</em>.
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                      <input type="checkbox" id="chkMerge" style={{ width: 18, height: 18 }} checked={config.mergeSequential} onChange={(e) => setField('mergeSequential', e.target.checked)} />
                      <label htmlFor="chkMerge" className={styles.label} style={{ cursor: 'pointer' }}>
                        Merge Sequential Messages (Recommended)
                      </label>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 8, marginBottom: 4, lineHeight: 1.4 }}>
                      Combines rapid-fire messages into a single turn to ensure cleaner <em>User &rarr; Assistant</em> patterns.
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                      <input type="checkbox" id="chkReactions" style={{ width: 18, height: 18 }} checked={config.imputeReactions} onChange={(e) => setField('imputeReactions', e.target.checked)} />
                      <label htmlFor="chkReactions" className={styles.label} style={{ cursor: 'pointer' }}>
                        Convert Reactions to Text (Highly Recommended)
                      </label>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 8, marginBottom: 4, lineHeight: 1.4 }}>
                      Treats your reactions (👍, ❤️) as replies. Saves thousands of sessions where you acknowledged but didn&apos;t type.
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                      <input type="checkbox" id="chkPII" style={{ width: 18, height: 18 }} checked={config.redactPII} onChange={(e) => setField('redactPII', e.target.checked)} />
                      <label htmlFor="chkPII" className={styles.label} style={{ cursor: 'pointer' }}>
                        Redact PII (Emails & Phone #s)
                      </label>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.4 }}>
                      Scrubs personally identifiable information by replacing detected emails and phone numbers with <code>[REDACTED_EMAIL]</code> and <code>[REDACTED_PHONE]</code> placeholders.
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                      <input
                        type="checkbox"
                        id="chkSystem"
                        style={{ width: 18, height: 18 }}
                        checked={config.removeSystemMessages}
                        onChange={(e) => setField('removeSystemMessages', e.target.checked)}
                      />
                      <label htmlFor="chkSystem" className={styles.label} style={{ cursor: 'pointer' }}>
                        Remove System/Admin Messages
                      </label>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.4 }}>
                      Filters out platform noise like &quot;You missed a call&quot;, &quot;Alice named the group&quot;, etc.
                    </p>
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
                    <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
                      <div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{selectedIds.size}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Threads</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold' }}>~{estimatedTokens.toLocaleString()}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Est. Tokens</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: validity.color }}>{avgSelectedScore}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Avg Quality ({validity.label})</div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span className={styles.label}>Token Limit (OpenAI Fine-tuning)</span>
                      <span className={styles.label}>{Math.round(fillPercent)}% Full</span>
                    </div>
                    <div className={styles.tokenBarContainer}>
                      <div className={styles.tokenBarFill} style={{ width: `${fillPercent}%`, background: fillPercent > 90 ? '#ef4444' : '#10b981' }} />
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 4 }}>Max 2M tokens recommended for initial fine-tuning jobs.</p>
                  </div>

                  <button className={styles.generateBtn} onClick={handleGenerate} disabled={generating || selectedIds.size === 0}>
                    {generating ? 'Processing...' : `Generate Dataset (${selectedIds.size})`}
                  </button>
                  {generating && <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 8 }}>This may take a minute...</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ThreadPreviewModal isOpen={!!previewThread} onClose={() => setPreviewThread(null)} threadId={previewThread?.id || null} threadTitle={previewThread?.title} platform={previewThread?.platform} />
    </div>
  );
}
