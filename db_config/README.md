# Database config SQL scripts

This directory contains hand-made migrations scripts for setting up the database schema.

# Sequence for creation of DB.
Currently there are 2 different methods to create the database (running either of them, not neccessary to run both):

## Shell script
First option is to run the init_db.sh script:
```shell
sh db_config/init_db.sh
```

This creates the database and its schema, and then export it into the dockerized server in pgadmin. 

## JS script
The second option is to run the init_db.js script:

```shell
node db_config/init_db.js
```
This option connects into the postgres address you provide, and 'manually' send the query to create & populate the DB.

# PENDING:
- Allow 'personalization' of db (username, password, db_name, etc)
- For js script, INSERT queries are very vulnerable. Refactor needed before launching into production. 