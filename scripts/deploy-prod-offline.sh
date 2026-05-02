#!/usr/bin/env bash
set -euo pipefail

SERVER="root@agent.mob-ai.cn"
PUBLIC_HOST=""
PROJECT_DIR="/var/www/agent-forge"
CODE_DIR="/var/www/agent-forge/source"
REPO_URL="$(git config --get remote.origin.url || true)"
TAG=""
MODE="deploy"
REGISTRY_IMAGE=""
REGISTRY_PUSH_IMAGE=""
REGISTRY_PULL_IMAGE=""
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
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=6
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
  --mode registry-deploy      CI-safe registry deploy. Builds and pushes image, then server pulls it.
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
  --registry-image <image>    Registry image path for registry-deploy, used for both push and pull when split images are not set.
  --registry-push-image <image>
                              Image path used by CI/build runner for docker push, e.g. registry-origin.example.com/agent-forge
  --registry-pull-image <image>
                              Image path used by remote server for docker pull, e.g. registry.example.com/agent-forge
  --backup-stamp <stamp>      Backup folder suffix. Default: current timestamp
  --local-db-container <name> Local Postgres container. Default: agent-forge-db-dev
  --tables <a,b,c>            Comma-separated tables to sync. Default: Skill,StylePreset,ApiUsageCounter
  --skip-env                  Deploy without overwriting remote .env.
  --skip-table-sync           Deploy without syncing DB tables.
  --skip-remote-pullback      Do not pull remote backups back to local backup dir.

Authentication:
  Set SSHPASS for password SSH, or configure normal ssh/scp key authentication.
  Set REGISTRY_USERNAME and REGISTRY_PASSWORD for registry-deploy.
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
    --registry-image)
      REGISTRY_IMAGE="${2:-}"
      shift 2
      ;;
    --registry-push-image)
      REGISTRY_PUSH_IMAGE="${2:-}"
      shift 2
      ;;
    --registry-pull-image)
      REGISTRY_PULL_IMAGE="${2:-}"
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
  deploy|image-deploy|registry-deploy|backup|build|sync-env|sync-tables|verify) ;;
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

if [[ "$MODE" == "deploy" || "$MODE" == "image-deploy" || "$MODE" == "registry-deploy" || "$MODE" == "build" ]]; then
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

if [[ "$MODE" == "registry-deploy" ]]; then
  REGISTRY_PUSH_IMAGE="${REGISTRY_PUSH_IMAGE:-$REGISTRY_IMAGE}"
  REGISTRY_PULL_IMAGE="${REGISTRY_PULL_IMAGE:-$REGISTRY_IMAGE}"
  [[ -n "$REGISTRY_PUSH_IMAGE" ]] || die "--registry-push-image or --registry-image is required for registry-deploy"
  [[ -n "$REGISTRY_PULL_IMAGE" ]] || die "--registry-pull-image or --registry-image is required for registry-deploy"
  [[ "$REGISTRY_PUSH_IMAGE" == */* ]] || die "--registry-push-image must include a registry host"
  [[ "$REGISTRY_PULL_IMAGE" == */* ]] || die "--registry-pull-image must include a registry host"
  [[ -n "${REGISTRY_USERNAME:-}" ]] || die "REGISTRY_USERNAME is required for registry-deploy"
  [[ -n "${REGISTRY_PASSWORD:-}" ]] || die "REGISTRY_PASSWORD is required for registry-deploy"
fi

if [[ "$MODE" == "deploy" || "$MODE" == "image-deploy" || "$MODE" == "registry-deploy" || "$MODE" == "build" ]]; then
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

build_push_registry_image() {
  [[ -n "$TAG" ]] || die "--tag is required to build registry image"
  [[ -n "$REGISTRY_PUSH_IMAGE" ]] || die "--registry-push-image is required"
  local registry_host="${REGISTRY_PUSH_IMAGE%%/*}"
  log "Logging in to registry $registry_host"
  printf '%s' "$REGISTRY_PASSWORD" | docker login "$registry_host" -u "$REGISTRY_USERNAME" --password-stdin >/dev/null

  log "Building and pushing linux/amd64 image $REGISTRY_PUSH_IMAGE:$TAG"
  docker buildx build \
    --platform linux/amd64 \
    -t "$REGISTRY_PUSH_IMAGE:$TAG" \
    -t "$REGISTRY_PUSH_IMAGE:latest" \
    -f Dockerfile . \
    --push
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

server_pull_registry_image() {
  [[ -n "$REGISTRY_PULL_IMAGE" ]] || die "--registry-pull-image is required"
  local registry_host="${REGISTRY_PULL_IMAGE%%/*}"
  log "Uploading runtime config"
  ssh_remote "mkdir -p '${PROJECT_DIR}'"
  scp_to_remote docker-compose.prod.yml "${PROJECT_DIR}/docker-compose.prod.yml"
  scp_to_remote nginx.conf "${PROJECT_DIR}/nginx.conf"

  log "Logging in to registry on server"
  printf '%s' "$REGISTRY_PASSWORD" | ssh_remote "docker login '$registry_host' -u '$REGISTRY_USERNAME' --password-stdin >/dev/null"

  log "Pulling registry image on server"
  ssh_remote "bash -s" <<REMOTE_PULL
set -euo pipefail
cd "$PROJECT_DIR"
docker pull "$REGISTRY_PULL_IMAGE:$TAG"
docker tag "$REGISTRY_PULL_IMAGE:$TAG" agent-forge:latest
cat > release.txt <<RELEASE
tag=$TAG
commit=$HEAD_SHA
image=$REGISTRY_PULL_IMAGE:$TAG
deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RELEASE
REMOTE_PULL
}

start_remote_registry_deploy() {
  [[ -n "$REGISTRY_PULL_IMAGE" ]] || die "--registry-pull-image is required"
  local registry_host="${REGISTRY_PULL_IMAGE%%/*}"
  local run_dir="${PROJECT_DIR}/deploy-runs/${STAMP_NAME}"

  log "Uploading runtime config"
  ssh_remote "mkdir -p '${PROJECT_DIR}'"
  scp_to_remote docker-compose.prod.yml "${PROJECT_DIR}/docker-compose.prod.yml"
  scp_to_remote nginx.conf "${PROJECT_DIR}/nginx.conf"

  log "Logging in to registry on server"
  printf '%s' "$REGISTRY_PASSWORD" | ssh_remote "docker login '$registry_host' -u '$REGISTRY_USERNAME' --password-stdin >/dev/null"

  log "Starting remote registry deploy task"
  ssh_remote "bash -s" <<REMOTE_START
set -euo pipefail
RUN_DIR="$run_dir"
mkdir -p "\$RUN_DIR"
cat > "\$RUN_DIR/deploy.sh" <<'REMOTE_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="\$1"
RUN_DIR="\$2"
TAG="\$3"
HEAD_SHA="\$4"
REGISTRY_IMAGE="\$5"
CURRENT_PHASE=init

timestamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

log_phase() {
  local phase="\$1"
  local event="\$2"
  local detail="\${3:-}"
  if [[ -n "\$detail" ]]; then
    echo "ts=\$(timestamp) phase=\$phase event=\$event \$detail"
  else
    echo "ts=\$(timestamp) phase=\$phase event=\$event"
  fi
}

trap 'code=\$?; echo failure > "\$RUN_DIR/status"; echo "ts=\$(timestamp) phase=\$CURRENT_PHASE event=failure exit_code=\$code" >> "\$RUN_DIR/deploy.log"; exit "\$code"' ERR

cd "\$PROJECT_DIR"
echo running > "\$RUN_DIR/status"
{
  log_phase deploy start "tag=\$TAG image=\$REGISTRY_IMAGE:\$TAG commit=\$HEAD_SHA"

  CURRENT_PHASE=pull
  echo pulling > "\$RUN_DIR/status"
  pull_started_at=\$(date +%s)
  log_phase pull start "image=\$REGISTRY_IMAGE:\$TAG"
  docker pull "\$REGISTRY_IMAGE:\$TAG"
  pull_finished_at=\$(date +%s)
  log_phase pull finish "duration_seconds=\$((pull_finished_at - pull_started_at))"

  CURRENT_PHASE=tag
  echo tagging > "\$RUN_DIR/status"
  tag_started_at=\$(date +%s)
  log_phase tag start "source=\$REGISTRY_IMAGE:\$TAG target=agent-forge:latest"
  docker tag "\$REGISTRY_IMAGE:\$TAG" agent-forge:latest
  docker image inspect agent-forge:latest --format 'image_id={{.Id}} created={{.Created}} size={{.Size}}'
  tag_finished_at=\$(date +%s)
  log_phase tag finish "duration_seconds=\$((tag_finished_at - tag_started_at))"

  CURRENT_PHASE=release
  cat > release.txt <<RELEASE
tag=\$TAG
commit=\$HEAD_SHA
image=\$REGISTRY_IMAGE:\$TAG
deployed_at=\$(timestamp)
RELEASE

  CURRENT_PHASE=start
  echo starting > "\$RUN_DIR/status"
  start_started_at=\$(date +%s)
  log_phase start start "compose_file=docker-compose.prod.yml service=app"
  docker compose -f docker-compose.prod.yml stop app
  docker compose -f docker-compose.prod.yml rm -f app
  docker compose -f docker-compose.prod.yml up -d app
  start_finished_at=\$(date +%s)
  log_phase start finish "duration_seconds=\$((start_finished_at - start_started_at))"

  CURRENT_PHASE=healthcheck
  echo healthchecking > "\$RUN_DIR/status"
  health_started_at=\$(date +%s)
  log_phase healthcheck start "container=agent-forge-app-1"
  for i in \$(seq 1 100); do
    status=\$(docker inspect -f "{{.State.Health.Status}}" agent-forge-app-1 2>/dev/null || echo missing)
    echo "health=\$status attempt=\$i"
    [ "\$status" = healthy ] && break
    sleep 3
  done
  final_status=\$(docker inspect -f "{{.State.Health.Status}}" agent-forge-app-1 2>/dev/null || echo missing)
  [ "\$final_status" = healthy ]
  health_finished_at=\$(date +%s)
  log_phase healthcheck finish "duration_seconds=\$((health_finished_at - health_started_at))"
  log_phase deploy finish
} >> "\$RUN_DIR/deploy.log" 2>&1
echo success > "\$RUN_DIR/status"
REMOTE_SCRIPT
chmod +x "\$RUN_DIR/deploy.sh"
echo running > "\$RUN_DIR/status"
nohup bash "\$RUN_DIR/deploy.sh" "$PROJECT_DIR" "\$RUN_DIR" "$TAG" "$HEAD_SHA" "$REGISTRY_PULL_IMAGE" >/dev/null 2>&1 < /dev/null &
echo \$! > "\$RUN_DIR/pid"
echo "run_dir=\$RUN_DIR"
echo "pid=\$(cat "\$RUN_DIR/pid")"
REMOTE_START
}

wait_for_remote_registry_deploy() {
  local run_dir="${PROJECT_DIR}/deploy-runs/${STAMP_NAME}"
  log "Polling remote registry deploy task"
  for i in $(seq 1 180); do
    local status
    status="$(ssh_remote "cat '$run_dir/status' 2>/dev/null || echo missing" || echo ssh_unavailable)"
    echo "remote_deploy_status=$status attempt=$i"
    case "$status" in
      success)
        ssh_remote "tail -n 80 '$run_dir/deploy.log' || true"
        return 0
        ;;
      failure)
        ssh_remote "tail -n 160 '$run_dir/deploy.log' || true"
        return 1
        ;;
    esac
    sleep 10
  done
  ssh_remote "tail -n 160 '$run_dir/deploy.log' || true"
  die "Timed out waiting for remote registry deploy task"
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
for i in $(seq 1 100); do
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
for attempt in \$(seq 1 10); do
  if docker exec agent-forge-app-1 wget -qO- http://127.0.0.1:8001/api/health; then
    break
  fi
  if [ "\$attempt" -eq 10 ]; then
    exit 1
  fi
  sleep 2
done
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
  registry-deploy)
    remote_backup
    build_push_registry_image
    start_remote_registry_deploy
    wait_for_remote_registry_deploy
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
