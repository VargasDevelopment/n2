FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@10.12.4
WORKDIR /build
COPY . .
RUN pnpm install --frozen-lockfile
# The web bundle embeds its commit so an open tab can tell when the server has moved on.
ARG N2_BUILD_COMMIT
RUN pnpm --filter @n2/web build && pnpm --filter @n2/cli build && pnpm --filter @n2/server build
RUN pnpm --filter @n2/server deploy --prod --legacy /runtime

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ARG N2_BUILD_COMMIT
RUN test -n "$N2_BUILD_COMMIT"
ENV NODE_ENV=production N2_BUILD_COMMIT=$N2_BUILD_COMMIT
WORKDIR /app
COPY --from=build /build/LICENSE /build/THIRD_PARTY_NOTICES ./
COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /build/apps/server/dist ./dist
COPY --from=build /build/apps/cli/dist ./cli
COPY --from=build /build/apps/web/dist ./public
# Browsers receive bundled third-party code, so the notices are served beside it.
COPY --from=build /build/LICENSE ./public/LICENSE.txt
COPY --from=build /build/THIRD_PARTY_NOTICES ./public/THIRD_PARTY_NOTICES.txt
# A new named volume copies this directory's owner, so the non-root server can write to it.
RUN install -d -o 1000 -g 1000 -m 0700 /data
USER 1000:1000
EXPOSE 4317 4318
CMD ["node", "dist/server.js"]
