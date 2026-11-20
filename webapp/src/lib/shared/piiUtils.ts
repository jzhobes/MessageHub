/**
 * Remove personally identifiable information from dataset text before training or fine-tuning.
 */

export const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b\+?1?\s*\(?-?\d{3}\)?\s*-?\d{3}\s*-?\d{4}\b/g,
  trackingUPS: /\b1Z[0-9A-Z]{16}\b/g,
  // Look for long strings of digits that might be tracking or account numbers.
  longDigits: /\b\d{12,25}\b/g,
};

/**
 * Redact email addresses and phone numbers.
 */
export function redactPII(content: string): string {
  if (!content) {
    return content;
  }
  return content.replace(PII_PATTERNS.email, '[REDACTED_EMAIL]').replace(PII_PATTERNS.phone, '[REDACTED_PHONE]');
}

/**
 * Redact shipping details from the text.
 */
export function redactTrackingNumbers(content: string): string {
  if (!content) {
    return content;
  }
  return content.replace(PII_PATTERNS.trackingUPS, '[REDACTED_TRACKING]').replace(PII_PATTERNS.longDigits, (match) => {
    // Only redact long IDs so ordinary numbers like years stay readable.
    return match.length >= 15 ? '[REDACTED_TRACKING]' : match;
  });
}
