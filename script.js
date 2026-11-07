const scrollBox = document.querySelector('.timeline-scroll');
const leftBtn = document.querySelector('.timeline-arrow.left');
const rightBtn = document.querySelector('.timeline-arrow.right');

function scrollToTimelineEntry(id) {
    const target = document.getElementById(id);
    const visibleWidth = scrollBox.clientWidth;

    scrollBox.scrollTo({
        left: target.offsetLeft - (visibleWidth / 2),
        behavior: 'smooth'
    });
}

function updateArrowVisibility() {
    const maxScroll = scrollBox.scrollWidth - scrollBox.clientWidth;

    leftBtn.classList.toggle('hidden', scrollBox.scrollLeft <= 5);
    rightBtn.classList.toggle('hidden', scrollBox.scrollLeft >= maxScroll - 5);
}

// on load: jump straight to the far right (present), no animation
scrollBox.scrollLeft = scrollBox.scrollWidth;
updateArrowVisibility();

// re-check every time the user scrolls (by button or manually)
scrollBox.addEventListener('scroll', updateArrowVisibility);