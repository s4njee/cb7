import { clearOutbox } from "./progressOutbox";

/** Remove all locally held reading state without touching books or servers. */
export function clearReadingData(): number {
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("shelf.")) keys.push(key);
    }
    for (const key of keys) {
      localStorage.removeItem(key);
      removed++;
    }
  } catch {
    /* storage may be unavailable */
  }
  clearOutbox();
  return removed;
}
