#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Runs the local verification loop for this repository.
#
#   syntax -> unit tests -> Linux Web E2E -> (optional) secret scan
#
# The GitHub workflows remain the authority (linux-tests / windows-smoke /
# gitleaks); this script reproduces the Linux-runnable half locally so a change
# can be checked before pushing.
#
# Usage:
#   bash scripts/check.sh              # full loop
#   bash scripts/check.sh --fast       # skip the E2E (unit tests only)
#   SKIP_E2E=1 bash scripts/check.sh   # same as --fast
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

fast=false
for argument in "$@"; do
  case "${argument}" in
    --fast) fast=true ;;
    -h | --help)
      sed -n '3,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "error: unknown argument: ${argument}" >&2
      exit 2
      ;;
  esac
done
if [ "${SKIP_E2E:-0}" = "1" ]; then
  fast=true
fi

echo '==> bash -n (shell scripts)'
for script in scripts/*.sh test/*.sh; do
  bash -n "${script}"
done

echo '==> node --check (module syntax)'
for module in lib/*.js test/*.mjs; do
  node --check "${module}"
done

echo '==> node --test test/*.test.mjs'
node --test test/*.test.mjs

if [ "${fast}" = true ]; then
  echo '==> skipping the Linux Web E2E (--fast / SKIP_E2E=1)'
else
  echo '==> bash test/e2e.sh (Linux Web host E2E)'
  bash test/e2e.sh
fi

if command -v betterleaks >/dev/null 2>&1; then
  echo '==> betterleaks git (full history)'
  betterleaks git --no-banner --redact .
else
  echo 'betterleaks is not installed; skipping the primary secret scan (CI scans on push).'
fi

# Gitleaks remains as an auxiliary scan.
if command -v gitleaks >/dev/null 2>&1; then
  echo '==> gitleaks git (full history, auxiliary)'
  gitleaks git --no-banner --redact .
  echo '==> gitleaks dir (working tree, auxiliary)'
  gitleaks dir --no-banner --redact .
fi

echo 'All checks passed.'
