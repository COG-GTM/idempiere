FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts
COPY src ./src
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3002
CMD ["node", "src/server.js"]
