import { describe, expect, it } from 'vitest';

import { decodeHtmlEntities, stripHtml } from '@/lib/shared/stringUtils';

describe('decodeHtmlEntities', () => {
  it('decodes supported named and numeric entities in the same input', () => {
    expect(decodeHtmlEntities('&quot;A &amp; B&quot; &lt;x&gt; &apos;y&apos; &#65; &#x42; &#X43;')).toBe(
      '"A & B" <x> \'y\' A B C',
    );
  });

  it('decodes HTML5 named entities found in emails and previews', () => {
    expect(decodeHtmlEntities('&nbsp;&copy;&hellip;&eacute;')).toBe('\u00a0©…é');
  });

  it.each([
    ['&amp;lt;', '&lt;'],
    ['&amp;gt;', '&gt;'],
    ['&amp;quot;', '&quot;'],
    ['&#38;quot;', '&quot;'],
    ['&#x26;lt;', '&lt;'],
    ['&#38;#x3c;', '&#x3c;'],
    ['&amp;#60;', '&#60;'],
    ['&#38;amp;', '&amp;'],
    ['&amp;amp;', '&amp;'],
  ])('decodes only one layer: %s', (input, expected) => {
    expect(decodeHtmlEntities(input)).toBe(expected);
  });

  it('preserves supplementary Unicode characters rather than truncating them', () => {
    expect(decodeHtmlEntities('&#128512; &#x1F600;')).toBe('😀 😀');
  });

  it.each(['&#0;', '&#xD800;', '&#xDFFF;', '&#1114112;', '&#x110000;', `&#${'9'.repeat(400)};`])(
    'replaces an invalid numeric Unicode value: %s',
    (input) => {
      expect(decodeHtmlEntities(input)).toBe('\ufffd');
    },
  );

  it.each(['', 'plain text & more', '&unknown;', '&#xZZ;', '&#-1;', '&amp', '&#;', '&#x;'])(
    'preserves unsupported or malformed input: %s',
    (input) => {
      expect(decodeHtmlEntities(input)).toBe(input);
    },
  );
});

describe('stripHtml', () => {
  it.each(['script', 'style'])('excludes %s contents with normal and malformed closing tags', (tag) => {
    for (const end of [`</${tag}>`, `</${tag} >`, `</${tag} ignored="value">`, `</${tag.toUpperCase()}>`]) {
      expect(stripHtml(`<p>Before</p><${tag}>hidden &amp; content${end}<p>After</p>`)).toBe('Before\nAfter');
    }
  });

  it.each(['script', 'style'])('excludes unclosed %s contents', (tag) => {
    expect(stripHtml(`<p>Visible</p><${tag}>hidden`)).toBe('Visible');
  });

  it('preserves paragraph, list, line and table boundaries', () => {
    expect(
      stripHtml(
        '<p>One<br>Two</p><ul><li>Three</li><li>Four</li></ul><table><tr><td>Five</td><td>Six</td></tr></table>',
      ),
    ).toBe('One\nTwo\nThree\nFour\nFive Six');
  });

  it('preserves inline text without inserting spaces inside words', () => {
    expect(stripHtml('Hel<b>lo</b> <em>world</em>')).toBe('Hello world');
  });

  it('handles quoted angle brackets, comments and incomplete tags', () => {
    expect(stripHtml('<p title="a > b">Visible<!-- hidden --!> text</p><div title="unfinished')).toBe('Visible text');
  });

  it('does not mistake script-like custom elements for scripts', () => {
    expect(stripHtml('<scripture>Visible</scripture>')).toBe('Visible');
  });

  it('decodes entities once without parsing decoded text as markup', () => {
    expect(stripHtml('<p>&amp;lt; &#38;quot; &lt;b&gt;literal&lt;/b&gt; &#128512;</p>')).toBe(
      '&lt; &quot; <b>literal</b> 😀',
    );
  });

  it('omits inert template contents', () => {
    expect(stripHtml('Before<template>Hidden</template>After')).toBe('Before After');
  });

  it.each(['', 'plain text', '2 < 3 and 4 > 1'])('preserves plain text: %s', (text) => {
    expect(stripHtml(text)).toBe(text);
  });
});
