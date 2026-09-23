#!/usr/bin/env bash
# Builds the site into a new release and switches the `current` symlink atomically.
# Called by the webhook receiver, the nightly cron and GitHub Actions.
# Собирает сайт в новый релиз и атомарно переключает симлинк `current`.
# Запускают приёмник вебхука, ночной крон и GitHub Actions.
set -euo pipefail

ROOT=/srv/vkus
SITE=$ROOT/site
RELEASES=$ROOT/releases
LOCK=/tmp/vkus-build.lock
AGAIN=/tmp/vkus-build.again

# a change during a running build is not lost: the loop below runs once more
# изменение во время сборки не теряется: цикл ниже соберёт ещё раз
touch "$AGAIN"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "сборка уже идёт, повторю после неё"
  exit 0
fi

build() {
  cd "$SITE"
  set -a; . "$SITE/.env"; set +a
  pnpm install --frozen-lockfile --prefer-offline
  pnpm build
  local stamp
  stamp=$(date +%Y%m%d-%H%M%S)
  mkdir -p "$RELEASES"
  cp -r dist "$RELEASES/$stamp"
  ln -sfn "$RELEASES/$stamp" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current"
  # keep the last five releases / оставляем пять последних релизов
  ls -1dt "$RELEASES"/* | tail -n +6 | xargs -r rm -rf
  echo "релиз $stamp"
}

while [ -e "$AGAIN" ]; do
  rm -f "$AGAIN"
  build
done
