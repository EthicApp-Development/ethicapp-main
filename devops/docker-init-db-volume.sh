#!/bin/bash -exu

source .env
docker-compose up postgres postgres_init
