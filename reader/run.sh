#!/usr/bin/env bash
# Reads every lease source, builds out/leases.json, and saves the results to the repository.
# Always saves a log, so a failure can be read from the repository.
mkdir -p out
{
  set -x
  node -v
  node reader/test7.mjs && node reader/test_more.mjs && node reader/test_combine.mjs
  echo "tests exit=$?"
  npm init -y >/dev/null 2>&1
  npm install playwright && npx playwright install --with-deps chromium >/dev/null 2>&1 && node reader/proof.mjs
  echo "platform readers exit=$?"
  node reader/read7.mjs
  echo "other readers exit=$?"
  node reader/combine.mjs
  echo "combine exit=$?"
} > out/log_full.txt 2>&1
tail -c 6000 out/log_full.txt > out/log.txt
rm -f out/log_full.txt
git config user.name "contors-lease-feed"
git config user.email "contors-lease-feed@users.noreply.github.com"
git add out
git commit -m "Lease feed update" || echo "nothing to save"
git pull --rebase --autostash || true
git push
