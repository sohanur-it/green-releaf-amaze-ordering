// Public/js/shared/main.js
document.addEventListener('DOMContentLoaded', () => {
    const appContainer = document.getElementById('app-container');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const htmlElement = document.documentElement;

    //the pre-loader script in the <head> adds this class to the <html> tag.
    //we move it to our app container where the CSS styles expect it.
    if (htmlElement.classList.contains('sidebar-is-collapsed')) {
        appContainer.classList.add('sidebar-collapsed');
        htmlElement.classList.remove('sidebar-is-collapsed'); // clean up the html tag
    }

    //this is a crucial part. We add a class to the body to enable CSS transitions
    //only *after* the initial state has been set, preventing the load animation of the navbar.
    setTimeout(() => {
        document.body.classList.add('transitions-enabled');
    }, 10);


    //when the toggle button is clicked...
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            appContainer.classList.toggle('sidebar-collapsed');

            //save the new state to localStorage so it persists across page loads
            const isCollapsed = appContainer.classList.contains('sidebar-collapsed');
            localStorage.setItem('sidebarState', isCollapsed ? 'collapsed' : 'expanded');
        });
    }
});