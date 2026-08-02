#!/usr/bin/env sh
# CB8 first-boot secret bootstrap.
#
# Generates a .env (from .env.example) with strong, random values for the two
# secrets a basic single-host stack needs — CB8_DB_PASSWORD and
# BETTER_AUTH_SECRET — so you can `docker compose up` without hand-editing any
# secret. Re-running is safe: an existing .env is never overwritten, and real
# values already present are left untouched. This is the zero-config path; for
# library paths and ports, edit the generated .env afterwards.
#
# Usage (from packaging/docker/):
#   ./cb8-init.sh            # create/complete ./.env, then `docker compose up -d`
#
# Persistence note: the generated secrets live in this .env file. Keep it — it
# is the source of truth for the DB password and session-signing key. Losing it
# means resetting the Postgres role password and logging everyone out.

set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/.env"
EXAMPLE_FILE="$DIR/.env.example"

# A strong random secret: prefer openssl, fall back to /dev/urandom.
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# Whether KEY in $ENV_FILE is unset, empty, or still the placeholder.
needs_value() {
  key="$1"
  placeholder="$2"
  line="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null || true)"
  val="${line#*=}"
  [ -z "$val" ] || [ "$val" = "$placeholder" ]
}

# Set KEY=VALUE in $ENV_FILE (replace the line if present, else append).
set_value() {
  key="$1"
  value="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    tmp="$(mktemp)"
    # Use a sed-free rewrite so values with slashes/special chars are safe.
    while IFS= read -r ln; do
      case "$ln" in
        "${key}="*) printf '%s=%s\n' "$key" "$value" ;;
        *) printf '%s\n' "$ln" ;;
      esac
    done < "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$EXAMPLE_FILE" ]; then
    echo "error: $EXAMPLE_FILE not found; run from packaging/docker/" >&2
    exit 1
  fi
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example"
fi

if needs_value CB8_DB_PASSWORD change-me; then
  set_value CB8_DB_PASSWORD "$(gen_secret)"
  echo "Generated CB8_DB_PASSWORD"
else
  echo "CB8_DB_PASSWORD already set — left unchanged"
fi

if needs_value BETTER_AUTH_SECRET ''; then
  set_value BETTER_AUTH_SECRET "$(gen_secret)"
  echo "Generated BETTER_AUTH_SECRET"
else
  echo "BETTER_AUTH_SECRET already set — left unchanged"
fi

echo
echo "Done. Review $ENV_FILE (library paths, port, trusted origins), then:"
echo "  docker compose up -d"
