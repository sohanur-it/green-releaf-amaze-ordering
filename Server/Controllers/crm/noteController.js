// Server/Controllers/crm/noteController.js

const Note = require('../../Models/crm/noteModel');

//api controller for notes. just sends back json.

const createNote = async (req, res) => {
    try {
        const { buyerId } = req.params;
        const newNote = await Note.create(buyerId, req.body);
        res.status(201).json(newNote);
    } catch (err) {
        res.status(500).json({ message: "Failed to create note", error: err.message });
    }
};

const updateNote = async (req, res) => {
    try {
        const { noteId } = req.params;
        const updatedNote = await Note.update(noteId, req.body);
        res.status(200).json(updatedNote);
    } catch (err) {
        res.status(500).json({ message: "Failed to update note", error: err.message });
    }
};

const deleteNote = async (req, res) => {
    try {
        const { noteId } = req.params;
        await Note.deleteById(noteId);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ message: "Failed to delete note", error: err.message });
    }
};

module.exports = {
    createNote,
    updateNote,
    deleteNote
};