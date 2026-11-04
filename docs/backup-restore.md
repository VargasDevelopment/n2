# Backup and restore

Your whole library is one SQLite file: every Project, setting and activity record. N2 has a
backup command that copies it safely while N2 is running. Backups are not automatic. Run the
command yourself or from a scheduler, and copy the results somewhere other than this machine.

## What a backup contains

Each run creates one new directory named after the UTC time plus a random ID:

```text
<backup dir>/20261104T144337975Z-a14000da-c233-4d6e-83bf-74304c2d4f01/
  n2.sqlite       the snapshot: a single, self-contained SQLite file
  manifest.json   checksum and contents summary
```

The command:

1. Checks that the source is an N2 library with a schema this version supports. It refuses
   anything else.
2. Copies the database with SQLite's online backup API. This is safe while N2 is running.
3. Turns the copy into a single file with no write-ahead log, then runs SQLite's
   `integrity_check` and `foreign_key_check`. If either fails, it stops.
4. Writes `manifest.json` with the file's SHA-256 (`file_sha256`), the schema version, row counts
   and digests per table, and a digest of the whole dataset.
5. Builds all of this in a hidden temporary directory and renames it into place only when it is
   complete. A failed run leaves earlier backups untouched.

Files are created with owner-only permissions (`0700` directories, `0600` files). On success it
prints one line of JSON naming the new snapshot:

```json
{ "backup": "/data/backups/<time>-<id>/n2.sqlite", "dataset_sha256": "..." }
```

The command never deletes old backups. Remove ones you no longer want yourself, and always keep
or delete a backup directory as a whole.

## Docker Compose

### Take a backup

```bash
docker compose exec n2 node dist/backup.js
```

Backups go to `/data/backups` in the `n2-data` volume, next to the library. That does not protect
you if the volume or the machine is lost, so copy them out:

```bash
docker compose cp n2:/data/backups ./n2-backups
```

To back up every night at 03:00, add a line like this to your crontab (`crontab -e`). Note the
`-T`: cron has no terminal.

```text
0 3 * * * cd /path/to/n2 && docker compose exec -T n2 node dist/backup.js
```

### Restore

Pick the backup directory name, for example from `docker compose exec n2
ls /data/backups`. Then stop N2, check the snapshot, swap it in and start N2 again:

```bash
BACKUP=<backup directory name>
docker compose stop n2
docker compose run --rm --no-deps -e BACKUP="$BACKUP" n2 sh -ec '
cd /data
expected=$(grep -o "\"file_sha256\": \"[0-9a-f]*\"" "backups/$BACKUP/manifest.json" | cut -d "\"" -f 4)
echo "$expected  backups/$BACKUP/n2.sqlite" | sha256sum -c -
replaced="replaced-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$replaced"
for file in n2.sqlite n2.sqlite-wal n2.sqlite-shm; do
  if [ -e "$file" ]; then mv "$file" "$replaced/"; fi
done
cp "backups/$BACKUP/n2.sqlite" n2.sqlite
' && docker compose up -d n2
curl http://127.0.0.1:4317/health
```

The checksum line must print `OK`. If it does not, the script stops before changing anything and
N2 stays stopped; run `docker compose up -d n2` to start it again with
your current library. The library you replaced, with its `-wal` and `-shm` files if any, is kept
in `/data/replaced-<time>/`. Delete that directory once you are happy with the restore.

### Restore a backup copied out of Docker

If the backup is only on your machine (for example in `./n2-backups`), first put it back into
the volume. This also works on a new machine with a brand-new volume. There, build the image
first, from the checkout:

```bash
N2_BUILD_COMMIT=$(git rev-parse HEAD) docker compose build
```

Then copy the backup directory in:

```bash
BACKUP=<backup directory name>
tar -C n2-backups -c "$BACKUP" | docker compose run --rm --no-deps -T n2 sh -ec 'mkdir -p -m 0700 /data/backups && tar -C /data/backups -x'
```

Then follow [Restore](#restore) above. Its last step creates and starts the N2 container if
there is none yet.

## From source

### Take a backup

The command needs absolute paths. From the root of the checkout:

```bash
pnpm --filter @n2/server build
N2_DB_PATH=$PWD/.data/n2.sqlite N2_BACKUP_DIR=$PWD/.data/backups node apps/server/dist/backup.js
```

If you set `N2_DB_PATH` for `pnpm dev`, use the same path here.

### Restore

Stop `pnpm dev` first, then run this from the root of the checkout. If you set `N2_DB_PATH`, keep it
set so the restore replaces that library:

```bash
BACKUP=.data/backups/<backup directory name> sh -ec '
db=${N2_DB_PATH:-$PWD/.data/n2.sqlite}
expected=$(grep -o "\"file_sha256\": \"[0-9a-f]*\"" "$BACKUP/manifest.json" | cut -d "\"" -f 4)
echo "$expected  $BACKUP/n2.sqlite" | sha256sum -c -
replaced=$(dirname "$db")/replaced-$(date -u +%Y%m%dT%H%M%SZ)
mkdir "$replaced"
for file in "$db" "$db-wal" "$db-shm"; do
  if [ -e "$file" ]; then mv "$file" "$replaced/"; fi
done
cp "$BACKUP/n2.sqlite" "$db"
' && pnpm dev
```

The steps run in their own `sh -e`, so the first failed step stops them. The checksum line must
print `OK`. If it does not, nothing is changed and `pnpm dev` does not start. On macOS, use
`shasum -a 256 -c -` instead of `sha256sum -c -`.

## Things to know

- Restore a backup with the same or a newer N2 version than the one that made it. A newer
  version updates the schema when it starts. An older version refuses a newer schema.
- Never copy `n2.sqlite` by hand while N2 is running. Use the backup command.
- Never pair a restored `n2.sqlite` with `-wal` or `-shm` files left from another database. The
  restore steps above move them aside.
- Only one N2 server should use a library file at a time.
