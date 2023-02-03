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

Please head to the [CONTRIBUTING](./CONTRIBUTING.md) document and review our [communication channels](https://github.com/EthicApp-Development/organization/blob/master/CONTRIBUTING.md) for the project.

## 2. Architecture overview

### 2.1. Runtime dependencies

#### 2.1.1. Natively

In order to run the project *physically* in your computer, the following software is required:

- Node.JS.
- PostgreSQL 10.X.

#### 2.1.2. Virtualized

Only `docker-compose` (from Docker) is required. Note that *Docker Desktop* is not required for installing Docker itself.

## 3. Install

### 3.1. Setup

First you need two things: the `passwords.js` file and a dump for the Postgres database with the data needed to start the web application. For the former, you can simply run the shell command below. For the latter, please contact the maintainer, as [issue #71](https://github.com/EthicApp-Development/ethicapp-main/issues/71) is not yet completed.

```shell
echo '
module.exports.dbcon = "tcp://app:app2020@postgres/ethicapp";
module.exports.uploadPath = "";

module.exports.GOOGLE_CLIENT_ID = "";
module.exports.GOOGLE_CLIENT_SECRET ="";

module.exports.Captcha_Web = "";
module.exports.Captcha_Secret = "";

module.exports.accessKeyId = "";
module.exports.secretAccessKey = "";
' > modules/passwords.js
```

#### 3.1.1. Natively

At the root directory of the project, and run `npm install` for installing Node.JS dependencies.

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
