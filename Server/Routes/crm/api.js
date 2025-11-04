// Server/Routes/crm/api.js

const express = require('express');
const router = express.Router();
const buyerController = require('../../Controllers/crm/buyerController');
const contactController = require('../../Controllers/crm/contactController');
const locationController = require('../../Controllers/crm/locationController');
const noteController = require('../../Controllers/crm/noteController');
const salesRepController = require('../../Controllers/crm/salesRepController');
const tagController = require('../../Controllers/crm/tagController');

// this is where all our crm api routes will go. keeps it cleannn

/*
 * @route   GET /api/crm/buyers
 * @desc    Get all buyers as JSON
 * @access  Private
 */
//this is the same controller function, but it would be modified to return JSON
const getBuyersApi = async (req, res) => {
    try {
        const Buyer = require('../../Models/crm/buyerModel');
        const buyers = await Buyer.getAll();
        res.json(buyers); // sends data back as json. front end will love this.
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch buyers' });
    }
};

router.get('/buyers', getBuyersApi);

// --- Contact Routes ---

// @route   POST /api/crm/buyers/:buyerId/contacts
// @desc    Create a new contact for a buyer
// @access  Private
router.post('/buyers/:buyerId/contacts', contactController.createContact);

// @route   PATCH /api/crm/contacts/:contactId
// @desc    Update an existing contact
// @access  Private
router.patch('/contacts/:contactId', contactController.updateContact);

// @route   DELETE /api/crm/contacts/:contactId
// @desc    Delete a contact
// @access  Private
router.delete('/contacts/:contactId', contactController.deleteContact);

// --- Location Routes ---

// @route   POST /api/crm/buyers/:buyerId/locations
// @desc    Create a new location for a buyer
router.post('/buyers/:buyerId/locations', locationController.createLocation);

// @route   PATCH /api/crm/locations/:locationId
// @desc    Update an existing location
router.patch('/locations/:locationId', locationController.updateLocation);

// @route   DELETE /api/crm/locations/:locationId
// @desc    Delete a location
router.delete('/locations/:locationId', locationController.deleteLocation);

// --- NOTE ROUTES ---

// @route   POST /api/crm/buyers/:buyerId/notes
// @desc    Create a new note for a buyer
router.post('/buyers/:buyerId/notes', noteController.createNote);

// @route   PATCH /api/crm/notes/:noteId
// @desc    Update an existing note
router.patch('/notes/:noteId', noteController.updateNote);

// @route   DELETE /api/crm/notes/:noteId
// @desc    Delete a note
router.delete('/notes/:noteId', noteController.deleteNote);

// @route   POST /api/crm/buyers/:buyerId/sales-reps
// @desc    Assign a sales rep to a buyer
router.post('/buyers/:buyerId/sales-reps', salesRepController.assignRep);

// @route   DELETE /api/crm/sales-reps/assignments/:assignmentId
// @desc    Unassign a sales rep from a buyer
router.delete('/sales-reps/assignments/:assignmentId', salesRepController.unassignRep);

// @route   POST /api/crm/locations/assign-sales-rep
// @desc    Assign a sales rep to a location
router.post('/locations/assign-sales-rep', salesRepController.assignRepToLocation);

// @route   DELETE /api/crm/locations/:locationId/unassign-sales-rep
// @desc    Unassign a sales rep from a location
router.delete('/locations/:locationId/unassign-sales-rep', salesRepController.unassignRepFromLocation);

// --- SALES REP CRUD ROUTES (for the management page) ---
router.post('/sales-reps', salesRepController.createRep);
router.patch('/sales-reps/:repId', salesRepController.updateRep);
router.delete('/sales-reps/:repId', salesRepController.deleteRep);

// --- TAG ROUTES ---
router.post('/buyers/:buyerId/tags', tagController.createTag);
router.patch('/tags/:tagId', tagController.updateTag);
router.delete('/tags/:tagId', tagController.deleteTag);


//just a placeholder so the app doesnt crash lol
router.get('/', (req, res) => {
    res.json({ message: 'CRM API cookin' });
});


module.exports = router;