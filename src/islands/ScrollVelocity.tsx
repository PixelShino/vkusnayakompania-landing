/**
 * Scrolling marquee whose speed answers the page scroll (React Bits ScrollVelocity,
 * trimmed to one row and wired to our tokens). Reduced motion freezes it.
 * Бегущая строка, скорость которой отзывается на прокрутку: основа — React Bits
 * ScrollVelocity, оставлена одна строка и наши токены. Reduced motion её
 * останавливает, текст остаётся читаемым.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from 'motion/react';

interface Props {
  /** items shown in the row / позиции строки */
  items: string[];
  /** px per second at rest / базовая скорость, px в секунду */
  velocity?: number;
  /** copies laid end to end to fill the viewport / копий подряд, чтобы закрыть экран */
  copies?: number;
}

const wrap = (min: number, max: number, v: number) => {
  const range = max - min;
  return ((((v - min) % range) + range) % range) + min;
};

export default function ScrollVelocity({ items, velocity = 42, copies = 4 }: Props) {
  const reduce = useReducedMotion();
  const baseX = useMotionValue(0);
  const { scrollY } = useScroll();
  const scrollVelocity = useVelocity(scrollY);
  const smooth = useSpring(scrollVelocity, { damping: 50, stiffness: 400 });
  // прокрутка ускоряет ленту максимум втрое и может развернуть её
  const factor = useTransform(smooth, [0, 1000], [0, 3], { clamp: false });

  const copyRef = useRef<HTMLSpanElement>(null);
  const [copyWidth, setCopyWidth] = useState(0);

  useLayoutEffect(() => {
    const measure = () => setCopyWidth(copyRef.current?.offsetWidth ?? 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [items]);

  const x = useTransform(baseX, (v) => (copyWidth === 0 ? '0px' : `${wrap(-copyWidth, 0, v)}px`));
  const direction = useRef(1);

  useAnimationFrame((_t, delta) => {
    if (reduce || copyWidth === 0) return;
    let moveBy = direction.current * velocity * (delta / 1000);
    const f = factor.get();
    if (f < 0) direction.current = -1;
    else if (f > 0) direction.current = 1;
    moveBy += direction.current * moveBy * f;
    baseX.set(baseX.get() + moveBy);
  });

  const row = (
    <>
      {items.map((item, i) => (
        <span className="marquee__item" key={i}>
          {item}
          <span className="marquee__dot" aria-hidden="true">
            ·
          </span>
        </span>
      ))}
    </>
  );

  return (
    <div className="marquee" aria-label={items.join(', ')}>
      <motion.div className="marquee__row" style={{ x }} aria-hidden="true">
        {Array.from({ length: copies }, (_, i) => (
          <span className="marquee__copy" key={i} ref={i === 0 ? copyRef : null}>
            {row}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
