import { describe, expect, it } from 'vitest';
import { ADMIN_PANELS, adminPanelTitle, toAdminPanel } from './adminPanelHelpers';

describe('adminPanelHelpers', () => {
  it('accepts only known admin panels', () => {
    expect(toAdminPanel('upload')).toBe('upload');
    expect(toAdminPanel('create-folder')).toBe('create-folder');
    expect(toAdminPanel('not-a-panel')).toBeNull();
    expect(toAdminPanel(null)).toBeNull();
  });

  it('rejects panels that moved to real routes', () => {
    expect(toAdminPanel('menu')).toBeNull();
    expect(toAdminPanel('login')).toBeNull();
    expect(toAdminPanel('settings')).toBeNull();
    expect(toAdminPanel('users')).toBeNull();
    expect(toAdminPanel('forgot')).toBeNull();
    expect(toAdminPanel('reset')).toBeNull();
  });

  it('keeps modal titles in one lookup table', () => {
    expect(adminPanelTitle('create-folder')).toBe('New folder');
    expect(adminPanelTitle('add-path')).toBe('Add from server path');
    for (const panel of ADMIN_PANELS) {
      expect(adminPanelTitle(panel)).toBeTruthy();
    }
  });
});
