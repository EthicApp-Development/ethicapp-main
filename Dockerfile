# Usa una imagen oficial de Node.js 16 como base
FROM node:12-slim

# Establece el directorio de trabajo
WORKDIR /app

# Copia archivos necesarios
COPY package*.json ./
RUN npm install

COPY app.js ./
COPY bin ./bin
COPY public ./public
COPY routes ./routes
COPY views ./views
COPY modules ./modules
COPY entrypoint.sh ./entrypoint.sh

# Crea directorio para cargas
RUN mkdir /app/uploads && chmod 777 /app/uploads

# Da permisos al script
RUN chmod +x ./entrypoint.sh

# Expone el puerto
EXPOSE 8501

# Entrypoint
ENTRYPOINT ["./entrypoint.sh"]
