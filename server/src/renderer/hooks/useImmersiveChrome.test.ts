import { describe, expect, it } from 'vitest';
import { CHROME_AUTO_HIDE_MS, nextChromeState } from './useImmersiveChrome';

describe('useImmersiveChrome', () => {
  it('auto-hides after a sensible reading pause', () => {
    expect(CHROME_AUTO_HIDE_MS).toBe(3000);
  });

  it('toggle flips visibility and arms the hide timer only when showing', () => {
    expect(nextChromeState(false, false, 'toggle')).toEqual({ visible: true, scheduleHide: true });
    expect(nextChromeState(true, false, 'toggle')).toEqual({ visible: false, scheduleHide: false });
  });

  it('toggle while pinned shows the chrome without arming the hide timer', () => {
    expect(nextChromeState(false, true, 'toggle')).toEqual({ visible: true, scheduleHide: false });
  });

  it('reveal shows the chrome and re-arms the hide timer', () => {
    expect(nextChromeState(false, false, 'reveal')).toEqual({ visible: true, scheduleHide: true });
    expect(nextChromeState(true, false, 'reveal')).toEqual({ visible: true, scheduleHide: true });
  });

  it('reveal while the pointer rests on the chrome never schedules a hide', () => {
    expect(nextChromeState(true, true, 'reveal')).toEqual({ visible: true, scheduleHide: false });
  });

  it('autoHide hides the chrome unless the pointer is pinned on it', () => {
    expect(nextChromeState(true, false, 'autoHide')).toEqual({ visible: false, scheduleHide: false });
    expect(nextChromeState(true, true, 'autoHide')).toEqual({ visible: true, scheduleHide: false });
  });
});
