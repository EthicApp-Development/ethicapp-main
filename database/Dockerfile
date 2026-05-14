FROM postgres:16

# Crea y define directorio de trabajo
WORKDIR /docker-entrypoint-initdb.d

# Copia todos los scripts de inicialización
COPY create_*.sql ./
