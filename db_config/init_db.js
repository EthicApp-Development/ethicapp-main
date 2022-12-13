
let pass = require("../modules/passwords");

const {Client } = require('pg')
 
// pools will use environment variables
// for connection information
const client = new Client({
        host: 'localhost',
        port: 5334,
        user: 'app',
        password: 'app2020',
      })

/*
Alternative way of creartng client
const client = new Client({
	connectionString: 'tcp://app:app2020@postgres/doccollab'
});
*/

client.connect((err) => {
        if (err) {
                console.error('connection error', err.stack)
        } else {
                console.log('connected')
        }
})

const init_files = ['create_db.sql', 'create_', 'populate_db.sql']
const number_of_files = 38
const sql_queries = []
var file_to_be_read ; var dataSql; var dataArr
for (let i=0; i<number_of_files; i++){
        file_to_be_read = './db_config/'
        if (!i){
                file_to_be_read += init_files[0]
        }

        else if (i==37){
                file_to_be_read += init_files[2]
        }
        else{
                file_to_be_read += init_files[1]
                file_to_be_read += i.toString()
                file_to_be_read += '.sql'
        }

        dataSql = fs.readFileSync(file_to_be_read).toString();
        dataArr = dataSql.toString().split(';');
        
        /*
        Careful here with populate_db.sql because with this method 
        we'll be inserting value parameters as text, 
        which could lead to sql injection vulnerabilities.

        It can be easily solved with a simple refactor, where we create 
        the populate_db.sql query directly in this file. 
        Should look something like:
        
        const text = 'INSERT INTO users ... VALUES ($1, $2,...) RETURNING *' ;
        const values = ['user_username', 'user_password', 'user_email', ...]
        client.query(text, values, (err, res) => {
                ...
        })
        */
        dataArr.array.forEach(query => {
                if(query){
                        query += ';' ;
                        client.query(query, (err, res) => {
                                if (err) {
                                  console.log(err.stack)
                                } else {
                                  console.log(res.rows[0])
                                }
                              })
                }
                
        });

}
