# syntax=docker/dockerfile:1.7-labs
#
# ohif-viewer para Cloud Run.
#
# Difiere del Dockerfile raíz de OHIF en la segunda etapa: aquel termina en
# nginx sirviendo estáticos, y eso no sirve acá porque hace falta inyectar el
# RELAY_REQUEST_TOKEN del lado del servidor (ver toth/server.mjs). Node sirve
# los mismos estáticos y además hace de proxy, todo en un origen.
#
#   docker build -f toth/Dockerfile -t ohif-viewer .
#
# El contexto es la raíz del repo, no toth/.

FROM node:24-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.5.2

WORKDIR /usr/src/app
ENV PATH=/usr/src/app/node_modules/.bin:$PATH

# Manifiestos primero para que la capa de install se cachee. preinstall.js va
# incluido porque el script "preinstall" de la raíz corre durante pnpm install,
# antes de copiar el resto del código.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc preinstall.js ./
COPY --parents ./extensions/*/package.json ./modes/*/package.json ./platform/*/package.json ./
RUN pnpm install --no-frozen-lockfile

COPY --link --exclude=pnpm-lock.yaml --exclude=package.json . .

ENV QUICK_BUILD=true
ARG APP_CONFIG=config/toth.js
ARG PUBLIC_URL=/
ENV PUBLIC_URL=${PUBLIC_URL}

RUN pnpm run show:config
RUN pnpm run build


FROM node:24-slim AS final

WORKDIR /app
COPY --from=builder /usr/src/app/platform/app/dist ./dist
# server.mjs importa link-token.mjs y api-gate.mjs: olvidar uno deja el
# contenedor muriendo al arrancar con ERR_MODULE_NOT_FOUND.
COPY toth/server.mjs toth/link-token.mjs toth/api-gate.mjs ./

ENV NODE_ENV=production
ENV DIST_DIR=/app/dist
ENV PORT=8080
EXPOSE 8080

# Sin root: Cloud Run no lo exige, pero un proceso que sólo lee archivos y
# reenvía HTTP no tiene por qué correr como root.
USER node

CMD ["node", "server.mjs"]
