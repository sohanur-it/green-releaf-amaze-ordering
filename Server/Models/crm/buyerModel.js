//Server/Models/crm/buyerModel.js

const db = require('../../config/database');

//this model is just for grabbing buyer data from the db.
//keeps all the ugly sql in one place.

const Buyer = {
    //function to get all buyers. gonna use this for the main crm table.
    //the query is basically the one from the docs I made.
    async getAll() {
        const query = `
            SELECT
                b.entry_id,
                b.name,
                b.website_url,
                b.buyer_type,
                s.name AS stage_name,
                s.color AS stage_color,
                df.name AS deal_flow_name,
                (SELECT COUNT(*) FROM "ORDERS-buyer_contacts" WHERE orders_buyer_id = b.entry_id) AS contact_count,
                (SELECT string_agg(t.name, ', ') FROM "ORDERS-buyer_tags" t WHERE t.orders_buyer_id = b.entry_id) AS tags
            FROM "ORDERS-buyers" b
                     LEFT JOIN "ORDERS-buyer_stages" s ON b.fk_stage_id = s.entry_id
                     LEFT JOIN "ORDERS-deal_flows" df ON b.fk_deal_flow_id = df.entry_id
            ORDER BY b.name;
        `;

        try {
            const { rows } = await db.query(query);
            return rows;
        } catch (err) {
            //if ot breaks, log it.
            console.error('Error fetching all buyers:', err);
            throw err;
        }
    },

    // function to get one specific buyer and all their related stuff. the 360 view.
    async findById(id) {
        // we're gonna run a bunch of queries at the same time. it's faster.
        try {
            const buyerQuery = `
                SELECT
                    b.*,
                    s.name AS stage_name,
                    s.color AS stage_color,
                    df.name AS deal_flow_name
                FROM "ORDERS-buyers" b
                         LEFT JOIN "ORDERS-buyer_stages" s ON b.fk_stage_id = s.entry_id
                         LEFT JOIN "ORDERS-deal_flows" df ON b.fk_deal_flow_id = df.entry_id
                WHERE b.entry_id = $1;
            `;

            const contactsQuery = 'SELECT * FROM "ORDERS-buyer_contacts" WHERE orders_buyer_id = $1 ORDER BY name;';
            const locationsQuery = 'SELECT * FROM "ORDERS-buyer_locations" WHERE orders_buyer_id = $1 ORDER BY name;';
            const notesQuery = 'SELECT * FROM "ORDERS-buyer_notes" WHERE orders_buyer_id = $1 ORDER BY created_at DESC;';

            // WE GOTTA UPDATE THIS ONE to include the tag's id
            const tagsQuery = 'SELECT entry_id, name, color, background_color FROM "ORDERS-buyer_tags" WHERE orders_buyer_id = $1 ORDER BY name;';

            // Get sales reps assigned to buyer OR to buyer's locations
            // Combines both buyer-level and location-level assignments
            const salesRepsQuery = `
                WITH buyer_assigned_reps AS (
                    SELECT
                        a.entry_id AS assignment_id,
                        COALESCE(
                            u1.first_name || ' ' || u1.last_name,
                            sr.name
                        ) AS name,
                        COALESCE(u1.email, sr.email) AS email,
                        COALESCE(sr.phone, '') AS phone,
                        'buyer' AS assignment_type,
                        NULL::integer AS location_id
                    FROM "ORDERS-buyer_sales_rep_assignments" a
                        LEFT JOIN "ORDERS-sales_reps" sr ON a.fk_sales_rep_id = sr.entry_id
                        LEFT JOIN users u1 ON sr.email = u1.email
                    WHERE a.fk_buyer_id = $1
                ),
                location_assigned_reps AS (
                    SELECT
                        l.entry_id AS assignment_id,
                        COALESCE(
                            u2.first_name || ' ' || u2.last_name,
                            'Unknown'
                        ) AS name,
                        COALESCE(u2.email, '') AS email,
                        '' AS phone,
                        'location' AS assignment_type,
                        l.entry_id AS location_id
                    FROM "ORDERS-buyer_locations" l
                        LEFT JOIN users u2 ON l.assigned_sales_rep_id = u2.id
                    WHERE l.orders_buyer_id = $1
                        AND l.assigned_sales_rep_id IS NOT NULL
                )
                SELECT DISTINCT ON (COALESCE(email, ''), COALESCE(name, ''))
                    assignment_id,
                    name,
                    email,
                    phone,
                    assignment_type,
                    location_id
                FROM (
                    SELECT * FROM buyer_assigned_reps
                    UNION ALL
                    SELECT * FROM location_assigned_reps
                ) combined
                WHERE name IS NOT NULL AND name != 'Unknown'
                ORDER BY COALESCE(email, ''), COALESCE(name, ''), assignment_id;
            `;

            // fire all the queries off at once!
            const [
                buyerResult,
                contactsResult,
                locationsResult,
                notesResult,
                tagsResult,
                salesRepsResult
            ] = await Promise.all([
                db.query(buyerQuery, [id]),
                db.query(contactsQuery, [id]),
                db.query(locationsQuery, [id]),
                db.query(notesQuery, [id]),
                db.query(tagsQuery, [id]),
                db.query(salesRepsQuery, [id])
            ]);

            // if we didn't find a buyer, just return null
            if (buyerResult.rows.length === 0) {
                return null;
            }

            // smash all the results together into one big object
            return {
                details: buyerResult.rows[0],
                contacts: contactsResult.rows,
                locations: locationsResult.rows,
                notes: notesResult.rows,
                tags: tagsResult.rows,
                salesReps: salesRepsResult.rows
            };

        } catch (err) {
            console.error(`Error fetching buyer by id ${id}:`, err);
            throw err;
        }
    },

    // gets all stages. for the 'add new buyer' form dropdown.
    async getAllStages() {
        try {
            const { rows } = await db.query('SELECT entry_id, name FROM "ORDERS-buyer_stages" ORDER BY sort_order;');
            return rows;
        } catch (err) {
            console.error('Error fetching all buyer stages:', err);
            throw err;
        }
    },

    // gets all deal flows. also for the form dropdown.
    async getAllDealFlows() {
        try {
            const { rows } = await db.query('SELECT entry_id, name FROM "ORDERS-deal_flows" ORDER BY name;');
            return rows;
        } catch (err) {
            console.error('Error fetching all deal flows:', err);
            throw err;
        }
    },

    //this function actually creates the new buyer in the db
    async create(buyerData) {
        const { name, website_url, buyer_type, fk_stage_id, fk_deal_flow_id } = buyerData;

        // the query to insert a new row.
        // the RETURNING entry_id part is clutch, it gives us back the new id
        // so we can redirect the user right to the new profile page.
        const query = `
            INSERT INTO "ORDERS-buyers"
            (name, website_url, buyer_type, fk_stage_id, fk_deal_flow_id, source, created_at, updated_at)
            VALUES
                ($1, $2, $3, $4, $5, 'INTERNAL', NOW(), NOW())
            RETURNING entry_id;
        `;

        try {
            const { rows } = await db.query(query, [name, website_url, buyer_type, fk_stage_id, fk_deal_flow_id]);
            return rows[0]; // returns { entry_id: new_id }
        } catch (err) {
            console.error('Error creating buyer:', err);
            throw err;
        }
    },

    async update(id, buyerData) {
        const { name, website_url, buyer_type, fk_stage_id, fk_deal_flow_id } = buyerData;

        const query = `
            UPDATE "ORDERS-buyers"
            SET
                name = $1,
                website_url = $2,
                buyer_type = $3,
                fk_stage_id = $4,
                fk_deal_flow_id = $5,
                updated_at = NOW()
            WHERE
                entry_id = $6;
        `;

        try {
            // we don't need to return anything here, just wait for it to finish
            await db.query(query, [name, website_url, buyer_type, fk_stage_id, fk_deal_flow_id, id]);
            return;
        } catch (err) {
            console.error(`Error updating buyer ${id}:`, err);
            throw err;
        }
    },

    async deleteById(id) {
        // thanks to 'ON DELETE CASCADE' in the database schema, we only need to delete
        // the buyer record itself. The database will automatically delete all of its
        // contacts, notes, locations, tags, etc. Super efficient. :)
        const query = 'DELETE FROM "ORDERS-buyers" WHERE entry_id = $1;';
        try {
            await db.query(query, [id]);
            return;
        } catch (err) {
            console.error(`Error deleting buyer ${id}:`, err);
            throw err;
        }
    }
};

// we'll add more functions here later like...
// findById(id)
// create(buyerData)
// update(id, buyerData)
// delete(id)

module.exports = Buyer;