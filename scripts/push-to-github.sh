#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Pemakaian: ./scripts/push-to-github.sh https://github.com/USERNAME/REPOSITORY.git"
  exit 1
fi

git init
git add .
git commit -m "feat: initialize Toko360 modular platform v0.3"
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin "$1"
git push -u origin main
