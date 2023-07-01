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
    - [3.5. Build static assets](#35-build-static-assets)
  - [4. Run the environment](#4-run-the-environment)
    - [4.1. Natively](#41-natively)
    - [4.2. Virtualized](#42-virtualized)
    - [4.3. Production Mode](#43-production-mode)
  - [5. Appendices](#5-appendices)
    - [5.1. NPM developing and debugging scripts](#51-npm-developing-and-debugging-scripts)
    - [5.2. Persistance of PgAdmin (containerized)](#52-persistance-of-pgadmin-containerized)
    - [5.3. For non-Linux developers](#53-for-non-linux-developers)
      - [5.3.1. MacOS](#531-macos)
      - [5.3.2. Windows](#532-windows)

## 1. Developing

Please head to the [CONTRIBUTING document](./CONTRIBUTING.md) and review our [communication channels](https://github.com/EthicApp-Development/organization/blob/master/CONTRIBUTING.md#1-communication-channels) for the project. The build and run documentation is intended for **Linux-based systems**, for this project. Please consider having a machine with a Linux-based OS (or with a Linux-friendly console such as `bash`).

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

Initialize the file with development credential values for the Node web app such as the database connection URI:

```bash
npm run init-passwords-js
```

### 3.3. Create docker-compose secret file(s)

```bash
mkdir secrets
echo 'qwerty-dev-token' > ./secrets/jwt_token
```

### 3.4. Initialize the dockerized database shared volume

The virtualized Postgres server is configured to run with a mounted [Docker volume](https://docs.docker.com/storage/volumes/). Setup this with:

```bash
npm run init-db
```

This will create a directory at `$HOST_DB_VOLUME_PATH` (see the [DotEnv file](./.env)) in your filesystem, containing the preset development database, thus being preserved despite the state of the database container.

### 3.5. Build static assets

Finally, it is mandatory to build the "bundles" for static assets:

```bash
npm run build-assets
```

## 4. Run the environment

### 4.1. Natively

Head into `ethicapp` and run `npm install` for installing all dependencies. Then, once your Postgres server is up and running with the appropriate data and configuration at `passwords.js` (which is up to you), head into `ethicapp` directory and run the following for starting the web server at the default port `8080`:

```bash
npm run start
```

Note: you can change the web server port by setting a custom `PORT` variable for the command, e.g. `PORT=11500 npm run start`.

### 4.2. Virtualized

This is the recommended (and most documented) way to run the environment.

```bash
docker-compose down --remove-orphans
docker-compose up --build --detach
```

After those commands are executed, the dockerized web server will be available at `http://localhost:$NODE_PORT`, and PgAdmin will also start serving at `http://localhost:$PGADMIN_PORT` (values declared at the [DotEnv file](./.env)).

Then, you can check the output of any desired service with:

```bash
docker-compose logs -f $SERVICE_NAME
```

For checking which users are available to log-in as in the Node web application, please check [this file](./postgres-db/seeds/01_users.sql).

Note: if you experience any issue while attempting to log-in as any of those users, please run `npm run clear-sessions` (at the root project directory) for preventing previous sessions conflicting with the current runtime.

### 4.3. Production Mode

Please refer to the [INSTALL Markdown](INSTALL.md) for a detail information on how to run the app on production mode.

## 5. Appendices

### 5.1. NPM developing and debugging scripts

The root [`package.json`](./package.json) file contains some useful scripts for initialization and/or debugging, which are detailed at the following table (ordered by relevance) and can be easily run with `npm run $Script`.

| Script                   | Description                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `init-passwords-js`      | For [section 3.2](#32-passwords-file).                                                                                      |
| `init-db`                | For [section 3.4](#34-initialize-the-dockerized-database-shared-volume).                                                    |
| `lint-$LANG`             | For running a lint check for a given `LANG`. Values can be `js`, `html`, `css` or `sql`.                                    |
| `fix-$LANG`              | Runs automatic formatting fixes for linting rules, given a `LANG`. Values can be `js`, `css` or `sql`.                      |
| `clear-sessions`         | Deletes all web sessions (from local filesystem). Needed when login gets buggy due database modifications in certain cases. |
| `psql`                   | Quickly run a command-line Postgres client to the containerized development database.                                       |
| `pgdump` and `pgrestore` | Easily dumping/restoring the containerized database, if desired.                                                            |
| `build-js`               | Builds asset bundle for static frontend JS files.                                                                           |
| `build-css`              | Builds asset bundle for static frontend CSS files.                                                                          |
| `build-assets`           | Runs `build-js` and `build-css` simultaneously.                                                                             |

### 5.2. Persistance of PgAdmin (containerized)

If you inspect the [`docker-compose`](./docker-compose.yml) file, you will note that the database (and PgAdmin) use the `unless-stopped` restart policy. This means that those services will keep running unless `docker-compose down` is executed. Therefore, it is recommended to, when running the environment for the first time, first starting those services in detached mode:

```bash
docker-compose up --build --detach postgres pgadmin
```

Then, you can launch the Node service with, for instance:

```bash
docker-compose up --build node
```

By that way, Postgres and PgAdmin will run [constantly] on the background, they will be preserved even if the host machine is restarted, i.e., the developer will not have to re-enter the Postgres connection password whenever they want to connect to the database at PgAdmin.

### 5.3. For non-Linux developers

If you have chosen not to use a Linux-based OS in your developing machine, read this section. If you are unfamiliar with Linux OSes, your first task would be install it on your machine (you may want to research about how to make a *dual boot*). If not, be aware that successful execution, debugging and updated runtime documentation will not be guaranteed, as the project is defined from its start to be executed and developed in a Linux environment.

#### 5.3.1. MacOS

You may have trouble running `npm` scripts from [appendix 5.1](#51-npm-developing-and-debugging-scripts), including mandatory initialization tasks. If this happens, you will need to prepend `bash -eu` to the commands at sections [3.2](#32-passwords-file) and [3.4](#34-initialize-the-dockerized-database-shared-volume).

#### 5.3.2. Windows

For Windows, you must have [WSL](https://learn.microsoft.com/en-us/windows/wsl/install), so that you can run a `bash` (or alike) shell directly in your host filesystem. You also need to install `npm` and `docker-compose` inside that WSL console. Then, it is important that you work on the *Linux-exclusive* filesystem, due to permission troubles with Windows files (i.e. do not use any child directory of your default "`C:`" Windows disk: `/mnt/c`). For instance, clone the project at `$HOME/ethicapp-main` and follow the instructions of the README file for building and running the environment properly. You also have to manage to open your IDE from the WSL `bash` console (i.e. with `code <CLONED_REPO_PATH>`).
