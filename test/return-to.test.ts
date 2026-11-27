import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '../src/http';

describe('safeReturnTo', () => {
  it('keeps local paths', () => {
    expect(safeReturnTo('/a/b?c=1')).toBe('/a/b?c=1');
    expect(safeReturnTo('/')).toBe('/');
  });

  it('refuses anything a browser could read as another site', () => {
    for (const bad of [
      '//evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      '/\\evil.example',
      '/ /evil.example',
      'https://evil.example',
      'evil.example',
      `/${'a'.repeat(600)}`,
      '',
      null,
      undefined,
    ]) {
      expect(safeReturnTo(bad), String(bad)).toBeNull();
    }
  });

  it('normalises what it keeps', () => {
    expect(safeReturnTo('/a/../b')).toBe('/b');
    expect(safeReturnTo('/a#frag')).toBe('/a');
  });
});
