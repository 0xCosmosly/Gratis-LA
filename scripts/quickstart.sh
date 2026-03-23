#!/usr/bin/env bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed. Install Node.js LTS first: https://nodejs.org"
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example."
fi

echo "Installing dependencies..."
npm install

echo
echo "Starting Gratis LA..."
echo "Tip: it will run in local mode unless .env has real Supabase keys."
echo

npm run dev -- "$@"
