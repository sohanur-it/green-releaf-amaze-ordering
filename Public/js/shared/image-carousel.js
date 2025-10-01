// Image Carousel Component - Reusable carousel with auto-cycling
// Features: auto-cycle every 6s, pause on hover, manual navigation, viewport detection

class ImageCarousel {
    constructor(container, images, options = {}) {
        this.container = container;
        this.images = images || [];
        this.currentIndex = 0;
        this.cycleInterval = null;
        this.isHovered = false;
        this.isInViewport = false;

        // Options
        this.options = {
            cycleDelay: options.cycleDelay || 6000, // 6 seconds
            showDots: options.showDots !== false,
            showArrows: options.showArrows !== false,
            pauseOnHover: options.pauseOnHover !== false,
            enableSwipe: options.enableSwipe !== false
        };

        this.init();
    }

    init() {
        if (!this.images || this.images.length === 0) {
            this.renderPlaceholder();
            return;
        }

        this.render();
        this.setupEventHandlers();
        this.setupViewportObserver();

        if (this.images.length > 1) {
            this.startCycle();
        }
    }

    render() {
        this.container.innerHTML = '';
        this.container.className = 'image-carousel';

        // Create images container
        const imagesContainer = document.createElement('div');
        imagesContainer.className = 'carousel-images';

        this.images.forEach((image, index) => {
            const img = document.createElement('img');
            img.src = `/${image.file_path}`;
            img.alt = `Product image ${index + 1}`;
            img.className = 'carousel-image';
            if (index === 0) {
                img.classList.add('active');
            }
            imagesContainer.appendChild(img);
        });

        this.container.appendChild(imagesContainer);

        // Add navigation arrows if enabled
        if (this.options.showArrows && this.images.length > 1) {
            this.renderArrows();
        }

        // Add dots if enabled
        if (this.options.showDots && this.images.length > 1) {
            this.renderDots();
        }
    }

    renderArrows() {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'carousel-arrow carousel-arrow-prev';
        prevBtn.innerHTML = '‹';
        prevBtn.addEventListener('click', () => this.prev());

        const nextBtn = document.createElement('button');
        nextBtn.className = 'carousel-arrow carousel-arrow-next';
        nextBtn.innerHTML = '›';
        nextBtn.addEventListener('click', () => this.next());

        this.container.appendChild(prevBtn);
        this.container.appendChild(nextBtn);
    }

    renderDots() {
        const dotsContainer = document.createElement('div');
        dotsContainer.className = 'carousel-dots';

        this.images.forEach((_, index) => {
            const dot = document.createElement('button');
            dot.className = 'carousel-dot';
            if (index === 0) {
                dot.classList.add('active');
            }
            dot.addEventListener('click', () => this.goTo(index));
            dotsContainer.appendChild(dot);
        });

        this.container.appendChild(dotsContainer);
    }

    renderPlaceholder() {
        this.container.innerHTML = `
            <div class="product-image-placeholder">
                <span class="placeholder-icon">📦</span>
                <span class="placeholder-text">No Image Available</span>
            </div>
        `;
    }

    setupEventHandlers() {
        // Pause on hover
        if (this.options.pauseOnHover) {
            this.container.addEventListener('mouseenter', () => {
                this.isHovered = true;
                this.stopCycle();
            });

            this.container.addEventListener('mouseleave', () => {
                this.isHovered = false;
                if (this.isInViewport) {
                    this.startCycle();
                }
            });
        }

        // Swipe support for mobile
        if (this.options.enableSwipe) {
            this.setupSwipe();
        }
    }

    setupSwipe() {
        let touchStartX = 0;
        let touchEndX = 0;

        this.container.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        });

        this.container.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            this.handleSwipe(touchStartX, touchEndX);
        });
    }

    handleSwipe(startX, endX) {
        const threshold = 50; // minimum swipe distance

        if (startX - endX > threshold) {
            // Swipe left - next image
            this.next();
        } else if (endX - startX > threshold) {
            // Swipe right - previous image
            this.prev();
        }
    }

    setupViewportObserver() {
        // Only cycle when carousel is in viewport (performance optimization)
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                this.isInViewport = entry.isIntersecting;

                if (entry.isIntersecting && !this.isHovered) {
                    this.startCycle();
                } else {
                    this.stopCycle();
                }
            });
        }, {
            threshold: 0.5 // 50% of carousel must be visible
        });

        observer.observe(this.container);
    }

    startCycle() {
        if (this.cycleInterval || this.images.length <= 1) return;

        this.cycleInterval = setInterval(() => {
            this.next();
        }, this.options.cycleDelay);
    }

    stopCycle() {
        if (this.cycleInterval) {
            clearInterval(this.cycleInterval);
            this.cycleInterval = null;
        }
    }

    next() {
        this.goTo((this.currentIndex + 1) % this.images.length);
    }

    prev() {
        this.goTo((this.currentIndex - 1 + this.images.length) % this.images.length);
    }

    goTo(index) {
        if (index < 0 || index >= this.images.length) return;
        if (index === this.currentIndex) return;

        // Update images
        const carouselImages = this.container.querySelectorAll('.carousel-image');
        carouselImages[this.currentIndex].classList.remove('active');
        carouselImages[index].classList.add('active');

        // Update dots
        if (this.options.showDots) {
            const dots = this.container.querySelectorAll('.carousel-dot');
            dots[this.currentIndex].classList.remove('active');
            dots[index].classList.add('active');
        }

        this.currentIndex = index;
    }

    destroy() {
        this.stopCycle();
        this.container.innerHTML = '';
    }
}

// Helper function to create carousel from product data
function createProductCarousel(containerElement, product, options = {}) {
    const images = product.images || [];
    return new ImageCarousel(containerElement, images, options);
}
