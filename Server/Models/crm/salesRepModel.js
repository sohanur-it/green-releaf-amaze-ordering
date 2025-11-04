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

    // finds one rep by their email. need it to check for duplicates.
    async findByEmail(email) {
        try {
            const { rows } = await db.query('SELECT * FROM "ORDERS-sales_reps" WHERE email = $1;', [email]);
            return rows[0] || null;
        } catch (err) {
            console.error(`Error finding sales rep by email ${email}:`, err);
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

    // Helper: Get or create sales rep entry for a user
    async getOrCreateSalesRepForUser(userId) {
        const UserModel = require('../userModel');
        const user = await UserModel.findById(userId);
        
        if (!user) {
            throw new Error('User not found');
        }

        // Check if sales rep entry already exists for this user
        // We'll use a pattern: check by email or create new
        const checkQuery = `
            SELECT entry_id FROM "ORDERS-sales_reps" 
            WHERE email = $1 OR name = $2
            LIMIT 1
        `;
        const { rows: existing } = await db.query(checkQuery, [
            user.email,
            `${user.firstname} ${user.lastname}`.trim()
        ]);

        if (existing.length > 0) {
            return existing[0].entry_id;
        }

        // Create new sales rep entry for this user
        const createQuery = `
            INSERT INTO "ORDERS-sales_reps" (name, email, created_at, updated_at)
            VALUES ($1, $2, NOW(), NOW())
            RETURNING entry_id
        `;
        const { rows: newRep } = await db.query(createQuery, [
            `${user.firstname} ${user.lastname}`.trim(),
            user.email
        ]);

        return newRep[0].entry_id;
    },

    // assigns a rep to a buyer. now accepts user ID and creates/uses sales rep entry
    async assignToBuyer(buyerId, userId) {
        // userId is actually a user ID now, not a sales_rep entry_id
        // We need to get or create a sales rep entry for this user
        const salesRepEntryId = await this.getOrCreateSalesRepForUser(userId);
        
        const query = `
            INSERT INTO "ORDERS-buyer_sales_rep_assignments" (fk_buyer_id, fk_sales_rep_id)
            VALUES ($1, $2)
            RETURNING *;
        `;
        // also check if its already assigned so we dont get dupes
        const checkQuery = 'SELECT * FROM "ORDERS-buyer_sales_rep_assignments" WHERE fk_buyer_id = $1 AND fk_sales_rep_id = $2;';

        try {
            const { rows: existing } = await db.query(checkQuery, [buyerId, salesRepEntryId]);
            if (existing.length > 0) {
                // lol they already tried to add this one.
                throw new Error('Sales rep is already assigned to this buyer.');
            }

            const { rows } = await db.query(query, [buyerId, salesRepEntryId]);
            // now we need to get the full rep info to send back to the front end
            // Get the user info directly since we know the userId
            const UserModel = require('../userModel');
            const user = await UserModel.findById(userId);
            
            // Return formatted response with user info
            return {
                assignment_id: rows[0].entry_id,
                name: user ? `${user.firstname} ${user.lastname}`.trim() : 'Unknown',
                email: user?.email || '',
                phone: '' // Phone not stored in users table
            };
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
    },

    // Assigns a sales rep to a location (updates the location's assigned_sales_rep_id)
    async assignToLocation(locationId, userId) {
        try {
            // First check if location exists
            const locationCheck = await db.query(
                'SELECT entry_id FROM "ORDERS-buyer_locations" WHERE entry_id = $1',
                [locationId]
            );

            if (locationCheck.rows.length === 0) {
                throw new Error('Location not found');
            }

            // Update the location's assigned_sales_rep_id
            // Note: We need to check if the column exists, if not we'll need to add it
            const updateQuery = `
                UPDATE "ORDERS-buyer_locations" 
                SET assigned_sales_rep_id = $1, updated_at = NOW()
                WHERE entry_id = $2
                RETURNING entry_id, assigned_sales_rep_id;
            `;

            const { rows } = await db.query(updateQuery, [userId, locationId]);

            // Get user info for response
            const UserModel = require('../userModel');
            const user = await UserModel.findById(userId);

            return {
                location_id: rows[0].entry_id,
                sales_rep_id: rows[0].assigned_sales_rep_id,
                sales_rep_name: user ? `${user.firstname} ${user.lastname}`.trim() : 'Unknown',
                sales_rep_email: user?.email || ''
            };
        } catch (err) {
            console.error('Error assigning sales rep to location:', err);
            throw err;
        }
    }
};

module.exports = SalesRep;