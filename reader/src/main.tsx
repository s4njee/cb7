import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";

// Hearth Noir chrome faces (Newsreader titles, Instrument Sans UI).
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/500.css";
import "@fontsource/newsreader/600.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/instrument-sans/600.css";
// Reading faces are injected into the EPUB iframe by lib/fonts; load previews
// here so the typeface picker can render each one in its own face.
import "@fontsource/literata/400.css";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/inter/400.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/opendyslexic/400.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/comic.css";
import "./styles/epub.css";
import "./styles/pdf.css";

import App from "./App";
import { ErrorBoundary, RootErrorFallback } from "./components/ErrorBoundary";
import { toApiError } from "./lib/transport";
import { usePrefs } from "./store/prefs";
import { useSession } from "./store/session";

// Accent before first paint — app chrome is dark-only; reading theme is page-only.
document.documentElement.setAttribute("data-accent", usePrefs.getState().accent);

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      // A 401 on a read means the (previously authenticated) session lapsed —
      // drop back to sign-in. Guests never authenticate, so their reads succeed;
      // guest write failures don't go through react-query.
      const err = toApiError(error);
      const state = useSession.getState();
      if (err.status === 401 && !state.guest) {
        state.goConnect("signin", { serverUrl: state.serverUrl });
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary fallback={(error) => <RootErrorFallback error={error} />}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
