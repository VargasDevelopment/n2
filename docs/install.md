# Install and run

N2 runs on one machine and stores everything in one SQLite file. There are two ways to run it:

- **Docker Compose** builds an image and runs the web interface and API on one port.
- **From source** runs the development servers with live reload.

Both start with an empty data directory. On first start N2 creates a new library with a starter
Project.

N2 has no login. Keep it on localhost. See [SECURITY.md](../SECURITY.md).

## Docker Compose

Requires Docker with Compose v2.

```bash
git clone https://github.com/VargasDevelopment/n2.git
cd n2
N2_BUILD_COMMIT=$(git rev-parse HEAD) docker compose up -d --build
```

Open <http://localhost:4317>. Check that it is healthy:

```bash
curl http://127.0.0.1:4317/health
```

It answers with `{"ok":true,"schemaVersion":<n>,"commit":"<commit>"}`.

### What the Compose file sets up

- One container running `node dist/selfhost.js`, which serves the web interface and the API on
  port 4317.
- The port is published on `127.0.0.1` only. Other machines cannot reach it.
- A Docker volume named `n2_n2-data` (`n2-data` in the Compose file; the project is named `n2`),
  mounted at `/data`. The library is `/data/n2.sqlite`. Backups go to `/data/backups`. To run a
  second, separate install, give it its own project name and port, for example
  `N2_PORT=5317 docker compose -p n2-work up -d --build`. Use the same `-p` and `N2_PORT` for every
  later command for that install. Its volume is then `n2-work_n2-data`.
- The server runs as user ID 1000, not root. It restarts unless you stop it.

### Settings

Set these in your shell or in a `.env` file next to `compose.yaml`:

| Variable          | Default | Meaning                                                                                                                                                                 |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `N2_PORT`         | `4317`  | Port on your machine. N2 is at `http://localhost:<port>`.                                                                                                               |
| `N2_BUILD_COMMIT` | `local` | Build label. The web page compares it with the server's to tell an open tab that N2 was upgraded. Set it to the current commit so every upgrade gets a different label. |

| `N2_ALLOWED_HOSTS` | empty | Extra host names N2 answers to, separated by commas, for example `n2.home.arpa`. See below. |

For example, to use port 5317:

```bash
N2_PORT=5317 N2_BUILD_COMMIT=$(git rev-parse HEAD) docker compose up -d --build
```

### Everyday commands

```bash
docker compose ps                # status and health
docker compose logs -f n2        # logs
docker compose stop              # stop
docker compose start             # start again
docker compose exec n2 node cli/index.js project list --pretty
```

`docker compose down` removes the container but keeps the `n2-data`
volume. `down -v` **deletes the volume and your library**.

### Upgrade

Take a backup, then rebuild from the new code. The server updates the database schema when it
starts.

```bash
docker compose exec n2 node dist/backup.js
git pull
N2_BUILD_COMMIT=$(git rev-parse HEAD) docker compose up -d --build
```

Schema updates only go forward. An older version refuses to open a library that a newer version
has updated, so going back means restoring a backup taken before the upgrade.

### Roll back to an older version

Restore with the **older** image. The restore steps use whatever image is built, and the newer
image would update the restored library's schema again when it starts. So build the older image
first:

```bash
docker compose exec n2 ls /data/backups   # note the pre-upgrade backup
docker compose stop n2
git checkout <older commit or tag>
N2_BUILD_COMMIT=$(git rev-parse HEAD) docker compose build
```

Then follow [Restore](backup-restore.md#restore) with that backup. Its last step, `up -d n2`,
recreates the container from the older image. Check that `curl http://127.0.0.1:4317/health`
reports the older commit. Do not start N2 between the build and the restore.

## From source

Requires:

- Node.js 24 or newer
- pnpm 10.12 or newer
- Python 3, make and a C++ compiler. pnpm runs `node-gyp` when it installs the `better-sqlite3`
  package, and `node-gyp` needs them. On Debian or Ubuntu: `sudo apt install python3 make g++`.
  On macOS: `xcode-select --install`.

```bash
git clone https://github.com/VargasDevelopment/n2.git
cd n2
pnpm install
pnpm dev
```

`pnpm dev` starts two processes:

- the API at `http://127.0.0.1:4317`
- the web interface at <http://localhost:4318>. It forwards `/api` and `/health` to the API.

The library is created at `.data/n2.sqlite` in the checkout. Both servers listen on `127.0.0.1`
only.

To run the API without the web interface, for example for agents only:

```bash
pnpm --filter @n2/server dev
```

### Settings

| Variable                 | Default                      | Used by  | Meaning                                                                 |
| ------------------------ | ---------------------------- | -------- | ----------------------------------------------------------------------- |
| `N2_PORT`                | `4317`                       | API, web | API port. The web dev server forwards API requests to it.               |
| `N2_WEB_PORT`            | `4318`                       | web      | Web dev server port.                                                    |
| `N2_DB_PATH`             | `<checkout>/.data/n2.sqlite` | API      | Library file. Use an absolute path. Its folder is created if missing.   |
| `N2_REQUIRE_EXISTING_DB` | unset                        | API      | Set to `1` to refuse to start unless the file is already an N2 library. |

For example, to run a second copy next to the default one:

```bash
N2_PORT=5317 N2_WEB_PORT=5318 N2_DB_PATH=$HOME/n2-second/n2.sqlite pnpm dev
```

### Upgrade

Stop `pnpm dev`, back up (see [Backup and restore](backup-restore.md)), then:

```bash
git pull
pnpm install
pnpm dev
```

To roll back, stop `pnpm dev`, run `git checkout <older commit or tag>` and `pnpm install`, then
follow the from-source [Restore](backup-restore.md#restore-1) with a backup taken before the
upgrade. Its last step starts the older code.

## Agent CLI settings

The CLI (`pnpm --silent n2 ...` from source, or `node cli/index.js ...` in the container) reads:

| Variable        | Default                 | Meaning                                        |
| --------------- | ----------------------- | ---------------------------------------------- |
| `N2_API_URL`    | `http://127.0.0.1:4317` | Where the N2 API is. Same as `--api-url`.      |
| `N2_PROJECT_ID` | `default`               | Project to use. Same as `--project`.           |
| `N2_TIMEOUT_MS` | `10000`                 | Request timeout. Same as `--timeout-ms`.       |
| `N2_AGENT_NAME` | `cli`                   | Name that changes are credited to in activity. |

With the Compose defaults, the CLI from a source checkout reaches the container without any
settings, because both use port 4317.

## Allowed host names

The self-host server (Compose) only answers requests addressed to `localhost`, `127.0.0.1` or
`[::1]`, on any port. Requests for any other host name get `403`. This stops a web page from
reaching N2 by pointing its own domain at your machine (DNS rebinding). Browser writes must also
come from the same host and port they are sent to.

If you deliberately serve N2 under another name, for example through your own authenticating
proxy, list that exact name, without a port, in `N2_ALLOWED_HOSTS`:

```bash
N2_ALLOWED_HOSTS=n2.home.arpa N2_BUILD_COMMIT=$(git rev-parse HEAD) docker compose up -d --build
```

Wildcards are not supported. The development servers started by `pnpm dev` do not have this
check.

## Using N2 from another device

N2 is built for one person on one machine and has no login. If you want to reach it from another
device, use a connection that already authenticates you, such as an SSH tunnel:

```bash
ssh -L 4317:127.0.0.1:4317 you@your-n2-machine
```

Then open <http://localhost:4317> on that device. Do not publish the port on a public or shared
network.

## If the first start was interrupted

On its first start N2 creates the library file, then sets it up. If that first start is stopped in
between, an empty `n2.sqlite` is left behind. Later starts refuse it with
`Refusing authoritative N2 database`, because N2 never treats an unknown file as a library.

Only when this was a brand-new install with no data yet: stop N2, move `n2.sqlite` and any
`n2.sqlite-wal` or `n2.sqlite-shm` files aside, then start N2 again. With Docker Compose:

```bash
docker compose stop n2
docker compose run --rm --no-deps -T n2 sh -ec 'mkdir /data/aside && for f in /data/n2.sqlite /data/n2.sqlite-wal /data/n2.sqlite-shm; do if [ -e "$f" ]; then mv "$f" /data/aside/; fi; done'
docker compose start n2
```

If the file is not empty, it is not an interrupted first start. Restore from a backup instead
(see [Backup and restore](backup-restore.md)).
