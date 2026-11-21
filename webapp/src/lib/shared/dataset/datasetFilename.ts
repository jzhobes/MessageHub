export function getDatasetBaseName(name: string | undefined, format: 'markdown' | 'jsonl' = 'jsonl'): string {
  const extension = format === 'markdown' ? '.md' : '.jsonl';
  const filename = (name ?? '').trim().replace(/[\\/\x00-\x1f\x7f]/g, '_');
  let end = filename.length;

  while (end >= extension.length && filename.slice(end - extension.length, end).toLowerCase() === extension) {
    end -= extension.length;
    while (end > 0 && /\s/.test(filename[end - 1])) {
      end--;
    }
  }

  return filename.slice(0, end).replace(/^\.+$/, '') || 'dataset';
}
