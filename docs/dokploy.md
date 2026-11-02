# Deploy Haven with Docker / Dokploy

Haven uses one container for the built web app, API, and reminder scheduler. SQLite, photos, settings, and reminder history live together in `/data`. Keep **one running instance**, on one server, with a persistent local volume. No separate database container is needed.

Haven has no login: anyone who can reach it can read/change inventory, download backups, reset the database, and invoke configured AI/email integrations. Use your private network/VPN or an access gate at the reverse proxy before exposing it outside your household. HTTPS alone does not restrict access. No authentication is added by this packaging.

## Dokploy setup

1. Make the current source available in the Git repository that Dokploy will build. Local uncommitted files are not included in a Git deployment.
2. Create a **Docker Compose** service in your Dokploy project, connect that repository/branch, and use `docker-compose.yml` at the repository root. Choose **Docker Compose**, rather than Stack: this configuration builds the image from source.
3. In **Environment**, set your address and any optional server credentials:

   ```dotenv
   APP_BASE_URL=https://haven.example.com
   OPENAI_API_KEY=
   OPENAI_MODEL=gpt-6-luna
   OPENAI_TRANSCRIBE_MODEL=gpt-transcribe
   SMTP_HOST=
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=
   SMTP_PASS=
   SMTP_FROM=
   ```

   Use the full browser origin, without a path or trailing slash. Empty credentials leave integrations unavailable. Compose explicitly passes these values into the container; Dokploy's environment editor supplies the interpolation values. Credentials are runtime values and never build arguments.

4. In **Domains**, add your hostname and route it to service **`haven`**, container port **`3000`**, path **`/`**. Enable HTTPS and your certificate provider. Let Dokploy terminate TLS; leave `TLS_CERT` and `TLS_KEY` unset in the container. No host port needs publishing: Dokploy routes to the service internally.
5. Deploy, then visit `/api/health` on the configured address; it should return `{"ok":true}`. Check the dashboard and Settings. A fresh volume starts **empty**; sample inventory is only loaded by the explicit action in Settings.
6. In Settings, confirm **App address** matches your deployed URL before making bucket QR labels or sending reminders. `APP_BASE_URL` initializes fresh/reset settings; changing the environment does not overwrite an address already saved in SQLite. Configure the household timezone and email recipients explicitly.

Dokploy documents [Compose setup and environment handling](https://docs.dokploy.com/docs/core/docker-compose) and [domain routing](https://docs.dokploy.com/docs/core/docker-compose/domains).

### Using a Dokploy Application

Haven also supports the same deployment approach as TV Dinner: create an Application connected to this repository, use the root `Dockerfile`, route your domain to port **3000**, and add a persistent volume in Storage. Mount it at `/data` and set `DATA_DIR=/data` along with `APP_BASE_URL` and any optional credentials above. Redeploy after changing environment variables or mounts.

If your existing volume is mounted at `/app/data`, keep that volume and set `DATA_DIR=/app/data` instead. The mount path and `DATA_DIR` must refer to the same directory. The development example's `DATA_DIR=./data` resolves to `/app/data` in this image and overrides the Dockerfile's `/data` default.

## Persistent storage and updates

`haven-data` mounts at `/data`. Compose scopes its actual volume name to the project. Keep the same Dokploy service/project and volume across redeployments. Rebuild/redeploy replaces the container and preserves the volume. Do not delete the volume or run `docker compose down --volumes` unless you intend to erase all saved data. On a multi-server setup, keep Haven on the server holding its volume.

Like TV Dinner, the container runs as root so existing root-owned Dokploy volumes are writable without a separate ownership repair. A volume mounted read-only or storage with host-side restrictions still needs those restrictions resolved. Keep SQLite's database, WAL/SHM files, and `uploads/` together. The image contains no local `.env`, database, photos, certificates, or Git history.

Download a backup from Settings before updates. No reset/reseed runs on container startup. The existing disposable-schema policy still applies: an incompatible future schema fails startup and requires an intentional fresh database; this packaging does not introduce migrations.

## Moving existing inventory

Your Mac's inventory is **not** copied into the image. Use **Settings → Download backup** to export it. The ZIP contains data and photos, but not credentials. Keep it private.

The image includes the existing restore CLI. On the Docker host, with an image built from this repository, restore into a **new, empty named volume** before attaching it to Haven:

```sh
docker build -t prepper-app:local .
docker volume create haven-import
docker run --rm --init \
  --mount type=volume,source=haven-import,target=/data \
  --mount type=bind,source=/absolute/path/haven-backup.zip,target=/backup.zip,readonly \
  prepper-app:local \
  node --import tsx server/restore.ts /backup.zip /data
```

The CLI rejects nonempty destinations and incompatible backups. Stop the existing Haven container before switching volumes. In `docker-compose.yml`, replace the bottom volume declaration with:

```yaml
volumes:
  haven-data:
    external: true
    name: haven-import
```

Redeploy on that same Docker host. Verify inventory/photos and update the saved App address in Settings to the new URL; restored settings retain the old address and recipients. Keep only one active household instance to avoid duplicate reminder emails. Record this volume customization in your deployment configuration so future updates keep it.

## Local Docker check

```sh
docker build -t prepper-app:local .
pnpm test:container
```

The smoke test uses a uniquely named temporary container and root-owned volume, checks production assets, native SQLite/image processing, backup download, health, graceful shutdown, and persistence after replacing the container with the volume at `/app/data`, then removes only its test resources. It never mounts your normal `data/` directory. Pass another image tag with `pnpm test:container IMAGE`.

To run the image locally:

```sh
docker run --detach --name haven --init --restart unless-stopped \
  --publish 127.0.0.1:3000:3000 \
  --mount type=volume,source=haven-local-data,target=/data \
  --env APP_BASE_URL=http://localhost:3000 \
  prepper-app:local
```

Open [localhost:3000](http://localhost:3000). Optional credentials can be passed with additional `--env` arguments. Stop this instance with `docker stop haven`; the named volume persists.
