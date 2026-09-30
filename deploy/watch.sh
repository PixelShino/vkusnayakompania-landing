#!/usr/bin/env bash
# Watchdog: if content changed after the last build started and no build is
# running, rebuild. Covers what the Flow misses — a reorder by drag-and-drop,
# a webhook lost while Directus restarted, a build killed half-way.
# Сторож: если контент менялся после начала последней сборки, а сборка не идёт —
# пересобрать. Закрывает то, что упускает Flow: перетаскивание порядка,
# вебхук, потерянный при перезапуске Directus, сборку, убитую на середине.
#
# cron every 2 minutes as `deploy` / крон раз в 2 минуты от `deploy`
set -euo pipefail

REPO=/srv/vkus/site
LOCK=/tmp/vkus-build.lock
cd "$REPO"
set -a; . "$REPO/.env"; set +a
[ -n "${DIRECTUS_URL:-}" ] && [ -n "${DIRECTUS_TOKEN:-}" ] || exit 0

# a build is running: it will pick the change up itself
# сборка идёт: она сама подхватит правку
exec 9>"$LOCK"
if ! flock -n 9; then exit 0; fi
flock -u 9

# prints the time of the newest unpublished change, or nothing
# печатает время самой свежей неопубликованной правки или ничего
pending=$(node -e '
  const base = process.env.DIRECTUS_URL, headers = { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}` };
  const get = async (path) => {
    const r = await fetch(base + path, { headers, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return (await r.json()).data;
  };
  const collections = "afisha,promos,menus,cakes,places_files,settings,home,places,directions,directus_files,texts";
  const [build, [last]] = await Promise.all([
    get("/items/site_build"),
    get(`/activity?filter[collection][_in]=${collections}&filter[action][_in]=create,update,delete&sort=-timestamp&limit=1&fields=timestamp`),
  ]);
  if (!last) process.exit(0);
  const changed = Date.parse(last.timestamp);
  const started = build?.started_at ? Date.parse(build.started_at) : 0;
  // a change younger than a minute is still on its way through the Flow
  // правке моложе минуты ещё положено идти через Flow
  if (changed > started && Date.now() - changed > 60_000 && build?.status !== "building") {
    console.log(new Date(changed).toLocaleTimeString("ru-RU", { timeZone: "Europe/Samara", hour: "2-digit", minute: "2-digit" }));
  }
')
[ -n "$pending" ] || exit 0

echo "сторож: есть правки от $pending, которых нет на сайте — пересобираю"
node -e '
  fetch(`${process.env.DIRECTUS_URL}/items/site_build`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "stale", summary: `Есть правки от ${process.argv[1]}, которых ещё нет на сайте — пересобираю.` }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
' "$pending" || true
exec "$REPO/deploy/build.sh"
