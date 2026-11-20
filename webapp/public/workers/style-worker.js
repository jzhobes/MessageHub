/**
 * Load the model dependencies from the CDN. Next.js can have trouble bundling native dependencies
 * like ONNX Runtime for workers.
 */
import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

// We're in the browser, so skip the local model lookup.
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
 * Prepare messages in the format the classifier expects.
 */
function sampleMessages(messages, limit = 10, maxChars = 1000) {
  if (!messages || !Array.isArray(messages)) {
    return '';
  }
  return messages.slice(0, limit).join('\n---\n').substring(0, maxChars);
}

/**
 * Run commands against a lazily loaded `Xenova/mobilebert-uncased-mnli` classifier. Try WebGPU
 * first and fall back to WASM.
 *
 * - `preload` warms the model cache and posts `preload:complete`.
 * - `filter_threads` checks each thread's samples against `labels` and posts `filter:status`,
 *   `filter:match`, `filter:progress`, and `filter:complete`.
 * - `analyze` is the default. It checks `messages` against `LABELS` and posts `analyze:status` and
 *   `analyze:result`.
 *
 * The worker posts `progress` for downloads that take over 200ms and `error` if work fails.
 */
self.onmessage = async (e) => {
  const { type, messages, threads, labels: targetLabels, isLast } = e.data;

  try {
    if (!classifier) {
      self.postMessage({ type: 'progress', message: 'Warming up AI...' });

      let progressStart = 0;
      classifier = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', {
        device: 'webgpu', // Try WebGPU first and fall back to WASM.
        progress_callback: (data) => {
          if (data.status === 'progress') {
            if (!progressStart) {
              progressStart = Date.now();
            }
            // Show download progress only if it's still loading after 200ms.
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
      // Load the model now so the first scan can use the cache.
      self.postMessage({ type: 'preload:complete' });
      return;
    }

    if (type === 'filter_threads') {
      // Scan threads against the selected labels.
      self.postMessage({ type: 'filter:status', message: 'Scanning threads...' });

      const matches = [];
      // Use shared threshold
      const total = threads.length;

      for (let i = 0; i < total; i++) {
        const item = threads[i];
        const textToAnalyze = sampleMessages(item.messages);

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

        // Send fewer progress events so we don't flood the worker bridge.
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
      // Generate persona tags for the supplied messages.
      self.postMessage({ type: 'analyze:status', message: 'Analyzing style...' });

      const textToAnalyze = sampleMessages(messages);

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
