import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushAllProgress, flushProgress, scheduleProgress } from './progressSync';
import { updateLocation, updateProgress } from './api/reading';

vi.mock('./api/reading', () => ({
  updateProgress: vi.fn(() => Promise.resolve()),
  updateLocation: vi.fn(() => Promise.resolve()),
}));

const updateProgressMock = vi.mocked(updateProgress);
const updateLocationMock = vi.mocked(updateLocation);

describe('progressSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateProgressMock.mockClear();
    updateLocationMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses a burst of page turns into a single write with the last value', () => {
    scheduleProgress(1, { page: 1 });
    scheduleProgress(1, { page: 2 });
    scheduleProgress(1, { page: 3 });

    vi.advanceTimersByTime(799);
    expect(updateProgressMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(updateProgressMock).toHaveBeenCalledTimes(1);
    expect(updateProgressMock).toHaveBeenCalledWith(1, 3, false);
  });

  it('writes different books independently', () => {
    scheduleProgress(1, { page: 1 });
    scheduleProgress(2, { page: 5 });

    vi.advanceTimersByTime(800);
    expect(updateProgressMock).toHaveBeenCalledTimes(2);
    expect(updateProgressMock).toHaveBeenCalledWith(1, 1, false);
    expect(updateProgressMock).toHaveBeenCalledWith(2, 5, false);
  });

  it('flushProgress writes the pending position immediately and cancels the trailing timer', () => {
    scheduleProgress(1, { page: 4 });
    flushProgress(1);

    expect(updateProgressMock).toHaveBeenCalledTimes(1);
    expect(updateProgressMock).toHaveBeenCalledWith(1, 4, false);

    vi.advanceTimersByTime(1000);
    expect(updateProgressMock).toHaveBeenCalledTimes(1);
  });

  it('flushProgress is a no-op when nothing is pending', () => {
    flushProgress(9);
    expect(updateProgressMock).not.toHaveBeenCalled();
  });

  it('flushAllProgress writes every pending book once', () => {
    scheduleProgress(1, { location: 'epubcfi(/6/4)', percent: 42 });
    scheduleProgress(2, { page: 7 });

    flushAllProgress();
    expect(updateLocationMock).toHaveBeenCalledTimes(1);
    expect(updateLocationMock).toHaveBeenCalledWith(1, 'epubcfi(/6/4)', 42, false);
    expect(updateProgressMock).toHaveBeenCalledTimes(1);
    expect(updateProgressMock).toHaveBeenCalledWith(2, 7, false);

    vi.advanceTimersByTime(1000);
    expect(updateLocationMock).toHaveBeenCalledTimes(1);
    expect(updateProgressMock).toHaveBeenCalledTimes(1);
  });

  it('a later schedule for the same book replaces the pending payload', () => {
    scheduleProgress(1, { page: 2 });
    scheduleProgress(1, { page: 3 });

    vi.advanceTimersByTime(800);
    expect(updateProgressMock).toHaveBeenCalledTimes(1);
    expect(updateProgressMock).toHaveBeenCalledWith(1, 3, false);
  });

  it('schedules an EPUB position with no percent as a bare location write', () => {
    scheduleProgress(1, { location: 'epubcfi(/6/4)' });

    vi.advanceTimersByTime(800);
    expect(updateLocationMock).toHaveBeenCalledTimes(1);
    expect(updateLocationMock).toHaveBeenCalledWith(1, 'epubcfi(/6/4)', undefined, false);
  });

  it('flushAllProgress(true) keeps the request alive across hide/unload', () => {
    scheduleProgress(1, { page: 9 });
    flushAllProgress(true);
    expect(updateProgressMock).toHaveBeenCalledWith(1, 9, true);
  });
});
