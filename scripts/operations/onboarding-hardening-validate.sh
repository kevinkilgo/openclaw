#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/operations/onboarding-hardening-validate.sh [options]

Read-only onboarding hardening validation helper. The script does not mutate
services, Swarm, SQLite files, BWS, Teams ingress, cron, or secrets.

Options:
  --sqlite-copy PATH          Inspect a copied SQLite DB snapshot.
  --router-config PATH        Hash a copied or read-only router config.
  --bws-token-file PATH       Verify BWS token mount file presence and perms only.
  --teams-ingress-path PATH   Count files under a copied/read-only ingress path.
  --artifact PATH             Leak-scan a proof/runbook artifact for obvious secret markers.
  --help                      Show this help.

Evidence is printed to stdout. Secret values are never read from token files.
USAGE
}

sqlite_copy=""
router_config=""
bws_token_file=""
teams_ingress_path=""
artifacts=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sqlite-copy)
      sqlite_copy="${2:-}"
      shift 2
      ;;
    --router-config)
      router_config="${2:-}"
      shift 2
      ;;
    --bws-token-file)
      bws_token_file="${2:-}"
      shift 2
      ;;
    --teams-ingress-path)
      teams_ingress_path="${2:-}"
      shift 2
      ;;
    --artifact)
      artifacts+=("${2:-}")
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

hash_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

json_line() {
  printf '%s\n' "$1"
}

check_sqlite() {
  local db="$1"
  if [[ -z "$db" ]]; then
    return
  fi
  if [[ ! -f "$db" ]]; then
    json_line "sqlite.status=missing path=$db"
    return
  fi

  json_line "sqlite.path=$db"
  json_line "sqlite.bytes=$(wc -c < "$db" | tr -d ' ')"
  json_line "sqlite.sha256=$(hash_file "$db")"

  if command -v sqlite3 >/dev/null 2>&1; then
    local result
    if result="$(sqlite3 "file:$db?mode=ro" 'PRAGMA integrity_check;' 2>&1)"; then
      json_line "sqlite.integrity=$result"
    else
      json_line "sqlite.integrity_error=$(printf '%s' "$result" | tr '\n' ' ')"
    fi
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$db" <<'PY'
import sqlite3
import sys

db = sys.argv[1]
try:
    uri = f"file:{db}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    rows = conn.execute("PRAGMA integrity_check;").fetchall()
    print("sqlite.integrity=" + ",".join(str(row[0]) for row in rows))
    conn.close()
except Exception as exc:
    print("sqlite.integrity_error=" + str(exc).replace("\n", " "))
PY
  else
    json_line "sqlite.integrity=unverified reason=no-sqlite3-or-python3"
  fi
}

check_router_config() {
  local config="$1"
  if [[ -z "$config" ]]; then
    return
  fi
  if [[ ! -f "$config" ]]; then
    json_line "router_config.status=missing path=$config"
    return
  fi
  json_line "router_config.path=$config"
  json_line "router_config.bytes=$(wc -c < "$config" | tr -d ' ')"
  json_line "router_config.sha256=$(hash_file "$config")"
}

check_bws_token_file() {
  local file="$1"
  if [[ -z "$file" ]]; then
    return
  fi
  if [[ ! -e "$file" ]]; then
    json_line "bws_token_file.status=missing path=$file"
    return
  fi
  if [[ ! -f "$file" ]]; then
    json_line "bws_token_file.status=not-regular-file path=$file"
    return
  fi
  json_line "bws_token_file.path=$file"
  json_line "bws_token_file.readable=$([[ -r "$file" ]] && echo true || echo false)"
  json_line "bws_token_file.bytes=$(wc -c < "$file" | tr -d ' ')"
  if stat -c '%a %U:%G' "$file" >/dev/null 2>&1; then
    json_line "bws_token_file.mode_owner=$(stat -c '%a %U:%G' "$file")"
  else
    json_line "bws_token_file.mode_owner=$(stat -f '%Lp %Su:%Sg' "$file")"
  fi
}

check_teams_ingress_path() {
  local path="$1"
  if [[ -z "$path" ]]; then
    return
  fi
  if [[ ! -d "$path" ]]; then
    json_line "teams_ingress.status=missing-or-not-directory path=$path"
    return
  fi
  json_line "teams_ingress.path=$path"
  json_line "teams_ingress.file_count=$(find "$path" -type f | wc -l | tr -d ' ')"
  json_line "teams_ingress.oldest=$(find "$path" -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | head -n 1 | awk '{print $1}')"
  json_line "teams_ingress.newest=$(find "$path" -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -n 1 | awk '{print $1}')"
}

scan_artifact() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    json_line "artifact.status=missing path=$file"
    return
  fi
  json_line "artifact.path=$file"
  json_line "artifact.sha256=$(hash_file "$file")"
  local secret_pattern='(access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|sfdxAuthUrl|oauthStoreJson)["'"'"'[:space:]]*[:=]["'"'"'[:space:]]*[A-Za-z0-9._~+/=-]{12,}|bearer[[:space:]]+[A-Za-z0-9._~+/=-]{16,}|BEGIN (RSA|OPENSSH|PRIVATE) KEY'
  if rg -n -i "$secret_pattern" "$file" >/dev/null 2>&1; then
    json_line "artifact.leak_scan=review-required"
    rg -n -i "$secret_pattern" "$file" || true
  else
    json_line "artifact.leak_scan=clean"
  fi
}

json_line "boundary=read-only"
check_sqlite "$sqlite_copy"
check_router_config "$router_config"
check_bws_token_file "$bws_token_file"
check_teams_ingress_path "$teams_ingress_path"
for artifact in "${artifacts[@]}"; do
  scan_artifact "$artifact"
done
