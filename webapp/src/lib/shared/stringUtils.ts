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
