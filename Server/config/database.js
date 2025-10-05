// Server/config/database.js

const { Pool } = require('pg');
require('dotenv').config();

//this thing handles our connection to the database.
//it uses the details from our .ENV file so we're not hardcoding passwords and shit.
//security thing even though I don't do it much when building quick. Lol
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

//a simple function to run queries. we'll use this everywhere.
//keeps it consistent.
module.exports = {
    query: (text, params) => pool.query(text, params),
};