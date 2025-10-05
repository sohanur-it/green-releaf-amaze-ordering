// Server/Models/crm/contactModel.js

const db = require('../../config/database');

//this model is just for messin with contacts. Again, keeping it clean.
const Contact = {

    //creates a new contact for a specific buyer
    async create(buyerId, contactData) {
        const { name, title, email, primary_phone } = contactData;
        const query = `
            INSERT INTO "ORDERS-buyer_contacts"
                (orders_buyer_id, name, title, email, primary_phone, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            RETURNING *;
        `;
        // RETURNING * is sick, as it sends back the whole new contact row after it's made.
        // the front end can use this to update the page without another fetch. :)

        try {
            const { rows } = await db.query(query, [buyerId, name, title, email, primary_phone]);
            return rows[0];
        } catch (err) {
            console.error('Error creating contact:', err);
            throw err;
        }
    },

    // updates an existing contact
    async update(contactId, contactData) {
        const { name, title, email, primary_phone } = contactData;
        const query = `
            UPDATE "ORDERS-buyer_contacts"
            SET
                name = $1,
                title = $2,
                email = $3,
                primary_phone = $4,
                updated_at = NOW()
            WHERE
                entry_id = $5
            RETURNING *;
        `;
        // returning the updated row is great for the front end
        try {
            const { rows } = await db.query(query, [name, title, email, primary_phone, contactId]);
            return rows[0];
        } catch (err) {
            console.error(`Error updating contact ${contactId}:`, err);
            throw err;
        }
    },

    // deletes a contact. simple as.
    async deleteById(contactId) {
        const query = 'DELETE FROM "ORDERS-buyer_contacts" WHERE entry_id = $1;';
        try {
            await db.query(query, [contactId]);
            return;
        } catch (err) {
            console.error(`Error deleting contact ${contactId}:`, err);
            throw err;
        }
    }
};

module.exports = Contact;