import { describe, expect, it } from 'vitest';
import {
  FOLDER_GROUP_NONE_KEY,
  addNumberFilter,
  addSeriesFilter,
  formatNumberLabel,
  numericGroupKey,
} from './folderHierarchyHelpers';
import type { SqlParam } from './types';

describe('folderHierarchyHelpers', () => {
  it('formats display labels and stable group keys', () => {
    expect(formatNumberLabel(null, 'Unnumbered Volume', 'Volume')).toBe('Unnumbered Volume');
    expect(formatNumberLabel(2, 'Unnumbered Volume', 'Volume')).toBe('Volume 2');
    expect(formatNumberLabel(2.5, 'Unnumbered Volume', 'Volume')).toBe('Volume 2.5');

    expect(numericGroupKey(null)).toBe(FOLDER_GROUP_NONE_KEY);
    expect(numericGroupKey(3)).toBe('3');
    expect(numericGroupKey(3.5)).toBe('3.5');
  });

  it('adds series filters for named and unsorted groups', () => {
    const namedConditions: string[] = [];
    const namedParams: SqlParam[] = [];
    addSeriesFilter(namedConditions, namedParams, 'Berserk');
    expect(namedConditions).toEqual(['lower(c.series_name) = lower(?)']);
    expect(namedParams).toEqual(['Berserk']);

    const noneConditions: string[] = [];
    const noneParams: SqlParam[] = [];
    addSeriesFilter(noneConditions, noneParams, FOLDER_GROUP_NONE_KEY);
    expect(noneConditions).toEqual(["NULLIF(TRIM(c.series_name), '') IS NULL"]);
    expect(noneParams).toEqual([]);
  });

  it('adds number filters for numbered, unnumbered, and invalid groups', () => {
    const numberedConditions: string[] = [];
    const numberedParams: SqlParam[] = [];
    addNumberFilter(numberedConditions, numberedParams, 'volume_number', '12.5');
    expect(numberedConditions).toEqual(['c.volume_number = ?']);
    expect(numberedParams).toEqual([12.5]);

    const noneConditions: string[] = [];
    const noneParams: SqlParam[] = [];
    addNumberFilter(noneConditions, noneParams, 'chapter_number', FOLDER_GROUP_NONE_KEY);
    expect(noneConditions).toEqual(['c.chapter_number IS NULL']);
    expect(noneParams).toEqual([]);

    const invalidConditions: string[] = [];
    const invalidParams: SqlParam[] = [];
    addNumberFilter(invalidConditions, invalidParams, 'chapter_number', 'not-a-number');
    expect(invalidConditions).toEqual(['1 = 0']);
    expect(invalidParams).toEqual([]);
  });
});
