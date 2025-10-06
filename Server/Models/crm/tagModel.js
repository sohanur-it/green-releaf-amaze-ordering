// Server/Models/crm/tagModel.js

const db = require('../../config/database');

// model for tag stuff. pretty straightforward.

const Tag = {
    // adds a new tag to a buyer
    async create(buyerId, tagData) {
        const { name, color, background_color } = tagData;
        const query = `
            INSERT INTO "ORDERS-buyer_tags" (orders_buyer_id, name, color, background_color)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        try {
            const { rows } = await db.query(query, [buyerId, name, color, background_color]);
            return rows[0];
        } catch (err) {
            console.error('Error creating tag:', err);
            throw err;
        }
    },

    // updates a tag's name and colors
    async update(tagId, tagData) {
        const { name, color, background_color } = tagData;
        const query = `
            UPDATE "ORDERS-buyer_tags"
            SET name = $1, color = $2, background_color = $3
            WHERE entry_id = $4
            RETURNING *;
        `;
        try {
            const { rows } = await db.query(query, [name, color, background_color, tagId]);
            return rows[0];
        } catch (err) {
            console.error(`Error updating tag ${tagId}:`, err);
            throw err;
        }
    },

    // delets a tag. BOOM! gone.
    async deleteById(tagId) {
        const query = 'DELETE FROM "ORDERS-buyer_tags" WHERE entry_id = $1;';
        try {
            await db.query(query, [tagId]);
            return;
        } catch (err) {
            console.error(`Error deleting tag ${tagId}:`, err);
            throw err;
        }
    }
};

module.exports = Tag;