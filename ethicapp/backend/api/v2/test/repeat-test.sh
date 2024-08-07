#!/bin/bash

for i in {1..1}
do
  echo "Running test iteration $i"
  npx jest --detectOpenHandles
  if [ $? -ne 0 ]; then
    echo "Test failed on iteration $i"
    exit 1
  fi
done
