#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx ca-certificates curl xz-utils ufw unattended-upgrades
if ! id demo-day >/dev/null 2>&1; then useradd --system --home-dir /var/lib/demo-day-voting --shell /usr/sbin/nologin demo-day; fi
install -d -o demo-day -g demo-day -m 750 /var/lib/demo-day-voting
install -d -m 750 /var/backups/demo-day-voting
install -d -m 755 /opt/demo-day-voting /var/www/demo-day-acme
cd /root/demo-day-deploy
version=v24.21.0
archive="node-${version}-linux-x64.tar.xz"
curl --fail --show-error --silent --location "https://nodejs.org/dist/${version}/${archive}" --output "$archive"
curl --fail --show-error --silent --location "https://nodejs.org/dist/${version}/SHASUMS256.txt" --output SHASUMS256.txt
grep " ${archive}$" SHASUMS256.txt | sha256sum --check --status
tar -xJf "$archive" -C /opt
ln -sfn "/opt/node-${version}-linux-x64/bin/node" /usr/local/bin/node
ln -sfn "/opt/node-${version}-linux-x64/bin/npm" /usr/local/bin/npm
node --version
install -m 644 nginx-initial.conf /etc/nginx/sites-available/demo-day-voting
ln -sfn /etc/nginx/sites-available/demo-day-voting /etc/nginx/sites-enabled/demo-day-voting
if [ -L /etc/nginx/sites-enabled/default ]; then unlink /etc/nginx/sites-enabled/default; fi
nginx -t
systemctl enable --now nginx
systemctl reload nginx
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
certbot certonly --webroot -w /var/www/demo-day-acme -d 194-87-103-89.sslip.io --non-interactive --agree-tos --register-unsafely-without-email
install -m 644 nginx.conf /etc/nginx/sites-available/demo-day-voting
install -m 755 renew-nginx.sh /etc/letsencrypt/renewal-hooks/deploy/demo-day-nginx
nginx -t
systemctl reload nginx
install -m 644 demo-day-voting.service /etc/systemd/system/demo-day-voting.service
install -m 755 backup.sh /usr/local/sbin/demo-day-backup
install -m 644 demo-day-backup.service /etc/systemd/system/demo-day-backup.service
install -m 644 demo-day-backup.timer /etc/systemd/system/demo-day-backup.timer
systemctl daemon-reload
systemctl enable --now certbot.timer demo-day-backup.timer
install -m 644 ssh-hardening.conf /etc/ssh/sshd_config.d/00-demo-day.conf
sshd -t
systemctl reload ssh
echo 'Host bootstrap complete'
