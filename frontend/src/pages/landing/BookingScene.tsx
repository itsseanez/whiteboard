// The page's one pinned scroll scene: Studio Wien's real month, live, driven
// by scroll. Open days fill in, a day is picked, its times appear, one turns
// black. Clicking anything in it goes to the real booking page.

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { getAvailability, getCatalog, type Day } from '../../api';
import { rangeFor } from '../../calendar';
import { salonDate } from '../../format';
import DayTimes from '../../components/DayTimes';
import MonthGrid from '../../components/MonthGrid';
import { sceneFrame } from './scene';
import { prefersReducedMotion } from './useReveal';
import styles from '../Landing.module.css';

const SALON = 'studio-wien';

type Month =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; today: string; timeZone: string; days: Map<string, Day> };

function useMonth(): Month {
  const [month, setMonth] = useState<Month>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    (async (): Promise<Month> => {
      const catalog = await getCatalog(SALON);
      const timeZone = catalog.tenant.timeZone;
      const today = salonDate(new Date(), timeZone);
      const days = new Map<string, Day>();
      const service = catalog.services[0];
      if (service) {
        const { from, through } = rangeFor('month', today, today);
        const found = await getAvailability(SALON, service.id, from, through);
        for (const day of found.days) days.set(day.date, day);
      }
      return { kind: 'ready', today, timeZone, days };
    })()
      .then((next) => live && setMonth(next))
      .catch(() => live && setMonth({ kind: 'failed' }));
    return () => {
      live = false;
    };
  }, []);
  return month;
}

/** 0 when the scene's wrapper reaches the top of the viewport, 1 when it leaves. */
function useScrollProgress(wrapper: React.RefObject<HTMLElement | null>, enabled: boolean): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const el = wrapper.current;
    if (!enabled || !el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      setProgress(travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 1);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [wrapper, enabled]);
  return progress;
}

export default function BookingScene() {
  const navigate = useNavigate();
  const wrapper = useRef<HTMLDivElement>(null);
  const [still] = useState(prefersReducedMotion);
  const month = useMonth();
  const progress = useScrollProgress(wrapper, !still && month.kind === 'ready');
  const goBook = () => navigate(`/${SALON}`);

  let visual;
  if (month.kind === 'failed') {
    visual = (
      <p className={styles.sceneNote}>
        We couldn't load Studio Wien's times. <Link to={`/${SALON}`}>Open the booking page</Link>.
      </p>
    );
  } else if (month.kind === 'loading') {
    visual = <p className={styles.sceneNote}>Loading Studio Wien's month…</p>;
  } else {
    // Reduced motion: the final frame, unpinned.
    const frame = sceneFrame(still ? 1 : progress, month.days);
    const day = frame.selected ? month.days.get(frame.selected) : undefined;
    const shown = day?.status === 'open' ? { ...day, slots: day.slots.slice(0, frame.slots) } : undefined;
    const chosen = frame.slotOn && shown?.status === 'open' ? (shown.slots[0] ?? null) : null;
    visual = (
      <div className={styles.sceneProduct}>
        <MonthGrid anchor={month.today} today={month.today} selected={frame.selected} days={frame.days} onPick={goBook} />
        <div className={styles.sceneTimes}>
          {shown && frame.slots > 0 ? (
            <DayTimes day={shown} timeZone={month.timeZone} selected={chosen} onPick={goBook} />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapper} className={still ? styles.sceneStill : styles.sceneTrack}>
      <section className={`${styles.tile} ${styles.sunk} ${styles.scene}`}>
        <h2 className={styles.tileTitle}>Every free time, in one place</h2>
        <p className={styles.tileLine}>
          Hours, shifts, time off and bookings are checked for every time. This is Studio Wien's
          month, live.
        </p>
        {visual}
      </section>
    </div>
  );
}
