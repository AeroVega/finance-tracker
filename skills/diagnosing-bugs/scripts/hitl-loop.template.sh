#!/usr/bin/env bash
# Optional human-assisted loop for a separately authorized synthetic test.
# Copy and adapt the steps outside public artifacts. This template is not a
# test result, a credential form, or permission to access Google Drive.
# Collect only fixed safe statuses. Keep credentials in the browser and
# real financial data, identifiers, raw errors, and tokens out of this loop.

set -euo pipefail

# Change only after reviewing the specific synthetic scenario and permission.
READY_FOR_SYNTHETIC_RUN=false
if [[ "$READY_FOR_SYNTHETIC_RUN" != true ]]; then
  printf '%s\n' 'Template only. Adapt an authorized synthetic scenario before running.' >&2
  exit 1
fi

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p '    [Enter when done] ' _
}

step 'Open the authorized synthetic test page with invented data only.'
step 'Perform the agreed reproduction steps. Do not paste records or credentials.'
read -r -p 'Did the specific symptom occur? Enter yes, no, or uncertain: ' answer
case "$answer" in
  yes|no|uncertain) printf 'SYMPTOM=%s\n' "$answer" ;;
  *) printf '%s\n' 'Invalid response. No entered text was recorded.' >&2; exit 2 ;;
esac
