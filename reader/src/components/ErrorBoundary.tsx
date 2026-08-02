/** Library-free React error boundaries. React only lets a class component catch
 *  a render/lifecycle throw, so this is intentionally the one class in the app.
 *
 *  Two consumers:
 *   - a root boundary in main.tsx wrapping the whole tree (themed full-screen
 *     fallback with a Reload button);
 *   - a reader boundary in Reader.tsx that, instead of white-screening, drops
 *     back to the library and surfaces a toast.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Rendered when a descendant throws. A function receives the caught error
   *  plus a `reset` that clears it so the subtree can re-mount. */
  fallback: ReactNode | ((error: unknown, reset: () => void) => ReactNode);
  /** Side effect on catch — e.g. navigate away, show a toast. Must not throw. */
  onError?: (error: unknown) => void;
}

interface State {
  error: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Keep a breadcrumb in dev; the fallback is what the user actually sees.
    if (import.meta.env?.DEV) {
      console.error("ErrorBoundary caught:", error, info.componentStack);
    }
    try {
      this.props.onError?.(error);
    } catch {
      /* a throwing handler must not mask the original error */
    }
  }

  reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error != null) {
      const { fallback } = this.props;
      return typeof fallback === "function"
        ? fallback(this.state.error, this.reset)
        : fallback;
    }
    return this.props.children;
  }
}

/** Full-screen themed fallback for the root boundary. Reload is the only honest
 *  recovery once the whole tree has torn — the state that broke it is unknown. */
export function RootErrorFallback({ error }: { error?: unknown }) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "The app hit an unexpected error and can’t continue.";
  return (
    <div className="crash-screen">
      <div className="crash-inner">
        <div className="eyebrow">CB8</div>
        <div className="crash-title">Something went wrong</div>
        <div className="crash-msg">{message}</div>
        <button className="btn-accent crash-reload" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}
