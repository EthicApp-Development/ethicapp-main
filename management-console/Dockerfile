FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend ./
RUN npm run build

FROM node:22-alpine AS backend-builder

WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev
COPY backend ./backend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend-builder /app /app
EXPOSE 8504
CMD ["node", "backend/server.js"]
