// Server/Models/crm/locationModel.js

const db = require('../../config/database');
const crypto = require('crypto');

//model for handling all the location data logic.
const Location = {

    // creates a new location for a specific buyer
    async create(buyerId, locationData) {
        const { name, line_one, line_two, city, state, zip, state_license, delivery_zone } = locationData;

        // generate a unique code for the url access thingy later.
        const accessCode = crypto.randomUUID();

        const query = `
            INSERT INTO "ORDERS-buyer_locations"
            (orders_buyer_id, name, line_one, line_two, city, state, zip, state_license, delivery_zone, access_code, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
            RETURNING *;
        `;
        try {
            const { rows } = await db.query(query, [buyerId, name, line_one, line_two, city, state, zip, state_license, delivery_zone || null, accessCode]);
            return rows[0];
        } catch (err) {
        console.error('Error creating location:', err);
        throw err;
    }
    },

    //updates an existing location
    // we dont touch the access_code here. It should never change. EVER.
    async update(locationId, locationData) {
        const { name, line_one, line_two, city, state, zip, state_license, delivery_zone } = locationData;
        const query = `
            UPDATE "ORDERS-buyer_locations"
            SET
                name = $1,
                line_one = $2,
                line_two = $3,
                city = $4,
                state = $5,
                zip = $6,
                state_license = $7,
                delivery_zone = $8,
                updated_at = NOW()
            WHERE
                entry_id = $9
            RETURNING *;
        `;
        try {
            const { rows } = await db.query(query, [name, line_one, line_two, city, state, zip, state_license, delivery_zone || null, locationId]);
            return rows[0];
        } catch (err) {
            console.error(`Error updating location ${locationId}:`, err);
            throw err;
        }
    },

    //deletes a location
    async deleteById(locationId) {
        const query = 'DELETE FROM "ORDERS-buyer_locations" WHERE entry_id = $1;';
        try {
            await db.query(query, [locationId]);
            return;
        } catch (err) {
            console.error(`Error deleting location ${locationId}:`, err);
            throw err;
        }
    }
};

module.exports = Location;