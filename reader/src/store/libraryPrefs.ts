import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ImportMode = "copy" | "link";
export type DuplicatePolicy = "skip" | "keep" | "replace";

interface LibraryPrefs {
  importMode: ImportMode;
  duplicatePolicy: DuplicatePolicy;
  readEmbeddedMetadata: boolean;
  protectEditedMetadata: boolean;
  setImportMode: (mode: ImportMode) => void;
  setDuplicatePolicy: (policy: DuplicatePolicy) => void;
  setReadEmbeddedMetadata: (value: boolean) => void;
  setProtectEditedMetadata: (value: boolean) => void;
}

export const useLibraryPrefs = create<LibraryPrefs>()(
  persist(
    (set) => ({
      importMode: "copy",
      duplicatePolicy: "skip",
      readEmbeddedMetadata: true,
      protectEditedMetadata: true,
      setImportMode: (importMode) => set({ importMode }),
      setDuplicatePolicy: (duplicatePolicy) => set({ duplicatePolicy }),
      setReadEmbeddedMetadata: (readEmbeddedMetadata) => set({ readEmbeddedMetadata }),
      setProtectEditedMetadata: (protectEditedMetadata) => set({ protectEditedMetadata }),
    }),
    { name: "shelf.libraryPrefs" },
  ),
);
