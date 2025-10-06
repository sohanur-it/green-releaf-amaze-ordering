// Server/Routes/admin-routes.js

const express = require('express');
const router = express.Router();
const buyerController = require('../Controllers/crm/buyerController');
const salesRepController = require('../Controllers/crm/salesRepController');

// Route to render the main admin dashboard
router.get('/', (req, res) => {
    res.render('admin/dashboard', {
        title: 'Dashboard',
        layout: 'layouts/main'
    });
});

// Route to render the CRM page, handled by our controller
router.get('/crm', buyerController.getAllBuyers);

// The page to manage all sales reps
router.get('/crm/sales-reps', salesRepController.showRepsPage);

// otherwise the server will think "new" is an ID.
router.get('/crm/buyers/new', buyerController.showAddBuyerForm);

// POST route to handle the form submission and create the new buyer.
router.post('/crm/buyers', buyerController.createBuyer);

// GET route to show the form for editing an existing buyer.
router.get('/crm/buyers/:id/edit', buyerController.showEditBuyerForm);

// POST route to handle the submission of the edit form.
router.post('/crm/buyers/:id', buyerController.updateBuyer);

// POST route to handle the actual deletion of a buyer.
router.post('/crm/buyers/:id/delete', buyerController.deleteBuyer);

//route to display a single buyer's profile page.
// The ':id' part is a placeholder for the actual buyer's entry_id
router.get('/crm/buyers/:id', buyerController.getBuyerById);

module.exports = router;