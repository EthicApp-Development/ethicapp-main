# EthicApp Production Install

This file will detail all about the production version of the Ethicapp project. Please review the [organization README document](https://github.com/EthicApp-Development/organization#readme) for a detailed description of this project and its goals.

- [EthicApp Production Install](#ethicapp-production-install)
  - [1. Architecture overview](#1-architecture-overview)
    - [1.1. Runtime dependencies](#11-runtime-dependencies)
    - [1.2. Other dependencies](#12-other-dependencies)
  - [2. Docker Compose Explanations](#2-docker-compose-explanations)
    - [2.1. docker-compose.production.yaml](#21-docker-composeproductionyaml)
  - [3. Setting up the environments](#3-setting-up-the-environments)
    - [3.1. Setting up the production environment](#31-setting-up-the-production-environment)
    - [3.2. Setting up the production services environment](#32-setting-up-the-production-services-environment)
    - [3.3. Setting up the production all-in-one environment](#33-setting-up-the-production-all-in-one-environment)
  - [4. DockerHub](#4-dockerhub)
    - [4.1. Commit and Push to Docker Hub](#41-commit-and-push-to-docker-hub)
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
  - Postgres

It sets up the necessary software to run Ethicapp. It contains all the necessary software to fully run in production mode. All in the same machine.

NOTICE: Ethicapp Node pull and image from [DockerHub](https://hub.docker.com/repository/docker/ethicapp/stable-2/general) to work. If you wish to update the dockerhub image please refer to the [4. DockerHub](#4-dockerhub) Section

## 3. Setting up the environments

### 3.1. Setting up the production environment

To run the `docker-compose.production.yaml` for just for ethicapp front + backend without the database you must run the following command:
```bash
docker-compose -f docker-compose.production.yaml up -d node nginx
```
NOTICE: is important to have de `secrets` folder within the same directory of the docker-compose file or the build will result in an error.

### 3.2. Setting up the production services environment
Before running the production services yaml you must run the following commmands:

```bash
npm run init-db
```bash
This initialises the database the base data and shared volume necesarry to properly run the cotenerised database image.

To run the `docker-compose.production.yaml` for just for the database you must run the following command:
```bash
docker-compose -f docker-compose.production.yaml up -d postgres
```

### 3.3. Setting up the production all-in-one environment

Before running the production services yaml you must run the following commmands:

```bash
npm run init-db
```
This initialises the database the base data and shared volume necesarry to properly run the cotenerised database image.

To run the `docker-compose.production.yaml` with all the necesarry services to deploy ethicapp in the same machine you must run the following command:
```bash
docker-compose -f docker-compose.production.yaml up -d
```

This will install all the necessary files to run the Ethicapp on the machine.

## 4. DockerHub
Docker Hub is a cloud-based repository for Docker images. Share, store, and download containerized software packages. Central hub for Docker image distribution.

### 4.1. Commit and Push to Docker Hub
To commit and push Docker images to Docker Hub, follow these steps:

1. Make sure you have Docker installed and logged in to your Docker Hub account using the docker login command.

2. Build your Docker image using the docker build command or alternatively use the docker compose up function:
   ```bash
   docker-compose up --build --detach
   ```
3. Commit the ethicapp/node image using the following command:
   ```bash
    docker commit ethicapp ethicapp/stable-2
   ```
   you can alternatively add a tag. For example:
    ```bash
      docker commit ethicapp ethicapp/stable-2:NameOfTag
    ```
4. Push the image to the Dockerhub repository using the following command:
    ```bash
      docker push ethicapp/stable-2
    ```
    if you wish to commit wihtou the default "latest" tag you can do so by using the following command:
    ```bash
      docker push ethicapp/stable-2:NameOfTag
    ```

NOTICE: Ensure that you have proper permissions and the correct repository name and tag in the commands.