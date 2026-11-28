// Measure fixed chrome so wrapped labels and enlarged text never cover the
// final page control. The document remains the only page scroll root.
const root = document.documentElement;
const filters = document.getElementById('activity-filters');
const elements = [
  [document.querySelector('.primary-nav'), '--navigation-height'],
  [document.getElementById('draft-bar'), '--draft-height'],
  [document.querySelector('.sidebar'), '--workspace-header-height'],
  // Month headers stick below the sticky Activity filters.
  [filters, '--filters-height']
];
if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(() => {
    for (const [element, property] of elements) {
      root.style.setProperty(property, `${Math.ceil(element.getBoundingClientRect().height)}px`);
    }
  });
  for (const [element] of elements) observer.observe(element);
}
// The filter bar gains its hairline only while it is pinned, so it reads as part
// of the page until the list scrolls under it.
if (filters) {
  let frame = 0;
  const update = () => {
    frame = 0;
    const pinned = window.scrollY > 0 && filters.getClientRects().length > 0 &&
      filters.getBoundingClientRect().top <= parseFloat(getComputedStyle(filters).top) + 0.5;
    if (filters.dataset.stuck !== String(pinned)) filters.dataset.stuck = String(pinned);
  };
  addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(update); }, {passive: true});
  addEventListener('hashchange', update);
  update();
}
