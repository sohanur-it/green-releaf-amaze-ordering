// Server/Routes/crm/api.js

const express = require('express');
const router = express.Router();
const buyerController = require('../../Controllers/crm/buyerController');
const contactController = require('../../Controllers/crm/contactController');
const locationController = require('../../Controllers/crm/locationController');
const noteController = require('../../Controllers/crm/noteController');
const salesRepController = require('../../Controllers/crm/salesRepController');
const tagController = require('../../Controllers/crm/tagController');
const purchaseLimitController = require('../../Controllers/crm/purchaseLimitController');
const { requireAuth, requireRole } = require('../../Middleware/auth');
const { query } = require('../../config/database');

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

// @route   GET /api/crm/locations/check-dis
// @desc    Check if a DIS number belongs to another buyer's location
router.get('/locations/check-dis', requireAuth, requireRole('Sales Admin', 'Administrator'), locationController.checkDisNumber);

// @route   POST /api/crm/locations/:locationId/move
// @desc    Move a location from one buyer to another
router.post('/locations/:locationId/move', requireAuth, requireRole('Sales Admin', 'Administrator'), locationController.moveLocation);

// --- Delivery Window Routes ---

// @route   GET /api/crm/locations/:locationId/delivery-windows
// @desc    Get all delivery windows for a location
router.get('/locations/:locationId/delivery-windows', requireAuth, locationController.getLocationWindows);

// @route   POST /api/crm/locations/:locationId/delivery-windows
// @desc    Create a new delivery window for a location
router.post('/locations/:locationId/delivery-windows', requireAuth, requireRole('Sales Admin', 'Administrator', 'Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin'), locationController.createDeliveryWindow);

// @route   PATCH /api/crm/delivery-windows/:windowId
// @desc    Update a delivery window
router.patch('/delivery-windows/:windowId', requireAuth, requireRole('Sales Admin', 'Administrator', 'Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin'), locationController.updateDeliveryWindow);

// @route   DELETE /api/crm/delivery-windows/:windowId
// @desc    Delete a delivery window
router.delete('/delivery-windows/:windowId', requireAuth, requireRole('Sales Admin', 'Administrator', 'Fulfillment Team', 'fulfillment_worker', 'fulfillment_admin'), locationController.deleteDeliveryWindow);

// @route   POST /api/crm/locations/:locationId/validate-delivery-time
// @desc    Validate if a delivery time falls within active windows
router.post('/locations/:locationId/validate-delivery-time', requireAuth, locationController.validateDeliveryTime);

// @route   GET /api/crm/delivery-zones
// @desc    Get all unique delivery zones (for filtering)
router.get('/delivery-zones', requireAuth, locationController.getAllDeliveryZones);

// Purchase limit configuration for locations (Sales Admin / Administrator only)
router.get(
    '/locations/:locationId/purchase-limits',
    requireAuth,
    requireRole('Sales Admin', 'Administrator'),
    purchaseLimitController.getLocationLimits
);

router.put(
    '/locations/:locationId/purchase-limits',
    requireAuth,
    requireRole('Sales Admin', 'Administrator'),
    purchaseLimitController.updateLocationLimits
);

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

// Quick location search (for credits UI, etc.)
router.get(
    '/locations/search',
    requireAuth,
    requireRole('Sales Admin', 'Administrator'),
    async (req, res) => {
        try {
            const term = (req.query.q || '').trim();
            const limit = Math.min(parseInt(req.query.limit, 10) || 15, 50);

            if (term.length < 2) {
                return res.json({ success: true, results: [] });
            }

            const results = await query(
                `
                SELECT
                    l.entry_id AS location_id,
                    l.name AS location_name,
                    l.city,
                    l.state,
                    b.entry_id AS buyer_id,
                    b.name AS buyer_name
                FROM "ORDERS-buyer_locations" l
                INNER JOIN "ORDERS-buyers" b ON l.orders_buyer_id = b.entry_id
                WHERE
                    l.name ILIKE $1
                    OR b.name ILIKE $1
                    OR COALESCE(l.city, '') ILIKE $1
                    OR COALESCE(l.state, '') ILIKE $1
                ORDER BY b.name ASC, l.name ASC
                LIMIT $2
            `,
                [`%${term}%`, limit]
            );

            res.json({
                success: true,
                results: results.rows.map((row) => ({
                    location_id: row.location_id,
                    location_name: row.location_name,
                    buyer_id: row.buyer_id,
                    buyer_name: row.buyer_name,
                    city: row.city,
                    state: row.state
                }))
            });
        } catch (error) {
            console.error('Error searching locations:', error);
            res.status(500).json({ success: false, error: 'Failed to search locations' });
        }
    }
);

// --- SALES REP CRUD ROUTES (for the management page) ---
router.post('/sales-reps', salesRepController.createRep);
router.patch('/sales-reps/:repId', salesRepController.updateRep);
router.delete('/sales-reps/:repId', salesRepController.deleteRep);

// --- TAG ROUTES ---
router.post('/buyers/:buyerId/tags', tagController.createTag);
router.patch('/tags/:tagId', tagController.updateTag);

// --- BUYER INVOICES ---
const invoiceController = require('../../Controllers/invoiceController');
router.get('/buyers/:buyerId/invoices', invoiceController.getBuyerInvoices);


//just a placeholder so the app doesnt crash lol
router.get('/', (req, res) => {
    res.json({ message: 'CRM API cookin' });
});


module.exports = router;