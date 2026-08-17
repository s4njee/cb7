/**
 * App session + navigation state (no router).
 *
 * **CB8 is local-first**: the machine is `library ⇄ reader`, and `connect` is
 * a detour off the library, not a gate in front of it. Boot always lands on the
 * library because the library always exists — the on-device shelf needs no
 * server, no session and no network. A server, when there is one, adds a second
 * shelf to browse and download from.
 *
 * The `guest` choice is persisted so a returning guest skips the sign-in form;
 * auth itself is held by the cookie session (Rust / browser), not here.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User, WebComicRecord } from "../lib/api";

export type Screen = "boot" | "connect" | "library" | "reader";
export type ConnectStep = "server" | "signin";

interface PersistedSession {
  guestChosen: boolean;
  lastUsername: string | null;
}

interface SessionState extends PersistedSession {
  screen: Screen;
  serverUrl: string | null;
  user: User | null;
  guestAccess: boolean;
  guest: boolean;
  connectStep: ConnectStep;
  connectError: string | null;
  openRecord: WebComicRecord | null;
  /** Transient status line (crash recovery, "saved on device", …). Rendered by
   *  App; auto-cleared there. Null when nothing to show. */
  toast: string | null;
  /** Full-screen sheet layered over whatever screen is active (rendered by
   *  App). `stats` = reading statistics + server history. */
  sheet: null | "stats" | "downloads";
  /** Monotonic counter bumped by external import entry points (native menu,
   *  drag/drop). Library flips to the local shelf when it changes. */
  importTick: number;
  /** Live progress of a batch/folder import, or null when none is running.
   *  App renders a small overlay with a Cancel button while set. */
  importProgress: { done: number; total: number; current: string } | null;
  /** Monotonic counter bumped when the native menu asks the reader to open its
   *  settings drawer (Reader watches it, mirroring `importTick`). */
  readerSettingsTick: number;
  /** Monotonic counter bumped when the native menu asks the reader to open its
   *  in-book search (Cmd/Ctrl+F while reading). */
  readerSearchTick: number;
  /** Monotonic counter bumped when the native menu asks to focus the library
   *  search box (Cmd/Ctrl+F). Library watches it. */
  librarySearchTick: number;

  setBooting: () => void;
  /** Land on the library with no server involved — the local-first entry. */
  enterLibrary: () => void;
  /** Signal that a book was imported from outside the library screen (native
   *  menu, drag/drop). Library watches this to switch to the local shelf. */
  bumpImport: () => void;
  setImportProgress: (p: { done: number; total: number; current: string } | null) => void;
  /** Ask the reader to open its settings drawer (native View > Reader Settings). */
  requestReaderSettings: () => void;
  /** Ask the reader to open its in-book search (Cmd/Ctrl+F while reading). */
  requestReaderSearch: () => void;
  /** Focus the library search box (native Edit > Find in Library…, Cmd/Ctrl+F). */
  requestLibrarySearch: () => void;
  /** Leave the connect detour without connecting; the local shelf is still there. */
  cancelConnect: () => void;
  showToast: (msg: string) => void;
  dismissToast: () => void;
  openSheet: (sheet: NonNullable<SessionState["sheet"]>) => void;
  closeSheet: () => void;
  goConnect: (step: ConnectStep, opts?: { serverUrl?: string | null; error?: string | null; guestAccess?: boolean }) => void;
  enterAsUser: (user: User, serverUrl: string) => void;
  enterAsGuest: (serverUrl: string) => void;
  setConnectStep: (step: ConnectStep) => void;
  setConnectError: (msg: string | null) => void;
  setGuestAccess: (v: boolean) => void;
  openBook: (record: WebComicRecord) => void;
  closeReader: () => void;
  reset: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      guestChosen: false,
      lastUsername: null,

      screen: "boot",
      serverUrl: null,
      user: null,
      guestAccess: false,
      guest: false,
      connectStep: "server",
      connectError: null,
      openRecord: null,
      toast: null,
      sheet: null,
      importTick: 0,
      readerSettingsTick: 0,
      readerSearchTick: 0,
      librarySearchTick: 0,
      importProgress: null,

      setBooting: () => set({ screen: "boot" }),
      enterLibrary: () => set({ screen: "library" }),
      bumpImport: () => set((s) => ({ importTick: s.importTick + 1 })),
      setImportProgress: (importProgress) => set({ importProgress }),
      requestReaderSettings: () =>
        set((s) => ({ readerSettingsTick: s.readerSettingsTick + 1 })),
      requestReaderSearch: () =>
        set((s) => ({ readerSearchTick: s.readerSearchTick + 1 })),
      requestLibrarySearch: () =>
        set((s) => ({ librarySearchTick: s.librarySearchTick + 1 })),
      cancelConnect: () => set({ screen: "library", connectError: null }),
      showToast: (toast) => set({ toast }),
      dismissToast: () => set({ toast: null }),
      openSheet: (sheet) => set({ sheet }),
      closeSheet: () => set({ sheet: null }),
      goConnect: (step, opts) =>
        set((s) => ({
          screen: "connect",
          connectStep: step,
          serverUrl: opts?.serverUrl !== undefined ? opts.serverUrl : s.serverUrl,
          connectError: opts?.error ?? null,
          guestAccess: opts?.guestAccess ?? s.guestAccess,
          user: null,
          guest: false,
        })),
      enterAsUser: (user, serverUrl) =>
        set({
          screen: "library",
          user,
          serverUrl,
          guest: false,
          guestChosen: false,
          lastUsername: user.username,
          connectError: null,
        }),
      enterAsGuest: (serverUrl) =>
        set({
          screen: "library",
          user: null,
          serverUrl,
          guest: true,
          guestChosen: true,
          connectError: null,
        }),
      setConnectStep: (connectStep) => set({ connectStep, connectError: null }),
      setConnectError: (connectError) => set({ connectError }),
      setGuestAccess: (guestAccess) => set({ guestAccess }),
      openBook: (record) => set({ screen: "reader", openRecord: record }),
      closeReader: () => set({ screen: "library", openRecord: null }),
      // Signing out drops the server session but not the app: the local shelf
      // is still yours, so we land there rather than on a connect wall.
      reset: () =>
        set({
          screen: "library",
          connectStep: "server",
          user: null,
          guest: false,
          guestChosen: false,
          openRecord: null,
          connectError: null,
        }),
    }),
    {
      name: "shelf.session",
      partialize: (s): PersistedSession => ({
        guestChosen: s.guestChosen,
        lastUsername: s.lastUsername,
      }),
    },
  ),
);
