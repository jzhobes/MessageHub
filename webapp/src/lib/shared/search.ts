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
 * Shared search query parser that respects quoted phrases and special operators.
 * Supports OR operator (uppercase only) to create boolean OR queries.
 *
 * Examples:
 * - "test email" → [[test, email]] (AND)
 * - "test OR email" → [[test], [email]] (OR)
 * - "test email OR trial" → [[test, email], [trial]] (group1 OR group2)
 * - '"test OR email"' → [["test OR email"]] (literal phrase)
 */
export function parseSearchQuery(queryStr: string): ParsedQuery {
  // Split by " OR " (uppercase, with spaces) to get OR groups
  // But respect quotes - don't split inside quoted phrases
  const orGroups: ParsedToken[][] = [];

  // First, extract quoted phrases and replace them with placeholders
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

      // For regex, we escape all special regex chars EXCEPT our glob wildcards * and ?
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
