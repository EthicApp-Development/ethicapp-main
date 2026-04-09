# -----------------------------
# Stage 1: build frontend assets
# -----------------------------
FROM node:22-slim AS frontend-builder

WORKDIR /build

# Copiar manifests primero para aprovechar cache
COPY package*.json ./

# Instalar dependencias completas, incluyendo devDependencies
RUN npm ci

# Copiar el código necesario para el build
COPY public ./public
COPY scripts ./scripts
COPY modules ./modules

# Ejecutar build del frontend
RUN npm run build:auth

# -----------------------------
# Stage 2: legacy runtime
# -----------------------------
FROM node:12

WORKDIR /app

# Copiar manifests
COPY package*.json ./

# Instalar dependencias de producción solamente
RUN npm install --production

# Copiar código de la aplicación
COPY app.js ./
COPY bin ./bin
COPY public ./public
COPY routes ./routes
COPY views ./views
COPY modules ./modules
COPY entrypoint.sh ./entrypoint.sh

# Copiar el bundle generado en la etapa moderna
COPY --from=frontend-builder /build/public/js/auth.bundle.js /app/public/js/auth.bundle.js

# Si generas sourcemap en desarrollo o en producción, copia también esto:
# COPY --from=frontend-builder /build/public/js/auth.bundle.js.map /app/public/js/auth.bundle.js.map

# Crear directorios persistentes
RUN mkdir -p /app/uploads /app/sessions \
    && chmod 777 /app/uploads \
    && chmod 755 /app/sessions

# Permisos del entrypoint
RUN chmod +x ./entrypoint.sh

EXPOSE 8501

ENTRYPOINT ["./entrypoint.sh"]