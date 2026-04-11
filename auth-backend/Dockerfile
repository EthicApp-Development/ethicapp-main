# -----------------------------
# Stage 1: build frontend
# -----------------------------
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend ./
RUN npm run build

# -----------------------------
# Stage 2: build backend
# -----------------------------
FROM node:22-alpine AS backend-builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Copiar build del frontend al directorio público servido por Express
COPY --from=frontend-builder /app/frontend/dist ./public/app

# -----------------------------
# Stage 3: runtime
# -----------------------------
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY --from=backend-builder /app /app

EXPOSE 8502

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]