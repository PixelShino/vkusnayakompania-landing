/**
 * Yandex Maps JS API 3.0: both venues on one map, script pulled in lazily.
 * Written against the official docs — `ymaps3.ready`, `YMap` with
 * `location: { bounds }`, `YMapDefaultSchemeLayer` / `YMapDefaultFeaturesLayer`
 * and `YMapMarker(props, element)`.
 * Карта на две точки. Скрипт подключается лениво, когда контейнер подходит к
 * экрану; не загрузился за 8 секунд — вместо карты остаются ссылки на карточки
 * организаций.
 */

/** Точка для метки: адрес карточки организации приходит из контента готовым. */
type Point = { id: number; n: string; name: string; lat: number; lng: number; href: string };

type LngLat = [number, number];
type Location = {
  center?: LngLat;
  bounds?: [LngLat, LngLat];
  zoom?: number;
  duration?: number;
  easing?: string;
};
type YMapInstance = { addChild(child: unknown): void; setLocation(location: Location): void };

// The CDN script puts `ymaps3` on window; its types live in
// `@yandex/ymaps3-types`, which we do not pull into the bundle.
// Скрипт с CDN кладёт `ymaps3` в `window`; типы лежат в `@yandex/ymaps3-types`,
// в зависимости их не тянем — здесь описано только то, чем пользуемся.
declare const ymaps3: {
  ready: Promise<void>;
  YMap: new (root: HTMLElement, props: { location: Location; margin?: number[] }) => YMapInstance;
  YMapDefaultSchemeLayer: new () => unknown;
  YMapDefaultFeaturesLayer: new () => unknown;
  YMapMarker: new (
    props: { coordinates: LngLat; blockEvents?: boolean },
    element?: HTMLElement,
  ) => unknown;
};

const KEY = import.meta.env.PUBLIC_YANDEX_MAPS_KEY;
/** отступ от краёв, чтобы метки не липли к рамке: [сверху, справа, снизу, слева] */
const MARGIN = [40, 40, 40, 40];
const TIMEOUT = 8000;

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const loadApi = () =>
  new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(KEY)}&lang=ru_RU`;
    script.async = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('скрипт карт не загрузился')));
    document.head.appendChild(script);
    setTimeout(() => reject(new Error('карты не ответили за 8 секунд')), TIMEOUT);
  });

/** Метка: круг с номером точки и подпись адреса, вся метка — ссылка на карточку. */
const markerElement = (point: Point) => {
  const link = document.createElement('a');
  link.className = 'ymk';
  link.href = point.href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.title = `${point.name} на Яндекс Картах`;

  const dot = document.createElement('span');
  dot.className = 'ymk__dot';
  dot.textContent = point.n;

  const label = document.createElement('span');
  label.className = 'ymk__label';
  label.textContent = point.name;

  link.append(dot, label);
  return link;
};

const build = async (holder: HTMLElement) => {
  const canvas = holder.querySelector<HTMLElement>('[data-map-canvas]');
  const note = holder.querySelector<HTMLElement>('[data-map-note]');
  const points: Point[] = JSON.parse(holder.dataset.places ?? '[]');
  if (!canvas || !points.length) return;

  try {
    await loadApi();
    await ymaps3.ready;
  } catch {
    // карты нет — «Показать на карте» некуда вести, у карточек остаются ссылки
    holder.classList.add('is-failed');
    if (note) note.textContent = 'Карта не загрузилась';
    document.querySelectorAll<HTMLElement>('[data-map-focus]').forEach((button) => {
      button.hidden = true;
    });
    return;
  }

  const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer, YMapMarker } = ymaps3;
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  // bounds — левый верхний и правый нижний углы прямоугольника по обеим точкам
  const bounds: [LngLat, LngLat] = [
    [Math.min(...lngs), Math.max(...lats)],
    [Math.max(...lngs), Math.min(...lats)],
  ];

  const map = new YMap(canvas, { location: { bounds }, margin: MARGIN });
  map.addChild(new YMapDefaultSchemeLayer());
  map.addChild(new YMapDefaultFeaturesLayer());

  const marks = new Map<number, HTMLElement>();
  for (const point of points) {
    const element = markerElement(point);
    marks.set(point.id, element);
    // blockEvents: карта не перехватывает клик по метке у ссылки внутри неё
    map.addChild(new YMapMarker({ coordinates: [point.lng, point.lat], blockEvents: true }, element));
  }
  holder.classList.add('is-loaded');

  const targets = [...document.querySelectorAll<HTMLElement>('[data-map-focus]')];
  targets.forEach((target) => {
    target.addEventListener('click', () => {
      const id = Number(target.dataset.mapFocus);
      const point = points.find((item) => item.id === id);
      if (!point) return;
      targets.forEach((other) => {
        other.setAttribute('aria-pressed', String(other === target));
        other.closest('[data-place]')?.classList.toggle('is-shown', other === target);
      });
      marks.forEach((element, key) => element.classList.toggle('is-active', key === id));
      map.setLocation({
        center: [point.lng, point.lat],
        zoom: 16,
        duration: reduceMotion() ? 0 : 300,
        easing: 'ease-in-out',
      });
      // карта может лежать ниже кнопки
      holder.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    });
  });
};

const holder = document.querySelector<HTMLElement>('[data-map]');
if (holder && KEY) {
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void build(holder);
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(holder);
  } else {
    void build(holder);
  }
}
