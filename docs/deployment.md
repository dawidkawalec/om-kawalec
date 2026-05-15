# Deployment — kawalec-vps (Hetzner)

Production deploy of Kawalec Command Center to `cc.kawalec.pl` running on the Hetzner VPS `kawalec-vps`. Single host, Docker Compose stack behind Caddy with auto-TLS.

## Architecture

```
            ┌──────────┐
   internet │  Caddy   │ :80 / :443  (TLS via Let's Encrypt)
   ────────▶│          │
            └────┬─────┘
                 │ reverse_proxy
            ┌────▼─────┐
            │   app    │ :3000  (Next.js + OM)
            │          │
            └──┬──┬──┬─┘
               │  │  │
       ┌───────▼─▼─▼─────────────┐
       │ postgres  redis  meili  │  (internal only, no host port)
       └─────────────────────────┘
```

All services live in the `mercato-prod` Docker network. Only Caddy exposes ports 80/443 to the host.

## Prerequisites on the VPS

```bash
# As root or via sudo.
apt update && apt install -y docker.io docker-compose-v2 git
systemctl enable --now docker

# Create a deploy user (avoid running as root).
useradd -m -G docker -s /bin/bash deploy
su - deploy
```

DNS: set an `A` record `cc.kawalec.pl → <vps public IP>` before first start (Let's Encrypt verifies during boot).

## First-time deploy

```bash
# As the deploy user, on kawalec-vps.
cd /home/deploy
git clone git@github.com:kawalec/command-center.git
cd command-center

cp .env.production.example .env
$EDITOR .env   # fill in every CHANGE-ME, generate secrets per file comments

docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d

# Follow the bootstrap. INIT_COMMAND runs:
#   yarn initialize && yarn mercato kawalec setup-crm
# which creates the tenant, default OM seed, and applies the Kawalec overlay.
docker compose -f docker-compose.prod.yml logs -f app
```

Visit `https://cc.kawalec.pl` once Caddy obtains the cert (first issuance is usually <60 s after DNS propagation). Log in with the superadmin credentials from `.env`.

## Upgrade flow

```bash
cd /home/deploy/command-center
git pull origin main
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d app

# Migrations run automatically via init-or-migrate.sh.
# kawalec setup-crm is idempotent — safe to re-run on every boot.
```

## Re-running the Kawalec overlay manually

The CLI is idempotent. Use it when seeding a new tenant, after changing pipeline stages in `src/modules/kawalec/cli.ts`, or to recover from manual DB edits.

```bash
docker compose -f docker-compose.prod.yml exec app yarn mercato kawalec setup-crm
```

Pass `--tenant <id> --org <id>` to target a specific scope; without flags it picks the tenant with most deals.

## Backups

Recommended: cron on the VPS, dumps to external S3-compatible storage.

```bash
# /home/deploy/backups/backup.sh — call from cron @daily.
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%Y%m%dT%H%M%S)
BACKUP_DIR=/home/deploy/backups
mkdir -p "$BACKUP_DIR"

# Postgres dump (compressed).
docker compose -f /home/deploy/command-center/docker-compose.prod.yml \
  exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "$BACKUP_DIR/db-$TS.dump"

# Attachments storage.
docker run --rm \
  -v command-center_attachments_storage:/data:ro \
  -v "$BACKUP_DIR:/backup" \
  alpine tar czf "/backup/storage-$TS.tar.gz" -C /data .

# Push to S3 (configure rclone separately).
rclone copy "$BACKUP_DIR/db-$TS.dump"        kawalec-backups:command-center/
rclone copy "$BACKUP_DIR/storage-$TS.tar.gz" kawalec-backups:command-center/

# Keep 14 days locally.
find "$BACKUP_DIR" -type f -mtime +14 -delete
```

Restore drill (test on a staging copy at least quarterly):

```bash
# Restore Postgres.
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < db-XYZ.dump

# Restore attachments.
docker run --rm \
  -v command-center_attachments_storage:/data \
  -v "$(pwd):/backup:ro" \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/storage-XYZ.tar.gz -C /data"
```

## Day-2 operations

| Task | Command |
|------|---------|
| Live logs | `docker compose -f docker-compose.prod.yml logs -f app caddy` |
| Restart app | `docker compose -f docker-compose.prod.yml restart app` |
| Open psql | `docker compose -f docker-compose.prod.yml exec postgres psql -U $POSTGRES_USER $POSTGRES_DB` |
| Force re-init | `docker compose -f docker-compose.prod.yml exec app rm /tmp/init-marker/.seeded && docker compose -f docker-compose.prod.yml restart app` |
| Rotate secrets | Update `.env`, then `docker compose -f docker-compose.prod.yml up -d --force-recreate app` |

## Troubleshooting

- **Caddy can't get a cert:** check DNS `A` record resolves, port 80 reachable, `caddy logs` shows the ACME challenge.
- **App crashes on first boot with `TENANT_DATA_ENCRYPTION_KEY` missing:** generate `openssl rand -base64 48`, paste into `.env`, recreate.
- **Migrations stuck:** logs in `docker compose logs app`. Manual run: `docker compose exec app yarn db:migrate`.
- **Pipeline stages still show OM defaults:** re-run `docker compose exec app yarn mercato kawalec setup-crm`. The first deploy chains it via `INIT_COMMAND`, but a partial boot can skip it.
