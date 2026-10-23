# Multi-stage image for backup-dash
#
# Stage 1 (build): dependencies, the SvelteKit build, and the pinned restic
# binary. Stage 2 (runtime): the build output, production deps, restic, ssh.
#
# restic is pinned to 0.18.1 with a checksum on purpose: that is the version the
# 03:30 pipeline writes the repo with, and it matches the image at
# ghcr.io/nickbrett1/um790-backup. Debian slim's package is a different version;
# the host's ~/.local/bin/restic is 0.19.1 and is not what this observes.

ARG RESTIC_VERSION=0.18.1
ARG RESTIC_SHA256=680838f19d67151adba227e1570cdd8af12c19cf1735783ed1ba928bc41f363d

FROM node:22-slim AS build
WORKDIR /app

# bzip2/curl exist only in this stage; neither reaches the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates bzip2 \
    && rm -rf /var/lib/apt/lists/*

ARG RESTIC_VERSION
ARG RESTIC_SHA256
RUN set -eux; \
    curl -fsSL -o /tmp/restic.bz2 \
      "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2"; \
    echo "${RESTIC_SHA256}  /tmp/restic.bz2" | sha256sum -c -; \
    bunzip2 -c /tmp/restic.bz2 > /tmp/restic; \
    chmod 0755 /tmp/restic; \
    /tmp/restic version

COPY package.json package-lock.json* .npmrc* ./
RUN PINNED_NPM="$(node -p "try{require('./package.json').packageManager}catch(e){''}" 2>/dev/null || true)" \
    && if [ -n "$PINNED_NPM" ] && [ "$(npm --version)" != "${PINNED_NPM#npm@}" ]; then \
         echo "Activating pinned ${PINNED_NPM}..."; \
         npm install -g "${PINNED_NPM}" >/dev/null || true; \
       fi \
    && if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
# Link the GHCR container package to its GitHub repo on push. GHCR auto-links
# the package to nickbrett1/backup-dash so it inherits the
# repo's access (public repo -> public package; no manual visibility step).
LABEL org.opencontainers.image.source=https://github.com/nickbrett1/backup-dash

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-client ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

# The pinned restic, installed in the runtime stage (not just build).
COPY --from=build /tmp/restic /usr/local/bin/restic
# Pinned NAS host keys. StrictHostKeyChecking=yes: a NAS rebuild must fail
# loudly and be re-pinned deliberately, not silently trust a new key.
COPY deploy/known_hosts /app/known_hosts
# restic's sftp backend and the plain ssh calls both use this identity.
# No keys are baked in; they arrive read-only at runtime under /secrets.

ENV NODE_ENV=production
ENV KNOWN_HOSTS=/app/known_hosts
COPY --from=build /app/build ./build
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "build/index.js"]
