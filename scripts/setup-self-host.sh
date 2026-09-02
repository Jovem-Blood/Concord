#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: ./scripts/setup-self-host.sh [--force] [APP_HOST]
Prepare the web client and signaling API for Cloudflare Realtime SFU.
Then fill CLOUDFLARE_SFU_APP_ID and CLOUDFLARE_SFU_APP_SECRET in .env.
Existing files are preserved unless --force is used.
EOF
}
validate_hostname() (
  hostname=$1
  case "$hostname" in
    '' | .* | *. | *..* | *[!A-Za-z0-9.-]*) exit 1 ;;
  esac
  old_ifs=$IFS
  IFS=.
  set -- $hostname
  IFS=$old_ifs
  for label do
    case "$label" in '' | -* | *-) exit 1 ;; esac
  done
)
force=false
api_host=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --force) force=true ;;
    -h | --help) usage; exit 0 ;;
    -*) usage >&2; exit 1 ;;
    *)
      if [ -n "$api_host" ]; then usage >&2; exit 1; fi
      api_host=$1
      ;;
  esac
  shift
done
if [ -z "$api_host" ]; then
  printf 'Public app hostname (for example, concord.example.com): '
  IFS= read -r api_host
fi
if ! validate_hostname "$api_host"; then
  printf 'Invalid app hostname: %s\n' "$api_host" >&2
  exit 1
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
server_env="$project_root/.env"
desktop_env="$project_root/apps/desktop/.env.local"
if [ "$force" = false ] && { [ -e "$server_env" ] || [ -e "$desktop_env" ]; }; then
  printf 'Refusing to overwrite existing environment files. Use --force only to replace both.\n' >&2
  exit 1
fi
umask 077
server_tmp="$server_env.tmp.$$"
desktop_tmp="$desktop_env.tmp.$$"
cleanup() { rm -f "$server_tmp" "$desktop_tmp"; }
trap cleanup EXIT HUP INT TERM
cat >"$server_tmp" <<EOF
# Fill with credentials from Cloudflare > Realtime > Serverless SFU. Keep private.
CLOUDFLARE_SFU_APP_ID=
CLOUDFLARE_SFU_APP_SECRET=
PORT=3001
ALLOWED_ORIGINS=https://$api_host
PUBLIC_APP_URL=https://$api_host
PUBLIC_TOKEN_SERVER_URL=https://$api_host
EOF
cat >"$desktop_tmp" <<EOF
# Rebuild clients after changing these URLs. Never put SFU secrets here.
VITE_TOKEN_SERVER_URL=https://$api_host
VITE_WEB_APP_URL=https://$api_host
EOF
mv "$server_tmp" "$server_env"
mv "$desktop_tmp" "$desktop_env"
trap - EXIT HUP INT TERM
printf 'Prepared .env and apps/desktop/.env.local for https://%s\n' "$api_host"
printf 'Next: fill SFU credentials, configure HTTPS, start Compose and rebuild clients.\n'
