/**
 * @module
 * Desktop Window Title Builder
 *
 * Architecture overview for Junior Devs:
 * In the Electron desktop app the OS window title should reflect what's open.
 * This helper turns a full file path into a tidy "<filename> - CB8" title, and
 * falls back to plain "CB8" when there's nothing meaningful to show.
 */

/**
 * Build the window title from a file path.
 * @param filePath Full path to the open file (any OS separator).
 * @returns "<basename> - CB8", or "CB8" when no filename can be derived.
 */
export function generateWindowTitle(filePath: string): string {
  const basename = filePath.split(/[/\\]/).pop()?.trim() || '';
  if (!basename) {
    return 'CB8';
  }
  return `${basename} - CB8`;
}
