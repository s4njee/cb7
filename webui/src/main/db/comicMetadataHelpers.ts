/**
 * @module
 * Builds Parameterized SQL for Comic Metadata Updates
 *
 * Architecture overview for Junior Devs:
 * When a user edits a comic's metadata, only the fields they actually changed
 * should be written — and every value must go through a bound `?` parameter, not
 * string concatenation, to stay safe from SQL injection. This module turns a
 * partial set of metadata fields into the `SET` assignments and matching values
 * an UPDATE statement needs.
 *
 * The `METADATA_FIELD_COLUMNS` table is the single source of truth mapping each
 * camelCase field to its snake_case DB column. `buildComicMetadataUpdate` walks
 * it and, crucially, includes a field only when it is not `undefined` — so an
 * explicit `null` clears a column, while an absent field is left untouched.
 */
import type { SqlParam } from './types';

/** Partial set of editable comic metadata fields (undefined = leave unchanged). */
export interface ComicMetadataUpdateFields {
  title?: string;
  author?: string | null;
  artist?: string | null;
  genre?: string | null;
  year?: number | null;
  summary?: string | null;
  externalId?: string | null;
  externalSource?: string | null;
  seriesName?: string | null;
  volumeNumber?: number | null;
  chapterNumber?: number | null;
}

/** The `SET` clause fragments and their bound values for an UPDATE. */
export interface ComicMetadataUpdate {
  assignments: string[];
  values: SqlParam[];
}

/** Comic metadata in app (camelCase) shape. */
export interface ComicMetadata {
  author: string | null;
  artist: string | null;
  genre: string | null;
  year: number | null;
  summary: string | null;
  externalId: string | null;
  externalSource: string | null;
  seriesName: string | null;
  volumeNumber: number | null;
  chapterNumber: number | null;
}

/** Comic metadata as stored in the DB (snake_case columns). */
export interface ComicMetadataRow {
  author: string | null;
  artist: string | null;
  genre: string | null;
  year: number | null;
  summary: string | null;
  external_id: string | null;
  external_source: string | null;
  series_name: string | null;
  volume_number: number | null;
  chapter_number: number | null;
}

/** Source-of-truth mapping of each metadata field to its DB column. */
const METADATA_FIELD_COLUMNS: Array<[keyof ComicMetadataUpdateFields, string]> = [
  ['title', 'title'],
  ['author', 'author'],
  ['artist', 'artist'],
  ['genre', 'genre'],
  ['year', 'year'],
  ['summary', 'summary'],
  ['externalId', 'external_id'],
  ['externalSource', 'external_source'],
  ['seriesName', 'series_name'],
  ['volumeNumber', 'volume_number'],
  ['chapterNumber', 'chapter_number'],
];

/**
 * Build the `SET` assignments and bound values for a metadata UPDATE.
 * Includes only fields that are present (not `undefined`); each becomes a
 *          `column = ?` assignment with its value pushed in matching order, so an
 *          explicit `null` clears a column and an absent field is left untouched.
 * @param fields The partial set of metadata fields to update.
 * @returns The parameterized assignments and their values.
 */
export function buildComicMetadataUpdate(fields: ComicMetadataUpdateFields): ComicMetadataUpdate {
  const assignments: string[] = [];
  const values: SqlParam[] = [];

  for (const [fieldName, columnName] of METADATA_FIELD_COLUMNS) {
    const value = fields[fieldName];
    if (value !== undefined) {
      assignments.push(`${columnName} = ?`);
      values.push(value);
    }
  }

  return { assignments, values };
}

/**
 * Convert a DB metadata row into the app's camelCase shape.
 * @param row The snake_case row read from the database.
 * @returns The metadata in camelCase form.
 */
export function rowToComicMetadata(row: ComicMetadataRow): ComicMetadata {
  return {
    author: row.author,
    artist: row.artist,
    genre: row.genre,
    year: row.year,
    summary: row.summary,
    externalId: row.external_id,
    externalSource: row.external_source,
    seriesName: row.series_name,
    volumeNumber: row.volume_number,
    chapterNumber: row.chapter_number,
  };
}
