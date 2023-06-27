# EthicApp Production Install

This file will detail all about the production version of the Ethicapp project. Please review the [organization README document](https://github.com/EthicApp-Development/organization#readme) for a detailed description of this project and its goals.

- [EthicApp Production Install](#ethicapp-production-install)
  - [1. Architecture overview](#1-architecture-overview)
    - [1.1. Runtime dependencies](#11-runtime-dependencies)
    - [1.2. Other dependencies](#12-other-dependencies)
  - [2. Docker Compose Explanations](#2-docker-compose-explanations)
    - [2.1. docker-compose.production.yaml](#21-docker-composeproductionyaml)
  - [3. Setting up the environment pre requisites](#3-setting-up-the-environment-pre-requisites)
    - [3.1. Setting up the production environment](#31-setting-up-the-production-environment)
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

## 2. Docker Compose Explanations

### 2.1. docker-compose.production.yaml

This file will run the following programs:

- Node
  - Node.js is a server-side JavaScript runtime environment that allows for efficient, scalable, and event-driven network applications. Serving as the main Backend + Frontend for Ethicapp.
- Nginx
  - Nginx is a high-performance web server and reverse proxy server that efficiently handles HTTP, HTTPS, and other protocols, serving as a powerful intermediary between clients and web servers. Serving as a static content provider for Ethicapp's users.
- Postgres
  - PostgreSQL is an open-source relational database management system that provides robust data storage and advanced querying capabilities, allowing for efficient management and retrieval of structured data. Serving as Ethicapp's database.

It sets up the necessary software to run Ethicapp. It contains all the necessary software to fully run in production mode. All in the same machine.

NOTICE: Ethicapp Node pull and image from [DockerHub](https://hub.docker.com/repository/docker/ethicapp/stable-2/general) to work. If you wish to update the DockerHub image please refer to the [4. DockerHub](#4-dockerhub) Section

## 3. Setting up the environment pre requisites

Before running any of the production services, you must run initiate the database by running the following command:

```bash
npm run init-db
```

### 3.1. Setting up the production environment

To run the `docker-compose.production.yaml` with all the necessary services to deploy ethicapp in the same machine you must run the following command:

```bash
docker-compose -f docker-compose.production.yaml up --detach
```

This will install all the necessary files to run the Ethicapp on the machine.

## 4. DockerHub

Docker Hub is a cloud-based repository for Docker images. Share, store, and download containerized software packages. Central hub for Docker image distribution.

IMPORTANT: Remember to DELETE or NOT COPY secret files to the DockerHub repo, or else the secrets will be publicly to copy and steal.

### 4.1. Commit and Push to Docker Hub

To commit and push Docker images to Docker Hub, follow these steps:

1. Make sure you have Docker installed and logged in to your Docker Hub account using the docker login command.

2. Build your Docker image using the docker build command or alternatively use the docker compose up function:

   ```bash
   docker-compose up --build
   ```

3. Test the image to ensure its proper functionality and REMOVE the secret files containing sensible information BEFORE committing.

4. Commit the ethicapp/node image using the following command:

   ```bash
    docker commit ethicapp ethicapp/stable-2
   ```

   you can alternatively add a tag. For example:

    ```bash
      docker commit ethicapp ethicapp/stable-2:NameOfTag
    ```

5. Push the image to the DockerHub repository using the following command:

    ```bash
      docker push ethicapp/stable-2
    ```

    if you wish to commit without the default "latest" tag you can do so by using the following command:

    ```bash
      docker push ethicapp/stable-2:NameOfTag
    ```

NOTICE: Ensure that you have proper permissions and the correct repository name and tag in the commands.
