//helper utility functions

//sanitize a string for use in filenames
function sanitizeFilename(str) {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') //replace non-alphanumeric with dash
        .replace(/^-+|-+$/g, '') //trim dashes from ends
        .substring(0, 200); //limit length
}

//format price for display
function formatPrice(price) {
    if (!price && price !== 0) return '$0.00';
    return `$${parseFloat(price).toFixed(2)}`;
}

//format date for display
function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

//calculate best by date (1 year from package date)
function calculateBestByDate(packagedDate) {
    if (!packagedDate) return null;
    const date = new Date(packagedDate);
    date.setFullYear(date.getFullYear() + 1);
    return date;
}

//check if item has required details
function hasRequiredDetails(item) {
    return !!(
        item.category &&
        item.default_price &&
        item.brand &&
        item.strain_type
    );
}

//aggregate batch quantities by item name
function aggregateBatchQuantities(batches) {
    const aggregated = {};

    batches.forEach(batch => {
        const itemName = batch.name;
        if (!aggregated[itemName]) {
            aggregated[itemName] = {
                ...batch,
                total_quantity: 0,
                batches: []
            };
        }

        aggregated[itemName].total_quantity += (batch.full_package_count || 0);
        aggregated[itemName].batches.push(batch);
    });

    return Object.values(aggregated);
}

module.exports = {
    sanitizeFilename,
    formatPrice,
    formatDate,
    calculateBestByDate,
    hasRequiredDetails,
    aggregateBatchQuantities
};