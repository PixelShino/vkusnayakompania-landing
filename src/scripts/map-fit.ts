/**
 * Fits the widget map to the two venues. They stand about seven kilometres
 * apart, so one zoom cannot serve both a 390 px band on the phone and a
 * 1440 px one on the desktop: at the phone's zoom the venues sink into a map
 * of the region, at the desktop's one pin walks out of the frame. The
 * messenger panel lies over the corner a pin lands in, so the fit is measured
 * against the free part of the band and the centre steps off it by the same
 * amount. The address is rewritten before the lazy frame mounts it; with
 * scripting off the server's wide zoom stays and both pins are still in frame.
 * Подгонка виджета карты под две точки. Между ними около семи километров, и
 * один зум не обслуживает и полосу 390 px на телефоне, и 1440 px на десктопе:
 * на телефонном зуме точки тонут в карте области, на десктопном одна метка
 * уходит за кадр. Панель мессенджеров лежит поверх угла, куда попадает метка,
 * поэтому подгонка меряется по свободной части полосы, а центр смещается на
 * ту же величину. Адрес переписывается до того, как его смонтирует ленивый
 * кадр; без скриптов остаётся широкий зум сервера — обе метки всё равно в кадре.
 */

interface Point {
  lat: number;
  lng: number;
}

/** metres per pixel at zoom 0 on the equator — the Web Mercator constant */
const EQUATOR = 156543.033928;
const M_PER_DEG_LAT = 110574;

/** доля свободной области под метками: остальное уходит в поля */
const FILL = 0.8;

/** ниже этой высоты панель игнорируем: свободной полосы уже не остаётся */
const MIN_FREE = 200;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** How much of the band's height the panel takes, and from which end. */
/** Сколько высоты полосы забирает панель и с какого её края. */
const panelCut = (box: DOMRect) => {
  const panel = document.querySelector<HTMLElement>('[data-map-panel]');
  if (!panel) return { top: 0, bottom: 0 };
  const p = panel.getBoundingClientRect();
  const overlap = Math.min(p.bottom, box.bottom) - Math.max(p.top, box.top);
  if (overlap <= 0 || p.right <= box.left || p.left >= box.right) return { top: 0, bottom: 0 };
  if (box.height - overlap < MIN_FREE) return { top: 0, bottom: 0 };
  return p.top + p.height / 2 < box.top + box.height / 2
    ? { top: overlap, bottom: 0 }
    : { top: 0, bottom: overlap };
};

const fit = (holder: HTMLElement) => {
  let points: Point[] = [];
  try {
    points = JSON.parse(holder.dataset.mapFit ?? '[]');
  } catch {
    return;
  }
  const src = holder.dataset.src;
  if (!src || points.length < 2) return;

  const box = holder.getBoundingClientRect();
  if (!box.width || !box.height) return;

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  const cut = panelCut(box);
  const freeH = box.height - cut.top - cut.bottom;

  // metres the venues span, against the metres the free area can show
  // метры между точками против метров, которые вмещает свободная область
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(rad(midLat));
  const spanX = (Math.max(...lngs) - Math.min(...lngs)) * mPerDegLng;
  const spanY = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG_LAT;
  const need = Math.max(spanX / (box.width * FILL), spanY / (freeH * FILL), 1e-6);

  const scale = EQUATOR * Math.cos(rad(midLat));
  const zoom = Math.min(16, Math.max(11, Math.floor(Math.log2(scale / need))));
  const metresPerPx = scale / 2 ** zoom;

  // the map centres on the band, the venues on the free area: the gap in metres
  // карта центрируется по полосе, точки — по свободной области: разница в метрах
  const offset = (cut.top + freeH / 2 - box.height / 2) * metresPerPx;
  const lat = (midLat + offset / M_PER_DEG_LAT).toFixed(6);
  const lng = midLng.toFixed(6);

  // a plain swap, not `URL`: `searchParams` would re-encode the `~` between pins
  // простая подстановка, не `URL`: `searchParams` перекодирует `~` между метками
  holder.dataset.src = src
    .replace(/([?&]ll=)[^&]*/, `$1${lng}%2C${lat}`)
    .replace(/([?&]z=)[^&]*/, `$1${zoom}`);
};

const holders = [...document.querySelectorAll<HTMLElement>('[data-map-fit]')];
const fitAll = () => holders.forEach((holder) => !holder.classList.contains('is-loaded') && fit(holder));

fitAll();
// шрифты меняют высоту панели, поворот — ширину полосы; смонтированный кадр не трогаем
document.fonts?.ready.then(fitAll);
window.addEventListener('resize', fitAll);
