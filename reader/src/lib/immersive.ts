/** Immersive reading — drop the OS chrome (status/nav bar) while a book is open.
 *
 *  Two backends, because the app runs both ways:
 *  - Tauri: the window API's fullscreen, which is what hides the status bar on
 *    mobile and the title bar on desktop.
 *  - Browser dev: the Fullscreen API. It requires a user gesture, so enabling
 *    from the settings toggle works but re-applying on reader open does not —
 *    the rejection is swallowed rather than surfaced, since a book that opens
 *    windowed is a cosmetic miss, not an error worth interrupting a reader for.
 *
 *  Every call is best-effort: a platform that doesn't implement fullscreen must
 *  degrade to "reads fine, just not immersive", never to a thrown error. */
import { isTauri } from "./transport";

export async function applyImmersive(on: boolean): Promise<void> {
  try {
    if (isTauri) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setFullscreen(on);
      return;
    }
    if (on) {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch {
    /* unsupported platform, or no user gesture — stay windowed */
  }
}
