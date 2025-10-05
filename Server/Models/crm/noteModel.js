// Server/Models/crm/noteModel.js

const db = require('../../config/database');

//model for notes. simple stuff. title and text.
const Note = {

    //creates a new note for a buyer
    async create(buyerId, noteData) {
        const { title, text } = noteData;
        const query = `
            INSERT INTO "ORDERS-buyer_notes"
                (orders_buyer_id, title, text, created_at, updated_at)
            VALUES ($1, $2, $3, NOW(), NOW())
            RETURNING *;
        `;
        try {
            const { rows } = await db.query(query, [buyerId, title, text]);
            return rows[0];
        } catch (err) {
            console.error('Error creating note:', err);
            throw err;
        }
    },

    //updates an existing note
    async update(noteId, noteData) {
        const { title, text } = noteData;
        const query = `
            UPDATE "ORDERS-buyer_notes"
            SET
                title = $1,
                text = $2,
                updated_at = NOW()
            WHERE
                entry_id = $3
            RETURNING *;
        `;
        try {
            const { rows } = await db.query(query, [title, text, noteId]);
            return rows[0];
        } catch (err) {
            console.error(`Error updating note ${noteId}:`, err);
            throw err;
        }
    },

    //deletes a note
    async deleteById(noteId) {
        const query = 'DELETE FROM "ORDERS-buyer_notes" WHERE entry_id = $1;';
        try {
            await db.query(query, [noteId]);
            return;
        } catch (err) {
            console.error(`Error deleting note ${noteId}:`, err);
            throw err;
        }
    }
};

module.exports = Note;