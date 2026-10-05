#!/bin/bash
set -euo pipefail
release="/opt/demo-day-voting/release-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 755 "$release"
tar -xzf /root/demo-day-deploy/app.tar.gz -C "$release"
cd "$release"
npm ci --omit=dev --ignore-scripts
chown -R root:root "$release"
chmod -R go-w "$release"
if [ ! -f /var/lib/demo-day-voting/db.json ]; then
    install -o demo-day -g demo-day -m 640 /root/demo-day-deploy/initial-db.json /var/lib/demo-day-voting/db.json
fi
if [ ! -f /etc/demo-day-voting.env ]; then
    install -o root -g root -m 600 /root/demo-day-deploy/production.env /etc/demo-day-voting.env
fi
/usr/local/sbin/demo-day-backup
ln -sfn "$release" /opt/demo-day-voting/current
systemctl enable demo-day-voting
systemctl restart demo-day-voting
sleep 2
systemctl is-active demo-day-voting
curl --fail --silent --show-error http://127.0.0.1:3100/api/public -o /dev/null
echo "Deployed $release"
