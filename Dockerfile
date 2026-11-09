# Single deployable app image. Database runs separately (see docker-compose.yml).
FROM node:22-bookworm-slim
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000 UPLOAD_DIR=/data/uploads
RUN mkdir -p /data/uploads && chown -R node:node /data /app/.next
USER node
EXPOSE 3000
# Apply any new migrations, then start. Migrations are versioned and idempotent.
CMD ["sh", "-c", "npm run db:migrate && npm start"]
