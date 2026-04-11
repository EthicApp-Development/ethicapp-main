FROM node:12

WORKDIR /app

# Copiar manifests
COPY package*.json ./

# Instalar dependencias de producción
RUN npm install --production

# Copiar código de la aplicación
COPY app.js ./
COPY bin ./bin
COPY public ./public
COPY routes ./routes
COPY views ./views
COPY modules ./modules
COPY middlewares ./middlewares
COPY entrypoint.sh ./entrypoint.sh

# Crear directorios persistentes
RUN mkdir -p /app/uploads /app/sessions \
    && chmod 777 /app/uploads \
    && chmod 755 /app/sessions

# Permisos del entrypoint
RUN chmod +x ./entrypoint.sh

EXPOSE 8501

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "bin/www"]