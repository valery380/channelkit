# Multi-stage Docker build for ChannelKit
#
# Builds from source and creates a minimal production image.
# Auth state is persisted to /root/.channelkit (mount a volume to keep sessions across restarts).
#
# Build:
#   docker build -t channelkit -f docker/Dockerfile .
#
# Run:
#   docker run -d -p 4000:4000 -v channelkit-data:/root/.channelkit channelkit

FROM node:22-slim AS builder

WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Production image ---
FROM node:22-slim

WORKDIR /app

COPY --from=builder /build/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /build/dist/ dist/

COPY docker/entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 4000

CMD ["./entrypoint.sh"]
