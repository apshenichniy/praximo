#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 SECRET_FILE DOTENV_CONTRACT DESCRIPTION" >&2
  exit 64
fi

secret_file=$1
dotenv_contract=$2
description=$3

if [[ ! -r "$secret_file" ]]; then
  echo "$description is not readable: $secret_file" >&2
  exit 66
fi

if [[ ! -r "$dotenv_contract" ]]; then
  echo "$description dotenv contract is not readable: $dotenv_contract" >&2
  exit 66
fi

if mode=$(stat -f '%Lp' "$secret_file" 2>/dev/null); then
  :
else
  mode=$(stat -c '%a' "$secret_file")
fi

if [[ "$mode" != 600 ]]; then
  echo "$description must have mode 0600: $secret_file" >&2
  exit 65
fi

required_keys=$(
  awk -F= '
    /^[[:space:]]*($|#)/ { next }
    /^[A-Za-z_][A-Za-z0-9_]*=/ { print $1; next }
    { printf "invalid dotenv contract entry on line %d\n", NR > "/dev/stderr"; invalid = 1 }
    END { if (invalid) exit 1 }
  ' "$dotenv_contract" | LC_ALL=C sort
)
actual_keys=$(
  awk -F= '
    /^[[:space:]]*($|#)/ { next }
    !/^[A-Za-z_][A-Za-z0-9_]*=/ {
      printf "invalid dotenv entry on line %d\n", NR > "/dev/stderr"
      invalid = 1
      next
    }
    {
      key = $1
      value = substr($0, index($0, "=") + 1)
      if (length(value) == 0) {
        printf "empty required value: %s\n", key > "/dev/stderr"
        invalid = 1
      }
      print key
    }
    END { if (invalid) exit 1 }
  ' "$secret_file" | LC_ALL=C sort
)

if [[ "$actual_keys" != "$required_keys" ]]; then
  echo "$description has an unexpected key inventory" >&2
  echo "Expected names:" >&2
  printf '%s\n' "$required_keys" >&2
  echo "Actual names:" >&2
  printf '%s\n' "$actual_keys" >&2
  exit 65
fi
