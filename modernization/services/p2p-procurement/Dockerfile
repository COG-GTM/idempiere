FROM node:20-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY src ./src

ENV NODE_ENV=production
USER node
EXPOSE 3002
CMD ["node", "src/server.js"]
