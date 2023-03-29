# 1. EthicApp

This repository contains the main project for EthicApp: a web application (developed in JavaScript and Angular.JS) for supporting teaching Ethics in higher education environments. Please review the [organization README document](https://github.com/EthicApp-Development/organization#readme) for a detailed description of this project and its goals.

- [1. EthicApp](#1-ethicapp)
  - [1. Developing](#1-developing)
  - [2. Architecture overview](#2-architecture-overview)
    - [2.1. Runtime dependencies](#21-runtime-dependencies)
      - [2.1.1. Natively](#211-natively)
      - [2.1.2. Virtualized](#212-virtualized)
  - [3. Setting up the environment](#3-setting-up-the-environment)
    - [3.1. Install root Node dependencies](#31-install-root-node-dependencies)
    - [3.2. "Passwords" file](#32-passwords-file)
    - [3.3. Create docker-compose secret file(s)](#33-create-docker-compose-secret-files)
    - [3.4. Initialize the dockerized database shared volume](#34-initialize-the-dockerized-database-shared-volume)
  - [4. Run the environment](#4-run-the-environment)
    - [4.1. Natively](#41-natively)
    - [4.2. Virtualized](#42-virtualized)

## 1. Developing

Please head to the [CONTRIBUTING document](./CONTRIBUTING.md) and review our [communication channels](https://github.com/EthicApp-Development/organization/blob/master/CONTRIBUTING.md#1-communication-channels) for the project.

## 2. Architecture overview

### 2.1. Runtime dependencies

#### 2.1.1. Natively

In order to run the project *natively* in your computer, the following software is required:

- Node.JS (with `npm`).
- PostgreSQL 10.X.

#### 2.1.2. Virtualized

`docker-compose` (from [Docker](https://www.docker.com/)) amd [`npm`](https://www.npmjs.com/package/npm) (due some setup tasks needed prior Docker shared volume).

## 3. Setting up the environment

### 3.1. Install root Node dependencies

Run `npm install`, needed for a few [DevOps](https://about.gitlab.com/topics/devops/) utilities needed for this project (e.g. linters). You can skip this step if you are not going to contribute.

### 3.2. "Passwords" file

Initialize the `passwords.js` file for setting the database connection (among other things) for the Node app:

```shell
npm run init-passwords-js
```

### 3.3. Create docker-compose secret file(s)

```shell
mkdir secrets
echo 'qwerty-dev-token' > ./secrets/jwt_token
```

### 3.4. Initialize the dockerized database shared volume

The virtualized Postgres server is configured to run with a mounted [Docker volume](https://docs.docker.com/storage/volumes/). Setup this with:

```shell
npm run init-db
```

This will create a directory at `$HOST_DB_VOLUME_PATH` (see the [DotEnv file](./.env)) in your filesystem, containing the preset development database, thus being preserved despite the state of the database container.

## 4. Run the environment

### 4.1. Natively

Head into `ethicapp-node` and run `npm install` for installing all dependencies. Then, once your Postgres server is up and running with the appropriate data and configuration at `passwords.js` (which is up to you), head into `ethicapp-node` directory and run the following for starting the web server at the default port `8501`:

```shell
npm run start
```

Note: you can change the web server port by setting a custom `PORT` variable for the command, e.g. `PORT=11500 npm run start`.

### 4.2. Virtualized

This is the recommended (and most documented) way to run the environment.

```shell
docker-compose down --remove-orphans
docker-compose up --build --detach
```

After those commands are executed, the dockerized web server will be available at `http://localhost:$NODE_PORT`, and PgAdmin will also start serving at `http://localhost:$PGADMIN_PORT` (values declared at the [DotEnv file](./.env)).

Then, you can check the output of any desired service with:

```shell
docker-compose logs -f $SERVICE_NAME
```

For checking which users are available to log-in as in the Node web application, please check [this file](./postgres-db/seeds/01_users.sql).
