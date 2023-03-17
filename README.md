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

In order to run the project *physically* in your computer, the following software is required:

- Node.JS.
- PostgreSQL 10.X.

#### 2.1.2. Virtualized

The only dependency is `docker-compose` (from [Docker](https://www.docker.com/)).

## 3. Install

### 3.1. Setup

Before running the environment, you will need (1) the `passwords.js` file for the node app, (2) the docker-compose secret file(s) and (3) a dump for the Postgres database with the data needed to start the web application.

For (1), just run the shell command below. Note that the `dbconn` is very similar to Postgres' [connection URI](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING).

```shell
echo '
module.exports.dbcon = "tcp://app:app2020@postgres:5432/ethicapp";
module.exports.uploadPath = "/tmp/foo";

module.exports.GOOGLE_CLIENT_ID = "foo.apps.googleusercontent.com";;
module.exports.GOOGLE_CLIENT_SECRET = "qwerty";

module.exports.Captcha_Web = "qwerty";
module.exports.Captcha_Secret = "qwerty";

module.exports.accessKeyId = "qwerty";
module.exports.secretAccessKey = "qwerty";
' > ./ethicapp-node/modules/passwords.js
```

Then, run the following for (2), at the root directory of the cloned project in your machine:

```shell
mkdir secrets
echo 'foo-dev-token' > ./secrets/jwt_token
```

For (3), please contact the maintainer to receive a proper dump for you, as the database setup is not yet automated (see [issue #71](https://github.com/EthicApp-Development/ethicapp-main/issues/71) for details).

#### 3.1.1. Natively

At the root directory of the project, and run `npm install` for installing Node.JS dependencies. In order for the ESLint vscode extension to work properly, you may need to run `sudo npm install --global eslint`.

#### 3.1.2. Virtualized

```shell
docker-compose down --remove-orphans
docker-compose build
```

### 3.2. Run

#### 3.2.1. Native

Once your Postgres server is up and running (with the appropriate data) on the default port, execute the `start` Node task with `npm run-script start` for starting the web server.

#### 3.2.2. Virtualized

Run `docker-compose up --build`. It is recommended to start the environment in detached mode (`--detach` flag) and check the logs of the Node.JS web application or the desired service with `docker-compose logs -f ${SERVICE_NAME}`.
