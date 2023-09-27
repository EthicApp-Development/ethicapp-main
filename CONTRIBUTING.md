# Contributing to EthicApp

- [Contributing to EthicApp](#contributing-to-ethicapp)
  - [1. Newcomers, read this!](#1-newcomers-read-this)
  - [2. Getting started](#2-getting-started)
  - [3. Architecture overview](#3-architecture-overview)
    - [3.1. Project structure](#31-project-structure)
  - [4. Required skills](#4-required-skills)
    - [4.1. Overall](#41-overall)
    - [4.2. Backend](#42-backend)
    - [4.3. Frontend](#43-frontend)
  - [5. Recommended skills](#5-recommended-skills)
  - [6. Communication channels](#6-communication-channels)
  - [7. Required software](#7-required-software)
    - [7.1. Basic dependencies](#71-basic-dependencies)
    - [7.2. Linters](#72-linters)
  - [8. IDE extensions](#8-ide-extensions)
    - [8.1. Mandatory extensions](#81-mandatory-extensions)
      - [8.1.1. Overall developing](#811-overall-developing)
      - [8.1.2. Markdown](#812-markdown)
    - [8.2. Recommended extensions](#82-recommended-extensions)
  - [9. Appendixes](#9-appendixes)
    - [9.1. Recommendation for GitLens](#91-recommendation-for-gitlens)

## 1. Newcomers, read this!

If you want to start making contributions rightaway or already have solved an issue and want to raise a new pull request then please check our ourganizations [git workflow guide](https://github.com/EthicApp-Development/organization/blob/master/Guidelines/git-workflow.md) on how to commit, raise issues and PRs the right way.

## 2. Getting started

If you intent to contribute (thank you), after reviewing this file, please check the [organization repo](https://github.com/EthicApp-Development/organization) for detailed information about coding styles, git guidelines and governance, as well as a more detailed description of the project and its goals. Head for issues labeled `enhancement` to start your first contributions or raise an issue of your own interest that might prove useful to the overall project.


When opening the project with `vscode` and its required extensions for this project (see [section 6](#6-required-software)), the [workspace settings](./.vscode/settings.json) will load and your IDE will be ready for development.

## 3. Architecture overview

<!-- TODO: a couple of architecture design diagrams (e.g. physical view, context view). -->

### 3.1. Project structure

| Directory    | Description                                                        |
| ------------ | ------------------------------------------------------------------ |
| `dev-ops/`   | Shell scripts for automated tasks related to development (DevOps). |
| `ethicapp/`  | Contains the Node web application.                                 |
| `pgadmin/`   | Configuration for PgAdmin in development runtime.                  |
| `web-nginx/` | Configuration for NGINX in production runtime.                     |

## 4. Required skills

In order to work in the project you should be familiar with the following:

- [JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Language_overview)
- [HTML](https://developer.mozilla.org/en-US/docs/Learn/HTML/Introduction_to_HTML)
- [CSS](https://developer.mozilla.org/en-US/docs/Learn/CSS/First_steps)
- [AngularJS](https://angularjs.org/)
- [NodeJS](https://nodejs.org/en)

Knowledge of (Docker)[https://www.docker.com/] and (PostgreSQL)[https://www.postgresql.org/] could be helpful, but not required

### 4.1. Overall

- Basic knowledge of web applications and software architectural patterns.
- Reasonable experience with Visual Studio Code IDE.
- Oriented-object programming in JavaScript.

### 4.2. Backend

- SQL (PostgreSQL).

### 4.3. Frontend

- UI design with AngularJS.
- DOM manipulation in JavaScript.

## 5. Recommended skills

- Experience in development and usage of RESTful web APIs.
- JQuery.

## 6. Communication channels

Please read [this document](https://github.com/EthicApp-Development/organization/blob/master/CONTRIBUTING.md).

## 7. Required software

The official IDE for this project is [Visual Studio Code](https://code.visualstudio.com/) (AKA `vscode`). Other mandatory developing tools are listed bellow in this section.

### 7.1. Basic dependencies

- Git.
- Node.JS.
- Linux, or `sh` script-capable operating system, e.g. Windows with [WSL](https://learn.microsoft.com/en-us/windows/wsl/install). For more information on this head to the appendices of the [following document](https://github.com/EthicApp-Development/ethicapp-main/blob/master/README.md)

### 7.2. Linters

The used linters are in `package.json` and thus are automatically installed with `npm`. However, the implemented linters are stated in the following table.

| Linter name                           | Target language |
| ------------------------------------- | --------------- |
| [ESLint](https://eslint.org/)         | JavaScript      |
| [HTMLHint](https://htmlhint.com/)     | HTML            |
| [StyleLint](https://stylelint.io/)    | CSS             |
| [SQLFluff](https://www.sqlfluff.com/) | SQL             |

For ensuring the codebase fulfills the linting settings, you execute `./lint-check.sh` at the root directory of the project.

## 8. IDE extensions

### 8.1. Mandatory extensions

#### 8.1.1. Overall developing

- [Better Comments](https://marketplace.visualstudio.com/items?itemName=aaron-bond.better-comments): as various code comments are formatted to be rendered nicely by this tool.
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint).
- [HTMLHint](https://marketplace.visualstudio.com/items?itemName=HTMLHint.vscode-htmlhint).
- [sqlfluff](https://marketplace.visualstudio.com/items?itemName=dorzey.vscode-sqlfluff).

#### 8.1.2. Markdown

- [Markdown All in One](https://marketplace.visualstudio.com/items?itemName=yzhang.markdown-all-in-one): for various smart Markdown utilities, such as section headers, automatic table of contents, etc.
- [Markdownlint](https://marketplace.visualstudio.com/items?itemName=DavidAnson.vscode-markdownlint): linter for implementing the standardized best practices for writing Markdown files.

### 8.2. Recommended extensions

- [GitLens](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens): for advanced usage of Git. Highly recommended, as it is specially helpful for merging commits and branches, comparing commits, as well as keeping track of history of a selected line of code. If you are new to this extension, please go to [appendix 8.1](#81-recommendation-for-gitlens).
- [Git Graph](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph): provides visualization of commit history. Extremely useful for viewing changes and merges on branches.
- [Docker](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-docker): for `Dockerfile` and `docker-compose` intellisense.
- [YAML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml): validation and formatting of YAML files (e.g. for when editing linter config files in YAML).

## 9. Appendixes

### 9.1. Recommendation for GitLens

In case you are unfamiliar with GitLens, you may want to append the following configuration to your personal settings (at vscode's user `settings.json`), for suppressing additional verbosity for this extension:

```jsonc
{
  // ...
  "gitlens.currentLine.enabled": false,
  "gitlens.hovers.currentLine.over": "line",
  "gitlens.codeLens.enabled": false
}
```
