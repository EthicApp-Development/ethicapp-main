---
name: Reporte de error/bug
about: 'Un error es un problema demostrable causado por el código en el repositorio.
  Buenos reportes de error son muy importantes para mejorar nuestro proyecto, ¡gracias! '
title: "[Componente] Título breve del reporte de error"
labels: bug
assignees: ''

---

- type: textarea
  attributes:
    label: Descripción general del error
    description: Por favor describe brevemente del problema, si aplica.
    placeholder: Opcional
  validations:
    required: false

- type: textarea
  attributes:
    label: ¿Cuándo ocurrió?
    description: De ser posible, ingresar fecha, idealmente junto con la hora estimada.
    placeholder:
  validations:
    required: true

- type: textarea
  attributes:
    label: ¿En qué dispositivo fue?
    description: Indicar si el error se produjo al usar el sistema por celular o por medio de un computador.
    placeholder:
  validations:
    required: true

- type: textarea
  attributes:
    label: ¿En qué explorador web ocurrió?
    description: Nombrar el explorador en el que se vio el error (Google Chrome, FireFox, Opera, etc.).
    placeholder:
  validations:
    required: true

- type: textarea
  attributes:
    label: ¿Cómo reproducir el error?
    description: Por favor indicar los pasos a seguir para reproducir el error, siendo lo más detallado que se pueda.
    placeholder:
  validations:
    required: true

- type: textarea
  attributes:
    label: Detalles adicionales
    description: Indicar otros detalles si aplica, como el contexto adicional, capturas de pantalla, etc.
    placeholder: Opcional
  validations:
    required: false
