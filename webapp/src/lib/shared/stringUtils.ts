/**
 * Decodes basic HTML entities in a string.
 * Handles decimal (&#123;), hex (&#xabc;), and standard named entities (&quot;, &amp;, etc).
 */
export const decodeHtmlEntities = (str: string): string => {
  return str
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'");
};

/**
 * Strips HTML tags from a string, including partial tags at the ends.
 */
export const stripHtml = (html: string): string => {
  if (!html) {
    return '';
  }
  return (
    html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      // Complete tags: < then letter, /, or !
      .replace(/<[a-z!/][^>]*>/gi, ' ')
      // Partial tag at start (e.g. "class='foo'>") - only if it ends with >
      // and doesn't contain a start < (heuristic for "is a tag residue")
      .replace(/^[^<]*>/, (match) => (match.includes('<') ? match : ' '))
      // Partial tag at end (e.g. "<div class='foo") - only if it starts with <tag
      .replace(/<[a-z!/][^>]*$/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
};

/**
 * Generates a snippet from content that centers on the search query match.
 * If the query is found, extracts a window around it. Otherwise, returns the start of the content.
 *
 * @param content - The full text content to extract a snippet from
 * @param query - The search query to look for
 * @param maxLength - Maximum length of the snippet (default: 300)
 * @returns A snippet string, potentially with leading/trailing ellipsis
 */
export const generateContextSnippet = (content: string, query: string, maxLength: number = 300): string => {
  if (!content) {
    return '';
  }
  if (!query) {
    return content.substring(0, maxLength);
  }

  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Find the first occurrence of the query
  const matchIndex = lowerContent.indexOf(lowerQuery);

  if (matchIndex === -1) {
    // No match found, return start of content
    const snippet = content.substring(0, maxLength);
    return snippet.length < content.length ? snippet + '...' : snippet;
  }

  // Calculate window around match
  const halfWindow = Math.floor(maxLength / 2);
  let start = Math.max(0, matchIndex - halfWindow);
  let end = Math.min(content.length, matchIndex + query.length + halfWindow);

  // Adjust if we're near the boundaries
  if (start === 0) {
    end = Math.min(content.length, maxLength);
  } else if (end === content.length) {
    start = Math.max(0, content.length - maxLength);
  }

  // Try to break at word boundaries for cleaner snippets
  if (start > 0) {
    const spaceAfterStart = content.indexOf(' ', start);
    if (spaceAfterStart !== -1 && spaceAfterStart < start + 20) {
      start = spaceAfterStart + 1;
    }
  }

  if (end < content.length) {
    const spaceBeforeEnd = content.lastIndexOf(' ', end);
    if (spaceBeforeEnd !== -1 && spaceBeforeEnd > end - 20) {
      end = spaceBeforeEnd;
    }
  }

  let snippet = content.substring(start, end);

  // Add ellipsis
  if (start > 0) {
    snippet = '...' + snippet;
  }
  if (end < content.length) {
    snippet = snippet + '...';
  }

  return snippet;
};
