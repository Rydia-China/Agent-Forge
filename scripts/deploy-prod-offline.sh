#!/usr/bin/env bash
set -euo pipefail

SERVER="root@agent.mob-ai.cn"
PROJECT_DIR="/var/www/agent-forge"
TAG=""
RETAG="false"
BACKUP_STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="backups"
LOCAL_DB_CONTAINER="agent-forge-db-dev"
REMOTE_DB_NAME="agent_forge"
REMOTE_BIZ_DB_NAME="biz"
TABLES=("Skill" "StylePreset" "ApiUsageCounter")
SKIP_ENV="false"
SKIP_TABLE_SYNC="false"
SKIP_REMOTE_PULLBACK="false"

SSH_OPTS=(
  -o StrictHostKeyChecking=accept-new
  -o PreferredAuthentications=password
  -o PubkeyAuthentication=no
)

usage() {
  cat <<'USAGE'
Usage:
  SSHPASS=... scripts/deploy-prod-offline.sh --tag v0.0.2 [options]

Required:
  --tag <tag>                 Release tag to deploy. Must point at HEAD unless --retag is used.

Options:
  --retag                     Force-update the local tag to current HEAD before building.
  --server <user@host>        SSH target. Default: root@agent.mob-ai.cn
  --project-dir <path>        Remote project directory. Default: /var/www/agent-forge
  --backup-stamp <stamp>      Backup folder suffix. Default: current timestamp
  --local-db-container <name> Local Postgres container. Default: agent-forge-db-dev
  --tables <a,b,c>            Comma-separated tables to sync. Default: Skill,StylePreset,ApiUsageCounter
  --skip-env                  Do not overwrite remote .env.
  --skip-table-sync           Do not sync DB tables.
  --skip-remote-pullback      Do not pull remote backups back to local backup dir.

Notes:
  - Password auth is always passed through sshpass -e, so SSHPASS must be set.
  - The script backs up local DB/.env and remote DB/.env before deployment.
  - The app container is recreated from a locally built linux/amd64 image.
USAGE
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

log() {
  echo
  echo "==> $*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

join_by_comma() {
  local IFS=","
  echo "$*"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --retag)
      RETAG="true"
      shift
      ;;
    --server)
      SERVER="${2:-}"
      shift 2
      ;;
    --project-dir)
      PROJECT_DIR="${2:-}"
      shift 2
      ;;
    --backup-stamp)
      BACKUP_STAMP="${2:-}"
      shift 2
      ;;
    --local-db-container)
      LOCAL_DB_CONTAINER="${2:-}"
      shift 2
      ;;
    --tables)
      IFS="," read -r -a TABLES <<< "${2:-}"
      shift 2
      ;;
    --skip-env)
      SKIP_ENV="true"
      shift
      ;;
    --skip-table-sync)
      SKIP_TABLE_SYNC="true"
      shift
      ;;
    --skip-remote-pullback)
      SKIP_REMOTE_PULLBACK="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[[ -n "$TAG" ]] || { usage; die "--tag is required"; }
[[ -n "${SSHPASS:-}" ]] || die "SSHPASS must be set"
[[ ${#TABLES[@]} -gt 0 ]] || die "At least one table is required"

require_cmd git
require_cmd docker
require_cmd sshpass
require_cmd gzip
require_cmd curl

HEAD_SHA="$(git rev-parse HEAD)"
if [[ "$RETAG" == "true" ]]; then
  log "Updating local tag $TAG to current HEAD $HEAD_SHA"
  git tag -fa "$TAG" -m "release: $TAG"
fi

TAG_SHA="$(git rev-parse "${TAG}^{}")"
[[ "$TAG_SHA" == "$HEAD_SHA" ]] || die "Tag $TAG points to $TAG_SHA, but HEAD is $HEAD_SHA. Use --retag to update it."

[[ -z "$(git status --short)" ]] || die "Working tree is not clean"

BACKUP_DIR="${BACKUP_ROOT}/deploy-${TAG}-${BACKUP_STAMP}"
LOCAL_BACKUP_DIR="${BACKUP_DIR}/local"
SERVER_BACKUP_DIR="${BACKUP_DIR}/server"
SYNC_DIR="${BACKUP_DIR}/sync"
IMAGE_TAR="/tmp/agent-forge-${TAG}.tar.gz"
REMOTE_IMAGE_TAR="/tmp/agent-forge-${TAG}.tar.gz"
REMOTE_SYNC_SQL="/tmp/agent-forge-core-tables-${TAG}.sql"

mkdir -p "$LOCAL_BACKUP_DIR" "$SYNC_DIR"

log "Local backup -> $LOCAL_BACKUP_DIR"
if [[ -f .env ]]; then
  cp .env "$LOCAL_BACKUP_DIR/env.backup"
  chmod 600 "$LOCAL_BACKUP_DIR/env.backup"
fi
git rev-parse HEAD > "$LOCAL_BACKUP_DIR/git-commit.txt"
git tag --points-at HEAD > "$LOCAL_BACKUP_DIR/git-tags.txt"
docker exec "$LOCAL_DB_CONTAINER" pg_dump -U postgres -d "$REMOTE_DB_NAME" > "$LOCAL_BACKUP_DIR/${REMOTE_DB_NAME}.full.sql"
docker exec "$LOCAL_DB_CONTAINER" pg_dump -U postgres -d "$REMOTE_BIZ_DB_NAME" > "$LOCAL_BACKUP_DIR/${REMOTE_BIZ_DB_NAME}.full.sql"

if [[ "$SKIP_TABLE_SYNC" != "true" ]]; then
  log "Exporting local sync tables: $(join_by_comma "${TABLES[@]}")"
  PG_TABLE_ARGS=()
  for table in "${TABLES[@]}"; do
    PG_TABLE_ARGS+=("--table=\"${table}\"")
  done
  docker exec "$LOCAL_DB_CONTAINER" pg_dump -U postgres -d "$REMOTE_DB_NAME" --data-only "${PG_TABLE_ARGS[@]}" > "$SYNC_DIR/core-tables.sql"
fi

log "Remote backup on $SERVER"
sshpass -e ssh "${SSH_OPTS[@]}" "$SERVER" "bash -s" <<REMOTE_BACKUP
set -euo pipefail
cd "$PROJECT_DIR"
BACKUP_DIR="backups/deploy-${TAG}-${BACKUP_STAMP}"
mkdir -p "\$BACKUP_DIR"
if [ -f .env ]; then
  cp .env "\$BACKUP_DIR/env.backup"
  chmod 600 "\$BACKUP_DIR/env.backup"
fi
cp docker-compose*.yml "\$BACKUP_DIR/" 2>/dev/null || true
DB=\$(docker ps --filter "name=agent-forge-db" --format "{{.Names}}" | head -n1)
test -n "\$DB"
echo "\$DB" > "\$BACKUP_DIR/db-container.txt"
docker exec "\$DB" pg_dump -U postgres -d "$REMOTE_DB_NAME" > "\$BACKUP_DIR/${REMOTE_DB_NAME}.full.sql"
docker exec "\$DB" pg_dump -U postgres -d "$REMOTE_BIZ_DB_NAME" > "\$BACKUP_DIR/${REMOTE_BIZ_DB_NAME}.full.sql"
docker images agent-forge:latest --format "{{.ID}} {{.Repository}}:{{.Tag}} {{.CreatedAt}}" > "\$BACKUP_DIR/docker-image-before.txt"
ls -lh "\$BACKUP_DIR"
REMOTE_BACKUP

if [[ "$SKIP_REMOTE_PULLBACK" != "true" ]]; then
  log "Pulling remote backup to $SERVER_BACKUP_DIR"
  mkdir -p "$SERVER_BACKUP_DIR"
  sshpass -e scp "${SSH_OPTS[@]}" -r "$SERVER:${PROJECT_DIR}/backups/deploy-${TAG}-${BACKUP_STAMP}/." "$SERVER_BACKUP_DIR/"
fi

log "Building linux/amd64 image for $TAG"
docker buildx build --platform linux/amd64 -t agent-forge:latest -t "agent-forge:${TAG}" -f Dockerfile . --load

log "Saving image -> $IMAGE_TAR"
docker save agent-forge:latest "agent-forge:${TAG}" | gzip > "$IMAGE_TAR"
ls -lh "$IMAGE_TAR"

log "Uploading image"
sshpass -e scp "${SSH_OPTS[@]}" "$IMAGE_TAR" "$SERVER:$REMOTE_IMAGE_TAR"

if [[ "$SKIP_TABLE_SYNC" != "true" ]]; then
  log "Uploading sync SQL"
  sshpass -e scp "${SSH_OPTS[@]}" "$SYNC_DIR/core-tables.sql" "$SERVER:$REMOTE_SYNC_SQL"
fi

if [[ "$SKIP_ENV" != "true" ]]; then
  [[ -f .env ]] || die ".env not found; use --skip-env to deploy without overwriting remote env"
  log "Backing up and overwriting remote .env"
  sshpass -e ssh "${SSH_OPTS[@]}" "$SERVER" "bash -s" <<REMOTE_ENV
set -euo pipefail
cd "$PROJECT_DIR"
ENV_BACKUP_DIR="backups/env-overwrite-${TAG}-${BACKUP_STAMP}"
mkdir -p "\$ENV_BACKUP_DIR"
cp .env "\$ENV_BACKUP_DIR/env.before-overwrite"
chmod 600 "\$ENV_BACKUP_DIR/env.before-overwrite"
REMOTE_ENV
  sshpass -e scp "${SSH_OPTS[@]}" .env "$SERVER:${PROJECT_DIR}/.env"
  sshpass -e ssh "${SSH_OPTS[@]}" "$SERVER" "chmod 600 '${PROJECT_DIR}/.env'"
fi

log "Loading image and recreating app"
sshpass -e ssh "${SSH_OPTS[@]}" "$SERVER" "bash -s" <<REMOTE_DEPLOY
set -euo pipefail
cd "$PROJECT_DIR"
docker load < "$REMOTE_IMAGE_TAR"
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml rm -f app
docker compose -f docker-compose.prod.yml up -d app
REMOTE_DEPLOY

log "Waiting for app health"
sshpass -e ssh "${SSH_OPTS[@]}" "$SERVER" "bash -s" <<'REMOTE_HEALTH'
set -euo pipefail
for i in $(seq 1 40); do
  status=$(docker inspect -f "{{.State.Health.Status}}" agent-forge-app-1 2>/dev/null || echo missing)
  echo "health=$status attempt=$i"
  [ "$status" = healthy ] && exit 0
  sleep 3
done
docker logs --tail 120 agent-forge-app-1
exit 1
REMOTE_HEALTH

if [[ "$SKIP_TABLE_SYNC" != "true" ]]; then
  log "Syncing remote tables: $(join_by_comma "${TABLES[@]}")"
  TABLE_LIST=""
  for table in "${TABLES[@]}"; do
    if [[ -n "$TABLE_LIST" ]]; then
      TABLE_LIST+=", "
    fi
    TABLE_LIST+="\"${table}\""
  done
  sshpass -e ssh "${SSH_OPTS[@]}" "$SERVER" "bash -s" <<REMOTE_SYNC
set -euo pipefail
DB=\$(docker ps --filter "name=agent-forge-db" --format "{{.Names}}" | head -n1)
test -n "\$DB"
docker exec -i "\$DB" psql -U postgres -d "$REMOTE_DB_NAME" -v ON_ERROR_STOP=1 -c 'TRUNCATE ${TABLE_LIST} RESTART IDENTITY;'
docker exec -i "\$DB" psql -U postgres -d "$REMOTE_DB_NAME" -v ON_ERROR_STOP=1 < "$REMOTE_SYNC_SQL"
REMOTE_SYNC
fi

log "Final verification"
curl -fsS "https://${SERVER#*@}/api/health" >/tmp/agent-forge-health.json
cat /tmp/agent-forge-health.json
echo
OSS_STATUS="$(curl -sS -o /tmp/agent-forge-oss-auth.json -w '%{http_code}' -X POST "https://${SERVER#*@}/api/external/video/oss/upload")"
cat /tmp/agent-forge-oss-auth.json
echo
[[ "$OSS_STATUS" == "401" || "$OSS_STATUS" == "400" ]] || die "Unexpected OSS auth-check status: $OSS_STATUS"

if [[ "$SKIP_TABLE_SYNC" != "true" ]]; then
  sshpass -e ssh "${SSH_OPTS[@]}" "$SERVER" "bash -s" <<'REMOTE_COUNTS'
set -euo pipefail
DB=$(docker ps --filter "name=agent-forge-db" --format "{{.Names}}" | head -n1)
docker exec "$DB" psql -U postgres -d agent_forge -c 'SELECT count(*) AS skills FROM "Skill"; SELECT count(*) AS style_presets FROM "StylePreset"; SELECT count(*) AS api_usage_counters FROM "ApiUsageCounter";'
REMOTE_COUNTS
fi

log "Cleaning temporary files"
rm -f "$IMAGE_TAR" /tmp/agent-forge-health.json /tmp/agent-forge-oss-auth.json
sshpass -e ssh "${SSH_OPTS[@]}" "$SERVER" "rm -f '$REMOTE_IMAGE_TAR' '$REMOTE_SYNC_SQL' /tmp/oss-upload-check.json /tmp/oss-upload-public.json"

log "Done"
echo "Backups: $BACKUP_DIR"
