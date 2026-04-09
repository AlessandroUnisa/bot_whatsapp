FROM node:18-slim

RUN apt-get update && apt-get install -y git ca-certificates --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
ENV GIT_CONFIG_COUNT=2
ENV GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf
ENV GIT_CONFIG_VALUE_0=ssh://git@github.com/
ENV GIT_CONFIG_KEY_1=url.https://github.com/.insteadOf
ENV GIT_CONFIG_VALUE_1=git+ssh://git@github.com/
RUN npm install --omit=dev --omit=optional --no-package-lock

COPY . .

# Backup dei file Excel (il volume li sovrascrive)
RUN mkdir -p /app/data_init && \
    cp /app/data/compleanni.xlsx /app/data_init/ && \
    cp /app/data/ricorrenze.xlsx /app/data_init/

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "index.js"]
