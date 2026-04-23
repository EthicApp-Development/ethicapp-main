# ethicapp-student

Aplicación nueva para estudiantes con:

- Backend Node + Express (`backend/`)
- Frontend React 19 + Bootstrap 5 (`frontend/`)
- Integración con sesión autenticada desde `auth-backend` vía headers `X-User-Id` y `X-User-Role`

## Desarrollo

```bash
cd ethicapp-student/backend && npm install
cd ../frontend && npm install
cd ..
npm install
npm run dev
```

## Configuración frontend

- `VITE_STUDENT_API_BASE_PATH`: prefijo base para los requests del frontend al backend.
  - Valor por defecto: `/student/api/`
  - Se normaliza automáticamente para usar `/` inicial y final.

## Producción

```bash
docker build -t ethicapp-student ./ethicapp-student
```
