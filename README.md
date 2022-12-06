# 1. EthicApp

This repository contains the main project for EthicApp: a web application (developed in JavaScript and Angular.JS) for supporting teaching Ethics in higher education environments. Please review the [organization README document](https://github.com/EthicApp-Development/organization#readme) for a detailed description of this project and its goals.

## 1. Developing

Please read the [CONTRIBUTING](./CONTRIBUTING.md) document.

## 2. Architecture overview

### 2.1. Runtime dependencies

In order to run the project natively in your computer, the following software is required:

- Node.JS.
- PostgreSQL. <!-- ? Which version(s)? -->

If you intend to run it virtualized, the only dependency is `docker-compose`.

## 3. Install

### 3.1. Setup

For all cases, please initialize the `modules/passwords.js` file with:

```shell
echo '
module.exports.dbcon = "tcp://app:app2020@postgres/doccollab";
module.exports.uploadPath = "";

module.exports.GOOGLE_CLIENT_ID = "";
module.exports.GOOGLE_CLIENT_SECRET ="";

module.exports.Captcha_Web = "";
module.exports.Captcha_Secret = "";

module.exports.accessKeyId = "";
module.exports.secretAccessKey = "";
' > modules/passwords.js
```

Ask the maintainer for the value of the secrets as you need them.

#### 3.1.1. Native

1. At the root directory of the project and run `npm install` for installing dependencies.
2. As issue [#71](https://github.com/EthicApp-Development/ethicapp-main/issues/71) is not yet resolved, you will have to ask for a database image with the existing schema and data for the system to start running (e.g. users). The maintainer will give you further details.

#### 3.1.2. Virtualized

Run:

```shell
docker-compose down --remove-orphans
docker-compose build
```

### 3.2. Run

#### 3.2.1. Native

Execute the `start` Node task with `npm run-script start` for starting the web server.

#### 3.2.2. Virtualized

Run `docker-compose up --build`. Due volume mount, it may happen that, for some reason, the `postgres` directory gets owned by the `root` user and unreadable by your user, on your host machine. In such case, run `sudo chown -R ${USER} postgres`. Also, it is recommended to start the environment in detached mode and check the logs of the Node.JS web application. We can wrap all of this with the following shell command:

```shell
sudo chown -R ${USER} postgres/ && docker-compose down --remove-orphans && docker-compose up --build --detach && docker-compose logs -f node
```

## 4. Getting started

Please go to the [CONTRIBUTING](./CONTRIBUTING.md) document and review our [communication channels](https://github.com/EthicApp-Development/organization/blob/master/CONTRIBUTING.md) for the project.
