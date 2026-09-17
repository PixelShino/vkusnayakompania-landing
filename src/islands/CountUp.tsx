/**
 * Number that counts up once when it scrolls into view.
 * The final value is what renders on the server and what stays if anything goes
 * wrong — no JS, reduced motion, a missed observer — so the figure on the page is
 * never a lie. The count is a decoration on top of a correct number.
 * Цифра, которая один раз досчитывается при появлении в кадре. Конечное значение
 * рендерит сервер, и оно же остаётся при любом сбое — нет JS, reduced motion,
 * не сработал обсервер, — поэтому цифра на странице никогда не врёт. Счёт лишь
 * украшает уже верное число.
 */
import { useEffect, useRef, useState } from 'react';

interface Props {
  /** final value / конечное значение */
  to: number;
  /** thousands separator, e.g. a thin space / разделитель тысяч */
  separator?: string;
  /** milliseconds / длительность счёта */
  duration?: number;
}

const format = (n: number, separator: string) => {
  const s = String(n);
  return separator ? s.replace(/\B(?=(\d{3})+(?!\d))/g, separator) : s;
};

// strong ease-out: fast start, long settle — the number lands rather than stops
// сильный ease-out: быстрый старт, долгое затухание — число приземляется
const easeOut = (t: number) => 1 - (1 - t) ** 4;

export default function CountUp({ to, separator = '', duration = 1400 }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let frame = 0;
    let start = 0;
    const step = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(to * easeOut(t)));
      if (t < 1) frame = requestAnimationFrame(step);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setValue(0);
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [duration, to]);

  return (
    <span ref={ref} className="tnum">
      {format(value, separator)}
    </span>
  );
}
