FROM node:20-slim

# Install system dependencies + python3 (required by yt-dlp binary)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp via pip (most reliable method)
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && yt-dlp --version

# Configure yt-dlp: use Node.js as JS runtime + android client to avoid bot detection
RUN mkdir -p /root/.config/yt-dlp && \
    printf '--js-runtimes node\n--extractor-args youtube:player_client=android,web\n' \
    > /root/.config/yt-dlp/config

WORKDIR /app

# Install Node dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Directories that need to exist at runtime (will also be created by the app on boot)
RUN mkdir -p data/downloads sessions

# Railway injects PORT; fall back to 5000 in other environments
ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000

CMD ["node", "server.js"]
