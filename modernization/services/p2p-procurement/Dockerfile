FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY public ./public
RUN groupadd -r appuser && useradd -r -g appuser appuser
USER appuser
ENV NODE_ENV=production
EXPOSE 3002
CMD ["node", "src/server.js"]
