# EthicApp v1

> ⚠️ **Warning:** This is a legacy and deprecated version of EthicApp. It is no longer actively maintained and is used solely for research purposes.
>
> For current development, see branch `ethicapp-v2`.

This is a containerized version of the EthicApp v1 application for experimental and development purposes.

## 🟢 How to Start the Application

1. Build all images from scratch:

```bash
docker-compose build --no-cache
```

2. Start the application:

```bash
docker-compose up
```

3. The application will be available at:

```
http://localhost:8501
```

## 🔴 How to Stop the Application

```bash
docker-compose down
```

## 🔄 How to Reset Everything (Start from Scratch)

If you want to reset all volumes, including uploaded files and the PostgreSQL database:

```bash
docker-compose down -v --remove-orphans
```
Then rebuild and launch again:
```bash
docker-compose build --no-cache
docker-compose up
```

## 👥 Test Users

Test users are preloaded by the SQL script `create_34.sql`. These accounts are available for testing:

| Email           | Password (MD5 hash of username) | Role  |
|----------------|----------------------------------|-------|
| admin@admin    | admin                            | S     |
| profesor@test  | profesor                         | P     |
| alumno1@test   | alumno1                          | A     |
| alumno2@test   | alumno2                          | A     |
| alumno3@test   | alumno3                          | A     |

All users share the same dummy RUT (`11111111-1`) and sex (`M`).

> ⚠️ These credentials are for testing only. Do not use them in production.
