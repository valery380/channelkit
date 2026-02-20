FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ dist/
COPY config.yaml ./
CMD ["node", "dist/cli.js", "start"]
