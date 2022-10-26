# EthicApp

This repository contains the main project for EthicApp: a web application (developed in JavaScript and Angular.JS) for supporting teaching Ethics in high education environments. Please review the [organization README document](https://github.com/EthicApp-Development/organization#readme) for a detailed description of this project and its goals.

## 1. Developing

Please read the [CONTRIBUTING](./CONTRIBUTING.md) document.

## 2. Architecture overview

### 2.1. Runtime dependencies

In order to run the project natively in your computer, the following software is required:

- Node.JS.
- PostgreSQL. <!-- ? Which version(s)? -->

## 3. Install

<!-- TODO: enhance this when an actual well-isolated Dockerfile is made -->

### 3.1. Setup

1. Clone this repository: `git clone git@github.com:EthicApp-Development/ethicapp-main.git`.
2. `cd` into the root directory of the project and run `npm install` for installing dependencies.
3. Run the SQL scripts at `db_config` for executing the necessary migration in your database.
4. Enter the command `npm run-script start` for starting the server in your machine.

### 3.2. Run

Execute the `start` Node task with `npm run-script start` for starting the web server.

<!-- TODO: document logging (if complex logging exists) and testing (after it gets implemented) -->
