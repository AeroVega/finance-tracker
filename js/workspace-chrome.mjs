// Measure fixed chrome so wrapped labels and enlarged text never cover the
// final page control. The document remains the only page scroll root.
const root = document.documentElement;
const elements = [
  [document.querySelector('.primary-nav'), '--navigation-height'],
  [document.getElementById('draft-bar'), '--draft-height'],
  [document.querySelector('.sidebar'), '--workspace-header-height']
];
if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(() => {
    for (const [element, property] of elements) {
      root.style.setProperty(property, `${Math.ceil(element.getBoundingClientRect().height)}px`);
    }
  });
  for (const [element] of elements) observer.observe(element);
}
