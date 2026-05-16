# syntax=docker/dockerfile:1.6
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
RUN adduser -D -u 1001 mcp && chown -R mcp:mcp /app
USER mcp
EXPOSE 3100
CMD ["node", "dist/index.js"]
