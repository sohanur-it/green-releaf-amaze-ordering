// Server/Controllers/crm/buyerController.js

const Buyer = require('../../Models/crm/buyerModel');
const SalesRep = require('../../Models/crm/salesRepModel');

//gets all buyers and sends em to the crm index page
const getAllBuyers = async (req, res) => {
    try {
        const buyers = await Buyer.getAll();
        res.render('admin/crm/index', {
            title: 'CRM - Buyers',
            buyers: buyers,
            layout: 'layouts/main'
        });
    } catch (err) {
        // if we cant get buyers, show an error page.
        res.status(500).send('Server error while fetching buyers');
    }
};

// gets a single buyer by their id and shows their profile page
const getBuyerById = async (req, res, next) => {
    try {
        const buyerId = req.params.id;
        // we gotta get the buyer data AND all the reps for the dropdown at the same time
        const [buyerData, allSalesReps] = await Promise.all([
            Buyer.findById(buyerId),
            SalesRep.getAll()
        ]);


        //if the model returns null, it means no buyer was found.
        // so we'll just show a 404 page.
        if (!buyerData) {
            const err = new Error('Buyer not found');
            err.status = 404;
            return next(err); // passes this to the main error handler
        }

        // if we found the buyer, render the profile page and pass in all the data
        res.render('admin/crm/buyer-profile', {
            title: `CRM - ${buyerData.details.name}`,
            buyer: buyerData, // the view will get an object with details, contacts, notes, etc.
            allSalesReps: allSalesReps, // pass the list of all reps to the view
            layout: 'layouts/main'
        });

    } catch (err) {
        //if something else breaks, pass it to the error handler too
        next(err);
    }
};

//shows the page with the form for adding a new buyer
const showAddBuyerForm = async (req, res, next) => {
    try {
        // we need to get the stages and deal flows to populate the dropdowns on the form
        const [stages, dealFlows] = await Promise.all([
            Buyer.getAllStages(),
            Buyer.getAllDealFlows()
        ]);

        res.render('admin/crm/add-buyer', {
            title: 'CRM - Add New Buyer',
            layout: 'layouts/main',
            stages: stages, // pass stages to the view
            dealFlows: dealFlows // pass deal flows to the view
        });
    } catch (err) {
        next(err);
    }
};

// Handles the actual creation of the buyer when the form is submitted
const createBuyer = async (req, res, next) => {
    try {
        // req.body contains all the data from the form
        const newBuyerData = {
            name: req.body.name,
            website_url: req.body.website_url,
            buyer_type: req.body.buyer_type,
            fk_stage_id: req.body.fk_stage_id,
            fk_deal_flow_id: req.body.fk_deal_flow_id,
        };

        const result = await Buyer.create(newBuyerData);

        // after creating, redirect to the new buyer's profile page
        res.redirect(`/admin/crm/buyers/${result.entry_id}`);
    } catch (err) {
        // if something goes wrong, maybe render the form again with an error message
        // for now, we'll just pass it to the main error handler
        next(err);
    }
};

//shows the edit form, pre populated with the buyer's data
const showEditBuyerForm = async (req, res, next) => {
    try {
        const buyerId = req.params.id;
        // We need to fetch the specific buyer's data AND all possible stages/deal flows for the dropdowns
        const [buyerData, stages, dealFlows] = await Promise.all([
            Buyer.findById(buyerId),
            Buyer.getAllStages(),
            Buyer.getAllDealFlows()
        ]);

        if (!buyerData) {
            return res.status(404).send("Buyer not found");
        }

        res.render('admin/crm/edit-buyer', {
            title: `CRM - Edit ${buyerData.details.name}`,
            layout: 'layouts/main',
            buyer: buyerData,
            stages: stages,
            dealFlows: dealFlows
        });
    } catch (err) {
        next(err);
    }
};

// Processes the submitted form data to update the buyer
const updateBuyer = async (req, res, next) => {
    try {
        const buyerId = req.params.id;
        const updatedData = {
            name: req.body.name,
            website_url: req.body.website_url,
            buyer_type: req.body.buyer_type,
            fk_stage_id: req.body.fk_stage_id,
            fk_deal_flow_id: req.body.fk_deal_flow_id,
        };

        await Buyer.update(buyerId, updatedData);

        // after updating, redirect back to their profile page so they can see the changes
        res.redirect(`/admin/crm/buyers/${buyerId}`);
    } catch (err) {
        next(err);
    }
};

const deleteBuyer = async (req, res, next) => {
    try {
        const buyerId = req.params.id;
        await Buyer.deleteById(buyerId);
        // after deleting, send them back to the main CRM list
        res.redirect('/admin/crm');
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getAllBuyers,
    getBuyerById,
    showAddBuyerForm,
    createBuyer,
    showEditBuyerForm,
    updateBuyer,
    deleteBuyer
};