# Haven · Prepper App

A local household inventory for food, water, fuel, dog food, and other emergency supplies. React + Vite, a Node/Fastify API, and SQLite. No account or external database required.

## Run locally

Use Node 24 LTS and pnpm. Node 26 is also supported and has been checked on this Mac. This workspace includes an ignored project-local Node 24 fallback at `.local/pnpm/bin/node`.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Open [localhost:5173](http://localhost:5173). The API runs on port 3001. Vite proxies API and photo requests, so the frontend and API appear under one browser origin. For another device, use the network address printed by Vite. The Node computer must stay running.

For a single-process local build:

```sh
pnpm build
pnpm start
```

Then open [localhost:3001](http://localhost:3001). Update the app address in Settings before making QR labels. Docker/Dokploy packaging and S3 scheduling are deferred.

## Sample data and fresh starts

Settings → **Reset & sample data** has two explicitly confirmed actions:

- **Reset to empty:** clears inventory, settings, locations, buckets, photos, adjustment history, and reminder history. Restores the two default empty locations and household defaults.
- **Reset & load sample data:** clears the same information, then loads a fictional household across every category, 12 buckets, sample illustrations, quantities, nutrition, dates, reminders, and incomplete records.

Sample planning values are examples, not personal recommendations. Sample email recipients are blank; no email is sent. Delivery history contains explicitly named fictional sent/failed records to preview that screen. A persistent banner identifies the sample database. Resetting clears recipients stored in SQLite, but never edits server credentials in `.env`.

During this prototype phase there is **one disposable schema**, `server/schema.sql`, and no migration history. When changing the SQL schema incompatibly, stop the server, move or remove the configured data directory, then start fresh and reseed in Settings. Keep backups only when you want to preserve a particular snapshot; compatibility with changed prototype schemas is not guaranteed.

## Inventory behavior

- Food catalogs hold nutrition and common details. Purchase batches hold purchase, best-by, and expiration dates. Individual stock units hold remaining quantities, packaging, storage, rotation, and reminder preferences.
- Splitting a batch subtracts the assigned quantity from its original unit and creates bags sharing the same batch. Totals are conserved. A zero-quantity original stays in history and is hidden unless **Show empty** is enabled.
- Buckets are reusable containers, not additional food. Each has a permanent number (01–12 in setup, then 13 onward); nicknames and locations can change without changing the number or QR link. Numbers are assigned on the server, sorted numerically, and never reused within a database. A full reset starts numbering over.
- Locations such as Garage, Attic, or Closet can contain standalone resources and buckets. Storage & buckets lets you browse everything at a place across categories. A bag follows its bucket’s location, including an unknown location; it never falls back to an old standalone location. Move the bucket once to relocate all its bags without changing quantities.
- Shared catalog/batch edits also update sibling bags and their versions. If another device changes a record before you save, the API returns a conflict and leaves your form intact. Copy important unsaved edits, close the form, reload the page, and edit the fresh record.
- **Use** and **Refill** adjust quantities; **Set remaining amount** records a stock check. **Rotate** updates the rotation date without assuming the container was refilled. Quantities do not change automatically.
- Gallons on a Mylar bag describe packaging capacity, not food weight. The app converts compatible mass or volume units, and never assumes a food density.
- Calories and macros use recorded serving sizes. Incompatible or missing data is excluded and flagged. Partial coverage means coverage from recorded amounts, not a complete estimate. Dog-food duration uses a measured daily ration in grams; dog food stays out of human calorie totals.
- Household water coverage includes adult and dog water settings. A missing daily need shows **Needs setup**. Rotations use calendar months, clamp to month-end, and respect the configured timezone.
- Best-by, expiration, and rotation dates are distinct. Passing a date does not erase inventory or determine whether an item is safe to use.
- With natural gas off, cooking and generation share each stored fuel reserve. Different fuels have separate runtime estimates. With natural gas available, utility-powered usage does not consume the modeled stored reserve. Fuel rates and runtime hours are planning assumptions that you can edit.

## OpenAI setup

Add `OPENAI_API_KEY` to the server’s `.env`. Defaults are configurable:

```dotenv
OPENAI_MODEL=gpt-6-luna
OPENAI_TRANSCRIBE_MODEL=gpt-transcribe
```

Prompts are plain Markdown in `prompts/`: extraction, description, and transcription context. Restart the API after changing environment variables. Prompt files are read on each request.

Photo library and camera controls upload photos locally. AI assistance sends selected photos and entered facts to OpenAI only when requested. Dictation records up to two minutes and transcribes after you stop. Manual entry remains available without internet or credentials. Unknown AI fields remain blank, and all extracted fields require review. Existing values are not preselected for replacement. No API key is bundled into frontend code.

Photo uploads support JPEG, PNG, WebP, and camera formats supported by the local image library, up to 15 MB. They are rotated, resized, stripped of original metadata, and saved as WebP. If HEIC decoding is unavailable, upload a JPEG instead. Audio uploads are limited to 15 MB. Failed AI requests require an explicit retry; the app does not queue paid requests automatically.

## Camera and microphone on iPad/phone

Microphone capture requires a secure browser context. `localhost` works on the computer itself; accessing a computer’s HTTP LAN address from a phone does not provide that exception. Photo capture uses the operating system’s file/camera picker where supported.

For local HTTPS on this Mac, install `mkcert` and create a certificate for the exact hostname/IP your devices will visit:

```sh
brew install mkcert
mkcert -install
mkdir -p .certs
mkcert -cert-file .certs/local.pem -key-file .certs/local-key.pem localhost 127.0.0.1 ::1 YOUR-MAC.local YOUR-LAN-IP
```

Set in `.env`:

```dotenv
TLS_CERT=.certs/local.pem
TLS_KEY=.certs/local-key.pem
APP_BASE_URL=https://YOUR-MAC.local:5173
```

Install **only the public root certificate** from `mkcert -CAROOT` on your iPhone/iPad and enable full trust in iOS Certificate Trust Settings. Keep the CA private key on the Mac. Restart `pnpm dev`, visit the HTTPS address, and grant microphone permission. Alternatively, use an existing trusted HTTPS reverse proxy later. Keyboard dictation and manual notes remain fallbacks.

## M110 label workflow

Default labels are **50 × 80 mm at 203 dpi**. Set your actual roll dimensions in Settings. Labels narrower than 35 mm or shorter than 40 mm use a compact name, ID, and QR layout; use 50 × 80 mm for quantities and dates. Set a stable LAN app address before printing; `localhost` QR links will not reach your computer from another device.

Select resources in an inventory list, use **Labels**, or make a label from an individual resource. Bucket labels are available from Storage & buckets. QR codes use stable unit or bucket IDs. Bucket labels feature a large permanent number; their links always show current contents; printed quantities and dates on food labels are snapshots and need reprinting after relevant edits.

- **PNG:** one selected label, ready to import as an image into Print Master.
- **PDF:** one accurately sized page per label for a supported desktop/print workflow. Disable fit-to-page scaling.
- **Excel batch:** up to 100 rows, first row headers, plain text with no formulas, merged cells, or embedded images. Import the first worksheet through Print Master’s Excel batch workflow. Map **QR URL** to a QR-code element in your saved template. Print Master version and hardware behavior need confirmation on the physical M110.

The app does not directly control Bluetooth or AirPrint. Thermal label longevity depends on the media and storage conditions; readable names and stable IDs remain on labels alongside the QR code.

## Email

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, and optional `SMTP_USER`/`SMTP_PASS` in `.env`. Port 587 normally uses STARTTLS (`SMTP_SECURE=false`); port 465 normally uses implicit TLS (`true`). Add recipients in Settings and use **Send test email**.

- Weekly summary: Monday at 9 a.m. in the selected timezone. Monthly: first day at 9 a.m. A running server queues the summary once per scheduled day, at or after 9 a.m.
- Date alerts: 30, 7, and 0 days; high-priority items also use 90 days. A custom lead time replaces the early threshold while preserving applicable 7-day and due-date alerts.
- On first noticing an already-crossed threshold, only the most urgent applicable threshold is queued. Outbox keys prevent repeatedly notifying the same threshold.
- Per-item notification switches and snoozes suppress that item’s alerts. Global coverage alerts have their own Settings threshold. No coverage alerts are sent for categories that have never been cataloged.
- SQLite stores queued messages, delivery state, and retries across restarts. Retries back off and stop after eight failures. Retry failed deliveries from Settings. Changed dates, removed recipients, disabled alerts, and snoozes cancel obsolete pending messages.
- The scheduler runs once per minute while the API process runs. It does not send missed historical summaries after their scheduled day. SMTP cannot guarantee exactly-once delivery if the process exits between sending and recording success.

## Backup and restore

Settings → **Download backup** exports a ZIP containing an SQLite backup-API snapshot, uploaded photos, and a version manifest. It excludes `.env` and application code. Photos are retained after removing them from an item until a full database reset, so historical photo references remain recoverable.

Stop the server and restore into a **new or empty folder**:

```sh
pnpm backup:restore /absolute/path/haven-backup.zip /absolute/path/new-data
```

Set `DATA_DIR` to the restored folder and restart. Restoration validates paths, completeness, schema version, and database integrity before replacing the empty destination. The restore size limit is 2 GB. Prototype schema changes can require a reset instead of restoring an older database.

## Verification

```sh
pnpm check
pnpm test
pnpm build
pnpm test:browser
```

Browser tests use installed Google Chrome, isolated `.local/browser-data`, and ports 5199/3101. They cover desktop, phone, and tablet viewport sizes without touching the normal data directory. If Chrome is unavailable, install Playwright Chromium and remove the `channel: 'chrome'` setting. Browser screenshots are saved under `test-results/`.

Live OpenAI photo extraction and file transcription were verified with synthetic fixtures using the configured key. Outbound SMTP, physical M110 printing, and real iOS microphone/camera permissions still need your services/devices to verify. All other inventory operations are designed to work over the local network without external internet.

## Optional live AI check

`pnpm test:ai` makes paid OpenAI calls through the running local API using synthetic label facts. To include speech on macOS, first create the ignored fixture:

```sh
mkdir -p .local/live-check
say -v Samantha -o .local/live-check/speech.aiff "Add twenty pounds of jasmine rice, purchased October twenty seventh, twenty twenty six. Store it in bucket number one."
afconvert -f WAVE -d LEI16 .local/live-check/speech.aiff .local/live-check/dictation.wav
pnpm test:ai
```

This is separate from the automated test suite and creates no inventory records. Uploaded synthetic reference photos are removed on the next reset.
