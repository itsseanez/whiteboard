import { useEffect, type RefObject } from 'react';

/** True when the visitor asked for less motion, or the browser can't say. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
}

// Tile text rises and fades in once, as the design system's marketing rules
// ask. Text is visible in the HTML; this only adds the hidden starting state,
// and only to elements below the fold, so nothing is lost without script.
export function useReveal(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = 'shown';
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.2 },
    );

    for (const node of el.querySelectorAll<HTMLElement>('[data-reveal]')) {
      if (node.getBoundingClientRect().top < window.innerHeight) continue;
      node.dataset.reveal = 'hidden';
      observer.observe(node);
    }
    return () => observer.disconnect();
  }, [root]);
}
