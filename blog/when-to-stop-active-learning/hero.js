/* Decorative motion only; the complete diagram remains readable without JavaScript. */
"use strict";
(() => {
  const figure = document.getElementById('learning-hero');
  const button = document.getElementById('hero-motion-toggle');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let playing = !reducedMotion.matches;
  let visible = true;

  function update() {
    figure.classList.toggle('hero-paused', !playing || !visible || document.hidden);
    button.textContent = playing ? 'Pause animation' : 'Play animation';
  }
  // Add the animation only when motion is allowed or explicitly requested.
  if (playing) figure.classList.add('hero-animated');
  button.hidden = false;
  button.addEventListener('click', () => {
    playing = !playing;
    if (playing) figure.classList.add('hero-animated');
    update();
  });
  reducedMotion.addEventListener('change', () => {
    playing = !reducedMotion.matches;
    figure.classList.toggle('hero-animated', playing);
    update();
  });
  document.addEventListener('visibilitychange', update);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      update();
    });
    observer.observe(figure);
  }
  update();
})();
