# EthicApp Production Install

This file will detail all about the production version of the Ethicapp project. Please review the [organization README document](https://github.com/EthicApp-Development/organization#readme) for a detailed description of this project and its goals.

- [EthicApp Production Install](#ethicapp-production-install)
  - [1. Architecture overview](#1-architecture-overview)
    - [1.1. Runtime dependencies](#11-runtime-dependencies)
    - [1.2. Other dependencies](#12-other-dependencies)
  - [2. Production docker-compose](#2-production-docker-compose)
  - [3. Build and run](#3-build-and-run)
    - [3.1. Database](#31-database)
    - [3.2. Production Docker image](#32-production-docker-image)
    - [3.3. Launching the environment](#33-launching-the-environment)
  - [4. DockerHub](#4-dockerhub)
    - [4.1. Commit and Push to Docker Hub](#41-commit-and-push-to-docker-hub)

## 1. Architecture overview

### 1.1. Runtime dependencies

In order to run the project in production mode in your machine, the following software is required:

`docker-compose` (from [Docker](https://www.docker.com/)) amd [`npm`](https://www.npmjs.com/package/npm) (due some setup tasks needed prior Docker shared volume).

### 1.2. Other dependencies

In order to run the `docker-compose.production.yaml` you must have a directory named `secrets` with necessary secret tokens for the application to properly run.

You must provide the following files:

- jwt_token
  - Contains the JWT token for the app to work
- keys-n-secrets.js
  - Google Cloud Platform API Key and Secret
  - Captcha Web API key and Secrets
  - AWS API key and Secrets

## 2. Production docker-compose

`docker-compose.production.yaml` declares three services, described as follows (all of them are open-source projects themselves):

- Node: a server-side JavaScript runtime environment that allows for efficient, scalable, and event-driven network applications. Serving as the main Backend + Frontend for Ethicapp.
- Nginx: high-performance web server and reverse proxy server that efficiently handles HTTP, HTTPS, and other protocols, serving as a powerful intermediary between clients and web servers. Serving as a static content provider for Ethicapp's users.
- Postgres: popular relational database management system that provides robust data storage and advanced querying capabilities, allowing for efficient management and retrieval of structured data. Serving as Ethicapp's database.

The service named "node" contains the web application, and uses the EthicApp production image, which is [published at DockerHub](https://hub.docker.com/repository/docker/ethicapp/stable-2/general). In order to update this public image, please refer to [section 4](#4-dockerhub).

## 3. Build and run

### 3.1. Database

First, initialize the shared volume for the database, with:

```bash
npm run init-db
```

### 3.2. Production Docker image

It is important to make sure to pull the latest production image from DockerHub:

```bash
docker pull ethicapp/stable-2:latest
```

### 3.3. Launching the environment

In order to run the production environment in your machine, you must use the `-f` flag in order to use the [production docker-compose file](./docker-compose.production.yaml) instead of the [default development one](./docker-compose.yml). The following command will build and run the environment accordingly.

```bash
docker-compose -f docker-compose.production.yaml up --build --detach
```

If you previously executed the development docker-compose runtime, the previous command may complain about "orphan" services. For such case, execute `docker-compose down --remove-orphans` and then launch the production environment again.

## 4. DockerHub

[DockerHub](https://hub.docker.com/) is Docker's cloud-based repository for images. This section explains how to update the production Docker image for EthicApp, which contains (only) the web application in Node.

### 4.1. Commit and Push to Docker Hub

To commit and push Docker images to Docker Hub, follow these steps:

1. Make sure you have Docker installed and logged in to your Docker Hub account using the `docker login` command.

2. Build your Docker image:

    ```bash
      docker-compose build
    ```

3. Test the image to ensure its proper functionality and REMOVE the secret files containing sensible information and auto generated files BEFORE committing.

4. Commit the ethicapp/node image:

    ```bash
      docker commit ethicapp ethicapp/stable-2
    ```

   you can alternatively add a tag. For example:

    ```bash
      docker commit ethicapp ethicapp/stable-2:NameOfTag
    ```

5. Push the image to the DockerHub repository:

    ```bash
      docker push ethicapp/stable-2
    ```

    if you wish to commit without the default "latest" tag you can do so by using the following command:

    ```bash
      docker push ethicapp/stable-2:NameOfTag
    ```

NOTICE: Ensure that you have proper permissions and the correct repository name and tag in the mentioned commands.
