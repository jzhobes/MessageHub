import { describe, expect, it } from 'vitest';

import { parseSearchQuery } from '@/lib/shared/search';

describe('parseSearchQuery', () => {
  it('should parse simple single word', () => {
    const result = parseSearchQuery('hello');
    expect(result.orGroups).toHaveLength(1);
    expect(result.orGroups[0]).toHaveLength(1);
    expect(result.orGroups[0][0].raw).toBe('hello');
    expect(result.orGroups[0][0].clean).toBe('hello');
    expect(result.orGroups[0][0].isStartOfWord).toBe(false);
  });

  it('should parse multiple words as AND group', () => {
    const result = parseSearchQuery('hello world');
    expect(result.orGroups).toHaveLength(1);
    expect(result.orGroups[0]).toHaveLength(2);
    expect(result.orGroups[0][0].clean).toBe('hello');
    expect(result.orGroups[0][1].clean).toBe('world');
  });

  it('should parse OR operator', () => {
    const result = parseSearchQuery('hello OR world');
    expect(result.orGroups).toHaveLength(2);
    expect(result.orGroups[0]).toHaveLength(1);
    expect(result.orGroups[1]).toHaveLength(1);
    expect(result.orGroups[0][0].clean).toBe('hello');
    expect(result.orGroups[1][0].clean).toBe('world');
  });

  it('should parse quoted phrases', () => {
    const result = parseSearchQuery('"hello world"');
    expect(result.orGroups).toHaveLength(1);
    expect(result.orGroups[0]).toHaveLength(1);
    expect(result.orGroups[0][0].raw).toBe('hello world');
    expect(result.orGroups[0][0].clean).toBe('hello world');
  });

  it('should handle start-of-word operator (^)', () => {
    const result = parseSearchQuery('^test');
    expect(result.orGroups[0][0].isStartOfWord).toBe(true);
    expect(result.orGroups[0][0].clean).toBe('test');
    expect(result.orGroups[0][0].regexPattern).toMatch(/^\(\?:\^/); // Should start with word boundary
  });

  it('should convert glob wildcards to SQL patterns', () => {
    const result = parseSearchQuery('test*');
    expect(result.orGroups[0][0].sqlPattern).toBe('test%');

    const result2 = parseSearchQuery('te?t');
    expect(result2.orGroups[0][0].sqlPattern).toBe('te_t');
  });

  it('should convert glob wildcards to regex patterns', () => {
    const result = parseSearchQuery('test*');
    // The implementation uses .*? but the ? gets escaped to . in the final pattern
    expect(result.orGroups[0][0].regexPattern).toBe('test.*?');

    const result2 = parseSearchQuery('te?t');
    expect(result2.orGroups[0][0].regexPattern).toBe('te.t');
  });

  it('should escape SQL special characters', () => {
    const result = parseSearchQuery('100%');
    expect(result.orGroups[0][0].sqlPattern).toBe('100\\%');

    const result2 = parseSearchQuery('test_value');
    expect(result2.orGroups[0][0].sqlPattern).toBe('test\\_value');
  });

  it('should escape regex special characters', () => {
    const result = parseSearchQuery('test.com');
    expect(result.orGroups[0][0].regexPattern).toBe('test\\.com');

    const result2 = parseSearchQuery('(test)');
    expect(result2.orGroups[0][0].regexPattern).toBe('\\(test\\)');
  });

  it('should handle mixed quoted and unquoted terms', () => {
    const result = parseSearchQuery('"exact phrase" wildcard*');
    expect(result.orGroups).toHaveLength(1);
    expect(result.orGroups[0]).toHaveLength(2);
    expect(result.orGroups[0][0].clean).toBe('exact phrase');
    expect(result.orGroups[0][1].clean).toBe('wildcard*');
  });

  it('should handle start-of-word with wildcards', () => {
    const result = parseSearchQuery('^test*');
    expect(result.orGroups[0][0].isStartOfWord).toBe(true);
    expect(result.orGroups[0][0].clean).toBe('test*');
    expect(result.orGroups[0][0].sqlPattern).toBe('test%');
    expect(result.orGroups[0][0].regexPattern).toMatch(/^\(\?:\^/);
  });

  it('should handle empty query', () => {
    const result = parseSearchQuery('');
    expect(result.orGroups).toHaveLength(0);
  });

  it('should handle whitespace-only query', () => {
    const result = parseSearchQuery('   ');
    expect(result.orGroups).toHaveLength(0);
  });

  it('should handle OR with quoted phrases', () => {
    const result = parseSearchQuery('"test email" OR trial');
    expect(result.orGroups).toHaveLength(2);
    expect(result.orGroups[0][0].clean).toBe('test email');
    expect(result.orGroups[1][0].clean).toBe('trial');
  });

  it('should handle complex OR with AND groups', () => {
    const result = parseSearchQuery('test email OR trial version');
    expect(result.orGroups).toHaveLength(2);
    expect(result.orGroups[0]).toHaveLength(2); // test AND email
    expect(result.orGroups[1]).toHaveLength(2); // trial AND version
  });
});
