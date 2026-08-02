/**
 * @module
 * Minimal Leveled Logger for the Node Side
 *
 * Architecture overview for Junior Devs:
 * Rather than pull in a heavy logging library, this thin wrapper around
 * `console` gives us two things: log levels (so noisy `debug` lines can be
 * silenced in production) and a consistent `[CB8:scope]` prefix (so logs are
 * easy to grep). The active level comes from the `CB8_LOG_LEVEL` environment
 * variable (debug | info | warn | error; default "info").
 *
 * Use this everywhere in server code — prefer `logger.info(...)` over a bare
 * `console.log(...)`. Call `createLogger('scope')` to tag a subsystem's logs.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveThreshold(): number {
  const env = (process.env.CB8_LOG_LEVEL ?? '').toLowerCase();
  return env in LEVELS ? LEVELS[env as LogLevel] : LEVELS.info;
}

const threshold = resolveThreshold();

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Derive a logger with a nested scope, e.g. createLogger('webServer'). */
  child(scope: string): Logger;
}

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  if (LEVELS[level] < threshold) return;
  const prefix = scope ? `[CB8:${scope}]` : '[CB8]';
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(prefix, ...args);
}

export function createLogger(scope = ''): Logger {
  return {
    debug: (...args) => emit('debug', scope, args),
    info: (...args) => emit('info', scope, args),
    warn: (...args) => emit('warn', scope, args),
    error: (...args) => emit('error', scope, args),
    child: (childScope) => createLogger(scope ? `${scope}:${childScope}` : childScope),
  };
}

export const logger = createLogger();
