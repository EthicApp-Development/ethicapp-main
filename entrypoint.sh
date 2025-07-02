#!/bin/sh

# Salir ante cualquier error
set -e

# Imprimir comandos a medida que se ejecutan (opcional para debugging)
# set -x

# Instalación de dependencias (solo si node_modules no existe, útil en contenedor de desarrollo)
if [ ! -d "node_modules" ]; then
  echo "Instalando dependencias..."
  npm install
fi

# Ejecutar la aplicación
echo "Levantando EthicApp en el puerto ${PORT:-8501}..."
exec npm start
