# EthicApp

This repository contains the main project for EthicApp: a web application (developed in JavaScript and Angular.JS) for supporting teaching Ethics in higher education environments. Please review the [organization README document](https://github.com/EthicApp-Development/organization#readme) for a detailed description of this project and its goals.

- [EthicApp](#ethicapp)
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
  - [5. Appendices](#5-appendices)
    - [5.1. NPM developing and debugging scripts](#51-npm-developing-and-debugging-scripts)
    - [5.2. Persistance of PgAdmin (containerized)](#52-persistance-of-pgadmin-containerized)
    - [5.3. For non-Linux developers](#53-for-non-linux-developers)
      - [5.3.1. MacOS](#531-macos)
      - [5.3.2. Windows](#532-windows)

## 1. Developing

Please head to the [CONTRIBUTING document](./CONTRIBUTING.md) and review our [communication channels](https://github.com/EthicApp-Development/organization/blob/master/CONTRIBUTING.md#1-communication-channels) for the project. The build and run documentation is intended for **Linux-based systems**, as it is practically the standard in particular for open-source projects. Please consider having a machine with a Linux-based OS.

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

Note: if you experience any issue while attempting to log-in as any of those users, please run `npm run clear-sessions` (at the root project directory) for preventing previous sessions conflicting with the current runtime.

## 5. Appendices

### 5.1. NPM developing and debugging scripts

The root [`package.json`](./package.json) file contains some useful scripts for initialization and/or debugging, which are detailed at the following table (ordered by relevance) and can be easily run with `npm run $Script`.

| Script                   | Description                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `init-passwords-js`      | For [section 3.2](#32-passwords-file).                                                                                      |
| `init-db`                | For [section 3.4](#34-initialize-the-dockerized-database-shared-volume).                                                    |
| `clear-sessions`         | Deletes all web sessions (from local filesystem). Needed when login gets buggy due database modifications in certain cases. |
| `psql`                   | Quickly run a command-line Postgres client to the containerized development database.                                       |
| `lint-$LANG`             | For running a lint check for a given `LANG`. Values can be `js`, `html`, `css` or `sql`.                                    |
| `pgdump` and `pgrestore` | Easily dumping/restoring the containerized database, if desired.                                                            |

### 5.2. Persistance of PgAdmin (containerized)

If you inspect the [`docker-compose`](./docker-compose.yml) file, you will note that the database (and PgAdmin) use the `unless-stopped` restart policy. This means that those services will keep running unless `docker-compose down` is executed. Therefore, it is recommended to, when running the environment for the first time, do:

```shell
docker-compose up --build --detach postgres pgadmin
```

Then, you can launch the Node service with:

```shell
docker-compose up --build node
```

With Postgres and PgAdmin running [constantly] on the background, they will be preserved even if the host machine is restarted, i.e., the developer will not have to re-enter the Postgres connection password whenever they want to connect to the database on PgAdmin.

### 5.3. For non-Linux developers

If you have chosen not to use a Linux-based OS in your developing machine, read this section. If you are unfamiliar with Linux OSes, your first task would be install it on your machine (you may want to research about how to make a *dual boot*). If not, be aware that successful execution, debugging and documentation will not be guaranteed, as the project is defined from its start to be executed and developed in a Linux environment.

#### 5.3.1. MacOS

You will have trouble running `npm` scripts from [appendix 5.1](#51-npm-developing-and-debugging-scripts), including mandatory initialization tasks. You may need to prepend `bash -eu` to the commands at sections [3.2](#32-passwords-file) and [3.4](#34-initialize-the-dockerized-database-shared-volume).

#### 5.3.2. Windows

For Windows, you must have [WSL](https://learn.microsoft.com/en-us/windows/wsl/install) so that you can run a `bash` shell directly in your host filesystem. You also need to install `npm` and `docker-compose` inside that WSL console. Then, all commands given in the documentation must be ran at that `bash` console through WSL.
