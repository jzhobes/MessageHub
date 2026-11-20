export interface ParsedToken {
  raw: string;
  clean: string;
  isStartOfWord: boolean;
  sqlPattern: string; // Pattern for SQL LIKE
  regexPattern: string; // Pattern for JS RegExp
}

export interface ParsedQuery {
  orGroups: ParsedToken[][]; // Array of OR groups, each containing AND tokens
}

/**
 * Parse search terms, keeping quoted phrases intact. Uppercase `OR` starts a new group. Terms
 * inside each group are ANDed.
 *
 * - `test email` → [[test, email]]
 * - `test OR email` → [[test], [email]]
 * - `test email OR trial` → [[test, email], [trial]]
 * - `"test OR email"` → [["test OR email"]]
 */
export function parseSearchQuery(queryStr: string): ParsedQuery {
  // Split on uppercase “ OR ” with spaces on both sides.
  // Leave OR inside quoted phrases alone.
  const orGroups: ParsedToken[][] = [];

  // Set quoted phrases aside so the split can't break them up.
  const quotedPhrases: string[] = [];
  const placeholderPrefix = '__QUOTED_PHRASE_';
  const processedQuery = queryStr.replace(/"([^"]+)"/g, (match, phrase) => {
    quotedPhrases.push(phrase);
    return `${placeholderPrefix}${quotedPhrases.length - 1}__`;
  });

  // Now split by " OR " (case-sensitive, uppercase only)
  const orParts = processedQuery.split(' OR ');

  for (const part of orParts) {
    const tokens: ParsedToken[] = [];

    // Restore quoted phrases in this part
    let restoredPart = part;
    quotedPhrases.forEach((phrase, idx) => {
      restoredPart = restoredPart.replace(`${placeholderPrefix}${idx}__`, `"${phrase}"`);
    });

    // Parse tokens in this OR group
    const quoteRegex = /"([^"]+)"|(\S+)/g;
    let match;

    while ((match = quoteRegex.exec(restoredPart)) !== null) {
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

      // Escape regex characters except * and ?, which are our search wildcards.
      const escapedForRegex = clean
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\?/g, '.') // Replace ? first (single char wildcard)
        .replace(/\*/g, '.*?'); // Then replace * (multi-char wildcard with non-greedy)

      tokens.push({
        raw,
        clean,
        isStartOfWord,
        sqlPattern: escapedForSql,
        regexPattern: isStartOfWord ? `(?:^|\\b)${escapedForRegex}` : escapedForRegex,
      });
    }

    if (tokens.length > 0) {
      orGroups.push(tokens);
    }
  }

  return { orGroups };
}
