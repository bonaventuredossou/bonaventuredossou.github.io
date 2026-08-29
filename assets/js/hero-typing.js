(function () {
  'use strict';

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initHeroTyping() {
    var items = Array.prototype.slice.call(
      document.querySelectorAll('.hero-typing .typing-live')
    );

    if (!items.length) return;

    items.forEach(function (live) {
      var parent = live.closest('.hero-typing');
      var text = live.getAttribute('data-typing-text') || '';

      if (!parent) return;

      parent.classList.add('typing-enabled');

      if (reduceMotion) {
        live.textContent = text;
        parent.classList.add('typing-complete');
        return;
      }

      live.textContent = '';

      // Both hero lines start together and finish at roughly the same time.
      var isTitle = parent.classList.contains('hero-title');
      var interval = isTitle ? 43 : 25;
      var startDelay = 320;
      var index = 0;

      window.setTimeout(function typeNextCharacter() {
        index += 1;
        live.textContent = text.slice(0, index);

        if (index < text.length) {
          window.setTimeout(typeNextCharacter, interval);
        } else {
          window.setTimeout(function () {
            parent.classList.add('typing-complete');
          }, 260);
        }
      }, startDelay);
    });
  }

  function addRevealClass(element, variant, delay) {
    if (!element) return;

    element.classList.add('scroll-reveal');

    if (variant) {
      element.classList.add(variant);
    }

    element.style.setProperty('--reveal-delay', (delay || 0) + 'ms');
  }

  function initScrollReveal() {
    if (reduceMotion) return;

    var targets = [];

    function remember(element, variant, delay) {
      if (!element) return;

      addRevealClass(element, variant, delay);
      targets.push(element);
    }

    // Section headings and intro text.
    document.querySelectorAll('#main > section:not(#top)').forEach(function (section) {
      var heading = section.querySelector(':scope > .container > header');
      var intro = section.querySelector(':scope > .container > .section-intro');

      remember(heading, 'reveal-heading', 0);
      remember(intro, null, 70);
    });

    // Research cards.
    document.querySelectorAll('.card-grid > .card').forEach(function (card, index) {
      remember(card, null, (index % 3) * 85);
    });

    // Featured Fon contribution.
    document.querySelectorAll('.project-featured-card').forEach(function (card) {
      remember(card, null, 40);
    });

    // Project cards.
    document.querySelectorAll('.project-grid > .project-card').forEach(function (card, index) {
      remember(card, null, (index % 3) * 85);
    });

    // Education.
    document.querySelectorAll('.education-card').forEach(function (card, index) {
      remember(card, null, (index % 3) * 80);
    });

    // Experience cards alternate subtly from left and right.
    document.querySelectorAll('.experience-card').forEach(function (card, index) {
      remember(
        card,
        index % 2 === 0 ? 'reveal-left' : 'reveal-right',
        0
      );
    });

    // Publications.
    document.querySelectorAll('.publication-item').forEach(function (paper, index) {
      remember(paper, null, (index % 3) * 75);
    });

    // Awards.
    document.querySelectorAll('.award-card').forEach(function (award, index) {
      remember(award, null, (index % 3) * 75);
    });

    // Skills.
    document.querySelectorAll('.skill-box').forEach(function (skill, index) {
      remember(skill, null, index * 90);
    });

    if (!targets.length) return;

    document.documentElement.classList.add('motion-enabled');

    // Fallback for browsers without IntersectionObserver.
    if (!('IntersectionObserver' in window)) {
      targets.forEach(function (target) {
        target.classList.add('is-visible');
      });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -8% 0px'
    });

    targets.forEach(function (target) {
      observer.observe(target);
    });
  }

  function init() {
    initHeroTyping();
    initScrollReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();