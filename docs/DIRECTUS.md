# Directus: установка и эксплуатация

Админка сайта. Клиент правит контент здесь, сайт собирается статикой и
обновляется сам в пределах минуты после «Сохранить».

## Как устроено

| Что | Где |
|---|---|
| Сайт | `https://vkus-com.ru` → nginx → `/srv/vkus/current` (симлинк на релиз) |
| Админка | `https://admin.vkus-com.ru` → nginx → Directus в Docker на `127.0.0.1:8055` |
| Вебхук пересборки | `https://admin.vkus-com.ru/hooks/rebuild` → nginx → `webhook` на `127.0.0.1:9000` → `deploy/build.sh` |
| Код | `/srv/vkus/site` — клон этого репозитория, ветка `main` |
| Релизы | `/srv/vkus/releases/<дата-время>`, хранятся пять последних |
| Бэкапы | `/srv/backups`, 14 дней |
| Превью | Vercel, собирает ветку из того же Directus по токену сборщика |

Цепочка публикации: редактор нажимает «Сохранить» → Flow «Пересборка сайта»
шлёт `POST /hooks/rebuild` → `build.sh` забирает контент по REST, собирает
Astro в новый релиз и переключает симлинк. Упавшая сборка симлинк не трогает.
Ночью в 00:10 крон собирает сайт ещё раз, чтобы сработали окна показа афиши
и акций.

## Установка на VPS

Ubuntu 22.04+, доступ root, DNS `vkus-com.ru`, `www.vkus-com.ru` и
`admin.vkus-com.ru` уже смотрят на сервер.

### 1. Сервер

```bash
apt update && apt install -y git nginx certbot python3-certbot-nginx webhook
curl -fsSL https://get.docker.com | sh
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
npm install -g pnpm@10
adduser --disabled-password --gecos '' deploy
usermod -aG docker deploy
mkdir -p /srv/vkus /srv/backups && chown -R deploy:deploy /srv/vkus /srv/backups
```

### 2. Код

```bash
su - deploy
git clone https://github.com/PixelShino/vkusnayakompania-landing.git /srv/vkus/site
cd /srv/vkus/site && pnpm install --frozen-lockfile
```

### 3. Directus

```bash
cd /srv/vkus/site/directus
cp .env.example .env
```

В `.env`: `SECRET` (`openssl rand -hex 32`), `PUBLIC_URL=https://admin.vkus-com.ru`,
`DB_PASSWORD`, `ADMIN_EMAIL` (настоящий адрес с обычным доменом: `.local` и
подобные Directus не принимает при входе), `ADMIN_PASSWORD`, блок SMTP
(`EMAIL_TRANSPORT=smtp` и данные почтового сервиса — без него не уйдут
приглашения и сброс пароля). `DIRECTUS_PORT` оставьте 8055.

```bash
docker compose up -d
curl -s http://127.0.0.1:8055/server/ping        # pong
docker compose cp snapshot.yaml directus:/directus/snapshot.yaml
docker compose exec -T directus npx directus schema apply --yes /directus/snapshot.yaml
# … INFO: Snapshot applied successfully
```

Снапшот схемы лежит в репо (`directus/snapshot.yaml`), контейнер его не видит,
поэтому файл сначала копируется внутрь.

Дальше роли, сборщик и Flow одним скриптом. Нужен статический токен
администратора: в админке «Пользователи → админ → Token → Generate», сохранить.

```bash
cd /srv/vkus/site
DIRECTUS_URL=http://127.0.0.1:8055 DIRECTUS_ADMIN_TOKEN=<токен админа> \
REBUILD_HOOK_URL=http://127.0.0.1:9000/hooks/rebuild REBUILD_HOOK_SECRET=<секрет вебхука> \
pnpm setup
```

Скрипт напечатает `DIRECTUS_TOKEN` сборщика — он нужен в следующем шаге и
больше не показывается. Секрет вебхука придумайте сами (`openssl rand -hex 24`).

В админке: «Настройки → Проект» уже по-русски и с именем из схемы; создайте
пользователей редакторов с ролью «Редактор» («Пользователи → +», роль
«Редактор», приглашение уйдёт письмом).

### 4. Сайт

```bash
cd /srv/vkus/site
cp .env.example .env
```

В `.env`: `DIRECTUS_URL=http://127.0.0.1:8055`, `DIRECTUS_TOKEN=<токен сборщика>`,
`PUBLIC_YANDEX_MAPS_KEY=<ключ JS API Яндекс Карт>`, `SITE=https://vkus-com.ru`.

Первый контент: сайт не соберётся без телефона, двух точек, пяти направлений,
фото первого экрана и SEO-полей (см. `pnpm test`). Заполните «Настройки»,
«Главная», «Точки» и «Направления» в админке — либо загрузите стартовый набор
из фикстуры: `pnpm exec node scripts/import-fixture.mjs` (заводит записи и
файлы из `src/data/fixture.json`, существующее не трогает; фото там
заглушки, их заменяют редакторы).

```bash
chmod +x deploy/build.sh deploy/backup.sh
deploy/build.sh        # первый релиз, /srv/vkus/current появился
```

### 5. nginx и сертификаты

```bash
cp deploy/nginx/vkus-com.ru.conf /etc/nginx/sites-available/vkus-com.ru
cp deploy/nginx/admin.vkus-com.ru.conf /etc/nginx/sites-available/admin.vkus-com.ru
ln -s /etc/nginx/sites-available/vkus-com.ru /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/admin.vkus-com.ru /etc/nginx/sites-enabled/
certbot certonly --nginx -d vkus-com.ru -d www.vkus-com.ru
certbot certonly --nginx -d admin.vkus-com.ru
nginx -t && systemctl reload nginx
```

Certbot сам добавит таймер продления.

### 6. Приёмник вебхука

`hooks.json` берёт секрет из окружения, поэтому `webhook` запускается с
флагом `-template`:

```bash
cat >/etc/default/webhook <<'EOF'
HOOK_SECRET=<секрет вебхука, тот же что в pnpm setup>
EOF
mkdir -p /etc/systemd/system/webhook.service.d
cat >/etc/systemd/system/webhook.service.d/override.conf <<'EOF'
[Service]
User=deploy
EnvironmentFile=/etc/default/webhook
ExecStart=
ExecStart=/usr/bin/webhook -nopanic -template -ip 127.0.0.1 -port 9000 -hooks /srv/vkus/site/deploy/webhook/hooks.json
EOF
systemctl daemon-reload && systemctl enable --now webhook
curl -s -X POST -H 'X-Hook-Secret: <секрет>' http://127.0.0.1:9000/hooks/rebuild   # принято, сборка запущена
```

### 7. Крон

```bash
crontab -u deploy /srv/vkus/site/deploy/crontab.txt
```

### 8. Выкладка кода из GitHub

В репозитории: `Settings → Secrets and variables → Actions`: переменная
`VPS_HOST` (IP или домен) и секрет `VPS_SSH_KEY` (приватный ключ, публичный —
в `/home/deploy/.ssh/authorized_keys`). После этого пуш в `main` собирает сайт
на сервере. Пока переменной нет, workflow пропускается.

### 9. Проверка

1. В админке измените заголовок афиши и сохраните.
2. Через минуту `https://vkus-com.ru` показывает новый заголовок.
3. `ls -la /srv/vkus/current` указывает на свежий релиз, `/srv/vkus/build.log`
   заканчивается строкой `релиз …`.

## Эксплуатация

- **Логи**: `docker compose -f /srv/vkus/site/directus/docker-compose.yml logs -f directus`;
  сборки — `/srv/vkus/build.log`; вебхук — `journalctl -u webhook`.
- **Пересобрать руками**: `sudo -u deploy /srv/vkus/site/deploy/build.sh`.
- **Обновить Directus**: поменять тег образа в `directus/docker-compose.yml`,
  `docker compose pull && docker compose up -d`. Перед этим бэкап.
- **Бэкап**: `deploy/backup.sh` (крон делает ночью). Восстановление:
  `gunzip -c /srv/backups/db-<дата>.sql.gz | docker compose exec -T database psql -U directus directus`
  и распаковать `uploads-<дата>.tar.gz` в `directus/`.
- **Схема поменялась** (новое поле): изменить в локальном Directus, выгрузить
  `GET /schema/snapshot?export=yaml` в `directus/snapshot.yaml`, закоммитить,
  на сервере `schema apply` из шага 3.
- **Токены**: сборщика — в `/srv/vkus/site/.env` и в переменных Vercel;
  секрет вебхука — в `/etc/default/webhook` и в Flow «Пересборка сайта».
  Отозвать токен сборщика: «Пользователи → Сборщик сайта → Token».

## Локальная разработка

```bash
cd directus && cp .env.example .env    # заполнить SECRET, DB_PASSWORD, ADMIN_*
docker compose up -d
cd .. && cp .env.example .env          # DIRECTUS_URL=http://localhost:8055
pnpm setup                             # нужен DIRECTUS_ADMIN_TOKEN, см. выше
pnpm fixture                           # выгрузить контент в фикстуру
pnpm dev                               # http://127.0.0.1:4321
```

Без `DIRECTUS_URL` в `.env` сайт собирается из `src/data/fixture.json`;
файлы фикстуры в `src/data/fixture-files/` не в git, их создаёт `pnpm fixture`.
