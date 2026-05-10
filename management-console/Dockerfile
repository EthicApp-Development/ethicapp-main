FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM node:22-alpine AS backend-test

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend ./
RUN npm test && touch /tmp/backend-tests-passed

FROM node:22-alpine AS backend-runtime

WORKDIR /app/backend
ENV NODE_ENV=production
COPY --from=backend-test /tmp/backend-tests-passed /tmp/backend-tests-passed
RUN rm /tmp/backend-tests-passed
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend ./
RUN find . -type d -name __tests__ -prune -exec rm -rf {} +

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend-runtime /app/backend ./backend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
EXPOSE 8504
CMD ["node", "backend/server.js"]
