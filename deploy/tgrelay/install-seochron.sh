#!/usr/bin/env bash
# Установка ретранслятора Telegram на seochron: пользователь tgrelay + сервис на 127.0.0.1:8787,
# пользователь vkustunnel только для SSH-туннеля с сервера сайта (ключ в $1 — публичный ключ).
set -euo pipefail
PUB=${1:?публичный ключ туннеля}
id -u tgrelay >/dev/null 2>&1 || useradd --system --home /var/lib/tgrelay --shell /usr/sbin/nologin tgrelay
install -d -o tgrelay -g tgrelay -m 750 /var/lib/tgrelay /opt/tgrelay
install -o root -g root -m 755 /tmp/relay.py /opt/tgrelay/relay.py
cat > /etc/systemd/system/tgrelay.service <<'EOF'
[Unit]
Description=Telegram Bot API relay with queue (for vkus-com.ru)
After=network-online.target
Wants=network-online.target

[Service]
User=tgrelay
Group=tgrelay
Environment=TGRELAY_LISTEN=127.0.0.1:8787
Environment=TGRELAY_DB=/var/lib/tgrelay/queue.db
ExecStart=/usr/bin/python3 /opt/tgrelay/relay.py
Restart=always
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/tgrelay
PrivateTmp=yes
MemoryMax=200M

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now tgrelay
sleep 1
systemctl is-active tgrelay
curl -s http://127.0.0.1:8787/health; echo
# пользователь туннеля: только проброс порта 8787, без шелла
id -u vkustunnel >/dev/null 2>&1 || useradd --system --create-home --home /home/vkustunnel --shell /usr/sbin/nologin vkustunnel
install -d -o vkustunnel -g vkustunnel -m 700 /home/vkustunnel/.ssh
echo "restrict,port-forwarding,permitopen=\"127.0.0.1:8787\" $PUB" > /home/vkustunnel/.ssh/authorized_keys
chown vkustunnel:vkustunnel /home/vkustunnel/.ssh/authorized_keys; chmod 600 /home/vkustunnel/.ssh/authorized_keys
# nologin не мешает «ssh -N» (шелл не запрашивается), но на всякий случай разрешим TCP-форвардинг явно
grep -q "Match User vkustunnel" /etc/ssh/sshd_config.d/99-hardening.conf 2>/dev/null || cat >> /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'

Match User vkustunnel
    AllowTcpForwarding local
    PermitOpen 127.0.0.1:8787
    X11Forwarding no
    PermitTTY no
    ForceCommand /bin/false
EOF
sshd -t && systemctl reload ssh
echo "установлено: tgrelay + vkustunnel"
