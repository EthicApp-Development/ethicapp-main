# Database config SQL scripts
This directory contains hand-made migrations scripts for setting up the database schema.

# Sequence for creation of DB.
For creating a database image with the existing schema, go to the root directory of the project and run `sh db_config/init_db.sh ${YOUR_DB_NAME}  ${YOUR_PG_USER} ${YOUR_PG_PASSWORD} ${PG_PORT}`, where you'll pass both your credentials and the database name and create a database image you can see and interact with in your pgadmin server page. The variables `YOUR_DB_NAME`, `YOUR_PG_USER`, `YOUR_PG_PASSWORD` & `PG_PORT` are required only when you have different credentials than the project standards, which you can see in the `init_db.sh` file. Nevertheless, for security reasons, it's always recommended that you use your own credentials each time you need to run this script.

This DB will come with some test users for you to use right away. These are: 

# Common issues 
1. A common issue is that you don't have client authentication for postgres in the project. You can easily diagnose this problem if you can connect to your newly created database in 'pgAdmin' through localhost:5555, but you cannot see it in your desktop 'pgAdmin' app. 
To solve it, you'll need to go to the 'pg_hba.conf' file (in the 'postgres' folder at the root of the project). Here, you'll need to find the 'IPv4 local connections:' section, and add the following line: `host    all             all             ${YOUR_IP_ADDRESS}            md5`, which will give permission to the host with the given IP address. 

# Pending
1. Currently, the script will update your pg connectionString only if you have already created the `modules/passwords.js`. If it is not created already, it could be easily implemented an automatic creation of this file, and change the pg connectionString once it is done. 
2. If the `init_db.sh` script is run multiple times, it populates the database with the same users multiple times. Should implement a barrier to not populate the same database more than once. 

