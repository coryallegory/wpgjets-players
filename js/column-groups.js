export function bindColumnGroupToggles(tableElement) {
  const toggleButtons = document.querySelectorAll('.group-toggle');

  toggleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const group = button.dataset.targetGroup;
      const className = group === 'stats' ? 'hide-stats' : 'hide-card';
      const shouldHide = !tableElement.classList.contains(className);

      tableElement.classList.toggle(className, shouldHide);
      button.setAttribute('aria-pressed', shouldHide ? 'false' : 'true');
      button.textContent = `${shouldHide ? 'Show' : 'Hide'} ${
        group === 'stats' ? 'playing stats' : 'card info'
      }`;
    });
  });
}
