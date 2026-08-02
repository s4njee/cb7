/**
 * @module
 * Admin Panel Routing & Access Helpers
 *
 * Architecture overview for Junior Devs:
 * The admin modal is a quick-actions dialog that swaps between a handful of
 * admin-only "panels" (upload, add-path, create-collection, create-folder).
 * Sign-in, settings, and user management live on real routes (/login,
 * /settings, /users) — not here. This module is the source of truth for which
 * quick-action panels exist and what each one is titled, plus the validator for
 * arbitrary panel strings coming from callers. Every panel is admin-only; the
 * modal itself gates rendering on the session.
 */

/** Every quick-action panel the admin modal can display, in definition order. */
export const ADMIN_PANELS = [
  'add-path',
  'upload',
  'create-collection',
  'create-folder',
] as const;

/** Union of valid admin panel identifiers. */
export type AdminPanel = typeof ADMIN_PANELS[number];

/** Fast lookup set for validating arbitrary panel strings. */
const adminPanelSet = new Set<string>(ADMIN_PANELS);

/** Display title for each admin panel. */
const panelTitles: Record<AdminPanel, string> = {
  'add-path': 'Add from server path',
  upload: 'Upload comics',
  'create-collection': 'New collection',
  'create-folder': 'New folder',
};

/**
 * Validate an arbitrary string as a known admin panel.
 * @param panel The candidate panel string.
 * @returns The typed panel if recognised, otherwise `null`.
 */
export function toAdminPanel(panel: string | null | undefined): AdminPanel | null {
  return panel && adminPanelSet.has(panel) ? (panel as AdminPanel) : null;
}

/**
 * Get the display title for a panel.
 * @param panel The panel.
 * @returns The human-readable title.
 */
export function adminPanelTitle(panel: AdminPanel): string {
  return panelTitles[panel];
}
