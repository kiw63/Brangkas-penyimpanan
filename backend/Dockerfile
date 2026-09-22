FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm install --omit=dev

COPY server.mjs ./

EXPOSE 8787

CMD ["node", "server.mjs"]
