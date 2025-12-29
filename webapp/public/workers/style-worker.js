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

const labels = [
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

self.onmessage = async (e) => {
    const { messages } = e.data;

    try {
        if (!classifier) {
            self.postMessage({ type: 'status', message: 'Initializing style analyzer...' });

            let progressStart = 0;
            classifier = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', {
                device: 'webgpu', // Try WebGPU first, will fallback to wasm
                progress_callback: (data) => {
                    // data: { status: 'progress', name: string, file: string, progress: number, loaded: number, total: number }
                    if (data.status === 'progress') {
                        if (data.progress >= 99) {
                            return;
                        }

                        if (!progressStart) { progressStart = Date.now(); }
                        // Only show progress if it takes longer than 200ms
                        if (Date.now() - progressStart < 200) {
                            return;
                        }

                        const loadedMB = (data.loaded / 1024 / 1024).toFixed(1);
                        const totalMB = data.total ? (data.total / 1024 / 1024).toFixed(1) : '??';

                        self.postMessage({
                            type: 'progress',
                            message: `Downloading ${data.file || 'model'}... ${Math.round(data.progress)}% (${loadedMB}MB / ${totalMB}MB)`,
                            progress: data.progress
                        });
                    }
                }
            });
        }

        self.postMessage({ type: 'status', message: 'Analyzing style...' });

        // Combine messages for representative sample
        const textToAnalyze = messages.slice(0, 10).join('\n---\n').substring(0, 1000);

        const result = await classifier(textToAnalyze, labels, {
            multi_label: true,
        });

        // Sort by score and take the top ones
        const suggestions = result.labels
            .map((label, i) => ({ label, score: result.scores[i] }))
            .filter((item) => item.score > 0.4) // Threshold
            .sort((a, b) => b.score - a.score)
            .map((item) => item.label);
        console.log('result:', JSON.stringify(result, null, 2));

        self.postMessage({ type: 'result', suggestions });
    } catch (e) {
        console.error('Worker error:', e);
        self.postMessage({ type: 'error', error: e.message });
    }
};
