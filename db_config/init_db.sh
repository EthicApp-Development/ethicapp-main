#Temporary file to run automatization of db.


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



#Creates the database $DB_NAME in server.
CREATE_DB_FILE=db_config/create_db.sql
psql -U $PG_USER -a -f $CREATE_DB_FILE -h $PGHOST -p $PGPORT -v db_name=$DB_NAME -v pg_user=$PG_USER -v pg_password=$PG_PASSSWORD


#Creates connection string for new database.
connectionString=postgresql://$PG_USER:$PG_PASSSWORD@$PGHOST:$PGPORT/$DB_NAME



# Creates and implements the schema for db $DB_NAME.
for f in ./db_config/create_sql_schema/* ; do
  case "$f" in
    *.sql) psql $connectionString --file=${f} ;;

  esac
  echo
done


#Populates db with test users.
POPULATE_MYDB=db_config/populate_db.sql
psql -U $PG_USER -a -f $POPULATE_MYDB -h $PGHOST -p $PGPORT -d $DB_NAME


#Once the database it's fully created, it exports the connection string to the rest of the app.
export DBCON==${DBCON-postgresql://$PG_USER:$PG_PASSSWORD@postgres/$DB_NAME}
DBCON=$DBCON node modules/passwords.js


<<comment
#For uploading db dump into dockerized container pgadmin address
pg_dump --attribute-inserts --dbname=doccollab --username=postgres --password --host=localhost --port=5433 --file=ethicapp-postgres-$(date +%F).sql
psql $connectionString --file=ethicapp-postgres-$(date +%F).sql --quiet
comment