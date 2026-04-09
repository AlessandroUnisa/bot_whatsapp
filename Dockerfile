FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Backup dei file Excel (il volume li sovrascrive)
RUN mkdir -p /app/data_init && \
    cp /app/data/compleanni.xlsx /app/data_init/ && \
    cp /app/data/ricorrenze.xlsx /app/data_init/

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "index.js"]
