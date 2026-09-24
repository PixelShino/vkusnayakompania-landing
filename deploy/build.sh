#!/usr/bin/env bash
# Builds the site into a new release and switches the `current` symlink atomically.
# Called by the webhook receiver, the nightly cron and GitHub Actions.
# Собирает сайт в новый релиз и атомарно переключает симлинк `current`.
# Запускают приёмник вебхука, ночной крон и GitHub Actions.
set -Eeuo pipefail

ROOT=/srv/vkus
# not SITE: `.env` defines SITE (the public URL) and would overwrite it
# не SITE: в `.env` есть SITE (адрес сайта), он затёр бы путь
REPO=$ROOT/site
RELEASES=$ROOT/releases
LOCK=/tmp/vkus-build.lock
AGAIN=/tmp/vkus-build.again
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

# a change during a running build is not lost: the loop below runs once more
# изменение во время сборки не теряется: цикл ниже соберёт ещё раз
touch "$AGAIN"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "сборка уже идёт, повторю после неё"
  exit 0
fi

# build status for editors, «Публикация сайта» in the admin; a failed report
# never fails the build, and without Directus (fixture builds) it is skipped
# статус сборки для редакторов, «Публикация сайта» в админке; сбой отчёта
# сборку не роняет, без Directus (сборка на фикстуре) отчёт пропускается
status() {
  [ -n "${DIRECTUS_URL:-}" ] && [ -n "${DIRECTUS_TOKEN:-}" ] || return 0
  node -e '
    const body = {};
    for (const arg of process.argv.slice(1)) {
      const [key, value] = arg.split(/=(.*)/s);
      body[key] = value === "" ? null : key === "seconds" ? Number(value) : value;
    }
    fetch(`${process.env.DIRECTUS_URL}/items/site_build`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.ok || console.error(`статус сборки не записан: ${r.status}`), (e) => console.error(`статус сборки не записан: ${e.message}`));
  ' "$@" || true
}
trap 'status status=error finished_at="$(date -Iseconds)" message="$(tail -n 40 "$LOG")"' ERR

build() {
  cd "$REPO"
  set -a; . "$REPO/.env"; set +a
  local started stamp
  started=$(date +%s)
  status status=building started_at="$(date -Iseconds)" finished_at= seconds= message=
  : >"$LOG"
  pnpm install --frozen-lockfile --prefer-offline 2>&1 | tee -a "$LOG"
  pnpm build 2>&1 | tee -a "$LOG"
  stamp=$(date +%Y%m%d-%H%M%S)
  mkdir -p "$RELEASES"
  cp -r dist "$RELEASES/$stamp"
  ln -sfn "$RELEASES/$stamp" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current"
  # keep the last five releases / оставляем пять последних релизов
  ls -1dt "$RELEASES"/* | tail -n +6 | xargs -r rm -rf
  status status=ok finished_at="$(date -Iseconds)" seconds=$(($(date +%s) - started)) release="$stamp"
  echo "релиз $stamp"
}

while [ -e "$AGAIN" ]; do
  rm -f "$AGAIN"
  build
done
