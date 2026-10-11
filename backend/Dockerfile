# Build context is the REPOSITORY ROOT, not backend/ — the image now contains
# the built frontend as well as the API, so the build needs both directories.
# compose.prod.yml and the CI build step both set `context: .` for this reason.
#
# One image rather than two, and Express serves the static files rather than
# Caddy. Caddy already reverse-proxies the whole hostname to this container, so
# a separate frontend container would mean a second image to build, tag, pull
# and keep in step with this one — for a page load that is a handful of files
# on a box with one app and thirty concurrent users. Same origin also means no
# CORS configuration to get wrong, and no second deploy that can land out of
# order with the API it talks to.

# ---- frontend build ----
FROM node:26-slim AS client

WORKDIR /client

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---- backend build ----
FROM node:26-slim AS build

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./
RUN npm run build

# ---- runtime ----
FROM node:26-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations

# app.ts resolves this as ../client relative to dist/, and serves the pages
# only if index.html is present — so a backend-only build still runs, it just
# answers the page routes with a 404 instead of HTML.
COPY --from=client /client/dist ./client

USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]
