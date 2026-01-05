/**
 * NOTE: We import from CDN here because Next.js sometimes struggles to bundle
 * complex binary dependencies like ONNX runtime inside Web Workers at build-time.
 * Using the CDN version ensures reliable loading across all environments.
 */
import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
// import { env, pipeline } from '@huggingface/transformers';

// Skip local model check since we are in the browser
env.allowLocalModels = false;
env.useBrowserCache = true;

let classifier;

const LABELS = [
  'Professional',
  'Casual',
  'Sarcastic',
  'Friendly',
  'Concise',
  'Empathetic',
  'Assertive',
  'Technical',
  'Humorous',
  'Formal',
];

const CONFIDENCE_THRESHOLD = 0.35;

/**
 * Consistently prepares an array of messages for the AI model.
 */
function sampleMessages(messages, limit = 10, maxChars = 1000) {
  if (!messages || !Array.isArray(messages)) {
    return '';
  }
  return messages.slice(0, limit).join('\n---\n').substring(0, maxChars);
}

self.onmessage = async (e) => {
  const { type, messages, threads, labels: targetLabels, isLast } = e.data;

  try {
    if (!classifier) {
      self.postMessage({ type: 'progress', message: 'Warming up AI...' });

      let progressStart = 0;
      classifier = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', {
        device: 'webgpu', // Try WebGPU first, will fallback to wasm
        progress_callback: (data) => {
          if (data.status === 'progress') {
            if (!progressStart) {
              progressStart = Date.now();
            }
            // Only show progress if it takes longer than 200ms
            if (Date.now() - progressStart < 200) {
              return;
            }

            const loadedMB = (data.loaded / 1024 / 1024).toFixed(1);
            const totalMB = data.total ? (data.total / 1024 / 1024).toFixed(1) : '??';

            self.postMessage({
              type: 'progress',
              message: `Downloading ${data.file || 'model'}...`,
              details: `${Math.round(data.progress)}% (${loadedMB}MB / ${totalMB}MB)`,
              progress: data.progress,
            });
          }
        },
      });
    }

    if (type === 'preload') {
      // Just warm up the cache
      self.postMessage({ type: 'preload:complete' });
      return;
    }

    if (type === 'filter_threads') {
      // New Mode: Filter Scan
      self.postMessage({ type: 'filter:status', message: 'Scanning threads...' });

      const matches = [];
      // Use shared threshold
      const total = threads.length;

      for (let i = 0; i < total; i++) {
        const item = threads[i];
        const textToAnalyze = sampleMessages(item.messages);
        // console.info('Analyzing:\r\n', textToAnalyze);

        if (!textToAnalyze || textToAnalyze.length < 10) {
          continue;
        }

        // Run classification
        const result = await classifier(textToAnalyze, targetLabels, {
          multi_label: true,
          truncation: true,
        });

        // Check matches
        const matchedLabels = result.labels.filter((label, idx) => {
          return targetLabels.includes(label) && result.scores[idx] > CONFIDENCE_THRESHOLD;
        });

        if (matchedLabels.length > 0) {
          self.postMessage({ type: 'filter:match', id: item.id, matches: matchedLabels });
          matches.push(item.id);
        }

        // Progress update (less frequently to save bridge traffic)
        if (i % 10 === 0 || i === total - 1) {
          self.postMessage({
            type: 'filter:progress',
            message: `Curating... Found ${matches.length} matching threads`,
            progress: Math.round((i / total) * 100),
          });
        }
      }

      // Final done message
      self.postMessage({ type: 'filter:complete', count: matches.length, labels: targetLabels, isLast });
    } else {
      // Default Mode: Generate Persona Tags
      self.postMessage({ type: 'analyze:status', message: 'Analyzing style...' });

      const textToAnalyze = sampleMessages(messages);
      // console.info('Analyzing:\r\n', textToAnalyze);

      const result = await classifier(textToAnalyze, LABELS, {
        multi_label: true,
        truncation: true,
      });

      // Sort by score and take the top ones
      const suggestions = result.labels
        .map((label, i) => ({ label, score: result.scores[i] }))
        .filter((item) => item.score > CONFIDENCE_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.label);

      self.postMessage({ type: 'analyze:result', suggestions });
    }
  } catch (e) {
    console.error('Worker error:', e);
    self.postMessage({ type: 'error', error: e.message });
  }
};
