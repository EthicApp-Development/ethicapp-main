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

## Producción

```bash
docker build -t ethicapp-student ./ethicapp-student
```
