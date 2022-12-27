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



#Necessary permission are granted to use the app with the newly created database.
for tbl in `psql -qAt -c "select tablename from pg_tables where schemaname = 'public';" $DB_NAME` ; do 
  psql -c "alter table \"$tbl\" owner to $PG_USER" $DB_NAME ; 
done

for tbl in `psql -qAt -c "select sequence_name from information_schema.sequences where sequence_schema = 'public';" $DB_NAME` ; 
  do  psql -c "alter sequence \"$tbl\" owner to $PG_USER" $DB_NAME ; 
done

for tbl in `psql -qAt -c "select table_name from information_schema.views where table_schema = 'public';" $DB_NAME` ; do  
  psql -c "alter view \"$tbl\" owner to $PG_USER" $DB_NAME ; 
done



#Populates db with test users.
# [TODO] Should create a check to not populate the DB more than once. 
#You shouldn't run this program more then once, but it wouldn't hurt to implement this verification
POPULATE_MYDB=db_config/populate_db.sql
psql -U $PG_USER -a -f $POPULATE_MYDB -h $PGHOST -p $PGPORT -d $DB_NAME



#Once the database it's fully created, it exports the connection string to the rest of the app.
export DBCON=${DBCON:-\"tcp://$PG_USER:$PG_PASSSWORD@postgres/$DB_NAME\"}
PASSWORD_FILE=modules/passwords.js
TEMP_FILE=temp.txt
if [ -f $PASSWORD_FILE ]; 
then 
  #If passwords.js file exists, then updates postgresql connectionString to work with the database created.
  touch $TEMP_FILE
  awk -v dbcon="$DBCON" '{sub(/module.exports.dbcon = [^ ]*/, "module.exports.dbcon = "dbcon); print }' $PASSWORD_FILE > $TEMP_FILE
  cp $TEMP_FILE $PASSWORD_FILE
  rm $TEMP_FILE
else echo "File passwords.js doesn't exist. Ask the maintainer getting the required secret values." ;
  #[TODO] Could create here the passwords.js file, but without the secrets...
fi
