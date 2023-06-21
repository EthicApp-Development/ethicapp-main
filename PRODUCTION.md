# EthicApp Production Install

This file will detail all about the production version of the Ethicapp project. Please review the [organization README document](https://github.com/EthicApp-Development/organization#readme) for a detailed description of this project and its goals.

- [EthicApp Production Install](#ethicapp-production-install)
  - [1. Architecture overview](#1-architecture-overview)
    - [1.1. Runtime dependencies](#11-runtime-dependencies)
    - [1.2. Other dependencies](#12-other-dependencies)
  - [2. Docker Compose Explanations](#2-docker-compose-explanations)
    - [2.1. docker-compose.production.yaml](#21-docker-composeproductionyaml)
    - [2.2. docker-compose.production-services.yaml](#22-docker-composeproduction-servicesyaml)
    - [2.3. docker-compose.production-all-in-one.yaml](#23-docker-composeproduction-all-in-oneyaml)
  - [3. Setting up the environments](#3-setting-up-the-environments)
    - [3.1. Setting up the production environment](#31-setting-up-the-production-environment)
    - [3.2. Setting up the production services environment](#32-setting-up-the-production-services-environment)
    - [3.3. Setting up the production all-in-one environment](#33-setting-up-the-production-all-in-one-environment)
## 1. Architecture overview

### 1.1. Runtime dependencies

In order to run the project in production mode in your machine, the following software is required:

`docker-compose` (from [Docker](https://www.docker.com/)) amd [`npm`](https://www.npmjs.com/package/npm) (due some setup tasks needed prior Docker shared volume).

### 1.2. Other dependencies

In order to run the `docker-compose.production.yaml` you must have a directory named `secrets` with necessary token and API keys within it. This file must be provided from an official Ethicapp distributor to work.

## 2. Docker Compose Explanations

### 2.1. docker-compose.production.yaml

This file will run the following programs:
  - Node
  - Nginx

It sets up the necessary software to run the main Ethicapp backend + frontend.

NOTICE: This production environment will require the postgres software to be either running on the same machine or another machine connected to this environment to fully deploy Ethicapp

### 2.2. docker-compose.production-services.yaml

This file will run the following programs:
  - Postgres

It sets up the necessary software to run the Ethicapp database backend

NOTICE: This production environment will require Node + Nginx to be either running on the same machine or another machine connected to this environment to fully deploy Ethicapp.

### 2.3. docker-compose.production-all-in-one.yaml

This file will run the following programs:
  - Node
  - Nginx
  - Postgres

It sets up the necessary software to run Ethicapp. It contains all the necessary software to fully run in production mode. All in the same machine.

## 3. Setting up the environments

### 3.1. Setting up the production environment

To run the `docker-compose.production.yaml` for just for ethicapp front + backend without the database you must run the following command:
```
docker-compose -f docker-compose.production.yaml up -d node nginx
```
NOTICE: is important to have de `secrets` folder within the same directory of the docker-compose file or the build will result in an error.

### 3.2. Setting up the production services environment
Before running the production services yaml you must run the following commmands:

```
npm run init-db
```
This initialises the database the base data and shared volume necesarry to properly run the cotenerised database image.

To run the `docker-compose.production.yaml` for just for the database you must run the following command:
```
docker-compose -f docker-compose.production.yaml up -d postgres
```

### 3.3. Setting up the production all-in-one environment

Before running the production services yaml you must run the following commmands:

```
npm run init-db
```
This initialises the database the base data and shared volume necesarry to properly run the cotenerised database image.

To run the `docker-compose.production.yaml` with all the necesarry services to deploy ethicapp in the same machine you must run the following command:
```
docker-compose -f docker-compose.production.yaml up -d
```

This will install all the necessary files to run the Ethicapp on the machine.