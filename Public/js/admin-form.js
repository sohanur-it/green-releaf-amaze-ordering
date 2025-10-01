//admin form JS - handles item details form
//includes image upload with drag-drop reordering and wysiwyg editor

let existingDetails = null;
let uploadedImages = [];
let productDetailId = null;

//initialize page
document.addEventListener('DOMContentLoaded', async () => {
    await loadItemDefaults();
    await loadExistingDetails();
    initTinyMCE();
    setupImageUpload();
    setupFormSubmit();
});

//load default values from items table
async function loadItemDefaults() {
    try {
        const response = await fetch(`/admin/api/item-defaults/${encodeURIComponent(window.ITEM_NAME)}`);
        const result = await response.json();

        if (result.success && result.data) {
            const data = result.data;

            //prepopulate from items table
            if (data.unit_weight_grams) {
                document.getElementById('unit_weight').value = data.unit_weight_grams;
            }
            if (data.unit_count) {
                document.getElementById('packages_per_case').value = data.unit_count;
            }
            if (data.brand_name) {
                document.getElementById('brand').value = data.brand_name;
            }
            if (data.strainname) {
                document.getElementById('strain_flavor').value = data.strainname;
            }
            if (data.publicingredients) {
                document.getElementById('ingredients').value = data.publicingredients;
            }
        }
    } catch (error) {
        console.error('Error loading item defaults:', error);
    }
}

//load existing product details if they exist
async function loadExistingDetails() {
    try {
        showLoading();

        const response = await fetch(`/admin/api/details/${encodeURIComponent(window.ITEM_NAME)}`);

        if (response.status === 404) {
            //no existing details - thats ok
            hideLoading();
            return;
        }

        const result = await response.json();

        if (result.success && result.data) {
            existingDetails = result.data;
            productDetailId = result.data.id;
            populateForm(result.data);

            //show delete button
            document.getElementById('delete-btn').style.display = 'inline-block';
        }
    } catch (error) {
        console.error('Error loading existing details:', error);
    } finally {
        hideLoading();
    }
}

//populate form with existing data
function populateForm(data) {
    //basic fields
    if (data.sku) document.getElementById('sku').value = data.sku;
    if (data.category) document.getElementById('category').value = data.category;
    if (data.brand) document.getElementById('brand').value = data.brand;
    if (data.strain_flavor) document.getElementById('strain_flavor').value = data.strain_flavor;
    if (data.strain_type) document.getElementById('strain_type').value = data.strain_type;
    if (data.default_price) document.getElementById('default_price').value = data.default_price;
    if (data.unit_weight) document.getElementById('unit_weight').value = data.unit_weight;
    if (data.packages_per_case) document.getElementById('packages_per_case').value = data.packages_per_case;
    if (data.unit_size_measurement) document.getElementById('unit_size_measurement').value = data.unit_size_measurement;
    if (data.ingredients) document.getElementById('ingredients').value = data.ingredients;
    if (data.internal_notes) document.getElementById('internal_notes').value = data.internal_notes;

    //checkboxes
    document.getElementById('list_to_buyers').checked = data.list_to_buyers;
    document.getElementById('featured_product').checked = data.featured_product;

    //product description - will be set after tinymce init
    if (data.product_description) {
        window.initialProductDescription = data.product_description;
    }

    //buyer types - TODO implement when needed

    //images
    if (data.images && data.images.length > 0) {
        uploadedImages = data.images;
        renderImages();
    }
}

//initialize TinyMCE WYSIWYG editor
function initTinyMCE() {
    tinymce.init({
        selector: '#product_description',
        height: 400,
        menubar: false,
        plugins: 'lists link image code table',
        toolbar: 'undo redo | formatselect | bold italic underline | alignleft aligncenter alignright | bullist numlist | link | code',
        content_style: 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif; font-size: 14px; }',
        setup: function(editor) {
            editor.on('init', function() {
                //set initial content if exists
                if (window.initialProductDescription) {
                    editor.setContent(window.initialProductDescription);
                }
            });
        }
    });
}

//setup image upload handlers
function setupImageUpload() {
    const fileInput = document.getElementById('image-upload');

    fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (files.length === 0) return;

        //need to save details first to get product_detail_id
        if (!productDetailId) {
            showToast('Please save product details before uploading images', 'warning');
            fileInput.value = '';
            return;
        }

        await uploadImages(files);
        fileInput.value = ''; //reset input
    });
}

//upload images to server
async function uploadImages(files) {
    try {
        showLoading();

        const formData = new FormData();
        for (let file of files) {
            formData.append('images', file);
        }

        const response = await fetch(`/admin/api/details/${encodeURIComponent(window.ITEM_NAME)}/images`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to upload images');
        }

        showToast('Images uploaded successfully', 'success');

        //add new images to list
        uploadedImages = uploadedImages.concat(result.data);
        renderImages();

    } catch (error) {
        console.error('Error uploading images:', error);
        showToast('Error uploading images: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

//render images with drag-drop support
function renderImages() {
    const container = document.getElementById('images-preview');

    if (uploadedImages.length === 0) {
        container.innerHTML = '<p class="empty-message">No images uploaded yet</p>';
        return;
    }

    container.innerHTML = '';

    uploadedImages.forEach((img, index) => {
        const imgCard = document.createElement('div');
        imgCard.className = 'image-card';
        imgCard.draggable = true;
        imgCard.dataset.imageId = img.id;
        imgCard.dataset.index = index;

        imgCard.innerHTML = `
            <img src="/${img.file_path}" alt="Product image">
            <div class="image-overlay">
                <button class="btn-delete-image" onclick="deleteImage(${img.id}, event)">🗑️</button>
                <span class="image-order">${index === 0 ? '⭐ Primary' : `#${index + 1}`}</span>
            </div>
        `;

        //drag and drop handlers
        imgCard.addEventListener('dragstart', handleDragStart);
        imgCard.addEventListener('dragover', handleDragOver);
        imgCard.addEventListener('drop', handleDrop);
        imgCard.addEventListener('dragend', handleDragEnd);

        container.appendChild(imgCard);
    });
}

//drag and drop handlers
let draggedElement = null;

function handleDragStart(e) {
    draggedElement = this;
    this.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    if (draggedElement !== this) {
        const draggedIndex = parseInt(draggedElement.dataset.index);
        const targetIndex = parseInt(this.dataset.index);

        //reorder array
        const [removed] = uploadedImages.splice(draggedIndex, 1);
        uploadedImages.splice(targetIndex, 0, removed);

        renderImages();
        updateImageOrder();
    }

    return false;
}

function handleDragEnd(e) {
    this.style.opacity = '1';
}

//update image order on server
async function updateImageOrder() {
    try {
        const imageOrders = uploadedImages.map((img, index) => ({
            id: img.id,
            sort_order: index,
            is_primary: index === 0
        }));

        const response = await fetch(`/admin/api/details/${encodeURIComponent(window.ITEM_NAME)}/images/order`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageOrders })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to update image order');
        }

    } catch (error) {
        console.error('Error updating image order:', error);
        showToast('Error updating image order: ' + error.message, 'error');
    }
}

//delete image
async function deleteImage(imageId, event) {
    event.preventDefault();
    event.stopPropagation();

    if (!confirm('Are you sure you want to delete this image?')) {
        return;
    }

    try {
        showLoading();

        const response = await fetch(`/admin/api/images/${imageId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to delete image');
        }

        showToast('Image deleted successfully', 'success');

        //remove from list
        uploadedImages = uploadedImages.filter(img => img.id !== imageId);
        renderImages();

    } catch (error) {
        console.error('Error deleting image:', error);
        showToast('Error deleting image: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

//setup form submit
function setupFormSubmit() {
    const form = document.getElementById('product-details-form');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        try {
            showLoading();

            //get form data
            const formData = new FormData(form);
            const data = {};

            //basic fields
            formData.forEach((value, key) => {
                if (key === 'buyer_types') {
                    //collect all checked buyer types
                    if (!data.buyer_types) data.buyer_types = [];
                    data.buyer_types.push(value);
                } else {
                    data[key] = value;
                }
            });

            //checkboxes
            data.list_to_buyers = document.getElementById('list_to_buyers').checked;
            data.featured_product = document.getElementById('featured_product').checked;

            //get content from tinymce editor
            if (tinymce.get('product_description')) {
                data.product_description = tinymce.get('product_description').getContent();
            }

            //save to server
            const response = await fetch(`/admin/api/details/${encodeURIComponent(window.ITEM_NAME)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to save product details');
            }

            productDetailId = result.data.id;

            showToast('Product details saved successfully!', 'success');

            //redirect back to list after short delay
            setTimeout(() => {
                window.location.href = '/admin';
            }, 1500);

        } catch (error) {
            console.error('Error saving product details:', error);
            showToast('Error saving: ' + error.message, 'error');
        } finally {
            hideLoading();
        }
    });

    //delete button
    document.getElementById('delete-btn').addEventListener('click', async () => {
        if (!confirm('Are you sure you want to delete this product details? This cannot be undone.')) {
            return;
        }

        try {
            showLoading();

            const response = await fetch(`/admin/api/details/${encodeURIComponent(window.ITEM_NAME)}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to delete product details');
            }

            showToast('Product details deleted successfully', 'success');

            setTimeout(() => {
                window.location.href = '/admin';
            }, 1500);

        } catch (error) {
            console.error('Error deleting product details:', error);
            showToast('Error deleting: ' + error.message, 'error');
        } finally {
            hideLoading();
        }
    });
}