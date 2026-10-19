/**
 * «Ход сборки» on the «Публикация сайта» page: a bar that fills while the site
 * is being built, the current step («собираю страницы: фото 120 из 559») and
 * the result, read from `site_build` every 2 s during a build and every 10 s
 * otherwise. When a build ends the page reloads once, so the summary, the
 * times and the error below are fresh too — the editor never has to guess
 * whether to press F5.
 *
 * «Ход сборки» на странице «Публикация сайта»: полоса, которая заполняется,
 * пока сайт собирается, текущий шаг («собираю страницы: фото 120 из 559») и
 * итог. Читает `site_build` раз в 2 с во время сборки и раз в 10 с в покое.
 * Когда сборка заканчивается, страница один раз перезагружается сама, и «Что
 * на сайте», время и текст ошибки ниже тоже свежие — гадать, нажимать ли F5,
 * не нужно.
 *
 * An app extension without a build step: `vue` and `@directus/extensions-sdk`
 * are the admin's own copies, the file is bundled by Directus at start.
 * Расширение админки без сборки: `vue` и `@directus/extensions-sdk` — копии
 * самой админки, файл собирает Directus при запуске.
 */
import { h, ref, onMounted, onBeforeUnmount } from 'vue';
import { useApi } from '@directus/extensions-sdk';

const LOOK = {
  building: { title: 'Идёт сборка', color: 'var(--theme--warning)' },
  stale: { title: 'Есть правки, которых нет на сайте', color: 'var(--theme--warning)' },
  ok: { title: 'Опубликовано', color: 'var(--theme--success)' },
  error: { title: 'Сборка не удалась', color: 'var(--theme--danger)' },
};
const busy = (status) => status === 'building' || status === 'stale';
const clock = (iso) =>
  iso ? new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '';

const BuildStatus = {
  props: { value: { type: Number, default: null } },
  setup(props) {
    const api = useApi();
    const state = ref(null);
    let timer = null;
    let stopped = false;

    const load = async () => {
      try {
        const response = await api.get('/items/site_build', {
          params: { fields: 'status,progress,step,finished_at,seconds' },
        });
        const now = response.data.data ?? {};
        // the build this page watched has ended: reload once for the fresh summary
        // сборка, за которой следила страница, закончилась — один раз обновить ради свежей сводки
        if (busy(state.value?.status) && !busy(now.status)) {
          window.location.reload();
          return;
        }
        state.value = now;
      } catch {
        // Directus restarting or offline: keep the last known state and try again
        // Directus перезапускается или недоступен — держим последнее состояние и пробуем снова
      }
      if (!stopped) timer = setTimeout(load, busy(state.value?.status) ? 2000 : 10000);
    };
    onMounted(load);
    onBeforeUnmount(() => {
      stopped = true;
      clearTimeout(timer);
    });

    return () => {
      const s = state.value ?? { progress: props.value };
      const look = LOOK[s.status] ?? { title: 'Статус сборки', color: 'var(--theme--primary)' };
      const pct = Math.max(0, Math.min(100, Math.round(Number(s.progress ?? 0))));
      const line =
        s.status === 'ok'
          ? `Готово в ${clock(s.finished_at)}${s.seconds ? `, сборка заняла ${s.seconds} с` : ''}`
          : s.status === 'error'
            ? 'На сайте осталась прежняя версия — подробности ниже'
            : s.step
              ? `Сейчас: ${s.step}`
              : 'Ждём начала сборки';
      return h('div', { style: 'display:grid;gap:10px' }, [
        h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:16px' }, [
          h('span', { style: `font-size:18px;font-weight:700;color:${look.color}` }, look.title),
          h('span', { style: 'font-size:18px;font-weight:700;font-variant-numeric:tabular-nums' }, `${pct} %`),
        ]),
        h(
          'div',
          {
            role: 'progressbar',
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': pct,
            'aria-label': look.title,
            style: 'height:12px;border-radius:6px;background:var(--theme--background-accent);overflow:hidden',
          },
          [h('div', { style: `height:100%;width:${pct}%;background:${look.color};border-radius:6px;transition:width .8s ease` })],
        ),
        h('div', { style: 'color:var(--theme--foreground-subdued);font-variant-numeric:tabular-nums' }, [
          line,
          busy(s.status) ? h('span', { style: 'opacity:.75' }, ' · страница обновится сама') : null,
        ]),
      ]);
    };
  },
};

export default {
  id: 'build-status',
  name: 'Ход сборки',
  icon: 'published_with_changes',
  description: 'Живой статус сборки сайта: полоса, шаг и итог; обновляется сам',
  component: BuildStatus,
  types: ['integer'],
  options: null,
};
