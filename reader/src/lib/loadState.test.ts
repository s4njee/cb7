import {
  classifyError,
  fromQuery,
  isOfflineError,
  isUnsupportedError,
  LOAD_MESSAGES,
} from "./loadState";

export interface LoadVector {
  name: string;
  run: () => void;
}

export const LOAD_STATE_VECTORS: LoadVector[] = [
  {
    name: "status 0 is offline",
    run: () => {
      if (!isOfflineError({ status: 0, message: "Cannot reach server" })) {
        throw new Error("expected offline");
      }
    },
  },
  {
    name: "CBR message is unsupported",
    run: () => {
      if (!isUnsupportedError({ status: 0, message: "CBR comics can only be read from a server" })) {
        throw new Error("expected unsupported");
      }
      const s = classifyError({ status: 0, message: "can't unpack RAR" }, "reader");
      if (s.kind !== "unsupported" || s.canRetry) throw new Error(JSON.stringify(s));
    },
  },
  {
    name: "fromQuery loading without data",
    run: () => {
      const s = fromQuery({
        isLoading: true,
        isError: false,
        hasData: false,
        loadingMessage: LOAD_MESSAGES.loadingLibrary,
      });
      if (s.kind !== "loading") throw new Error(s.kind);
    },
  },
  {
    name: "fromQuery preserves data on fetch",
    run: () => {
      const s = fromQuery({
        isLoading: false,
        isFetching: true,
        isError: false,
        hasData: true,
      });
      if (s.kind !== "refreshing") throw new Error(s.kind);
    },
  },
  {
    name: "fromQuery error with data is soft refresh",
    run: () => {
      const s = fromQuery({
        isLoading: false,
        isError: true,
        error: { status: 500, message: "boom" },
        hasData: true,
      });
      if (s.kind !== "refreshing" || !s.canRetry) throw new Error(JSON.stringify(s));
    },
  },
  {
    name: "fromQuery hard error without data",
    run: () => {
      const s = fromQuery({
        isLoading: false,
        isError: true,
        error: { status: 0, message: "offline" },
        hasData: false,
        context: "library",
      });
      if (s.kind !== "offline") throw new Error(s.kind);
    },
  },
];

export function runLoadStateVectors(): { failures: string[]; report: string } {
  const failures: string[] = [];
  for (const v of LOAD_STATE_VECTORS) {
    try {
      v.run();
    } catch (err) {
      failures.push(`${v.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report =
    failures.length === 0
      ? `loadState: ${LOAD_STATE_VECTORS.length} ok`
      : `loadState: ${failures.length} failed\n${failures.join("\n")}`;
  return { failures, report };
}
