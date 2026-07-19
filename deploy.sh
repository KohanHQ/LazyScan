#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
Usage: deploy.sh [sha]

No arg: pull main and deploy its HEAD. With a sha: deploy that commit
(rollback). Images come from GHCR (TAG = deployed sha); nothing builds here.
EOF
}

REF="${1:-}"
[[ "$REF" == "-h" || "$REF" == "--help" ]] && { usage; exit 0; }
[[ -z "$REF" || "$REF" =~ ^[0-9a-fA-F]{7,40}$ ]] || { echo "invalid sha: $REF" >&2; exit 2; }

git fetch --prune origin
if [[ -n "$REF" ]]; then
  git checkout --detach "$REF"
else
  git checkout main
  git pull --ff-only origin main
fi

TAG="$(git rev-parse HEAD)"
export TAG

# Explicit -f: never let docker-compose.override.yml (local dev: minio,
# local postgres) auto-load on the VPS.
docker compose -f docker-compose.yml pull
docker compose -f docker-compose.yml up -d --wait --remove-orphans
echo "deployed $TAG"
