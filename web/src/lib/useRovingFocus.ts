import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Roving tabindex for a set of SVG markers: the whole set is one Tab stop, arrow keys move
 * between items, Home/End jump to the ends and Enter activates. Keeps hundreds of map points
 * from becoming hundreds of Tab stops.
 */
export function useRovingFocus<T extends Element>(count: number, onActivate: (index: number) => void) {
  const [active, setActive] = useState(0);
  const refs = useRef<(T | null)[]>([]);
  const moved = useRef(false);

  useEffect(() => {
    if (active >= count) setActive(Math.max(0, count - 1));
  }, [count, active]);

  useEffect(() => {
    // Only move DOM focus in response to a key press, never on render.
    if (moved.current) {
      (refs.current[active] as unknown as HTMLElement | null)?.focus();
      moved.current = false;
    }
  }, [active]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent, index: number) => {
      const next = ({ ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: count - 1 } as Record<string, number>)[e.key];
      if (next !== undefined) {
        e.preventDefault();
        moved.current = true;
        setActive((next + count) % count);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate(index);
      }
    },
    [count, onActivate],
  );

  const itemProps = (index: number) => ({
    ref: (el: T | null) => {
      refs.current[index] = el;
    },
    tabIndex: index === Math.min(active, count - 1) ? 0 : -1,
    onKeyDown: (e: KeyboardEvent) => onKeyDown(e, index),
    onFocus: () => setActive(index),
  });

  return { active, itemProps };
}
