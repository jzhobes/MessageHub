import React from 'react';

import { FaRobot } from 'react-icons/fa';

import Checkbox from '@/components/Checkbox';
import TextareaAuto from '@/components/TextareaAuto';
import TextInput from '@/components/TextInput';

import styles from '@/pages/studio.module.css';

const PERSONA_TEMPLATES = [
  { label: 'Work', text: 'Professional, Concise' },
  { label: 'Social', text: 'Casual, Friendly, Lowercase' },
  { label: 'Witty', text: 'Sarcastic, Witty, Short' },
  { label: 'Active', text: 'Socially Active, Event-focused' },
];

const INSTRUCTION_TEMPLATES = [
  { label: 'Strict', text: 'Answer directly and concisely. No filler.' },
  {
    label: 'Professional',
    text: 'Maintain a polished, business-oriented tone. Use proper grammar, capitalization, and punctuation.',
  },
  { label: 'Casual', text: 'Use lowercase, minimal punctuation, and casual slang.' },
  { label: 'Assistant', text: 'You are a helpful assistant. Keep answers professional but friendly.' },
  {
    label: 'Life Context',
    text: 'Prioritize events, posts, and public activity to understand my social history and life patterns.',
  },
];

interface ConfigState {
  identityNames: string;
  personaTag: string;
  customInstructions: string;
  includeGroupNames: boolean;
  mergeSequential: boolean;
  removeSystemMessages: boolean;
  imputeReactions: boolean;
  redactPII: boolean;
  exportTarget: string;
  customSplit: boolean;
  customSessionLimit: string;
  customFileLimit: string;
  datasetName: string;
  recencyFilter: string;
}

interface StudioConfigProps {
  config: ConfigState;
  analyzingStyle: boolean;
  selectedCount: number;
  statusMessage: string | null;
  downloadProgress: number;
  onFieldChange: (key: keyof ConfigState, value: string | boolean) => void;
  onAnalyzeStyle: () => void;
}

export function StudioConfig({
  config,
  analyzingStyle,
  selectedCount,
  statusMessage,
  downloadProgress,
  onFieldChange,
  onAnalyzeStyle,
}: StudioConfigProps) {
  return (
    <div>
      <div style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 30 }}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Identity Configuration</h3>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Your Names (Active Speaker)</label>
            <p className={styles.helperText}>
              We scan for these names to identify &quot;You&quot; in the chat. Separated by commas.
            </p>
            <TextInput value={config.identityNames} onChange={(e) => onFieldChange('identityNames', e.target.value)} />
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label}>Search Recency</label>
            <p className={styles.helperText}>Ignore data older than a certain period for better persona accuracy.</p>
            <select
              className={styles.select}
              value={config.recencyFilter}
              onChange={(e) => onFieldChange('recencyFilter', e.target.value)}
            >
              <option value="all">All Time (Maximum History)</option>
              <option value="6m">Last 6 Months</option>
              <option value="1y">Last 12 Months</option>
              <option value="2y">Last 2 Years (Recommended)</option>
              <option value="5y">Last 5 Years</option>
            </select>
          </div>

          {config.exportTarget !== 'customgpt' ? (
            <>
              <div className={`${styles.inputGroup} ${styles.inputGroupItem}`}>
                <label className={styles.label}>Persona Tag (Optional)</label>
                <p className={styles.helperText}>
                  Example: &quot;Professional, Tech&quot;, &quot;Casual, Sarcastic&quot;. Multiple tags supported (comma
                  separated).
                </p>
                <div className={styles.inputGroupContainer}>
                  <TextInput
                    placeholder="e.g. Casual, Friendly"
                    value={config.personaTag}
                    suffix={
                      <button
                        className="btn-input-suffix"
                        title="Analyze writing style in selected threads"
                        disabled={analyzingStyle || selectedCount === 0}
                        onClick={onAnalyzeStyle}
                      >
                        <FaRobot size={16} />
                        <span>{analyzingStyle ? 'Analyzing' : 'Analyze Style'}</span>
                      </button>
                    }
                    onChange={(e) => onFieldChange('personaTag', e.target.value)}
                  />
                </div>
                {(statusMessage || downloadProgress > 0) && (
                  <div style={{ margin: '4px 12px 0 12px' }}>
                    {statusMessage && <div className={styles.statusMessage}>{statusMessage}</div>}
                    {downloadProgress > 0 && downloadProgress < 100 && (
                      <div className={styles.miniProgress}>
                        <div className={styles.miniProgressFill} style={{ width: `${downloadProgress}%` }} />
                      </div>
                    )}
                  </div>
                )}
                <div className={styles.templateContainer}>
                  <span className={styles.templateLabel}>Templates:</span>
                  {PERSONA_TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      className={styles.templateChip}
                      onClick={() => {
                        const current = config.personaTag.trim();
                        const newText = current ? `${current}, ${t.text}` : t.text;
                        onFieldChange('personaTag', newText);
                      }}
                    >
                      + {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={`${styles.inputGroup} ${styles.inputGroupItem}`}>
                <label className={styles.label}>Custom System Instructions (Optional)</label>
                <p className={styles.helperText}>Appended to the System Prompt. e.g. &quot;Do not use emojis.&quot;</p>
                <TextareaAuto
                  placeholder="Additional instructions..."
                  value={config.customInstructions}
                  minRows={3}
                  maxRows={8}
                  onChange={(e) => onFieldChange('customInstructions', e.target.value)}
                />
                <div className={styles.templateContainer}>
                  <span className={styles.templateLabel}>Templates:</span>
                  {INSTRUCTION_TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      className={styles.templateChip}
                      onClick={() => {
                        const current = config.customInstructions.trim();
                        const newText = current ? `${current}\n${t.text}` : t.text;
                        onFieldChange('customInstructions', newText);
                      }}
                    >
                      + {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div
              className={`${styles.inputGroupItem}`}
              style={{
                padding: '16px',
                background: 'rgba(99, 102, 241, 0.05)',
                borderRadius: '8px',
                border: '1px dashed rgba(99, 102, 241, 0.3)',
                marginTop: '12px',
              }}
            >
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                  Note: Custom GPT Formatting
                </strong>
                For Knowledge Base files, persona and system instructions are omitted to save tokens. You should paste
                your persona and custom instructions directly into the <strong>&quot;Instructions&quot;</strong> field
                of your Custom GPT in the ChatGPT UI.
              </p>
            </div>
          )}
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Content Strategy</h3>
          <Checkbox
            id="chkGroup"
            label="Include Speaker Names (Group Chats)"
            checked={config.includeGroupNames}
            description='Required for the model to understand group dynamics. Example: "[Alice]: How are you?" instead of just "How are you?".'
            onChange={(c) => onFieldChange('includeGroupNames', c)}
          />

          <Checkbox
            id="chkMerge"
            label="Merge Sequential Messages (Recommended)"
            checked={config.mergeSequential}
            description="Combines rapid-fire messages into a single turn to ensure cleaner User → Assistant patterns."
            style={{ marginTop: 12 }}
            onChange={(c) => onFieldChange('mergeSequential', c)}
          />

          <Checkbox
            id="chkReactions"
            label="Convert Reactions to Text (Highly Recommended)"
            checked={config.imputeReactions}
            description="Treats your reactions (👍, ❤️) as replies. Saves thousands of sessions where you acknowledged but didn't type."
            style={{ marginTop: 12 }}
            onChange={(c) => onFieldChange('imputeReactions', c)}
          />

          <Checkbox
            id="chkSystem"
            label="Remove System Messages"
            checked={config.removeSystemMessages}
            description='Excludes automated system messages like "Alice added Bob to the group" or "Only admins can send messages".'
            style={{ marginTop: 12 }}
            onChange={(c) => onFieldChange('removeSystemMessages', c)}
          />

          <Checkbox
            id="chkPII"
            label="Redact PII (Credit Cards, Phones, Emails)"
            checked={config.redactPII}
            description="Automatically detects and masks sensitive personally identifiable information using regex patterns."
            style={{ marginTop: 12 }}
            onChange={(c) => onFieldChange('redactPII', c)}
          />
        </div>
      </div>
    </div>
  );
}
