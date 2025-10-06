// Server/Controllers/crm/tagController.js

const Tag = require('../../Models/crm/tagModel');

// api controller for tags. just spits out json.

const createTag = async (req, res) => {
    try {
        const { buyerId } = req.params;
        const newTag = await Tag.create(buyerId, req.body);
        res.status(201).json(newTag);
    } catch (err) {
        res.status(500).json({ message: "Failed to create tag", error: err.message });
    }
};

const updateTag = async (req, res) => {
    try {
        const { tagId } = req.params;
        const updatedTag = await Tag.update(tagId, req.body);
        res.status(200).json(updatedTag);
    } catch (err) {
        res.status(500).json({ message: "Failed to update tag", error: err.message });
    }
};

const deleteTag = async (req, res) => {
    try {
        const { tagId } = req.params;
        await Tag.deleteById(tagId);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ message: "Failed to delete tag", error: err.message });
    }
};

module.exports = {
    createTag,
    updateTag,
    deleteTag
};