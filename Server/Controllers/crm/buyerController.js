// Server/Controllers/crm/buyerController.js

const Buyer = require('../../Models/crm/buyerModel');
const SalesRep = require('../../Models/crm/salesRepModel');
const UserModel = require('../../Models/userModel');

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
        // Get users with Sales Rep role for assignment dropdown
        const salesRepUsers = await UserModel.getUsersByRole('Sales Representative');
        
        // Format users for the dropdown (match the expected format)
        const allSalesReps = salesRepUsers.map(user => ({
            entry_id: user.id, // Use user ID as the identifier
            name: `${user.firstname} ${user.lastname}`.trim(),
            email: user.email || '',
            phone: '' // Phone not stored in users table
        }));
        
        // we gotta get the buyer data AND all the reps for the dropdown at the same time
        const discountBuilderService = require('../../Services/discountBuilderService');
        const { query } = require('../../config/database');
        
        // Fetch categories and products for discount rule editing
        const [categoriesResult, productsResult] = await Promise.all([
            query(`
                SELECT DISTINCT category_name
                FROM "ORDERS-products"
                WHERE category_name IS NOT NULL
                ORDER BY category_name ASC
            `).catch(() => ({ rows: [] })),
            query(`
                SELECT entry_id AS product_id, name, category_name
                FROM "ORDERS-products"
                ORDER BY name ASC
                LIMIT 200
            `).catch(() => ({ rows: [] }))
        ]);
        
        const [buyerData, discountAssignments, availableDiscounts] = await Promise.all([
            Buyer.findById(buyerId),
            discountBuilderService.getBuyerAssignments(parseInt(buyerId, 10)).catch(err => {
                console.error('Error fetching discount assignments:', err);
                return []; // Return empty array on error
            }),
            discountBuilderService.listDiscountCodes().catch(err => {
                console.error('Error fetching available discounts:', err);
                return []; // Return empty array on error
            })
        ]);


        //if the model returns null, it means no buyer was found.
        // so we'll just show a 404 page.
        if (!buyerData) {
            const err = new Error('Buyer not found');
            err.status = 404;
            return next(err); // passes this to the main error handler
        }

        // Check if user is fulfillment user for read-only restrictions
        // Only set isFulfillmentUser to true if user has ONLY fulfillment roles (no Sales Admin/Rep or Admin)
        const userRoles = await UserModel.getUserRoles(req.session.userId);
        const userRoleNames = userRoles.map(r => (r.name || r.role_name || '').trim()).filter(Boolean);
        const normalizeRole = (role) => role.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
        const isAdmin = userRoleNames.some(r => r.toLowerCase() === 'administrator');
        const isSalesAdmin = userRoleNames.some(r => r.toLowerCase() === 'sales admin');
        const hasFulfillmentRole = userRoleNames.some(r => {
            const normalized = normalizeRole(r);
            return normalized === 'fulfillment team' || 
                   normalized === 'fulfillment worker' || 
                   normalized === 'fulfillment admin';
        });
        // Only treat as fulfillment-only user if they have fulfillment role BUT NOT Sales Admin/Rep or Admin
        const isFulfillmentUser = hasFulfillmentRole && !isAdmin && !isSalesAdmin && !userRoleNames.some(r => r.toLowerCase() === 'sales representative');
        
        // if we found the buyer, render the profile page and pass in all the data
        res.render('admin/crm/buyer-profile', {
            title: `CRM - ${buyerData.details.name}`,
            buyer: buyerData, // the view will get an object with details, contacts, notes, etc.
            allSalesReps: allSalesReps, // pass the list of all users with Sales Rep role to the view
            discountAssignments: discountAssignments || [], // pass discount assignments ordered by priority
            availableDiscounts: availableDiscounts || [], // pass available discounts for assignment dropdown
            categories: categoriesResult.rows.map(r => r.category_name), // pass categories for rule editing
            products: productsResult.rows, // pass products for rule editing
            isFulfillmentUser: isFulfillmentUser, // Pass fulfillment flag for read-only restrictions
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
            zone: req.body.zone,
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
        const userId = req.session?.userId;
        
        // Check if user is fulfillment user - restrict to zone only
        let updatedData;
        if (userId) {
            const UserModel = require('../../Models/userModel');
            const userRoles = await UserModel.getUserRoles(userId);
            const userRoleNames = userRoles.map(r => (r.name || r.role_name || '').trim()).filter(Boolean);
            const normalizeRole = (role) => role.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
            const isAdmin = userRoleNames.some(r => r.toLowerCase() === 'administrator');
            const isSalesAdmin = userRoleNames.some(r => r.toLowerCase() === 'sales admin');
            const hasFulfillmentRole = userRoleNames.some(r => {
                const normalized = normalizeRole(r);
                return normalized === 'fulfillment team' || 
                       normalized === 'fulfillment worker' || 
                       normalized === 'fulfillment admin';
            });
            // Only treat as fulfillment-only user if they have fulfillment role BUT NOT Sales Admin/Rep or Admin
            const isFulfillmentUser = hasFulfillmentRole && !isAdmin && !isSalesAdmin && !userRoleNames.some(r => r.toLowerCase() === 'sales representative');
            
            if (isFulfillmentUser) {
                // Fulfillment users can only update zone field
                // Get current buyer data first
                const currentBuyer = await Buyer.findById(buyerId);
                if (!currentBuyer) {
                    return res.status(404).send("Buyer not found");
                }
                
                updatedData = {
                    name: currentBuyer.details.name,
                    website_url: currentBuyer.details.website_url,
                    buyer_type: currentBuyer.details.buyer_type,
                    zone: req.body.zone, // Only zone can be updated
                    fk_stage_id: currentBuyer.details.fk_stage_id,
                    fk_deal_flow_id: currentBuyer.details.fk_deal_flow_id,
                };
            } else {
                // Non-fulfillment users can update all fields
                updatedData = {
                    name: req.body.name,
                    website_url: req.body.website_url,
                    buyer_type: req.body.buyer_type,
                    zone: req.body.zone,
                    fk_stage_id: req.body.fk_stage_id,
                    fk_deal_flow_id: req.body.fk_deal_flow_id,
                };
            }
        } else {
            // Fallback if no userId (shouldn't happen with requireAuth)
            updatedData = {
                name: req.body.name,
                website_url: req.body.website_url,
                buyer_type: req.body.buyer_type,
                zone: req.body.zone,
                fk_stage_id: req.body.fk_stage_id,
                fk_deal_flow_id: req.body.fk_deal_flow_id,
            };
        }

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