/**
 * @module
 * mDNS Service Advertisement (`_cb8._tcp.local.`)
 *
 * Architecture overview for Junior Devs:
 * Client apps (the Shelf reader) find a CB8 server on the LAN by browsing for
 * the `_cb8._tcp.local.` mDNS service rather than making the user type an IP.
 * This module is the *advertising* half of that contract: once the Fastify
 * listener is actually up (we need the real port), `startMdns()` publishes one
 * service record describing this instance, and `stopMdns()` withdraws it on
 * shutdown.
 *
 * Three rules shape the code here:
 *
 *  1. **Never fatal.** Plenty of hosts have no multicast at all (containers on a
 *     bridge network, locked-down VPS, some VPNs). A server that can't advertise
 *     is still a perfectly good server — every failure is caught and logged, and
 *     nothing thrown here reaches the startup path.
 *  2. **The TXT record is a wire contract** with the client (see
 *     `reader/docs/CONTRACT.md` → "LAN discovery (mDNS)"). {@link buildTxt} is
 *     pure and unit-tested precisely so it cannot drift silently.
 *  3. **No database imports.** The instance name is resolved by the caller
 *     (`standalone.ts` reads `app_meta.server_name`) and passed in, which keeps
 *     this module trivially unit-testable.
 *
 * Opt-out: `CB8_MDNS=0`. Default **on** for bare-node, **off** in the shipped
 * Docker image (the Dockerfile presets `CB8_MDNS=0`) — a bridge-network
 * container would advertise a container IP the LAN cannot reach, which is worse
 * than not advertising at all. Host networking re-enables it.
 */
import Bonjour from 'bonjour-service';
import { createLogger } from './logger';

const log = createLogger('mdns');

/**
 * Service type, bare — `bonjour-service` prefixes the `_` and appends
 * `._tcp.local.` itself from `type` + `protocol`.
 */
export const MDNS_SERVICE_TYPE = 'cb8';

/** Transport for the service record. */
export const MDNS_SERVICE_PROTOCOL = 'tcp' as const;

/**
 * The fully-qualified service type as it appears on the wire, i.e. what
 * `dns-sd -B _cb8._tcp` / the client's browser matches on. Derived by
 * `bonjour-service` from {@link MDNS_SERVICE_TYPE} + {@link MDNS_SERVICE_PROTOCOL};
 * spelled out here for logs and for the contract test.
 */
export const MDNS_SERVICE_FQDN = '_cb8._tcp.local.';

/** The `path` TXT value. Always `/api`; reserved for a future sub-path deploy. */
export const MDNS_TXT_PATH = '/api';

/** How long to wait for the responder to withdraw the record before giving up. */
const STOP_TIMEOUT_MS = 2_000;

/** The TXT records attached to the advertised service. This is the wire contract. */
export interface MdnsTxtRecord {
  /** Server package version, e.g. `1.0.5`. */
  ver: string;
  /** Instance display name — `app_meta.server_name`, default `os.hostname()`. */
  name: string;
  /** Always {@link MDNS_TXT_PATH}. */
  path: string;
}

/** Everything {@link startMdns} needs to describe this instance. */
export interface StartMdnsOptions {
  /** The port the HTTP listener actually bound to. */
  port: number;
  /** Instance display name (`app_meta.server_name`, else `os.hostname()`). */
  name: string;
  /** Server package version, for the `ver` TXT record. */
  version: string;
  /** Environment to read `CB8_MDNS` from. Defaults to `process.env`; tests inject. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Build the TXT records for the advertised service.
 *
 * Pure by design: this is the exact payload the client parses, so it is unit
 * tested rather than verified by squinting at `dns-sd` output.
 *
 * @param opts The server package version and the instance display name.
 * @returns The `{ ver, name, path }` TXT record object.
 */
export function buildTxt(opts: { version: string; name: string }): MdnsTxtRecord {
  return { ver: opts.version, name: opts.name, path: MDNS_TXT_PATH };
}

/**
 * Decide whether to advertise, from the environment.
 *
 * Default **on**: discovery is the whole point, and an advertisement that
 * nobody hears costs nothing. `CB8_MDNS=0` (or `false`, case-insensitive) opts
 * out; any other value — including unset or empty — leaves it on.
 *
 * @param env The environment to read (`process.env` in production).
 * @returns `true` when the service should be advertised.
 */
export function mdnsEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.CB8_MDNS?.trim().toLowerCase();
  if (raw === undefined || raw === '') return true;
  return raw !== '0' && raw !== 'false';
}

/** The live responder, or `null` when not advertising. Module-level: one per process. */
let bonjour: Bonjour | null = null;

/**
 * Publish this server as `_cb8._tcp.local.` on the LAN.
 *
 * Call this **after** `fastify.listen()` resolves — the SRV record needs the
 * port the listener actually bound to. Idempotent: a second call while an
 * advertisement is live is a no-op. Never throws; a host without multicast just
 * gets a warning and no service record.
 *
 * @param opts The listening port, instance name, and package version.
 */
export async function startMdns(opts: StartMdnsOptions): Promise<void> {
  if (!mdnsEnabled(opts.env ?? process.env)) {
    log.info('LAN discovery disabled (CB8_MDNS=0); not advertising.');
    return;
  }
  if (bonjour) return;

  try {
    // The responder's sockets fail asynchronously (EADDRINUSE, no multicast
    // route); this callback is the only place those surface. Log, don't throw.
    const instance = new Bonjour(undefined, (err: unknown) => {
      log.warn('mDNS responder error; discovery may not work on this host:', err);
    });

    const service = instance.publish({
      name: opts.name,
      type: MDNS_SERVICE_TYPE,
      protocol: MDNS_SERVICE_PROTOCOL,
      port: opts.port,
      txt: buildTxt({ version: opts.version, name: opts.name }),
    });
    service.on('error', (err: unknown) => {
      log.warn('mDNS advertisement error; the service record may be missing:', err);
    });

    bonjour = instance;
    log.info(
      `Advertising "${opts.name}" as ${MDNS_SERVICE_FQDN} on port ${opts.port} ` +
        `(ver=${opts.version}, path=${MDNS_TXT_PATH})`,
    );
  } catch (err) {
    bonjour = null;
    log.warn('Could not start mDNS advertisement; continuing without LAN discovery:', err);
  }
}

/**
 * Withdraw the advertisement and tear the responder down.
 *
 * Idempotent and safe to call when {@link startMdns} never ran or bailed out.
 * Bounded by {@link STOP_TIMEOUT_MS} so a wedged responder can't stall shutdown;
 * the records go stale on their TTL anyway.
 */
export async function stopMdns(): Promise<void> {
  const instance = bonjour;
  bonjour = null;
  if (!instance) return;

  try {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        log.warn('mDNS teardown timed out; abandoning the responder.');
        finish();
      }, STOP_TIMEOUT_MS);
      timer.unref?.();

      // Send the goodbye packets first, then close the sockets.
      instance.unpublishAll(() => {
        instance.destroy(finish);
      });
    });
    log.info('mDNS advertisement withdrawn.');
  } catch (err) {
    log.warn('Error tearing down the mDNS advertisement; continuing:', err);
  }
}
