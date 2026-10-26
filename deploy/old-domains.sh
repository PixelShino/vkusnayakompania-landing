#!/usr/bin/env bash
# Old domains → vkus-com.ru. Run on the server as root (sudo), repeatable:
#   sudo /srv/vkus/site/deploy/old-domains.sh
# 1) installs the maps and the http server blocks (work before DNS moves);
# 2) for each domain whose A records already point here, issues the Let's Encrypt
#    certificate (webroot) and enables the https block. Run again after DNS changes.
# Старые домены → vkus-com.ru. Запускать на сервере от root (sudo), повторно безопасно:
# 1) ставит карты и http-блоки (работают ещё до переезда DNS);
# 2) для каждого домена, чьи A-записи уже смотрят сюда, выпускает сертификат
#    Let's Encrypt (webroot) и включает https-блок. После смены DNS запустить ещё раз.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/nginx/old-domains"
MY_IP="$(curl -s -4 --max-time 10 https://ifconfig.me || hostname -I | awk '{print $1}')"
install -d /etc/nginx/snippets/old-domains /var/www/letsencrypt
install -m 644 "$SRC/vkusdostavka.map" "$SRC/vkusnayakompania.map" /etc/nginx/snippets/old-domains/
install -m 644 "$SRC/20-old-domains-map.conf" /etc/nginx/conf.d/20-old-domains-map.conf
install -m 644 "$SRC/old-domains-http.conf" /etc/nginx/sites-available/old-domains-http
ln -sf /etc/nginx/sites-available/old-domains-http /etc/nginx/sites-enabled/old-domains-http
nginx -t && systemctl reload nginx
echo "http-редиректы установлены (карты: $(grep -c '^"' /etc/nginx/snippets/old-domains/vkusdostavka.map) + $(grep -c '^"' /etc/nginx/snippets/old-domains/vkusnayakompania.map) адресов)"
for host in vkusdostavka.shop vkusnayakompania.ru; do
  ok=1
  for name in "$host" "www.$host"; do
    got="$(getent ahostsv4 "$name" | awk '{print $1}' | sort -u | tr '\n' ' ')"
    case " $got" in *" $MY_IP "*) ;; *) ok=0; echo "$name → ${got:-нет записи}: ещё не сюда ($MY_IP)";; esac
  done
  if [ "$ok" = 1 ]; then
    if [ ! -f "/etc/letsencrypt/live/$host/fullchain.pem" ]; then
      certbot certonly --webroot -w /var/www/letsencrypt -d "$host" -d "www.$host" --non-interactive --agree-tos --keep-until-expiring
    fi
    install -m 644 "$SRC/$host-https.conf" "/etc/nginx/sites-available/$host-https"
    ln -sf "/etc/nginx/sites-available/$host-https" "/etc/nginx/sites-enabled/$host-https"
    nginx -t && systemctl reload nginx
    echo "$host: https-редирект включён"
  else
    echo "$host: https пока без сертификата — повторить после смены DNS"
  fi
done
