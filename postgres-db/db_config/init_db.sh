#Temporary file to run automatization of db.
!/bin/bash -exu

#Use of enviromental variables (mainly for security reasons)
export PGHOST=${PGHOST-localhost}
export PGPORT=${PGPORT-5433}
export PGDATABASE=${PGDATABASE-postgres}
export PGUSER=${PGUSER-postgres}
export PGPASSWORD=${PGPASSWORD-app2020}



#Command line arguments. 
DB_NAME=${1:-$PGDATABASE}
PG_USER=${2:-$PGUSER}             #Username given when created the server in pgAdmin.
PG_PASSSWORD=${3:-$PGPASSWORD}    #Password given when created the server in pgAdmin.
PG_PORT=${4:-$PGPORT}


#Creates the database $DB_NAME in server.
<<create-db 
CREATE_DB_FILE=db_config/create_db.sql
psql -U $PGUSER -a -f $CREATE_DB_FILE -h $PGHOST -p $PG_PORT -v db_name=$DB_NAME -v \
pg_user=$PG_USER -v pg_password=$PG_PASSSWORD
create-db

#               README ISSUE 71 TIPS
#Possible alternative method: Copy each file into docker world and execute it from inside container. 
#Problem: Makes customization difficult. Perhaps user can manually create db and postgres user, and thrn
#run this script to create schema.
#docker exec -it ethicapp-postgres bash -c 'psql postgresql://test:test@localhost:5432/test --file=${f}'
#docker cp db_config/create_db.sql ethicapp-postgres:create_db.sql
#docker exec ethicapp-postgres psql -U postgres -f create_db.sql



#Other alternative: This copy every file inside the /docker-entrypoint-initdb.d/ folder (in the container).
#This folder, according to docker documentation, "after the entrypoint calls initdb to create the default postgres 
#user and database, it will run any *.sql files, run any executable *.sh scripts, and source any 
#non-executable *.sh scripts found in that directory to do further initialization before starting the service."
#which makes this approach very good. Also, only runs "if you start the container with a data directory that is empty; 
#any pre-existing database will be left untouched on container startup."
#However, hasn't worked properly during my testing...
docker cp create-sql-schema/. ethicapp-postgres:/docker-entrypoint-initdb.d/

#If you try this method remember that, after you make the first 'docker cp' line work
#you will need to move both the "create_db.sql" and the "populate_db.sql" file inside the 
#/docker-entrypoint-initdb.d/ folder for full implementation. Also, keep in mind that 
#the "create_db.sql" currently works by receiving parameters from the command line for credentials, which 
#will not swork after implementing this solution. 
#This can be replaced by having each developer manually create his own enviroment values for credentials, 
#and then replacing the command line parameters inside the "create_db.sql" file for this env values.

<<possibly-useful-commands
docker exec -it ethicapp-postgres bash
su -c psql postgres
CREATE ROLE test WITH PASSWORD 'test'; ALTER ROLE test WITH PASSWORD 'test';
ALTER ROLE "test" WITH LOGIN;
CREATE DATABASE test_db WITH OWNER test;
postgresql://test:test@localhost:5432/test_db
#Creates the database $DB_NAME in server.
CREATE_DB_FILE=db_config/create_db.sql
psql -U $PGUSER -a -f $CREATE_DB_FILE -h $PGHOST -p $PG_PORT -v db_name=$DB_NAME -v \
pg_user=$PG_USER -v pg_password=$PG_PASSSWORD
possibly-useful-commands

<<commented-for-testing
#Creates connection string for new database.
connectionString=postgresql://$PG_USER:$PG_PASSSWORD@$PGHOST:$PG_PORT/$DB_NAME



# Creates and implements the schema for db $DB_NAME.
for f in ./db_config/create_sql_schema/* ; do
  case "$f" in
    #few alternatives
    #1option *.sql) docker cp --file=${f} ethicapp-postgres:${f}
    #2option *.sql) docker exec psql $connectionString --file=${f} ;;
    #3option *.sql) psql $connectionString --file=${f} ;;
  esac
  echo
done



#Necessary permission are granted to use the app with the newly created database.
for tbl in `psql -qAt -c "select tablename from pg_tables where schemaname = 'public';" $DB_NAME`\
; do 
  psql -c "alter table \"$tbl\" owner to $PG_USER" $DB_NAME ; 
done

for tbl in `psql -qAt -c "select sequence_name from information_schema.sequences where sequence_schema = 'public';" \ 
$DB_NAME` ; 
  do  psql -c "alter sequence \"$tbl\" owner to $PG_USER" $DB_NAME ; 
done

for tbl in `psql -qAt -c "select table_name from information_schema.views where table_schema = 'public';" \ 
$DB_NAME` ; do  
  psql -c "alter view \"$tbl\" owner to $PG_USER" $DB_NAME ; 
done



#Populates db with test users.
# [TODO] Should create a check to not populate the DB more than once. 
#You shouldn't run this program more then once, but it wouldn't hurt to implement this verification
POPULATE_MYDB=db_config/populate_db.sql
psql -U $PG_USER -a -f $POPULATE_MYDB -h $PGHOST -p $PG_PORT -d $DB_NAME



#Once the database it's fully created, it exports the connection string to the rest of the app.
export DBCON=${DBCON:-\"tcp://$PG_USER:$PG_PASSSWORD@postgres/$DB_NAME\"}
PASSWORD_FILE=modules/passwords.js
TEMP_FILE=temp.txt
if [ -f $PASSWORD_FILE ]; 
then 
  #If passwords.js file exists, then updates postgresql connectionString to work with the database 
  #created.
  touch $TEMP_FILE
  awk -v dbcon="$DBCON" '{sub(/module.exports.dbcon = [^ ]*/, "module.exports.dbcon = "dbcon); print }' \
  $PASSWORD_FILE > $TEMP_FILE
  cp $TEMP_FILE $PASSWORD_FILE
  rm $TEMP_FILE
else echo "File passwords.js doesn't exist. Ask the maintainer getting the required secret values." ;
  #[TODO] Could create here the passwords.js file, but without the secrets...
fi
commented-for-testing