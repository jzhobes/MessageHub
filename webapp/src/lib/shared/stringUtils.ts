import { decode } from 'html-entities';
import { parseFragment } from 'parse5';

import type { DefaultTreeAdapterMap } from 'parse5';

/**
 * Decodes one layer of HTML5 entities without reprocessing decoded output.
 * Requires semicolons and preserves unknown or malformed entities.
 * Replaces lone Unicode surrogates with the replacement character.
 * This decodes text; it does not sanitize HTML.
 *
 * @param str - The text containing HTML entities
 * @returns The text with each supported entity decoded once
 */
export const decodeHtmlEntities = (str: string): string => {
  return decode(str, { level: 'html5', scope: 'strict' }).toWellFormed();
};

const TEXT_BREAK_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'div',
  'dl',
  'dt',
  'dd',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tr',
  'ul',
]);

/**
 * Extracts plain text from HTML, excluding script and style contents.
 * Preserves block and line breaks and decodes entities once during parsing.
 * The result is text, not sanitized HTML, and must be rendered as text.
 *
 * @param html - The HTML document or fragment to extract text from
 * @returns Plain text with normalized whitespace
 */
export const stripHtml = (html: string): string => {
  if (!html) {
    return '';
  }

  const chunks: string[] = [];
  // An explicit stack avoids recursive traversal limits on deeply nested input.
  const pending: (DefaultTreeAdapterMap['node'] | string)[] = [parseFragment(html)];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (typeof node === 'string') {
      chunks.push(node);
    } else if ('value' in node) {
      chunks.push(node.value);
    } else if ('childNodes' in node) {
      const tag = 'tagName' in node ? node.tagName : '';
      if (tag === 'script' || tag === 'style' || tag === 'template') {
        chunks.push(' ');
        continue;
      }
      const separator = TEXT_BREAK_ELEMENTS.has(tag) ? '\n' : tag === 'td' || tag === 'th' ? ' ' : '';
      if (separator) {
        chunks.push(separator);
        pending.push(separator);
      }
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        pending.push(node.childNodes[i]);
      }
    }
  }

  return chunks
    .join('')
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n+/g, '\n')
    .trim()
    .toWellFormed();
};

/**
 * Heuristic check to see if a string likely contains HTML tags or entities.
 * Used to avoid running heavy strip/decode logic on plain text.
 */
export const containsHtmlOrEntities = (str: string): boolean => {
  return /<[a-z!/][^>]*>/i.test(str) || /&([a-z0-9]+|#[0-9]+|#x[0-9a-f]+);/i.test(str);
};

/**
 * Removes URLs from a string.
 */
export const stripUrls = (str: string): string => {
  const urlRegex = /https?:\/\/[^\s]+/gi;
  return str.replace(urlRegex, ' ').replace(/\s+/g, ' ').trim();
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
