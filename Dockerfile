# Stage 1: build the SPA
FROM node:20-alpine AS webbuild
WORKDIR /build
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm ci
COPY shared ./shared
COPY web ./web
RUN cd web && npm run build

# Stage 2: Deno runtime serving API + built SPA
FROM denoland/deno:alpine
WORKDIR /app
COPY deno.json ./
COPY shared ./shared
COPY server ./server
COPY db ./db
COPY --from=webbuild /build/web/dist ./web/dist
RUN deno cache server/main.ts server/migrate.ts
# migrations run on every boot; they are a no-op when already applied
CMD ["sh", "-c", "deno run -A server/migrate.ts && deno run -A server/main.ts"]
