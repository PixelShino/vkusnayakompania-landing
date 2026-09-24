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

Ход сборки виден в самой админке, раздел «Публикация сайта»: «Идёт сборка»,
«Опубликовано» со временем и длительностью или «Ошибка сборки» с последними
строками лога. Туда пишет `build.sh` токеном сборщика; при сборке без Directus
(на фикстуре) отчёт пропускается, а сбой отчёта сборку не роняет.

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

Защита и память. Часовой пояс — Самара: ночная пересборка в 00:10 должна
совпадать с полуночью точек. Своп обязателен: на 2 ГБ сборка Astro доходит
до 1,5 ГБ, рядом работают Directus и Postgres.

```bash
timedatectl set-timezone Europe/Samara
apt install -y fail2ban ufw unattended-upgrades
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
printf 'vm.swappiness = 10\nnet.core.default_qdisc = fq\nnet.ipv4.tcp_congestion_control = bbr\n' >/etc/sysctl.d/90-vkus.conf
sysctl --system
ufw default deny incoming && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
printf 'PermitRootLogin prohibit-password\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n' \
  >/etc/ssh/sshd_config.d/00-hardening.conf   # сначала положить свой ключ в authorized_keys
sshd -t && systemctl reload ssh
printf '[DEFAULT]\nbackend = systemd\nbanaction = ufw\n\n[sshd]\nenabled = true\nmode = normal\n' >/etc/fail2ban/jail.local
systemctl restart fail2ban
printf '{ "log-driver": "local", "log-opts": { "max-size": "10m", "max-file": "3" } }\n' >/etc/docker/daemon.json
systemctl restart docker
```

Для SSH `ufw allow`, а не `ufw limit`, и `fail2ban` в режиме `normal`, а не
`aggressive`: `ssh-keyscan` в GitHub Actions открывает пять соединений подряд,
и строгие правила банят раннер выкладки.

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
docker compose exec -T directus node /directus/cli.js schema apply --yes /directus/snapshot.yaml
# … INFO: Snapshot applied successfully
```

Снапшот схемы лежит в репо (`directus/snapshot.yaml`), контейнер его не видит,
поэтому файл сначала копируется внутрь. CLI зовётся через `node /directus/cli.js`:
`npx directus` в образе не находит бинарник и качает пакет из npm заново.

Дальше роли, сборщик и Flow одним скриптом. Нужен статический токен
администратора: в админке «Пользователи → админ → Token → Generate», сохранить.

```bash
cd /srv/vkus/site
DIRECTUS_URL=http://127.0.0.1:8055 DIRECTUS_ADMIN_TOKEN=<токен админа> \
REBUILD_HOOK_URL=https://admin.vkus-com.ru/hooks/rebuild REBUILD_HOOK_SECRET=<секрет вебхука> \
pnpm setup
```

Скрипт напечатает `DIRECTUS_TOKEN` сборщика — он нужен в следующем шаге и
больше не показывается. Секрет вебхука придумайте сами (`openssl rand -hex 24`).
Адрес вебхука — публичный: Flow выполняется внутри контейнера Directus, и
`127.0.0.1:9000` там указывает на сам контейнер, а не на сервер.

Имя проекта, цвет и русский язык админки (в том числе на странице входа) ставит
тот же скрипт. Дальше в админке создайте пользователей редакторов с ролью
«Редактор» («Пользователи → +», роль «Редактор», приглашение уйдёт письмом).

### 4. Сайт

```bash
cd /srv/vkus/site
cp .env.example .env
```

В `.env`: `DIRECTUS_URL=http://127.0.0.1:8055`, `DIRECTUS_TOKEN=<токен сборщика>`,
`PUBLIC_YANDEX_MAPS_KEY=<ключ JS API Яндекс Карт>`, `SITE=https://vkus-com.ru`.

Первый контент: сайт не соберётся без телефона, двух точек, пяти направлений,
фото первого экрана и SEO-полей (см. `pnpm test`). У точки есть своё поле
«Телефон точки»: пустое — на странице стоит общий номер из «Настроек». Заполните «Настройки»,
«Главная», «Точки» и «Направления» в админке — либо загрузите стартовый набор
из фикстуры: `pnpm exec node scripts/import-fixture.mjs` (заводит записи и
файлы из `src/data/fixture.json`, существующее не трогает; фото там
заглушки, их заменяют редакторы).

```bash
deploy/build.sh        # первый релиз, /srv/vkus/current появился
```

### 5. nginx и сертификаты

Конфиги из репо ссылаются на сертификаты, которых ещё нет, и с ними `nginx -t`
не проходит. Поэтому сначала временный блок на `:80` для выпуска, потом конфиги:

```bash
cat >/etc/nginx/sites-enabled/acme <<'EOF'
server { listen 80; server_name vkus-com.ru www.vkus-com.ru admin.vkus-com.ru; return 404; }
EOF
nginx -t && systemctl reload nginx
certbot certonly --nginx -d vkus-com.ru -d www.vkus-com.ru
certbot certonly --nginx -d admin.vkus-com.ru
rm /etc/nginx/sites-enabled/acme /etc/nginx/sites-enabled/default
cp deploy/nginx/vkus-com.ru.conf /etc/nginx/sites-available/vkus-com.ru
cp deploy/nginx/admin.vkus-com.ru.conf /etc/nginx/sites-available/admin.vkus-com.ru
ln -s /etc/nginx/sites-available/vkus-com.ru /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/admin.vkus-com.ru /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Certbot сам добавит таймер продления.

Прокси для сборки. Directus не отвечает `304` на повторный запрос картинки, и
Astro при каждой сборке заново пережимает все фото: минута вместо нескольких
секунд. Локальный nginx на `127.0.0.1:8056` сверяет `If-Modified-Since` и
отдаёт `304`, если файл не менялся; сборка ходит в Directus через него:

```bash
mkdir -p /var/cache/nginx/directus-assets && chown www-data: /var/cache/nginx/directus-assets
cp deploy/nginx/directus-build.conf /etc/nginx/sites-available/directus-build
ln -s /etc/nginx/sites-available/directus-build /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
sed -i 's|^DIRECTUS_URL=.*|DIRECTUS_URL=http://127.0.0.1:8056|' /srv/vkus/site/.env
```

### 6. Приёмник вебхука

`hooks.json` берёт секрет из окружения, поэтому `webhook` запускается с
флагом `-template`. Юнит из пакета Ubuntu стартует только при наличии
`/etc/webhook.conf` — условие снимается пустым `ConditionPathExists=`.
`-verbose` пишет вывод сборки в журнал: `journalctl -u webhook`.

```bash
cat >/etc/default/webhook <<'EOF'
HOOK_SECRET=<секрет вебхука, тот же что в pnpm setup>
EOF
chmod 600 /etc/default/webhook
mkdir -p /etc/systemd/system/webhook.service.d
cat >/etc/systemd/system/webhook.service.d/override.conf <<'EOF'
[Unit]
ConditionPathExists=

[Service]
User=deploy
EnvironmentFile=/etc/default/webhook
ExecStart=
ExecStart=/usr/bin/webhook -verbose -nopanic -template -ip 127.0.0.1 -port 9000 -hooks /srv/vkus/site/deploy/webhook/hooks.json
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

Ключ стоит ограничить одной командой выкладки: даже утёкший, он не даст
шелла на сервере.

```
command="cd /srv/vkus/site && git pull --ff-only && deploy/build.sh",restrict ssh-ed25519 AAAA… github-actions
```

### 9. Проверка

1. В админке измените заголовок афиши и сохраните.
2. «Публикация сайта» показывает «Идёт сборка», после перезагрузки страницы —
   «Опубликовано», и `https://vkus-com.ru` показывает новый заголовок.
3. `ls -la /srv/vkus/current` указывает на свежий релиз; вывод сборки —
   `journalctl -u webhook`.

## Эксплуатация

- **Статус сборки**: в админке «Публикация сайта»; при ошибке там же хвост лога.
- **Логи**: `docker compose -f /srv/vkus/site/directus/docker-compose.yml logs -f directus`;
  ночные сборки — `/srv/vkus/build.log`; сборки после сохранения — `journalctl -u webhook`.
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

## Акции: как набирать, чтобы лист не развалился

Секция «Акции» — печатный лист: первая акция по порядку (`sort`) — оттиск с
крупной цифрой, остальные — нумерованный реестр. Форму держит страница, а не
редактор, но три правила набора делают её лучше:

- **Заголовок — до 45 знаков**, одна мысль: «Скидка 20 % на первый заказ».
  Число со знаком `%` в заголовке первой акции страница вынимает и печатает
  крупно (`20 %`), остаток заголовка идёт подписью под ним. Без процента на
  месте цифры встаёт сам заголовок.
- **Текст — одно условие, до 110 знаков.** На странице остаётся первое
  предложение, остальное режется; в реестре — не больше трёх строк.
- **Первая по `sort` — витрина.** Ставьте первой общую акцию с процентом:
  оттиск с цифрой на бумаге и есть то, за что цепляется глаз. Точка задаётся
  полем `place`; пустое поле печатается как «Обе точки».

Окна показа (`show_from` / `show_until`) работают как прежде: вне окна акция
не собирается, ночной крон пересобирает сайт в 00:10.

Поля `yandex_score`, `yandex_ratings`, `yandex_reviews`, `yandex_highlights`
в «Настройках» страница больше не показывает: цифры спорили с живым виджетом
Яндекс Карт, а источник у отзывов один — виджет. Заполнять их не нужно;
`yandex_award` («Хорошее место 2026») по-прежнему печатается.

## Локальная разработка

```bash
cd directus && cp .env.example .env    # заполнить SECRET, DB_PASSWORD, ADMIN_*
docker compose up -d
cd .. && cp .env.example .env          # DIRECTUS_URL=http://localhost:8055
pnpm setup                             # нужен DIRECTUS_ADMIN_TOKEN, см. выше
pnpm fixture                           # выгрузить контент в фикстуру
pnpm dev                               # http://127.0.0.1:4321
```

Без `DIRECTUS_URL` в `.env` сайт собирается из `src/data/fixture.json`; файлы
фикстуры в `src/data/fixture-files/` лежат в git, поэтому сборка проходит на
чистом клоне и на CI без Directus. `pnpm fixture` их перезаписывает — после
правок контента в админке изменения в этой папке коммитятся вместе с
`fixture.json`. `public/media/` из них собирает `prebuild`, она в `.gitignore`.
