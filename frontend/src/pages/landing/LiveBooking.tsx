// The top of the product page: book a real time at a demo organization, right here.
//
// On arrival (wide screens, motion allowed) a short pinned scroll scene plays
// Studio Wien's month: open days fill in, a day is picked, times appear, one
// turns black. The first click anywhere in it hands over to the visitor, and
// from then on it is the booking flow: switch organization, pick a day and a time,
// give a name and email, book.

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';

import {
  ApiError,
  createBooking,
  getAvailability,
  getCatalog,
  type Booked,
  type Day,
  type Service,
  type Slot,
} from '@/lib/api';
import { rangeFor } from '@/lib/dates';
import { dayAndMonth, duration, organizationDate, timeOfDay, weekdayLong } from '@/lib/format';
import Button from '@/components/ui/Button';
import DayTimes from '@/components/schedule/DayTimes';
import Field from '@/components/ui/Field';
import MonthGrid from '@/components/schedule/MonthGrid';
import { sceneFrame } from './scene';
import { prefersReducedMotion } from './useReveal';
import styles from './Landing.module.css';
import Problem from '@/components/ui/Problem';

export const ORGANIZATIONS = [
  { slug: 'studio-wien', name: 'Studio Wien', place: 'Vienna' },
  { slug: 'marinas-cuts-color', name: "Marina's Cuts & Color", place: 'New York' },
] as const;

type Month =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; name: string; today: string; timeZone: string; service: Service | undefined; days: Map<string, Day> };

/** An organization's month from today, in its own zone. A reload keeps the old month on screen. */
function useMonth(slug: string, reload: number): Month {
  const [month, setMonth] = useState<Month>({ kind: 'loading' });
  const shownSlug = useRef(slug);

  useEffect(() => {
    let live = true;
    if (shownSlug.current !== slug) {
      shownSlug.current = slug;
      setMonth({ kind: 'loading' });
    }
    (async (): Promise<Month> => {
      const catalog = await getCatalog(slug);
      const timeZone = catalog.tenant.timeZone;
      const today = organizationDate(new Date(), timeZone);
      const service = catalog.services[0];
      const days = new Map<string, Day>();
      if (service) {
        const { from, through } = rangeFor('month', today, today);
        const found = await getAvailability(slug, service.id, from, through);
        for (const day of found.days) days.set(day.date, day);
      }
      return { kind: 'ready', name: catalog.tenant.name, today, timeZone, service, days };
    })()
      .then((next) => live && setMonth(next))
      .catch(() => live && setMonth({ kind: 'failed' }));
    return () => {
      live = false;
    };
  }, [slug, reload]);

  return month;
}

/** 0 when the track's top reaches the viewport's top, 1 when the scene has played. */
function useScrollProgress(track: React.RefObject<HTMLElement | null>, enabled: boolean): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const el = track.current;
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
  }, [track, enabled]);
  return progress;
}

function firstOpen(days: Map<string, Day>, fallback: string): string {
  for (const day of days.values()) {
    if (day.status === 'open' && day.slots.length > 0) return day.date;
  }
  return fallback;
}

function bookingProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'slot_taken') return 'Someone else just took that time. The times shown are now up to date.';
    if (error.code === 'slot_not_available') return 'That time is no longer free. Pick another.';
    if (error.status === 400) return 'Check your name and email, then try again.';
  }
  return 'Something went wrong booking that time. Try again in a moment.';
}

/** The scene only plays where it fits: motion allowed and a wide screen. */
function sceneAllowed(): boolean {
  if (prefersReducedMotion()) return false;
  return window.matchMedia?.('(min-width: 48rem)').matches ?? false;
}

export default function LiveBooking() {
  const [handedOver, setHandedOver] = useState(() => !sceneAllowed());
  const [slug, setSlug] = useState<string>(ORGANIZATIONS[0].slug);
  const [reload, setReload] = useState(0);
  const month = useMonth(slug, reload);

  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);

  const track = useRef<HTMLDivElement>(null);
  const tile = useRef<HTMLElement>(null);
  const progress = useScrollProgress(track, !handedOver && month.kind === 'ready');

  // The form is tall and what replaces it short, so bring the outcome into view.
  const outcome = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (booked || problem) outcome.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [booked, problem]);

  // Unpinning collapses the scroll track; keep the tile where the visitor sees it.
  const keepAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (keepAt.current === null || !tile.current) return;
    window.scrollBy(0, tile.current.getBoundingClientRect().top - keepAt.current);
    keepAt.current = null;
  }, [handedOver]);

  function takeOver(change: () => void) {
    if (!handedOver) {
      keepAt.current = tile.current?.getBoundingClientRect().top ?? null;
      setHandedOver(true);
    }
    change();
  }

  function switchTo(next: string) {
    takeOver(() => {
      setSlug(next);
      setDate(null);
      setSlot(null);
      setProblem(null);
      setBooked(null);
    });
  }

  async function book(event: FormEvent) {
    event.preventDefault();
    if (!slot || sending || month.kind !== 'ready' || !month.service) return;
    const staffId = slot.staffIds[0];
    if (!staffId) return;
    setSending(true);
    setProblem(null);
    try {
      setBooked(
        await createBooking(slug, {
          serviceId: month.service.id,
          staffId,
          startsAt: slot.startsAt,
          customer: { name, email },
        }),
      );
    } catch (error) {
      setProblem(bookingProblem(error));
      setSlot(null);
      setReload((n) => n + 1);
    } finally {
      setSending(false);
    }
  }

  let product;
  if (month.kind === 'failed') {
    product = <p className={styles.frameNote}>We couldn't load this organization's times. Try again in a moment.</p>;
  } else if (month.kind === 'loading') {
    product = <p className={styles.frameNote}>Loading times…</p>;
  } else if (booked) {
    const manageUrl = `${window.location.origin}/${slug}/manage?token=${encodeURIComponent(booked.manageToken)}`;
    product = (
      <div ref={outcome} className={styles.done}>
        <h3 className={styles.doneTitle}>You're booked</h3>
        <p className={styles.doneWhen}>
          {timeOfDay(booked.startsAt, month.timeZone)}, {weekdayLong(booked.startsAt, month.timeZone)}{' '}
          {dayAndMonth(booked.startsAt, month.timeZone)} at {month.name}.
        </p>
        <p className={styles.frameNote}>
          {booked.emailed ? "We've emailed you this link too. " : 'Keep this link. '}It's the only way to change or cancel
          this booking.
        </p>
        <a className={styles.manageLink} href={manageUrl}>
          {manageUrl}
        </a>
        <Button
          variant="secondary"
          onClick={() => {
            setBooked(null);
            setSlot(null);
            setReload((n) => n + 1);
          }}
        >
          Pick another time
        </Button>
      </div>
    );
  } else {
    const frame = handedOver ? null : sceneFrame(progress, month.days);
    const shownDate = frame ? frame.selected : (date ?? firstOpen(month.days, month.today));
    const day = shownDate ? month.days.get(shownDate) : undefined;
    const shownDay = frame && day?.status === 'open' ? { ...day, slots: day.slots.slice(0, frame.slots) } : day;
    const chosen = frame
      ? frame.slotOn && shownDay?.status === 'open'
        ? (shownDay.slots[0] ?? null)
        : null
      : slot;

    product = (
      <div className={styles.flow}>
        <MonthGrid
          anchor={month.today}
          today={month.today}
          selected={shownDate}
          days={frame ? frame.days : month.days}
          onPick={(picked) =>
            takeOver(() => {
              setDate(picked);
              setSlot(null);
              setProblem(null);
            })
          }
        />
        <div className={styles.day}>
          {problem ? (
            <Problem as="div" ref={outcome} className={styles.problem} role="alert">
              {problem}
            </Problem>
          ) : null}
          {shownDay && (!frame || frame.slots > 0) ? (
            <DayTimes
              day={shownDay}
              timeZone={month.timeZone}
              selected={chosen}
              onPick={(picked) =>
                takeOver(() => {
                  setDate(shownDate);
                  setSlot(picked);
                  setProblem(null);
                })
              }
            />
          ) : null}
          {!frame && slot && month.service ? (
            <form className={styles.form} onSubmit={book}>
              <p className={styles.summary}>
                {weekdayLong(slot.startsAt, month.timeZone)} {dayAndMonth(slot.startsAt, month.timeZone)},{' '}
                {month.service.name}, {duration(month.service.durationMinutes)}
              </p>
              <Field label="Your name" value={name} onChange={setName} required maxLength={200} autoComplete="name" />
              <Field
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                required
                maxLength={320}
                autoComplete="email"
              />
              <div>
                <Button type="submit" disabled={sending}>
                  {sending ? 'Booking…' : `Book ${timeOfDay(slot.startsAt, month.timeZone)}`}
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div ref={track} className={handedOver ? undefined : styles.sceneTrack}>
      <section ref={tile} className={`${styles.tile} ${styles.paper} ${styles.live}`} aria-label="Book at a demo organization">
        <h1 className={styles.heroTitle}>Online booking platform.</h1>
        <p className={styles.tileLine}>
          Book a real time at a demo organization, right here. Clients book themselves, any hour.
        </p>
        <div className={styles.switcher} role="group" aria-label="Demo organization">
          {ORGANIZATIONS.map((organization) => (
            <button
              key={organization.slug}
              type="button"
              className={styles.switch}
              aria-pressed={slug === organization.slug}
              onClick={() => switchTo(organization.slug)}
            >
              {organization.name}
            </button>
          ))}
        </div>
        <div className={styles.frame}>
          <p className={styles.frameZone}>
            {month.kind === 'ready' ? `All times ${month.timeZone.split('/').pop()?.replaceAll('_', ' ')}` : ' '}
          </p>
          {product}
        </div>
      </section>
    </div>
  );
}
