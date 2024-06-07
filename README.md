# EthicApp 2

This main branch of the repository contains the sources of EthicApp 2: A CSCL script engine developed in JavaScript and Angular.JS, which supports case-based ethics education in Higher Ed environments. Please review the [organization README document](https://github.com/EthicApp-Development/organization#readme) for a detailed description of this project and its goals.

- [EthicApp 2](#ethicapp-2)
  - [1. Developing](#1-developing)
  - [2. Required Skills](#2-required-skills)
  - [3. Runtime Dependencies](#3-runtime-dependencies)
    - [3.1. Native](#31-native)
    - [3.2. Virtualized](#32-virtualized)
  - [4. Setting up the environment](#4-setting-up-the-environment)
    - [4.1. Install root Node dependencies](#41-install-root-node-dependencies)
    - [4.2. "Passwords" file](#42-passwords-file)
    - [4.3. Create docker-compose secret file(s)](#43-create-docker-compose-secret-files)
    - [4.4. Initialize the dockerized database shared volume](#44-initialize-the-dockerized-database-shared-volume)
    - [4.5. Build static assets](#45-build-static-assets)
  - [5. Deploy EthicApp](#5-deploy-ethicapp)
    - [5.1. Native Development Environment](#51-native-development-environment)
    - [5.2. Virtualized Development Environment](#52-virtualized-development-environment)
    - [5.3. Production Install](#53-production-install)
  - [6. Appendices](#6-appendices)
    - [6.1. NPM developing and debugging scripts](#61-npm-developing-and-debugging-scripts)
    - [6.2. Persistence of PgAdmin (containerized)](#62-persistence-of-pgadmin-containerized)
    - [6.3. For non-Linux developers](#63-for-non-linux-developers)
      - [6.3.1. MacOS](#631-macos)
      - [6.3.2. Windows](#632-windows)

## 1. Developing

Please head to the [CONTRIBUTING document](./CONTRIBUTING.md) and review our [communication channels](https://github.com/EthicApp-Development/organization/blob/master/CONTRIBUTING.md#1-communication-channels) for the project. The build and run documentation is intended for **Linux-based systems**, for this project. Please consider having a machine with a Linux-based OS (or with a Linux-friendly console such as `bash`).

## 2. Required Skills

In order to work in the project you should be familiar with the following:

- [JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Language_overview)
- [HTML](https://developer.mozilla.org/en-US/docs/Learn/HTML/Introduction_to_HTML)
- [CSS](https://developer.mozilla.org/en-US/docs/Learn/CSS/First_steps)
- [AngularJS](https://angularjs.org/)
- [NodeJS](https://nodejs.org/en)

Knowledge of [Docker](https://www.docker.com/) and [PostgreSQL](https://www.postgresql.org/) could be helpful, but not required

## 3. Runtime Dependencies

### 3.1. Native

In order to run the project *natively* in your computer, the following software is required:

- Node.JS (with `npm`).
- PostgreSQL 10.X.

### 3.2. Virtualized

`docker-compose` (from [Docker](https://www.docker.com/)) and [`npm`](https://www.npmjs.com/package/npm) (due some setup tasks needed prior Docker shared volume).

## 4. Setting up the environment

### 4.1. Install root Node dependencies

Run `npm install`, needed for a few [DevOps](https://about.gitlab.com/topics/devops/) utilities needed for this project (e.g. linters). You can skip this step if you are not going to contribute.

### 4.2. "Passwords" file

Initialize the file with development credential values for the Node web app such as the database connection URI:

```bash
npm run init-passwords-js
```

### 4.3. Create docker-compose secret file(s)

```bash
mkdir secrets
echo 'qwerty-dev-token' > ./secrets/jwt_token
```

### 4.4. Initialize the dockerized database shared volume

The virtualized Postgres server is configured to run with a mounted [Docker volume](https://docs.docker.com/storage/volumes/). Setup this with:

```bash
npm run init-db
```

This will create a directory at `$HOST_DB_VOLUME_PATH` (see the [DotEnv file](./.env)) in your filesystem, containing the preset development database, thus being preserved despite the state of the database container.

### 4.5. Build static assets

Finally, it is mandatory to build the "bundles" for static assets:

```bash
npm run build
```

## 5. Deploy EthicApp

### 5.1. Native Development Environment

Head into `ethicapp` and run `npm install` for installing all dependencies. Then, once your Postgres server is up and running with the appropriate data and configuration at `passwords.js` (which is up to you), head into `ethicapp` directory and run the following for starting the web server at the default port `8080`:

```bash
npm run start
```

Note: you can change the web server port by setting a custom `PORT` variable for the command, e.g. `PORT=11500 npm run start`.

### 5.2. Virtualized Development Environment

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

### 5.3. Production Install

Please refer to the [INSTALL Markdown](INSTALL.md) for a detail information on how to run the app on production mode.

## 6. Appendices

### 6.1. NPM developing and debugging scripts

The root [`package.json`](./package.json) file contains some useful scripts for initialization and/or debugging, which are detailed at the following table (ordered by relevance) and can be easily run with `npm run $Script`.

| Script                   | Description                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `init-passwords-js`      | For [section 3.2](#32-passwords-file).                                                                                                                                                                                                                       |
| `init-db`                | For [section 3.4](#34-initialize-the-dockerized-database-shared-volume).                                                                                                                                                                                     |
| `lint-$LANG`             | For running a lint check for a given `LANG`. Values can be `js`, `html`, `css` or `sql`.                                                                                                                                                                     |
| `fix-$LANG`              | Runs automatic formatting fixes for linting rules, given a `LANG`. Values can be `js`, `css` or `sql`.                                                                                                                                                       |
| `clear-sessions`         | Deletes all web sessions (from local filesystem). Needed when authentication or other features gets buggy in certain cases. See [issue #151](https://github.com/EthicApp-Development/ethicapp-main/issues/151). It does need superuser permissions, somehow. |
| `psql`                   | Quickly run a command-line Postgres client to the containerized development database.                                                                                                                                                                        |
| `pgdump` and `pgrestore` | Easily dumping/restoring the containerized database, if desired.                                                                                                                                                                                             |
| `build-js`               | Builds asset bundle for static frontend JS files.                                                                                                                                                                                                            |
| `build-css`              | Builds asset bundle for static frontend CSS files.                                                                                                                                                                                                           |
| `build-assets`           | Runs `build-js` and `build-css` simultaneously.                                                                                                                                                                                                              |
| `bundle-teacher-module`  | Build and minifies controllers for faster file loading time|
| `build`                  | Runs `build-js` and `build-css` and `bundle-teacher-module` simultaneously.
|

### 6.2. Persistence of PgAdmin (containerized)

If you inspect the [`docker-compose`](./docker-compose.yml) file, you will note that the database (and PgAdmin) use the `unless-stopped` restart policy. This means that those services will keep running unless `docker-compose down` is executed. Therefore, it is recommended to, when running the environment for the first time, first starting those services in detached mode:

```bash
docker-compose up --build --detach postgres pgadmin
```

Then, you can launch the Node service with, for instance:

```bash
docker-compose up --build node
```

By that way, Postgres and PgAdmin will run [constantly] on the background, they will be preserved even if the host machine is restarted, i.e., the developer will not have to re-enter the Postgres connection password whenever they want to connect to the database at PgAdmin.

### 6.3. For non-Linux developers

If you have chosen not to use a Linux-based OS in your developing machine, read this section. If you are unfamiliar with Linux OSes, your first task would be install it on your machine (you may want to research about how to make a *dual boot*). If not, be aware that successful execution, debugging and updated runtime documentation will not be guaranteed, as the project is defined from its start to be executed and developed in a Linux environment.

- [Dual boot on windows](https://www.geeksforgeeks.org/creating-a-dual-boot-system-with-linux-and-windows/)
- [Dual boot on MacOS](https://www.technewstoday.com/how-to-install-linux-on-mac/)

#### 6.3.1. MacOS

You may have trouble running `npm` scripts from [appendix 5.1](#51-npm-developing-and-debugging-scripts), including mandatory initialization tasks. If this happens, you will need to prepend `bash -eu` to the commands at sections [3.2](#32-passwords-file) and [3.4](#34-initialize-the-dockerized-database-shared-volume).

#### 6.3.2. Windows

For Windows, you must have [WSL](https://learn.microsoft.com/en-us/windows/wsl/install), so that you can run a `bash` (or alike) shell directly in your host filesystem. You also need to install `npm` and `docker-compose` inside that WSL console. Then, it is important that you work on the *Linux-exclusive* filesystem, due to permission troubles with Windows files (i.e. do not use any child directory of your default "`C:`" Windows disk: `/mnt/c`). For instance, clone the project at `$HOME/ethicapp-main` and follow the instructions of the README file for building and running the environment properly. You also have to manage to open your IDE from the WSL `bash` console (i.e. with `code <CLONED_REPO_PATH>`).

## 7. Advanced Features
### 7.1 Automatic Content Analysis
This service allows for the automatic analysis of content generated by students in activities utilizing semantic differential questions. It employs the Universal Sentence Encoder (USE) language model to differentiate between meaningful and less meaningful responses. The content generated by the service is visible on the activity dashboard, which is exclusively accessible to the teacher or activity supervisor.
#### 7.1 Environment Variable Setup
To enable or disable service-related functions in Ethicapp, set the `CONTENT_ANALYSIS_SERVICE` environment variable in the `.env` file to `"True"` or `"False"`.
#### 7.2 Docker Deploy
##### 7.1.1 EthicApp With Content Analysis Service Deploy
EthicApp's Docker Compose its extended with content analysis services using:
```bash
docker compose -f docker-compose.yml -f docker-compose.content-analysis.yml up --build --detach
```
As an option, to always set `CONTENT_ANALYSIS_SERVICE` to `"True"`, a value can be given in the docker compose command, like so:
```bash
CONTENT_ANALYSIS_SERVICE=True docker compose -f docker-compose.yml -f docker-compose.content-analysis.yml up --build --detach
```
##### 7.1.2 Standalone Deploy
To start the service as Standalone, you first need to add a Redis client service to the `docker-compose.content-analysis.yml` file, adding:
```bash
RedisContainer:
  image: redis
  container_name: ethicapp-redis
  ports:
    - "6379:6379"
```
After that, the service can be deploy using:
```bash
docker compose -f docker-compose.content-analysis.yml up --build --detach
```