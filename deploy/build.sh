#!/usr/bin/env bash
# Builds the site into a new release and switches the `current` symlink atomically.
# Called by the webhook receiver, the nightly cron, the watchdog and GitHub Actions.
# Собирает сайт в новый релиз и атомарно переключает симлинк `current`.
# Запускают приёмник вебхука, ночной крон, сторож и GitHub Actions.
set -Eeuo pipefail

# VKUS_ROOT / VKUS_REPO: only for a rehearsal on another machine
# VKUS_ROOT / VKUS_REPO — только для репетиции на другой машине
ROOT=${VKUS_ROOT:-/srv/vkus}
# not SITE: `.env` defines SITE (the public URL) and would overwrite it
# не SITE: в `.env` есть SITE (адрес сайта), он затёр бы путь
REPO=${VKUS_REPO:-$ROOT/site}
RELEASES=$ROOT/releases
# start of the last build that reached the site: whoever saved between it and
# the start of this build gets «Ваши правки опубликованы» (scripts/build-notify.mjs)
# начало последней сборки, дошедшей до сайта: кто сохранял между ней и началом
# этой сборки, получает «Ваши правки опубликованы» (scripts/build-notify.mjs)
PUBLISHED=$ROOT/published-since
LOCK=/tmp/vkus-build.lock
AGAIN=/tmp/vkus-build.again
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

cd "$REPO"
set -a; . "$REPO/.env"; set +a

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
      body[key] = value === "" ? null : ["seconds", "progress"].includes(key) ? Number(value) : value;
    }
    fetch(`${process.env.DIRECTUS_URL}/items/site_build`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.ok || console.error(`статус сборки не записан: ${r.status}`), (e) => console.error(`статус сборки не записан: ${e.message}`));
  ' "$@" || true
}

# The build's own output turned into progress for the editor: the four steps
# and, while Astro prepares photos (the long part with new uploads), «фото 120
# из 559». Writes at most every 2 s, so a fast build is not slowed down.
# Вывод самой сборки превращается в ход для редактора: четыре шага и, пока
# Astro готовит фото (долгая часть при новых загрузках), «фото 120 из 559».
# Пишет не чаще раза в 2 с, чтобы не тормозить быструю сборку.
track() {
  local line pct last=0 at=0 photos=
  while IFS= read -r line; do
    # the line goes on as it was: build.log and `journalctl -u webhook` keep the full output
    # строка идёт дальше как была: build.log и `journalctl -u webhook` сохраняют весь вывод
    printf '%s\n' "$line"
    if [[ $line == *'> astro build'* ]]; then
      status progress=15 step="получаю контент"
    elif [[ $line == *'generating static routes'* ]]; then
      status progress=35 step="собираю страницы"
    elif [[ $line == *'generating optimized images'* ]]; then
      photos=1
      status progress=45 step="собираю страницы: готовлю фото"
    # «▶ /_astro/….webp (before: 34kB, after: 24kB) (+1.77s) (6/559)»
    elif [[ -n $photos && $line =~ \(([0-9]+)/([0-9]+)\) ]] && (( 10#${BASH_REMATCH[2]} > 0 )); then
      pct=$((45 + 45 * 10#${BASH_REMATCH[1]} / 10#${BASH_REMATCH[2]}))
      if (( pct > last && SECONDS - at >= 2 )); then
        last=$pct at=$SECONDS
        status progress="$pct" step="собираю страницы: фото ${BASH_REMATCH[1]} из ${BASH_REMATCH[2]}"
      fi
    fi
  done
  return 0
}

# the tail editors see: without Astro's revalidation warnings (they are noise
# from the 304 proxy and would push the real error out) and with the builder
# token masked — the message field is readable by the editor role
# хвост, который видят редакторы: без предупреждений Astro о перепроверке
# (это шум от прокси с 304, он вытеснил бы настоящую ошибку) и с замаскированным
# токеном сборщика — поле сообщения читает роль редактора
tail_for_editors() {
  # Astro colours its output even into a pipe: the escape codes would read as garbage
  # Astro красит вывод даже в трубу: escape-коды читались бы как мусор
  grep -v 'revalidating a cached remote asset' "$LOG" | tail -n 40 \
    | sed -E 's/access_token=[^ &"]+/access_token=***/g; s/\x1b\[[0-9;]*m//g'
}

# the moment before content is read: everything saved earlier is in this build
# момент до чтения контента: всё, что сохранили раньше, попадает в эту сборку
SINCE=$(date +%H:%M)

# a change during a running build is not lost: the loop below runs once more
# изменение во время сборки не теряется: цикл ниже соберёт ещё раз
touch "$AGAIN"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "сборка уже идёт, повторю после неё"
  status summary="Идёт сборка. Правки, сохранённые после её начала, соберутся сразу следом — перезагрузите страницу через минуту."
  exit 0
fi

failed() {
  status status=error finished_at="$(date -Iseconds)" step="сборка не удалась" \
    summary="Сборка не удалась, на сайте осталась прежняя версия. Правки после $SINCE не опубликованы." \
    message="$(tail_for_editors)"
  # the administrators hear it in the bell; the editor sees the page
  # администраторы узнают в колокольчике, редактор видит страницу
  node scripts/build-notify.mjs failed "$SINCE" || true
}
trap failed ERR

build() {
  local started stamp report since_iso from
  started=$(date +%s)
  SINCE=$(date +%H:%M)
  since_iso=$(date -Iseconds)
  from=$(cat "$PUBLISHED" 2>/dev/null || true)
  status status=building started_at="$since_iso" finished_at= seconds= message= progress=3 step="проверяю" \
    summary="Собираю правки, сохранённые до $SINCE. Обычно 10–30 секунд, с новыми фото — до минуты."
  : >"$LOG"
  pnpm install --frozen-lockfile --prefer-offline 2>&1 | tee -a "$LOG"
  # Astro prints the full image URL, token included, in its revalidation warnings:
  # mask it before it reaches build.log / watch.log
  # Astro печатает в предупреждениях о ревалидации полный адрес картинки вместе с
  # токеном: маскируем до того, как он попадёт в build.log / watch.log
  pnpm build 2>&1 | sed -uE 's/access_token=[^ &"]+/access_token=***/g' | tee -a "$LOG" | track
  status progress=95 step="публикую"
  stamp=$(date +%Y%m%d-%H%M%S)
  mkdir -p "$RELEASES"
  cp -r dist "$RELEASES/$stamp"
  ln -sfn "$RELEASES/$stamp" "$ROOT/current.tmp" && mv -T "$ROOT/current.tmp" "$ROOT/current"
  # keep the last five releases / оставляем пять последних релизов
  ls -1dt "$RELEASES"/* | tail -n +6 | xargs -r rm -rf
  # what is saved but not on the site (drafts) and what is still a placeholder;
  # a failed report is not an error
  # что сохранено, но не на сайте (черновики), и что ещё заглушка; сбой отчёта — не ошибка
  report=$(node scripts/site-report.mjs 2>>"$LOG" || true)
  status status=ok finished_at="$(date -Iseconds)" seconds=$(($(date +%s) - started)) release="$stamp" \
    progress=100 step="опубликовано" \
    summary="На сайте всё, что сохранено до $SINCE. Сборка заняла $(($(date +%s) - started)) с.${report:+ $report}"
  # the bell for those whose saves are in this release; a failed notice is not an error
  # колокольчик тем, чьи сохранения вошли в релиз; сбой уведомления — не ошибка
  node scripts/build-notify.mjs published "$from" "$since_iso" "$stamp" "$(($(date +%s) - started))" 2>>"$LOG" || true
  printf '%s\n' "$since_iso" >"$PUBLISHED"
  echo "релиз $stamp"
}

while [ -e "$AGAIN" ]; do
  rm -f "$AGAIN"
  build
done
