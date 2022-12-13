#Temporary file to run automatization of db.

<<comment
For proper modularization of code. (TO BE IMPLEMENTED)
export PGHOST=${PGHOST-localhost}
export PGPORT=${PGPORT-5432}
export PGDATABASE=${PGDATABASE-doccollab}
export PGUSER=${PGUSER-app}
export PGPASSWORD=${PGPASSWORD-app2020}
comment


<<comment 
Command line arguments. (TO BE IMPLEMENTED)
/*
DB_NAME=$1
PG_USER=$2
PG_PASSSWORD=$3
comment


CREATE_DB_FILE=create_db.sql

psql -U postgres -a -f $CREATE_DB_FILE -h localhost 
#echo $CREATE_MYDB
# Run create db script.

#RUN_ON_MYDB="psql -U postgres -a -f ${f} -h localhost "

for f in ./db_config/*; do
  case "$f" in
    *_db.sql)    echo "$0: ignoring $f";;
    *.sql) psql -U postgres -a -f ${f} -h localhost -d doccollabtest ;;
    *)        echo "$0: ignoring $f" ;;
  esac
  echo
done

POPULATE_MYDB=populate_db.sql
psql -U postgres -a -f $POPULATE_MYDB -h localhost -d doccollabtest
#echo $POPULATE_MYDB 

<<comment
For uploading db dump into dockerized container pgadmin address
pg_dump --attribute-inserts --dbname=doccollabtest --username=postgres --password --host=localhost --file=ethicapp-postgres-$(date +%F).sql
psql postgresql://app:app2020@localhost:5432/doccollab --file=ethicapp-postgres-$(date +%F).sql--quiet
comment
