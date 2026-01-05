/**
 * Centralized logic for redacting PII (Personally Identifiable Information)
 * from dataset strings before training/fine-tuning.
 */

export const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b\+?1?\s*\(?-?\d{3}\)?\s*-?\d{3}\s*-?\d{4}\b/g,
  trackingUPS: /\b1Z[0-9A-Z]{16}\b/g,
  // Generic pattern for long digit strings (often tracking or accounts)
  longDigits: /\b\d{12,25}\b/g,
};

/**
 * Apply general PII redaction (email, phone).
 */
export function redactPII(content: string): string {
  if (!content) {
    return content;
  }
  return content.replace(PII_PATTERNS.email, '[REDACTED_EMAIL]').replace(PII_PATTERNS.phone, '[REDACTED_PHONE]');
}

/**
 * Apply shipping-specific redaction.
 */
export function redactTrackingNumbers(content: string): string {
  if (!content) {
    return content;
  }
  return content.replace(PII_PATTERNS.trackingUPS, '[REDACTED_TRACKING]').replace(PII_PATTERNS.longDigits, (match) => {
    // Only redact if it looks like a long ID (not years or simple numbers)
    return match.length >= 15 ? '[REDACTED_TRACKING]' : match;
  });
}
