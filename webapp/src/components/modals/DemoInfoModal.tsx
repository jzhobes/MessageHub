import React from 'react';

import { FaExternalLinkAlt, FaGithub } from 'react-icons/fa';

import BaseModal, { ModalHeader } from '@/components/modals/BaseModal';

import styles from './DemoInfoModal.module.css';

interface DemoInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const GITHUB_REPO_URL = 'https://github.com/jzhobes/MessageHub';

/**
 * Replaces the local Setup wizard in GitHub Pages static Demo Mode, explaining what works
 * client-side on the sample archive and linking users to run MessageHub locally.
 */
export default function DemoInfoModal({ isOpen, onClose }: DemoInfoModalProps) {
  return (
    <BaseModal height="auto" isOpen={isOpen} maxWidth={560} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        <span>Interactive Demo Mode</span>
      </ModalHeader>

      <div className={styles.body}>
        <p className={styles.intro}>
          You are exploring a static, read-only sample archive running 100% in your browser with no backend server. No
          personal data is uploaded or stored.
        </p>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Included in This Demo</h3>
          <ul className={styles.list}>
            <li>
              <strong>Unified Viewer:</strong> Browse sample conversations across Facebook, Instagram, Google Chat,
              Gmail, and Google Voice.
            </li>
            <li>
              <strong>Full-Text Search &amp; Media:</strong> Test AND/OR queries, facet filtering, jump-to-message, and
              the media gallery.
            </li>
            <li>
              <strong>DataForge AI Studio:</strong> Preview JSONL / ChatGPT Project Markdown exports, auto-scan best
              days, run in-browser AI style analysis, and download a generated <code>.zip</code> dataset.
            </li>
          </ul>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Local-Only Features (Disabled Here)</h3>
          <ul className={styles.list}>
            <li>Importing your own Facebook, Instagram, or Google Takeout archives via Python ingestion.</li>
            <li>Local workspace directory browsing and SQLite database reset.</li>
            <li>Live server-side link preview scraping for external URLs.</li>
          </ul>
        </div>
      </div>

      <div className={styles.footer}>
        <a className={styles.repoLink} href={GITHUB_REPO_URL} rel="noopener noreferrer" target="_blank">
          <FaGithub size={16} />
          <span>Run Locally with Your Own Archives</span>
          <FaExternalLinkAlt size={12} />
        </a>
        <button className={styles.closeBtn} type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </BaseModal>
  );
}
