# 1. EthicApp

This repository contains the main project for EthicApp: a web application (developed in JavaScript and Angular.JS) for supporting teaching Ethics in higher education environments. Please review the [organization README document](https://github.com/EthicApp-Development/organization#readme) for a detailed description of this project and its goals.

- [1. EthicApp](#1-ethicapp)
  - [1. Developing](#1-developing)
  - [2. Architecture overview](#2-architecture-overview)
    - [2.1. Runtime dependencies](#21-runtime-dependencies)
      - [2.1.1. Natively](#211-natively)
      - [2.1.2. Virtualized](#212-virtualized)
  - [3. Install](#3-install)
    - [3.1. Setup](#31-setup)
      - [3.1.1. Natively](#311-natively)
      - [3.1.2. Virtualized](#312-virtualized)
    - [3.2. Run](#32-run)
      - [3.2.1. Native](#321-native)
      - [3.2.2. Virtualized](#322-virtualized)

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

## 3. Install

### 3.1. Setup

Before running the environment, you will need to:

1. Run `npm install`, needed for a few [DevOps](https://about.gitlab.com/topics/devops/) utilities needed for this project (e.g. linters).
2. Initialize the `passwords.js` file for setting the database connection (among other things) for the Node app: `npm run init-passwords-js`.
3. Get the docker-compose secret file(s): `mkdir secrets && echo 'foo-dev-token' > ./secrets/jwt_token`.
4. Initialize the database with `npm run init-db`.

#### 3.1.1. Natively

Head into `ethicapp-node` and run `npm install` for installing all dependencies.

#### 3.1.2. Virtualized

```shell
docker-compose down --remove-orphans
docker-compose build
```

### 3.2. Run

#### 3.2.1. Native

Once your Postgres server is up and running with the appropriate data (which is up to you) on the default port `5432`, execute the `start` Node task with `npm run-script start` for starting the web server, at the `ethicapp-node` directory.

#### 3.2.2. Virtualized

Run `docker-compose up --build`. It is recommended to start the environment in detached mode (`--detach` flag) and check the logs of the Node.JS web application or the desired service with `docker-compose logs -f ${SERVICE_NAME}`.
