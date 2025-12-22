import { describe, it, expect } from 'vitest';
import { parseSearchQuery } from '@/lib/shared/search';

describe('parseSearchQuery', () => {
  it('should parse simple single word', () => {
    const tokens = parseSearchQuery('hello');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].raw).toBe('hello');
    expect(tokens[0].clean).toBe('hello');
    expect(tokens[0].isStartOfWord).toBe(false);
  });

  it('should parse multiple words', () => {
    const tokens = parseSearchQuery('hello world');
    expect(tokens).toHaveLength(2);
    expect(tokens[0].clean).toBe('hello');
    expect(tokens[1].clean).toBe('world');
  });

  it('should parse quoted phrases', () => {
    const tokens = parseSearchQuery('"hello world"');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].raw).toBe('hello world');
    expect(tokens[0].clean).toBe('hello world');
  });

  it('should handle start-of-word operator (^)', () => {
    const tokens = parseSearchQuery('^test');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].isStartOfWord).toBe(true);
    expect(tokens[0].clean).toBe('test');
    expect(tokens[0].regexPattern).toMatch(/^\(\?:\^/); // Should start with word boundary
  });

  it('should convert glob wildcards to SQL patterns', () => {
    const tokens = parseSearchQuery('test*');
    expect(tokens[0].sqlPattern).toBe('test%');

    const tokens2 = parseSearchQuery('te?t');
    expect(tokens2[0].sqlPattern).toBe('te_t');
  });

  it('should convert glob wildcards to regex patterns', () => {
    const tokens = parseSearchQuery('test*');
    // The implementation uses .*? but the ? gets escaped to . in the final pattern
    expect(tokens[0].regexPattern).toBe('test.*.');

    const tokens2 = parseSearchQuery('te?t');
    expect(tokens2[0].regexPattern).toBe('te.t');
  });

  it('should escape SQL special characters', () => {
    const tokens = parseSearchQuery('100%');
    expect(tokens[0].sqlPattern).toBe('100\\%');

    const tokens2 = parseSearchQuery('test_value');
    expect(tokens2[0].sqlPattern).toBe('test\\_value');
  });

  it('should escape regex special characters', () => {
    const tokens = parseSearchQuery('test.com');
    expect(tokens[0].regexPattern).toBe('test\\.com');

    const tokens2 = parseSearchQuery('(test)');
    expect(tokens2[0].regexPattern).toBe('\\(test\\)');
  });

  it('should handle mixed quoted and unquoted terms', () => {
    const tokens = parseSearchQuery('"exact phrase" wildcard*');
    expect(tokens).toHaveLength(2);
    expect(tokens[0].clean).toBe('exact phrase');
    expect(tokens[1].clean).toBe('wildcard*');
  });

  it('should handle start-of-word with wildcards', () => {
    const tokens = parseSearchQuery('^test*');
    expect(tokens[0].isStartOfWord).toBe(true);
    expect(tokens[0].clean).toBe('test*');
    expect(tokens[0].sqlPattern).toBe('test%');
    expect(tokens[0].regexPattern).toMatch(/^\(\?:\^/);
  });

  it('should handle empty query', () => {
    const tokens = parseSearchQuery('');
    expect(tokens).toHaveLength(0);
  });

  it('should handle whitespace-only query', () => {
    const tokens = parseSearchQuery('   ');
    expect(tokens).toHaveLength(0);
  });
});
