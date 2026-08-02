import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  directorySuggestions,
  parseIngestErrorLimit,
  parseUploadHeaders,
  resolveAddPathFolderTarget,
  resolveUploadDestination,
  validateUploadPathParts,
} from './uploadRouteHelpers';

function dirent(name: string, isDirectory: boolean): fs.Dirent {
  return {
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
  } as fs.Dirent;
}

describe('uploadRouteHelpers', () => {
  it('parses percent-encoded upload headers', () => {
    expect(parseUploadHeaders('Saga%2001.cbz', undefined)).toEqual({
      ok: true,
      filename: 'Saga 01.cbz',
      relPath: 'Saga 01.cbz',
    });
    expect(parseUploadHeaders('Saga%2001.cbz', 'Saga%2FVol%201%2FSaga%2001.cbz')).toEqual({
      ok: true,
      filename: 'Saga 01.cbz',
      relPath: 'Saga/Vol 1/Saga 01.cbz',
    });
    expect(parseUploadHeaders('', undefined)).toEqual({ ok: false, status: 400, error: 'Missing X-CB8-Filename header' });
    expect(parseUploadHeaders('%E0%A4%A', undefined)).toEqual({
      ok: false,
      status: 400,
      error: 'Headers are not valid percent-encoded UTF-8',
    });
  });

  it('validates upload relative paths and supported extensions', () => {
    expect(validateUploadPathParts('book.cbz', 'Series/book.cbz')).toEqual({
      ok: true,
      relParts: ['Series', 'book.cbz'],
    });
    expect(validateUploadPathParts('../book.cbz', '../book.cbz')).toEqual({ ok: false, status: 400, error: 'Invalid filename' });
    expect(validateUploadPathParts('book.cbz', '../book.cbz')).toEqual({ ok: false, status: 400, error: 'Invalid relative path' });
    expect(validateUploadPathParts('book.txt', 'book.txt')).toEqual({ ok: false, status: 415, error: 'Unsupported file type' });
  });

  it('keeps resolved upload destinations inside the upload root', () => {
    const root = path.join(path.sep, 'uploads');
    expect(resolveUploadDestination(root, ['Series', 'book.cbz'])).toBe(path.join(root, 'Series', 'book.cbz'));
    expect(resolveUploadDestination(root, ['..', 'book.cbz'])).toBeNull();
  });

  it('filters, sorts, and limits directory suggestions', () => {
    const entries = [
      dirent('.hidden', false),
      dirent('B.cbz', false),
      dirent('A.txt', false),
      dirent('A.epub', false),
      dirent('Series', true),
    ];

    expect(directorySuggestions('/library', '', entries)).toEqual([
      { name: 'Series', path: `/library${path.sep}Series${path.sep}`, isDir: true },
      { name: 'A.epub', path: `/library${path.sep}A.epub`, isDir: false },
      { name: 'B.cbz', path: `/library${path.sep}B.cbz`, isDir: false },
    ]);
  });

  it('parses bounded ingest error limits', () => {
    expect(parseIngestErrorLimit(undefined)).toBe(50);
    expect(parseIngestErrorLimit('0')).toBe(1);
    expect(parseIngestErrorLimit('1000')).toBe(500);
    expect(parseIngestErrorLimit('25')).toBe(25);
    expect(parseIngestErrorLimit('nope')).toBe(50);
  });

  it('resolves add-path folder targets', () => {
    const folders = [
      { id: 1, name: 'Manga' },
      { id: 2, name: 'Books' },
    ];

    expect(resolveAddPathFolderTarget('', folders)).toEqual({ kind: 'none' });
    expect(resolveAddPathFolderTarget(' manga ', folders)).toEqual({ kind: 'existing', id: 1 });
    expect(resolveAddPathFolderTarget('BOOKS', folders)).toEqual({ kind: 'existing', id: 2 });
    expect(resolveAddPathFolderTarget('New Shelf', folders)).toEqual({
      kind: 'create',
      name: 'New Shelf',
    });
  });
});
