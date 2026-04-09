FROM node:18-slim

# Installa Chromium e dipendenze per Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Indica a Puppeteer di usare Chromium di sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Crea la cartella data se non esiste
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "index.js"]
