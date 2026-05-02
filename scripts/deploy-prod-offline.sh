#!/usr/bin/env bash
set -euo pipefail

SERVER="root@agent.mob-ai.cn"
PUBLIC_HOST=""
PROJECT_DIR="/var/www/agent-forge"
CODE_DIR="/var/www/agent-forge/source"
REPO_URL="$(git config --get remote.origin.url || true)"
TAG=""
MODE="deploy"
RETAG="false"
SKIP_GIT_TAG_CHECK="false"
BACKUP_STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="backups"
LOCAL_DB_CONTAINER="agent-forge-db-dev"
REMOTE_DB_NAME="agent_forge"
REMOTE_BIZ_DB_NAME="biz"
TABLES=("Skill" "StylePreset" "ApiUsageCounter")
SKIP_ENV="false"
SKIP_TABLE_SYNC="false"
SKIP_REMOTE_PULLBACK="false"

BASE_SSH_OPTS=(
  -o StrictHostKeyChecking=accept-new
)

PASSWORD_SSH_OPTS=(
  -o PreferredAuthentications=password
  -o PubkeyAuthentication=no
)

usage() {
  cat <<'USAGE'
Usage:
  SSHPASS=... pnpm deploy:prod -- --tag 0.0.4 [options]

Required for modes deploy/build:
  --tag <tag>                 Release tag to deploy. Must point to current HEAD.

Modes:
  --mode deploy               Full offline package release flow. Default.
  --mode image-deploy         CI-safe image package deploy. Does not sync .env or DB tables.
  --mode backup               Backup local and remote state only.
  --mode build                Build local linux/amd64 image package only; does not upload or restart app.
  --mode sync-env             Backup and overwrite remote .env, then recreate app.
  --mode sync-tables          Export and sync configured DB tables only.
  --mode verify               Verify public health, OSS auth path, container image, and table counts.

Options:
  --retag                     Force-update local tag to current HEAD before validation.
  --skip-git-tag-check        Allow --tag to be an image tag that is not a Git tag. Intended for CI deploy branches.
  --server <user@host>        SSH target. Default: root@agent.mob-ai.cn
  --public-host <host>        Public HTTP host for verification. Default: SSH host without user.
  --project-dir <path>        Remote runtime directory. Default: /var/www/agent-forge
  --code-dir <path>           Remote Git source directory. Default: /var/www/agent-forge/source
  --repo-url <url>            Git URL server pulls from. Default: local origin URL
  --backup-stamp <stamp>      Backup folder suffix. Default: current timestamp
  --local-db-container <name> Local Postgres container. Default: agent-forge-db-dev
  --tables <a,b,c>            Comma-separated tables to sync. Default: Skill,StylePreset,ApiUsageCounter
  --skip-env                  Deploy without overwriting remote .env.
  --skip-table-sync           Deploy without syncing DB tables.
  --skip-remote-pullback      Do not pull remote backups back to local backup dir.

Authentication:
  Set SSHPASS for password SSH, or configure normal ssh/scp key authentication.
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

ssh_remote() {
  if [[ -n "${SSHPASS:-}" ]]; then
    sshpass -e ssh "${BASE_SSH_OPTS[@]}" "${PASSWORD_SSH_OPTS[@]}" "$SERVER" "$@"
  else
    ssh "${BASE_SSH_OPTS[@]}" "$SERVER" "$@"
  fi
}

scp_to_remote() {
  if [[ -n "${SSHPASS:-}" ]]; then
    sshpass -e scp "${BASE_SSH_OPTS[@]}" "${PASSWORD_SSH_OPTS[@]}" "$1" "$SERVER:$2"
  else
    scp "${BASE_SSH_OPTS[@]}" "$1" "$SERVER:$2"
  fi
}

scp_from_remote_dir() {
  if [[ -n "${SSHPASS:-}" ]]; then
    sshpass -e scp "${BASE_SSH_OPTS[@]}" "${PASSWORD_SSH_OPTS[@]}" -r "$SERVER:$1/." "$2/"
  else
    scp "${BASE_SSH_OPTS[@]}" -r "$SERVER:$1/." "$2/"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --retag)
      RETAG="true"
      shift
      ;;
    --skip-git-tag-check)
      SKIP_GIT_TAG_CHECK="true"
      shift
      ;;
    --server)
      SERVER="${2:-}"
      shift 2
      ;;
    --public-host)
      PUBLIC_HOST="${2:-}"
      shift 2
      ;;
    --project-dir)
      PROJECT_DIR="${2:-}"
      shift 2
      ;;
    --code-dir)
      CODE_DIR="${2:-}"
      shift 2
      ;;
    --repo-url)
      REPO_URL="${2:-}"
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

case "$MODE" in
  deploy|image-deploy|backup|build|sync-env|sync-tables|verify) ;;
  *) die "Unknown mode: $MODE" ;;
esac

[[ -n "$REPO_URL" ]] || die "No repo URL configured. Pass --repo-url."
[[ -n "$SERVER" ]] || die "--server is required"
[[ "$PROJECT_DIR" == /* && "$PROJECT_DIR" != "/" ]] || die "--project-dir must be an absolute non-root path"
[[ "$CODE_DIR" == /* && "$CODE_DIR" != "/" ]] || die "--code-dir must be an absolute non-root path"
[[ "$CODE_DIR" != "$PROJECT_DIR" ]] || die "--code-dir must not equal --project-dir"
[[ ${#TABLES[@]} -gt 0 ]] || die "At least one table is required"

require_cmd git
require_cmd docker
if [[ -n "${SSHPASS:-}" ]]; then
  require_cmd sshpass
fi
require_cmd ssh
require_cmd scp
require_cmd curl

HEAD_SHA="$(git rev-parse HEAD)"
VERIFY_HOST="${PUBLIC_HOST:-${SERVER#*@}}"

if [[ "$MODE" == "deploy" || "$MODE" == "image-deploy" || "$MODE" == "build" ]]; then
  [[ -n "$TAG" ]] || { usage; die "--tag is required for mode $MODE"; }
  if [[ "$RETAG" == "true" ]]; then
    log "Updating local tag $TAG to current HEAD $HEAD_SHA"
    git tag -fa "$TAG" -m "release: $TAG"
  fi
  if [[ "$SKIP_GIT_TAG_CHECK" != "true" ]]; then
    TAG_SHA="$(git rev-parse "${TAG}^{}")"
    [[ "$TAG_SHA" == "$HEAD_SHA" ]] || die "Tag $TAG points to $TAG_SHA, but HEAD is $HEAD_SHA. Use --retag to update it."
  fi
fi

if [[ "$MODE" == "deploy" || "$MODE" == "image-deploy" || "$MODE" == "build" ]]; then
  [[ -z "$(git status --short)" ]] || die "Working tree is not clean"
fi

STAMP_NAME="${TAG:-manual}-${BACKUP_STAMP}"
BACKUP_DIR="${BACKUP_ROOT}/deploy-${STAMP_NAME}"
LOCAL_BACKUP_DIR="${BACKUP_DIR}/local"
SERVER_BACKUP_DIR="${BACKUP_DIR}/server"
SYNC_DIR="${BACKUP_DIR}/sync"
IMAGE_ARCHIVE="${SYNC_DIR}/agent-forge-${TAG:-manual}.tar.gz"

local_backup() {
  log "Local backup -> $LOCAL_BACKUP_DIR"
  mkdir -p "$LOCAL_BACKUP_DIR" "$SYNC_DIR"
  if [[ -f .env ]]; then
    cp .env "$LOCAL_BACKUP_DIR/env.backup"
    chmod 600 "$LOCAL_BACKUP_DIR/env.backup"
  fi
  git rev-parse HEAD > "$LOCAL_BACKUP_DIR/git-commit.txt"
  git tag --points-at HEAD > "$LOCAL_BACKUP_DIR/git-tags.txt"
  docker exec "$LOCAL_DB_CONTAINER" pg_dump -U postgres -d "$REMOTE_DB_NAME" > "$LOCAL_BACKUP_DIR/${REMOTE_DB_NAME}.full.sql"
  docker exec "$LOCAL_DB_CONTAINER" pg_dump -U postgres -d "$REMOTE_BIZ_DB_NAME" > "$LOCAL_BACKUP_DIR/${REMOTE_BIZ_DB_NAME}.full.sql"
}

export_sync_tables() {
  log "Exporting local sync tables: $(join_by_comma "${TABLES[@]}")"
  mkdir -p "$SYNC_DIR"
  local pg_table_args=()
  for table in "${TABLES[@]}"; do
    pg_table_args+=("--table=\"${table}\"")
  done
  docker exec "$LOCAL_DB_CONTAINER" pg_dump -U postgres -d "$REMOTE_DB_NAME" --data-only "${pg_table_args[@]}" > "$SYNC_DIR/core-tables.sql"
}

remote_backup() {
  log "Remote backup on $SERVER"
  ssh_remote "bash -s" <<REMOTE_BACKUP
set -euo pipefail
cd "$PROJECT_DIR"
BACKUP_DIR="backups/deploy-${STAMP_NAME}"
mkdir -p "\$BACKUP_DIR"
if [ -f .env ]; then
  cp .env "\$BACKUP_DIR/env.backup"
  chmod 600 "\$BACKUP_DIR/env.backup"
fi
cp docker-compose*.yml "\$BACKUP_DIR/" 2>/dev/null || true
if [ -d "$CODE_DIR/.git" ]; then
  git -C "$CODE_DIR" rev-parse HEAD > "\$BACKUP_DIR/source-git-commit.txt"
fi
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
    scp_from_remote_dir "${PROJECT_DIR}/backups/deploy-${STAMP_NAME}" "$SERVER_BACKUP_DIR"
  fi
}

backup_all() {
  local_backup
  if [[ "$SKIP_TABLE_SYNC" != "true" ]]; then
    export_sync_tables
  fi
  remote_backup
}

sync_env() {
  [[ -f .env ]] || die ".env not found"
  log "Backing up and overwriting remote .env"
  ssh_remote "bash -s" <<REMOTE_ENV
set -euo pipefail
cd "$PROJECT_DIR"
ENV_BACKUP_DIR="backups/env-overwrite-${STAMP_NAME}"
mkdir -p "\$ENV_BACKUP_DIR"
cp .env "\$ENV_BACKUP_DIR/env.before-overwrite"
chmod 600 "\$ENV_BACKUP_DIR/env.before-overwrite"
REMOTE_ENV
  scp_to_remote .env "${PROJECT_DIR}/.env"
  ssh_remote "chmod 600 '${PROJECT_DIR}/.env'"
}

package_image() {
  [[ -n "$TAG" ]] || die "--tag is required to build image package"
  log "Building local linux/amd64 image package for $TAG"
  mkdir -p "$SYNC_DIR"
  docker buildx build --platform linux/amd64 -t agent-forge:latest -t "agent-forge:$TAG" -f Dockerfile . --load
  docker save agent-forge:latest "agent-forge:$TAG" | gzip > "$IMAGE_ARCHIVE"
  ls -lh "$IMAGE_ARCHIVE"
}

server_load_image_package() {
  [[ -f "$IMAGE_ARCHIVE" ]] || die "Image archive not found: $IMAGE_ARCHIVE"
  log "Uploading image package and runtime config"
  ssh_remote "mkdir -p '${PROJECT_DIR}/releases'"
  scp_to_remote "$IMAGE_ARCHIVE" "${PROJECT_DIR}/releases/$(basename "$IMAGE_ARCHIVE")"
  scp_to_remote docker-compose.prod.yml "${PROJECT_DIR}/docker-compose.prod.yml"
  scp_to_remote nginx.conf "${PROJECT_DIR}/nginx.conf"

  log "Loading image package on server"
  ssh_remote "bash -s" <<REMOTE_LOAD
set -euo pipefail
cd "$PROJECT_DIR"
gzip -dc "releases/$(basename "$IMAGE_ARCHIVE")" | docker load
cat > release.txt <<RELEASE
tag=$TAG
commit=$HEAD_SHA
image=agent-forge:$TAG
deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RELEASE
REMOTE_LOAD
}

recreate_app() {
  log "Recreating app from loaded image"
  ssh_remote "bash -s" <<REMOTE_DEPLOY
set -euo pipefail
cd "$PROJECT_DIR"
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml rm -f app
docker compose -f docker-compose.prod.yml up -d app
REMOTE_DEPLOY
}

restart_app() {
  log "Recreating app with current remote image"
  ssh_remote "bash -s" <<REMOTE_RESTART
set -euo pipefail
cd "$PROJECT_DIR"
docker compose -f docker-compose.prod.yml up -d app
REMOTE_RESTART
}

wait_for_app_health() {
  log "Waiting for app health"
  ssh_remote "bash -s" <<'REMOTE_HEALTH'
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
}

sync_tables() {
  [[ -f "$SYNC_DIR/core-tables.sql" ]] || export_sync_tables
  log "Syncing remote tables: $(join_by_comma "${TABLES[@]}")"
  local table_list=""
  for table in "${TABLES[@]}"; do
    if [[ -n "$table_list" ]]; then
      table_list+=", "
    fi
    table_list+="\"${table}\""
  done
  ssh_remote "bash -s" <<REMOTE_SYNC
set -euo pipefail
DB=\$(docker ps --filter "name=agent-forge-db" --format "{{.Names}}" | head -n1)
test -n "\$DB"
docker exec -i "\$DB" psql -U postgres -d "$REMOTE_DB_NAME" -v ON_ERROR_STOP=1 -c 'TRUNCATE ${table_list} RESTART IDENTITY;'
REMOTE_SYNC
  if [[ -n "${SSHPASS:-}" ]]; then
    sshpass -e ssh "${BASE_SSH_OPTS[@]}" "${PASSWORD_SSH_OPTS[@]}" "$SERVER" \
      "DB=\$(docker ps --filter \"name=agent-forge-db\" --format \"{{.Names}}\" | head -n1); test -n \"\$DB\"; docker exec -i \"\$DB\" psql -U postgres -d \"$REMOTE_DB_NAME\" -v ON_ERROR_STOP=1" \
      < "$SYNC_DIR/core-tables.sql"
  else
    ssh "${BASE_SSH_OPTS[@]}" "$SERVER" \
      "DB=\$(docker ps --filter \"name=agent-forge-db\" --format \"{{.Names}}\" | head -n1); test -n \"\$DB\"; docker exec -i \"\$DB\" psql -U postgres -d \"$REMOTE_DB_NAME\" -v ON_ERROR_STOP=1" \
      < "$SYNC_DIR/core-tables.sql"
  fi
}

verify_deploy() {
  log "Final verification"
  curl -fsS "https://${VERIFY_HOST}/api/health" >/tmp/agent-forge-health.json
  cat /tmp/agent-forge-health.json
  echo

  local oss_status
  oss_status="$(curl -sS -o /tmp/agent-forge-oss-auth.json -w '%{http_code}' -X POST "https://${VERIFY_HOST}/api/external/video/oss/upload")"
  cat /tmp/agent-forge-oss-auth.json
  echo
  [[ "$oss_status" == "401" || "$oss_status" == "400" ]] || die "Unexpected OSS auth-check status: $oss_status"

  ssh_remote "bash -s" <<REMOTE_VERIFY
set -euo pipefail
echo "source_commit"
if [ -f "$PROJECT_DIR/release.txt" ]; then cat "$PROJECT_DIR/release.txt"; elif [ -d "$CODE_DIR/.git" ]; then git -C "$CODE_DIR" rev-parse HEAD; else echo "no-source"; fi
echo "container_image"
docker inspect -f "{{.Image}}" agent-forge-app-1
docker image inspect agent-forge:latest --format "{{.Id}} {{.Created}}"
echo "container_health"
docker exec agent-forge-app-1 wget -qO- http://localhost:8001/api/health
echo
REMOTE_VERIFY

  if [[ "$SKIP_TABLE_SYNC" != "true" ]]; then
    ssh_remote "bash -s" <<'REMOTE_COUNTS'
set -euo pipefail
DB=$(docker ps --filter "name=agent-forge-db" --format "{{.Names}}" | head -n1)
docker exec "$DB" psql -U postgres -d agent_forge -c 'SELECT count(*) AS skills FROM "Skill"; SELECT count(*) AS style_presets FROM "StylePreset"; SELECT count(*) AS api_usage_counters FROM "ApiUsageCounter";'
REMOTE_COUNTS
  fi
}

cleanup_tmp() {
  log "Cleaning temporary files"
  rm -f /tmp/agent-forge-health.json /tmp/agent-forge-oss-auth.json
  ssh_remote "rm -f /tmp/oss-upload-check.json /tmp/oss-upload-public.json"
}

case "$MODE" in
  backup)
    backup_all
    ;;
  build)
    package_image
    ;;
  image-deploy)
    remote_backup
    package_image
    server_load_image_package
    recreate_app
    wait_for_app_health
    SKIP_TABLE_SYNC="true"
    verify_deploy
    cleanup_tmp
    ;;
  sync-env)
    sync_env
    restart_app
    wait_for_app_health
    verify_deploy
    ;;
  sync-tables)
    export_sync_tables
    sync_tables
    verify_deploy
    ;;
  verify)
    verify_deploy
    ;;
  deploy)
    backup_all
    if [[ "$SKIP_ENV" != "true" ]]; then
      sync_env
    fi
    package_image
    server_load_image_package
    recreate_app
    wait_for_app_health
    if [[ "$SKIP_TABLE_SYNC" != "true" ]]; then
      sync_tables
    fi
    verify_deploy
    cleanup_tmp
    ;;
esac

log "Done"
echo "Mode: $MODE"
echo "Backups: $BACKUP_DIR"
