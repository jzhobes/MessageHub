export function getDatasetBaseName(name: string | undefined, format: 'markdown' | 'jsonl' = 'jsonl'): string {
  const extension = format === 'markdown' ? /(?:\s*\.md)+$/i : /(?:\s*\.jsonl)+$/i;
  return (
    name
      ?.trim()
      .replace(/[\\/\x00-\x1f\x7f]/g, '_')
      .replace(extension, '')
      .trim()
      .replace(/^\.+$/, '') || 'dataset'
  );
}
