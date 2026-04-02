FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp via pip
RUN python3 -m ensurepip --upgrade && \
    python3 -m pip install --no-cache-dir --break-system-packages yt-dlp && \
    yt-dlp --version

# Configure yt-dlp to use Node.js as JS runtime (already available in this image)
# and set default player clients to avoid bot detection
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
