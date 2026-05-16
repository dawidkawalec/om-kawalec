# Deployment — kawalec-vps (Hetzner)

Production deploy of Kawalec Command Center to `cc.kawalec.pl`. Single host shared with the rest of the Kawalec stack; the host already runs a central `caddy` container (`kawalec/caddy-geoip2`) terminating TLS for every `*.kawalec.pl` subdomain.

## Architecture

```
                                    Hetzner kawalec-vps (46.62.154.186)
                                    ───────────────────────────────────
   internet                         ┌────────────────┐
   ────────▶ :80/:443 ─────────────▶│  caddy (host)  │  Let's Encrypt for *.kawalec.pl
                                    │                │  /root/stacks/caddy/Caddyfile
                                    └────────┬───────┘
                                             │  reverse_proxy   network "proxy" (external)
                                             ▼
                              ┌──────────────────────────────┐
                              │  cc-app  (Next.js + OM)      │ :3000 (internal only)
                              └─────┬──────┬──────────┬──────┘
                                    │      │          │
                                    ▼      ▼          ▼
                              ┌────────┐ ┌─────┐ ┌────────────┐
                              │ postgres│ │redis│ │ meilisearch│   (network "default", private)
                              └────────┘ └─────┘ └────────────┘
```

`cc-app` joins both networks: `default` (talks to postgres/redis/meili) and `proxy` (reached by Caddy via the `cc-app` alias). Postgres/Redis/Meili stay on `default` only.

## Prerequisites

Already in place on `kawalec-vps`:
- Docker 29.x + Compose v2
- Central Caddy at `/root/stacks/caddy/` listening on `:80`/`:443`
- External Docker network `proxy`
- DNS: `cc.kawalec.pl` and `www.cc.kawalec.pl` resolve to `46.62.154.186`

You as deploy operator need root SSH (`kawalec-vps`) and write access to the repo.

## First-time deploy

```bash
ssh kawalec-vps

# 1. Pull the stack into the standard location.
cd /root/stacks
git clone https://github.com/dawidkawalec/om-kawalec.git command-center
cd command-center

# 2. Fill secrets. Generate strong values inline:
cp .env.production.example .env
$EDITOR .env
#   APP_URL=https://cc.kawalec.pl
#   ADMIN_EMAIL=...
#   POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
#   JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
#   AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
#   TENANT_DATA_ENCRYPTION_KEY=$(openssl rand -base64 48 | tr -d '\n')
#   MEILISEARCH_MASTER_KEY=$(openssl rand -hex 32)
#   MEILISEARCH_API_KEY=$(openssl rand -hex 32)
#   GOOGLE_GENERATIVE_AI_API_KEY=... (from aistudio.google.com/app/apikey)
#   OM_INIT_SUPERADMIN_EMAIL=info@craftweb.pl
#   OM_INIT_SUPERADMIN_PASSWORD=$(openssl rand -base64 24)

# 3. Build + start. First boot runs `INIT_COMMAND` which chains
#    `yarn initialize && yarn mercato kawalec setup-crm` so the tenant,
#    pipeline, and overlay arrive automatically.
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f app   # follow until "App runtime at..."

# 4. Wire the public hostname into the central Caddy.
$EDITOR /root/stacks/caddy/Caddyfile
# Append (mirroring the crm.kawalec.pl block):
#
#   cc.kawalec.pl {
#       reverse_proxy cc-app:3000
#   }
#
#   www.cc.kawalec.pl {
#       redir https://cc.kawalec.pl{uri} permanent
#   }

# 5. Reload Caddy in-place (no downtime).
docker exec caddy caddy reload --config /etc/caddy/Caddyfile

# 6. Verify.
curl -sSI https://cc.kawalec.pl/ | head -5
```

Open `https://cc.kawalec.pl` and log in with `OM_INIT_SUPERADMIN_EMAIL` / `OM_INIT_SUPERADMIN_PASSWORD` from `.env`.

## Upgrade flow

```bash
ssh kawalec-vps
cd /root/stacks/command-center
git pull origin main
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d app
docker compose -f docker-compose.prod.yml logs -f app
```

`init-or-migrate.sh` runs `yarn db:migrate` on every restart after the marker exists; `kawalec setup-crm` is idempotent and safe to re-run manually:

```bash
docker compose -f docker-compose.prod.yml exec app yarn mercato kawalec setup-crm
```

## Re-running the Kawalec overlay manually

Use when seeding a new tenant, after editing `src/modules/kawalec/cli.ts`, or to repair after manual DB edits.

```bash
docker compose -f docker-compose.prod.yml exec app yarn mercato kawalec setup-crm
# Pass --tenant <id> --org <id> to target a specific scope.
```

## Caddy vhost reference

Centralized in `/root/stacks/caddy/Caddyfile`. Our block:

```caddy
cc.kawalec.pl {
    reverse_proxy cc-app:3000
}

www.cc.kawalec.pl {
    redir https://cc.kawalec.pl{uri} permanent
}
```

Reload after edits: `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`. Caddy obtains certs from Let's Encrypt automatically on first request to the new host.

## Backups

Recommended cron on the VPS, dumps to external S3-compatible storage. Sample:

```bash
# /root/backups/cc-backup.sh — run daily via cron.
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%Y%m%dT%H%M%S)
OUT=/root/backups/command-center
mkdir -p "$OUT"

# Postgres dump.
docker compose -f /root/stacks/command-center/docker-compose.prod.yml \
  exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "$OUT/db-$TS.dump"

# Attachments storage.
docker run --rm \
  -v command-center_attachments_storage:/data:ro \
  -v "$OUT:/backup" \
  alpine tar czf "/backup/storage-$TS.tar.gz" -C /data .

# Push to S3 (configure rclone separately).
rclone copy "$OUT/db-$TS.dump"        kawalec-backups:command-center/
rclone copy "$OUT/storage-$TS.tar.gz" kawalec-backups:command-center/

find "$OUT" -type f -mtime +14 -delete
```

Restore drill (test on a staging copy quarterly):

```bash
# Postgres.
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < db-XYZ.dump

# Attachments.
docker run --rm \
  -v command-center_attachments_storage:/data \
  -v "$(pwd):/backup:ro" \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/storage-XYZ.tar.gz -C /data"
```

## Day-2 operations

| Task | Command |
|------|---------|
| Live logs | `docker compose -f docker-compose.prod.yml logs -f app` |
| Restart app | `docker compose -f docker-compose.prod.yml restart app` |
| Open psql | `docker compose -f docker-compose.prod.yml exec postgres psql -U $POSTGRES_USER $POSTGRES_DB` |
| Force re-init (DANGER, wipes init marker) | `docker compose -f docker-compose.prod.yml exec app rm /tmp/init-marker/.seeded && docker compose -f docker-compose.prod.yml restart app` |
| Rotate secrets | Update `.env`, then `docker compose -f docker-compose.prod.yml up -d --force-recreate app` |
| List Caddy routes | `docker exec caddy caddy adapt --config /etc/caddy/Caddyfile --pretty | head -200` |
| Caddy logs | `docker logs --tail 200 caddy` |

## Troubleshooting

- **Caddy can't get a cert:** verify DNS resolves (`dig +short cc.kawalec.pl`), port 80 reachable from the internet (it goes through host Caddy, not our app), `docker logs caddy` shows the ACME challenge attempt.
- **`cc-app` is missing in Caddy upstream resolution:** check `docker inspect cc-app --format '{{json .NetworkSettings.Networks}}'` — must include `proxy`. If not, the compose file lost the `networks: - proxy` entry.
- **App crashes on first boot with `TENANT_DATA_ENCRYPTION_KEY` missing:** generate `openssl rand -base64 48`, paste into `.env`, recreate.
- **Migrations stuck:** check `docker compose logs app`. Manual run: `docker compose exec app yarn db:migrate`.
- **Pipeline stages still show OM defaults after re-init:** re-run `docker compose exec app yarn mercato kawalec setup-crm`. `INIT_COMMAND` chains it on first boot, but a partial boot can skip it.
- **Conflict with Twenty on port 3000:** none expected — Twenty exposes 3000 on the host (`0.0.0.0:3000`), our `cc-app` exposes 3000 only inside the `proxy` Docker network. Confirm with `ss -tlnp | grep 3000` (should still be Twenty alone).
