import { describe, expect, it } from 'vitest';
import { generatePanelCode, hashPanelCode, safeEqualHex } from '../src/lib/hash.js';

describe('panel code hashing', () => {
  it('is deterministic and pepper-dependent', () => {
    expect(hashPanelCode('ABCD1234', 'pep')).toBe(hashPanelCode('ABCD1234', 'pep'));
    expect(hashPanelCode('ABCD1234', 'pep')).not.toBe(hashPanelCode('ABCD1234', 'other'));
    expect(hashPanelCode('ABCD1234', 'pep')).not.toBe(hashPanelCode('ABCD1235', 'pep'));
  });

  it('never contains the plaintext', () => {
    const h = hashPanelCode('SECRET99', 'pep');
    expect(h).not.toContain('SECRET99');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unambiguous codes of the requested length', () => {
    const code = generatePanelCode(8);
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
  });

  it('compares digests in constant time', () => {
    const a = hashPanelCode('X', 'p');
    expect(safeEqualHex(a, a)).toBe(true);
    expect(safeEqualHex(a, hashPanelCode('Y', 'p'))).toBe(false);
    expect(safeEqualHex(a, 'short')).toBe(false);
  });
});
