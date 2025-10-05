// Server/Controllers/crm/contactController.js

const Contact = require('../../Models/crm/contactModel');

//this controller is just for the api, so it only spits out json.
// no views, no redirects, just data.

//handles creating a new contact
const createContact = async (req, res) => {
    try {
        const { buyerId } = req.params; // get the buyer id from the URL
        const contactData = req.body;   // get the new contact details from the request body

        const newContact = await Contact.create(buyerId, contactData);

        // send a 201 'Created' status and the new contact object back as JSON
        res.status(201).json(newContact);
    } catch (err) {
        res.status(500).json({ message: "Failed to create contact", error: err.message });
    }
};

// handles updating an existing contact
const updateContact = async (req, res) => {
    try {
        const { contactId } = req.params;
        const contactData = req.body;

        const updatedContact = await Contact.update(contactId, contactData);

        // send back the updated contact object
        res.status(200).json(updatedContact);
    } catch (err) {
        res.status(500).json({ message: "Failed to update contact", error: err.message });
    }
};

// handles deleting a contact
const deleteContact = async (req, res) => {
    try {
        const { contactId } = req.params;
        await Contact.deleteById(contactId);

        // if successful, just send back a 204 'No Content' status.
        // means it worked, but there's nothing to send back.
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ message: "Failed to delete contact", error: err.message });
    }
};

module.exports = {
    createContact,
    updateContact,
    deleteContact
};