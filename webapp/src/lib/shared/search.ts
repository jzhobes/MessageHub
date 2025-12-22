export interface ParsedToken {
  raw: string;
  clean: string;
  isStartOfWord: boolean;
  sqlPattern: string; // Pattern for SQL LIKE
  regexPattern: string; // Pattern for JS RegExp
}

/**
 * Shared search query parser that respects quoted phrases and special operators
 */
export function parseSearchQuery(queryStr: string): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  const quoteRegex = /"([^"]+)"|(\S+)/g;
  let match;

  while ((match = quoteRegex.exec(queryStr)) !== null) {
    const raw = match[1] || match[2];
    if (!raw) {
      continue;
    }

    let isStartOfWord = false;
    let clean = raw;

    if (clean.startsWith('^')) {
      isStartOfWord = true;
      clean = clean.slice(1);
    }

    // Escape special characters for both SQL and Regex
    const escapedForSql = clean
      .replace(/[%_\\]/g, '\\$&')
      .replace(/\*/g, '%')
      .replace(/\?/g, '_');

    // For regex, we escape all special regex chars EXCEPT our glob wildcards * and ?
    const escapedForRegex = clean
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*?')
      .replace(/\?/g, '.');

    tokens.push({
      raw,
      clean,
      isStartOfWord,
      sqlPattern: escapedForSql,
      regexPattern: isStartOfWord ? `(?:^|\\b)${escapedForRegex}` : escapedForRegex,
    });
  }

  return tokens;
}
