FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1 AS dev
WORKDIR /app

ENV NODE_ENV=development
ENV HOST=0.0.0.0
ENV PORT=3000

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3000

CMD ["bun", "run", "dev"]

FROM oven/bun:1 AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src ./src

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "const port=process.env.PORT||3000; fetch('http://127.0.0.1:' + port + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrate before serving (idempotent via schema_migrations); exec keeps index.ts
# as PID 1 so SIGTERM reaches it for the graceful outbox drain.
CMD ["sh", "-c", "bun run src/migrate.ts && exec bun run src/index.ts"]
