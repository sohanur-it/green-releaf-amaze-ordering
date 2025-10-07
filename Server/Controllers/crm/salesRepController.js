// Server/Controllers/crm/salesRepController.js

const SalesRep = require('../../Models/crm/salesRepModel');

// controller for the sales rep api. just json.

// --- Page Rendering ---

// shows the new management page
const showRepsPage = async (req, res, next) => {
    try {
        const reps = await SalesRep.getAll();
        res.render('admin/crm/sales-reps', {
            title: 'CRM - Manage Sales Reps',
            layout: 'layouts/main',
            reps: reps
        });
    } catch (err) {
        next(err);
    }
};

const assignRep = async (req, res) => {
    try {
        const { buyerId } = req.params;
        const { salesRepId } = req.body; // get the rep's id from the form
        if (!salesRepId) {
            return res.status(400).json({ message: "You forgot to select a sales rep lol" });
        }
        const newAssignment = await SalesRep.assignToBuyer(buyerId, salesRepId);
        res.status(201).json(newAssignment);
    } catch (err) {
        res.status(500).json({ message: "Failed to assign sales rep", error: err.message });
    }
};

const unassignRep = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        await SalesRep.unassignFromBuyer(assignmentId);
        res.status(204).send(); // success, no content back
    } catch (err) {
        res.status(500).json({ message: "Failed to unassign sales rep", error: err.message });
    }
};

// --- API Functions for Rep CRUD ---

const createRep = async (req, res) => {
    try {
        const newRep = await SalesRep.create(req.body);
        res.status(201).json(newRep);
    } catch (err) {
        res.status(500).json({ message: "Failed to create sales rep", error: err.message });
    }
};

const updateRep = async (req, res) => {
    try {
        const { repId } = req.params;
        const updatedRep = await SalesRep.update(repId, req.body);
        res.status(200).json(updatedRep);
    } catch (err) {
        res.status(500).json({ message: "Failed to update sales rep", error: err.message });
    }
};

const deleteRep = async (req, res) => {
    try {
        const { repId } = req.params;
        await SalesRep.deleteById(repId);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ message: "Failed to delete sales rep", error: err.message });
    }
};

module.exports = {
    showRepsPage,
    assignRep,
    unassignRep,
    createRep,
    updateRep,
    deleteRep
};