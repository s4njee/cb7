/** Dictionary lookup against the free dictionaryapi.dev service.
 *
 *  This is a third-party host, not the CB8 server, so it deliberately does NOT
 *  go through lib/transport.ts — no auth, no server base URL, no media cache.
 *
 *  The app is otherwise offline-first and a reader on a plane must not notice
 *  this exists: every failure path resolves to a typed result rather than
 *  throwing, so a lookup can never break a reading session. */

const ENDPOINT = "https://api.dictionaryapi.dev/api/v2/entries/en";

export interface DictionarySense {
  partOfSpeech: string;
  definitions: string[];
}

export interface DictionaryEntry {
  word: string;
  /** IPA if the API supplied one; blank is common and fine. */
  phonetic: string;
  senses: DictionarySense[];
}

export type DictionaryResult =
  | { status: "found"; entry: DictionaryEntry }
  | { status: "missing"; word: string }
  | { status: "unavailable"; word: string };

/* The API's response shape, narrowed to what we read. */
interface ApiDefinition {
  definition?: unknown;
}
interface ApiMeaning {
  partOfSpeech?: unknown;
  definitions?: ApiDefinition[];
}
interface ApiPhonetic {
  text?: unknown;
}
interface ApiEntry {
  word?: unknown;
  phonetic?: unknown;
  phonetics?: ApiPhonetic[];
  meanings?: ApiMeaning[];
}

/** Session-lifetime cache. Definitions are immutable and a reader re-taps the
 *  same word constantly; misses are cached too, so a word that isn't in the
 *  dictionary doesn't re-hit the network on every long-press. Network failures
 *  are NOT cached — those are worth retrying when connectivity returns. */
const cache = new Map<string, DictionaryResult>();

const MAX_DEFINITIONS = 3;

/** Strip the punctuation that rides along with a word picked out of prose —
 *  quotes, trailing commas, em-dashes — but keep internal hyphens and
 *  apostrophes, which are part of the word ("well-known", "don't"). */
export function normalizeWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
    .trim();
}

/** True for something worth looking up — a single word, not a phrase. */
export function isLookupWord(raw: string): boolean {
  const word = normalizeWord(raw);
  return word.length > 1 && word.length <= 40 && !/\s/.test(word);
}

function parse(word: string, payload: unknown): DictionaryResult {
  if (!Array.isArray(payload) || payload.length === 0) {
    return { status: "missing", word };
  }
  const first = payload[0] as ApiEntry;
  const senses: DictionarySense[] = [];
  for (const meaning of first.meanings ?? []) {
    const definitions = (meaning.definitions ?? [])
      .map((d) => (typeof d.definition === "string" ? d.definition : ""))
      .filter(Boolean)
      .slice(0, MAX_DEFINITIONS);
    if (definitions.length) {
      senses.push({
        partOfSpeech: typeof meaning.partOfSpeech === "string" ? meaning.partOfSpeech : "",
        definitions,
      });
    }
  }
  if (!senses.length) return { status: "missing", word };

  const phonetic =
    typeof first.phonetic === "string" && first.phonetic
      ? first.phonetic
      : ((first.phonetics ?? []).find((p) => typeof p.text === "string" && p.text)
          ?.text as string) || "";

  return {
    status: "found",
    entry: {
      word: typeof first.word === "string" ? first.word : word,
      phonetic,
      senses,
    },
  };
}

/** Look a word up. Never rejects. `signal` lets a reader who taps another word
 *  mid-flight abandon the first request; an aborted lookup reports
 *  "unavailable" and is not cached. */
export async function lookup(raw: string, signal?: AbortSignal): Promise<DictionaryResult> {
  const word = normalizeWord(raw);
  if (!word) return { status: "missing", word };

  const hit = cache.get(word);
  if (hit) return hit;

  try {
    const resp = await fetch(`${ENDPOINT}/${encodeURIComponent(word)}`, { signal });
    // 404 is the API's ordinary "no such word" answer, not a fault.
    if (resp.status === 404) {
      const miss: DictionaryResult = { status: "missing", word };
      cache.set(word, miss);
      return miss;
    }
    if (!resp.ok) return { status: "unavailable", word };

    const result = parse(word, await resp.json());
    cache.set(word, result);
    return result;
  } catch {
    // Offline, DNS failure, CORS, abort — all indistinguishable here and all
    // mean the same thing to the reader.
    return { status: "unavailable", word };
  }
}
