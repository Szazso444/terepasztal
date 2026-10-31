import { describe, it, expect } from 'vitest';
import { parseDecimal } from './decimal';
import { parseNumber } from './kit';
import { readField, type FormField, type Row } from './contentForm';

describe('a number as it is typed', () => {
  it('takes a point or a comma as the decimal mark', () => {
    expect(parseDecimal('0.9')).toBe(0.9);
    expect(parseDecimal('0,9')).toBe(0.9);
    expect(parseDecimal(' 12,5 ')).toBe(12.5);
    expect(parseDecimal('-0,25')).toBe(-0.25);
    expect(parseDecimal(',5')).toBe(0.5);
    expect(parseDecimal('3,')).toBe(3);
  });

  it('leaves whole numbers, exponents and signs as they were', () => {
    expect(parseDecimal('40000')).toBe(40000);
    expect(parseDecimal('1e3')).toBe(1000);
    expect(parseDecimal('+7')).toBe(7);
  });

  it('is no number for text with two marks, a mark with nothing round it, or words', () => {
    for (const text of ['1,2,3', '1,234.5', '1.2,3', ',', 'abc', '0,9x', '1 ,5'])
      expect(parseDecimal(text), text).toBeNaN();
  });
});

describe('a typed number field reads a decimal comma', () => {
  const range = { min: 0, max: 5 };

  it('takes 0,3 for 0.3, and keeps the value for what is no number', () => {
    expect(parseNumber('0,3', range, 1)).toBe(0.3);
    expect(parseNumber('9,9', range, 1)).toBe(5);
    expect(parseNumber('1,2,3', range, 1)).toBe(1);
  });
});

describe('the content form reads a decimal comma in a number', () => {
  const field: FormField = { key: 'speed', kind: 'number' };

  it('stores 0.9 for 0,9, and refuses what is no number without touching the row', () => {
    const row: Row = { speed: 0.8 };
    expect(readField(row, field, 'number', '0,9')).toBe(true);
    expect(row.speed).toBe(0.9);
    expect(readField(row, field, 'number', 'fast')).toBe(false);
    expect(row.speed).toBe(0.9);
    expect(readField(row, field, 'number', '1,2,3')).toBe(false);
    expect(row.speed).toBe(0.9);
  });

  it('leaves a list of numbers to its commas', () => {
    const row: Row = {};
    expect(readField(row, { key: 'sizes', kind: 'numList' }, 'numList', '1, 2, 3')).toBe(true);
    expect(row.sizes).toEqual([1, 2, 3]);
  });
});
