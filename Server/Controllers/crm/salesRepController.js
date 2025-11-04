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
        const { assignmentType, salesRepId, firstName, lastName, email, password, username } = req.body;

        let userId;

        // If creating new user
        if (assignmentType === 'new') {
            if (!firstName || !lastName || !email || !password || !username) {
                return res.status(400).json({ message: "All fields are required for new user creation" });
            }

            const UserModel = require('../../Models/userModel');
            const bcrypt = require('bcrypt');

            // Check if user already exists
            const existingUser = await UserModel.findByEmail(email);
            if (existingUser) {
                return res.status(400).json({ message: "User with this email already exists" });
            }

            const existingUsername = await UserModel.findByUsername(username);
            if (existingUsername) {
                return res.status(400).json({ message: "Username already taken" });
            }

            // Hash password
            const passwordHash = await bcrypt.hash(password, 10);

            // Hash email for email_hash field (required by database)
            const emailHash = await bcrypt.hash(email, 10);

            // Create new user with Sales Representative role
            const { query } = require('../../config/database');
            
            // Insert user
            const userResult = await query(`
                INSERT INTO users (username, first_name, last_name, email, email_hash, password_hash, is_active, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
                RETURNING id
            `, [username, firstName, lastName, email, emailHash, passwordHash]);

            userId = userResult.rows[0].id;

            // Get or create Sales Representative role ID
            let roleResult = await query(`
                SELECT id FROM roles WHERE LOWER(name) = LOWER('Sales Representative')
            `);
            
            let roleId;
            if (roleResult.rows.length > 0) {
                roleId = roleResult.rows[0].id;
            } else {
                // Create the role if it doesn't exist
                const createRoleResult = await query(`
                    INSERT INTO roles (name, description, created_at, updated_at)
                    VALUES ('Sales Representative', 'Can create and manage orders for assigned clients', NOW(), NOW())
                    RETURNING id
                `);
                roleId = createRoleResult.rows[0].id;
            }
            
            // Assign Sales Representative role (check if already assigned first, then insert)
            try {
                // Check if role is already assigned
                const existingRole = await query(`
                    SELECT user_id FROM user_roles 
                    WHERE user_id = $1 AND role_id = $2
                `, [userId, roleId]);
                
                if (existingRole.rows.length === 0) {
                    // Role not assigned, insert it
                    await query(`
                        INSERT INTO user_roles (user_id, role_id, assigned_at)
                        VALUES ($1, $2, NOW())
                    `, [userId, roleId]);
                    console.log(`✅ Assigned Sales Representative role to user ${userId}`);
                } else {
                    console.log(`ℹ️ User ${userId} already has Sales Representative role`);
                }
            } catch (roleError) {
                console.error('Error assigning role:', roleError);
                // Don't fail the whole operation if role assignment fails
            }
        } else {
            // Assign existing user
            if (!salesRepId) {
                return res.status(400).json({ message: "Please select a sales representative" });
            }
            userId = salesRepId;
        }

        const newAssignment = await SalesRep.assignToBuyer(buyerId, userId);
        res.status(201).json(newAssignment);
    } catch (err) {
        console.error('Error assigning sales rep:', err);
        res.status(500).json({ message: "Failed to assign sales rep", error: err.message });
    }
};

// Assign sales rep to a location
const assignRepToLocation = async (req, res) => {
    try {
        const { locationId, salesRepId } = req.body;

        if (!locationId) {
            return res.status(400).json({ message: "Location ID is required" });
        }

        if (!salesRepId) {
            return res.status(400).json({ message: "Please select a sales representative" });
        }

        // salesRepId is the user ID from the users table
        const userId = salesRepId;

        const assignment = await SalesRep.assignToLocation(locationId, userId);
        res.status(201).json({
            success: true,
            message: "Sales representative assigned to location successfully",
            ...assignment
        });
    } catch (err) {
        console.error('Error assigning sales rep to location:', err);
        res.status(500).json({ message: "Failed to assign sales rep to location", error: err.message });
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

// Unassign sales rep from a location
const unassignRepFromLocation = async (req, res) => {
    try {
        const { locationId } = req.params;
        
        // Clear the assigned_sales_rep_id from the location
        const { query } = require('../../config/database');
        await query(`
            UPDATE "ORDERS-buyer_locations" 
            SET assigned_sales_rep_id = NULL, updated_at = NOW()
            WHERE entry_id = $1
        `, [locationId]);
        
        res.status(204).send(); // success, no content back
    } catch (err) {
        console.error('Error unassigning sales rep from location:', err);
        res.status(500).json({ message: "Failed to unassign sales rep from location", error: err.message });
    }
};

// --- API Functions for Rep CRUD ---

const createRep = async (req, res) => {
    try {
        const { name, email, phone, username, password } = req.body;
        
        // Check if sales rep with this email already exists
        let existingRep = await SalesRep.findByEmail(email);
        let newRep;
        
        if (existingRep) {
            // Update existing rep with new data if provided
            newRep = await SalesRep.update(existingRep.entry_id, { name, email, phone });
        } else {
            // Create new sales rep entry
            newRep = await SalesRep.create({ name, email, phone });
        }
        
        // If username and password are provided, create a user account
        if (username && password && password.length >= 8) {
            const UserModel = require('../../Models/userModel');
            const bcrypt = require('bcrypt');
            const { query } = require('../../config/database');
            
            // Check if user already exists
            const existingUser = await UserModel.findByEmail(email);
            if (existingUser) {
                // User exists, just return the rep
                return res.status(201).json(newRep);
            }
            
            const existingUsername = await UserModel.findByUsername(username);
            if (existingUsername) {
                // Username taken, just return the rep
                return res.status(201).json(newRep);
            }
            
            // Hash password
            const passwordHash = await bcrypt.hash(password, 10);
            
            // Hash email for email_hash field (required by database)
            const emailHash = await bcrypt.hash(email, 10);
            
            // Parse name into first and last name
            const nameParts = name.trim().split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';
            
            // Create user
            const userResult = await query(`
                INSERT INTO users (username, first_name, last_name, email, email_hash, password_hash, is_active, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
                RETURNING id
            `, [username, firstName, lastName, email, emailHash, passwordHash]);
            
            // Get or create Sales Representative role ID
            let roleResult = await query(`
                SELECT id FROM roles WHERE LOWER(name) = LOWER('Sales Representative')
            `);
            
            let roleId;
            if (roleResult.rows.length > 0) {
                roleId = roleResult.rows[0].id;
            } else {
                // Create the role if it doesn't exist
                const createRoleResult = await query(`
                    INSERT INTO roles (name, description, created_at, updated_at)
                    VALUES ('Sales Representative', 'Can create and manage orders for assigned clients', NOW(), NOW())
                    RETURNING id
                `);
                roleId = createRoleResult.rows[0].id;
            }
            
            // Assign Sales Representative role (check if already assigned first, then insert)
            try {
                // Check if role is already assigned
                const existingRole = await query(`
                    SELECT user_id FROM user_roles 
                    WHERE user_id = $1 AND role_id = $2
                `, [userResult.rows[0].id, roleId]);
                
                if (existingRole.rows.length === 0) {
                    // Role not assigned, insert it
                    await query(`
                        INSERT INTO user_roles (user_id, role_id, assigned_at)
                        VALUES ($1, $2, NOW())
                    `, [userResult.rows[0].id, roleId]);
                    console.log(`✅ Assigned Sales Representative role to user ${userResult.rows[0].id}`);
                } else {
                    console.log(`ℹ️ User ${userResult.rows[0].id} already has Sales Representative role`);
                }
            } catch (roleError) {
                console.error('Error assigning role:', roleError);
                // Don't fail the whole operation if role assignment fails
                // The user is created, role can be assigned manually if needed
            }
        }
        
        res.status(201).json(newRep);
    } catch (err) {
        console.error('Error creating sales rep:', err);
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
    assignRepToLocation,
    unassignRep,
    unassignRepFromLocation,
    createRep,
    updateRep,
    deleteRep
};