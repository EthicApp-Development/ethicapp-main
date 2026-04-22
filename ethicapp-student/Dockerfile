FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM node:22-alpine AS backend-builder

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend ./backend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend-builder /app /app
EXPOSE 8503
CMD ["node", "backend/server.js"]
