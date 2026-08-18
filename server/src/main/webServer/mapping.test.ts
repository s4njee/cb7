import { describe, it, expect } from 'vitest';
import { overlayUserState, type WebComicRecord } from './mapping';
import type { LibraryDatabase } from '../libraryDatabase';

// The comic's own (shared) columns — what a guest, or a logged-in user who has
// not opened this book yet, resumes from.
const sharedBase = {
  id: 7,
  title: 'Cannery Row',
  pageCount: 42,
  lastPage: null,
  lastLocation: 'epubcfi(/6/12!/4/2/2)',
  lastPercent: 26,
  lastRead: '2026-06-27T00:00:00Z',
} as unknown as WebComicRecord;

type Up = Awaited<ReturnType<LibraryDatabase['getUserProgress']>>;

function fakeDb(up: Up, favorited = false): LibraryDatabase {
  return {
    getUserProgress: async () => up,
    isFavorite: async () => favorited,
  } as unknown as LibraryDatabase;
}

describe('overlayUserState (guest progress + per-user priority)', () => {
  it('guests resume from the shared position stored on the comic', async () => {
    const out = await overlayUserState(sharedBase, fakeDb(null), null);
    expect(out.lastLocation).toBe('epubcfi(/6/12!/4/2/2)');
    expect(out.lastPercent).toBe(26);
    expect(out.favorited).toBe(false);
  });

  it("a logged-in user's own progress takes priority over the shared position", async () => {
    const db = fakeDb(
      { lastPage: null, lastLocation: 'epubcfi(/6/40!/4)', lastPercent: 80, lastRead: 'z', completed: false },
      true,
    );
    const out = await overlayUserState(sharedBase, db, 1);
    expect(out.lastLocation).toBe('epubcfi(/6/40!/4)');
    expect(out.lastPercent).toBe(80);
    expect(out.favorited).toBe(true);
  });

  it('falls back to the shared position when the user has never opened the book', async () => {
    const out = await overlayUserState(sharedBase, fakeDb(null), 1);
    expect(out.lastLocation).toBe('epubcfi(/6/12!/4/2/2)');
    expect(out.lastPercent).toBe(26);
  });
});
