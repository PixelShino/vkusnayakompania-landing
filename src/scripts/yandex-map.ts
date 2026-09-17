/**
 * Yandex Maps JS API 3.0: both venues on one map, script pulled in lazily.
 * Written against the official docs — `ymaps3.ready`, `YMap` with
 * `location: { bounds }`, `YMapDefaultSchemeLayer` / `YMapDefaultFeaturesLayer`
 * and `YMapMarker(props, element)`.
 * Карта на две точки, всегда обе в кадре — режима «одна точка крупно» нет.
 * Скрипт подключается лениво, когда контейнер подходит к экрану; не загрузился
 * за 8 секунд — остаются ссылки на карточки организаций на планке над картой.
 */

/** Точка для метки: адрес карточки организации приходит из контента готовым. */
type Point = { id: number; n: string; name: string; lat: number; lng: number; href: string };

type LngLat = [number, number];
type Location = { bounds: [LngLat, LngLat] };
type YMapInstance = { addChild(child: unknown): void };

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
    // карты нет — на планке над ней остаются ссылки на карточки точек
    holder.classList.add('is-failed');
    if (note) note.textContent = 'Карта не загрузилась';
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

  for (const point of points) {
    const element = markerElement(point);
    // blockEvents: карта не перехватывает клик по метке у ссылки внутри неё
    map.addChild(new YMapMarker({ coordinates: [point.lng, point.lat], blockEvents: true }, element));
  }
  holder.classList.add('is-loaded');
};

// widget branch: the pins are ~300 px apart at zoom 12, so on a band narrower
// than 480 px they sit on the edges — one step out keeps both well inside
// ветка виджета: при зуме 12 метки стоят в ~300 px друг от друга, и на полосе
// уже 480 px они упираются в края — шаг назад держит обе внутри кадра
const widget = document.querySelector<HTMLElement>('[data-frame="map"]');
if (widget && widget.clientWidth < 480 && widget.dataset.src)
  widget.dataset.src = widget.dataset.src.replace('&z=12&', '&z=11&');

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
