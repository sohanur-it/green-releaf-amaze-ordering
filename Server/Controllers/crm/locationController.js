// Server/Controllers/crm/locationController.js

const Location = require('../../Models/crm/locationModel');

// controller for the locations api. just json, no ejs.

//handles creating a new location
const createLocation = async (req, res) => {
    try {
        const { buyerId } = req.params;
        const newLocation = await Location.create(buyerId, req.body);
        res.status(201).json(newLocation);
    } catch (err) {
        res.status(500).json({ message: "Failed to create location", error: err.message });
    }
};

//handles updating a location
const updateLocation = async (req, res) => {
    try {
        const { locationId } = req.params;
        const updatedLocation = await Location.update(locationId, req.body);
        res.status(200).json(updatedLocation);
    } catch (err) {
        res.status(500).json({ message: "Failed to update location", error: err.message });
    }
};

// handles deleting a location
const deleteLocation = async (req, res) => {
    try {
        const { locationId } = req.params;
        await Location.deleteById(locationId);
        res.status(204).send(); // Success, no content to send back
    } catch (err) {
        res.status(500).json({ message: "Failed to delete location", error: err.message });
    }
};

module.exports = {
    createLocation,
    updateLocation,
    deleteLocation
};