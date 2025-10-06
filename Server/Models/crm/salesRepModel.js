// Server/Models/crm/salesRepModel.js

const db = require('../../config/database');

// this thing handles all the sales rep db stuff.

const SalesRep = {
    // gets all sales reps. gonna need this for the dropdown.
    async getAll() {
        try {
            const { rows } = await db.query('SELECT * FROM "ORDERS-sales_reps" ORDER BY name;');
            return rows;
        } catch (err) {
            console.error('Error fetching all sales reps:', err);
            throw err;
        }
    },

    // finds one rep by their id. need it for editing.
    async findById(repId) {
        try {
            const { rows } = await db.query('SELECT * FROM "ORDERS-sales_reps" WHERE entry_id = $1;', [repId]);
            return rows[0];
        } catch (err) {
            console.error(`Error finding sales rep ${repId}:`, err);
            throw err;
        }
    },

    // creates a new rep in the master table
    async create(repData) {
        const { name, email, phone } = repData;
        const query = `
            INSERT INTO "ORDERS-sales_reps" (name, email, phone, created_at, updated_at)
            VALUES ($1, $2, $3, NOW(), NOW())
            RETURNING *;
        `;
        try {
            const { rows } = await db.query(query, [name, email, phone]);
            return rows[0];
        } catch (err) {
            console.error('Error creating sales rep:', err);
            throw err;
        }
    },

    // updates a rep
    async update(repId, repData) {
        const { name, email, phone } = repData;
        const query = `
            UPDATE "ORDERS-sales_reps"
            SET name = $1, email = $2, phone = $3, updated_at = NOW()
            WHERE entry_id = $4
            RETURNING *;
        `;
        try {
            const { rows } = await db.query(query, [name, email, phone, repId]);
            return rows[0];
        } catch (err) {
            console.error(`Error updating sales rep ${repId}:`, err);
            throw err;
        }
    },

    // deletes a rep. careful with this one lol.
    // CASCADE on the db will also remove all their assignments.
    async deleteById(repId) {
        const query = 'DELETE FROM "ORDERS-sales_reps" WHERE entry_id = $1;';
        try {
            await db.query(query, [repId]);
            return;
        } catch (err) {
            console.error(`Error deleting sales rep ${repId}:`, err);
            throw err;
        }
    },

    // assigns a rep to a buyer. basically just creates a row in that junction table.
    async assignToBuyer(buyerId, salesRepId) {
        const query = `
            INSERT INTO "ORDERS-buyer_sales_rep_assignments" (fk_buyer_id, fk_sales_rep_id)
            VALUES ($1, $2)
            RETURNING *;
        `;
        // also check if its already assigned so we dont get dupes
        const checkQuery = 'SELECT * FROM "ORDERS-buyer_sales_rep_assignments" WHERE fk_buyer_id = $1 AND fk_sales_rep_id = $2;';

        try {
            const { rows: existing } = await db.query(checkQuery, [buyerId, salesRepId]);
            if (existing.length > 0) {
                // lol they already tried to add this one.
                throw new Error('Sales rep is already assigned to this buyer.');
            }

            const { rows } = await db.query(query, [buyerId, salesRepId]);
            // now we need to get the full rep info to send back to the front end
            const getRepQuery = `
                SELECT a.entry_id AS assignment_id, sr.*
                FROM "ORDERS-buyer_sales_rep_assignments" a
                JOIN "ORDERS-sales_reps" sr ON a.fk_sales_rep_id = sr.entry_id
                WHERE a.entry_id = $1;
            `;
            const result = await db.query(getRepQuery, [rows[0].entry_id]);
            return result.rows[0];
        } catch (err) {
            console.error('Error assigning sales rep:', err);
            throw err;
        }
    },

    // unassigns a rep. just deletes the row in the junction table. easy peasy.
    async unassignFromBuyer(assignmentId) {
        const query = 'DELETE FROM "ORDERS-buyer_sales_rep_assignments" WHERE entry_id = $1;';
        try {
            await db.query(query, [assignmentId]);
            return;
        } catch (err) {
            console.error(`Error unassigning sales rep (assignment id ${assignmentId}):`, err);
            throw err;
        }
    }
};

module.exports = SalesRep;