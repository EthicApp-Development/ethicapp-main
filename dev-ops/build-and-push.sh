#!/bin/bash -exu
# --------------------------------------------------------------------------------------------------
# Quick script for automatically updating the docker image on dockerhub.
# --------------------------------------------------------------------------------------------------

# Build and tag the Docker image
docker-compose -f docker-compose.imageRenewal.yml up --build --detach

# commit the image for Docker Hub
docker commit ethicapp-node ethicapp/stable-2

# Push the image to Docker Hub
docker push ethicapp/stable-2
