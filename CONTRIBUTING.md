# Contributing to EthicApp

- [Contributing to EthicApp](#contributing-to-ethicapp)
  - [1. Getting started](#1-getting-started)
  - [2. Architecture overview](#2-architecture-overview)
    - [2.1. Project structure](#21-project-structure)
  - [3. Required skills](#3-required-skills)
    - [3.1. Overall](#31-overall)
    - [3.2. Backend](#32-backend)
    - [3.3. Frontend](#33-frontend)
  - [4. Recommended skills](#4-recommended-skills)
  - [5. Communication channels](#5-communication-channels)
  - [6. Required software](#6-required-software)
    - [6.1. Basic dependencies](#61-basic-dependencies)
    - [6.2. Linters](#62-linters)
  - [7. IDE extensions](#7-ide-extensions)
    - [7.1. Mandatory extensions](#71-mandatory-extensions)
      - [7.1.1. Overall developing](#711-overall-developing)
      - [7.1.2. Markdown](#712-markdown)
    - [7.2. Recommended extensions](#72-recommended-extensions)
  - [8. Appendixes](#8-appendixes)
    - [8.1. Recommendation for GitLens](#81-recommendation-for-gitlens)

## 1. Getting started

If you intent to contribute (thank you), after reviewing this file, please check the [organization repo](https://github.com/EthicApp-Development/organization) for detailed information about coding styles, git guidelines and governance, as well as a more detailed description of the project and its goals. Head for issues labeled `good-first-issue` to start your first contributions.

When opening the project with `vscode` and its required extensions for this project (see [section 6](#6-required-software)), the [workspace settings](./.vscode/settings.json) will load and your IDE will be ready for development.

## 2. Architecture overview

<!-- TODO: a couple of architecture design diagrams (e.g. physical view, context view). -->

### 2.1. Project structure

| Directory    | Description                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `db_config/` | SQL migrations for setting up the database schema (more details [here](./db_config/README.md)). |
| `modules/`   | Global JavaScript utility modules.                                                              |
| `public/`    | Backend source code (JavaScript).                                                               |
| `routes/`    | Web routing JS scripts.                                                                         |
| `tests/`     | Automated tests.                                                                                |
| `views/`     | Frontend source code (Angular.JS).                                                              |

## 3. Required skills

### 3.1. Overall

- Basic knowledge of web applications and software architectural patterns.
- Reasonable experience with Visual Studio Code IDE.
- Oriented-object programming in JavaScript.

### 3.2. Backend

- SQL (PostgreSQL).

### 3.3. Frontend

- UI design with AngularJS.
- DOM manipulation in JavaScript.

## 4. Recommended skills

- Experience in development and usage of RESTful web APIs.
- JQuery.

## 5. Communication channels

Please read [this document](https://github.com/EthicApp-Development/organization/blob/master/CONTRIBUTING.md).

## 6. Required software

The official IDE for this project is [Visual Studio Code](https://code.visualstudio.com/) (AKA `vscode`). Other mandatory developing tools are listed bellow in this section.

### 6.1. Basic dependencies

- Git.
- Node.JS.
- Linux, or `sh` script-capable operating system, e.g. Windows with [WSL](https://learn.microsoft.com/en-us/windows/wsl/install).

### 6.2. Linters

The used linters are in `package.json` and thus are automatically installed with `npm`. However, the implemented linters are stated in the following table.

| Linter name                           | Target language |
| ------------------------------------- | --------------- |
| [ESLint](https://eslint.org/)         | JavaScript      |
| [HTMLHint](https://htmlhint.com/)     | HTML            |
| [StyleLint](https://stylelint.io/)    | CSS             |
| [SQLFluff](https://www.sqlfluff.com/) | SQL             |

For ensuring the codebase fulfills the linting settings, you execute `./lint-check.sh` at the root directory of the project.

## 7. IDE extensions

### 7.1. Mandatory extensions

#### 7.1.1. Overall developing

- [Better Comments](https://marketplace.visualstudio.com/items?itemName=aaron-bond.better-comments): as various code comments are formatted to be rendered nicely by this tool.
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint).
- [HTMLHint](https://marketplace.visualstudio.com/items?itemName=HTMLHint.vscode-htmlhint).
- [sqlfluff](https://marketplace.visualstudio.com/items?itemName=dorzey.vscode-sqlfluff).

#### 7.1.2. Markdown

- [Markdown All in One](https://marketplace.visualstudio.com/items?itemName=yzhang.markdown-all-in-one): for various smart Markdown utilities, such as section headers, automatic table of contents, etc.
- [Markdownlint](https://marketplace.visualstudio.com/items?itemName=DavidAnson.vscode-markdownlint): linter for implementing the standardized best practices for writing Markdown files.

### 7.2. Recommended extensions

- [GitLens](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens): for advanced usage of Git. Highly recommended, as it is specially helpful for merging commits and branches, comparing commits, as well as keeping track of history of a selected line of code. If you are new to this extension, please go to [appendix 8.1](#81-recommendation-for-gitlens).
- [Docker](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-docker): for `Dockerfile` and `docker-compose` intellisense.
- [YAML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml): validation and formatting of YAML files (e.g. for when editing linter config files in YAML).

## 8. Appendixes

### 8.1. Recommendation for GitLens

In case you are unfamiliar with GitLens, you may want to append the following configuration to your personal settings (at vscode's user `settings.json`), for suppressing additional verbosity for this extension:

```jsonc
{
  // ...
  "gitlens.currentLine.enabled": false,
  "gitlens.hovers.currentLine.over": "line",
  "gitlens.codeLens.enabled": false
}
```
