import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PrivacyPrefs {
  dictionaryLookups: boolean;
  readingStats: boolean;
  localDiscovery: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  nightWarmth: boolean;
  setDictionaryLookups: (value: boolean) => void;
  setReadingStats: (value: boolean) => void;
  setLocalDiscovery: (value: boolean) => void;
  setReducedMotion: (value: boolean) => void;
  setHighContrast: (value: boolean) => void;
  setNightWarmth: (value: boolean) => void;
}

export const usePrivacyPrefs = create<PrivacyPrefs>()(persist((set) => ({
  dictionaryLookups: true,
  readingStats: true,
  localDiscovery: true,
  reducedMotion: false,
  highContrast: false,
  nightWarmth: false,
  setDictionaryLookups: (dictionaryLookups) => set({ dictionaryLookups }),
  setReadingStats: (readingStats) => set({ readingStats }),
  setLocalDiscovery: (localDiscovery) => set({ localDiscovery }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  setHighContrast: (highContrast) => set({ highContrast }),
  setNightWarmth: (nightWarmth) => set({ nightWarmth }),
}), { name: "shelf.privacyPrefs" }));
