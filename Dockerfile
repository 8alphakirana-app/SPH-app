FROM node:22-alpine

# Install Chromium dari Alpine repo (jauh lebih ringan dari Debian)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-dejavu \
    font-noto

# Puppeteer: pakai Chromium sistem, jangan download sendiri
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy package files dulu (manfaatkan Docker layer cache)
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy source app (node_modules dan file sensitif sudah di-exclude via .dockerignore)
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
