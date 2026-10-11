// The booking flow: pick a service and a stylist, pick a time, give a name.
//
// THREE VIEWS, ONE REQUEST SHAPE
//
// Month, week and day are three densities over the same data, not three
// different features. Each one computes the range it needs, asks the
// availability endpoint once, and renders from a single Map keyed by date.
// Switching view re-fetches; switching day inside a loaded range costs nothing.
//
// THE 31-DAY CAP IS WHY MONTH VIEW IS NOT 42 DAYS
//
// The endpoint refuses an inclusive range over 31 days. A six-row month grid
// spans 42, so the month view asks for the month's OWN days — at most 31, and
// exactly 31 for October — and renders the borrowed leading and trailing cells
// as inert. They belong to a month the customer has not navigated to, so
// showing times in them would be wrong even if the range allowed it.
//
// `startsAt` goes back to the booking endpoint as the exact string availability
// handed out. It is never parsed into a Date and re-serialised: the engine
// offers instants, the endpoint matches on the instant, and a round trip
// through the browser's Date is a chance to lose one for no benefit.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  ApiError,
  createBooking,
  getAvailability,
  getCatalog,
  type Availability,
  type Booked,
  type Catalog,
  type Day,
  type Service,
  type Slot,
} from '../api';
import {
  addMonths,
  addDays,
  rangeFor,
  sameMonth,
  startOfWeek,
  weekDates,
} from '../calendar';
import {
  dateToIso,
  dayAndMonth,
  duration,
  fullMoment,
  salonDate,
  timeOfDay,
  weekdayLong,
} from '../format';
import MonthGrid from '../components/MonthGrid';
import WeekGrid from '../components/WeekGrid';
import DayTimes from '../components/DayTimes';
import Select from '../components/Select';
import shell from '../shell.module.css';
import styles from './Booking.module.css';

type View = 'month' | 'week' | 'day';

const VIEWS: readonly View[] = ['month', 'week', 'day'];

/** Any stylist qualified for the service. The default, and not a real id. */
const ANY_STAFF = '';

/** A 409 means the world moved, and each cause needs its own sentence. */
function bookingMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'slot_taken') {
      return 'Someone else just took that time. The times shown are now up to date.';
    }
    if (error.code === 'slot_not_available') {
      return 'That time is no longer free. Pick another.';
    }
    if (error.status === 400) {
      return 'Check the details above and try again.';
    }
  }
  return 'Something went wrong booking that time. Try again in a moment.';
}

/** 'October 2026' — a pure calendar label, so no zone is involved. */
function monthLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
}

function weekLabel(anchor: string, timeZone: string): string {
  const dates = weekDates(anchor);
  const first = dates[0]!;
  const last = dates[6]!;
  return `${dayAndMonth(dateToIso(first), timeZone)} – ${dayAndMonth(dateToIso(last), timeZone)}`;
}

export default function Booking() {
  const { slug = '' } = useParams();

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<{ title: string; detail: string } | null>(null);

  const [serviceId, setServiceId] = useState<string>('');
  const [staffId, setStaffId] = useState<string>(ANY_STAFF);

  const [view, setView] = useState<View>('month');
  /** Which period is on screen. A date, interpreted per view. */
  const [anchor, setAnchor] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);

  const [availability, setAvailability] = useState<Availability | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);

  // --- the salon and what it offers ---------------------------------------

  useEffect(() => {
    let live = true;
    getCatalog(slug)
      .then((loaded) => {
        if (!live) return;
        setCatalog(loaded);
        setServiceId(loaded.services[0]?.id ?? '');
      })
      .catch((error: unknown) => {
        if (!live) return;
        setLoadError(
          error instanceof ApiError && error.status === 404
            ? { title: 'Not found', detail: 'No salon at this address.' }
            : {
              title: "Can't reach the salon",
              detail: 'Something went wrong loading this page. Try again in a moment.',
            },
        );
      });
    return () => {
      live = false;
    };
  }, [slug]);

  const timeZone = catalog?.tenant.timeZone;
  const service: Service | undefined = catalog?.services.find((s) => s.id === serviceId);

  /** Today in the SALON's zone — a customer in Kennesaw at 20:00 is already on
   * tomorrow in Vienna, and every view has to agree about which day that is. */
  const today = useMemo(() => (timeZone ? salonDate(new Date(), timeZone) : null), [timeZone]);

  useEffect(() => {
    if (today && !anchor) {
      setAnchor(today);
      setDate(today);
    }
  }, [today, anchor]);

  // A stylist who cannot do the newly chosen service must not stay selected —
  // the availability query would return nothing and the page would look broken.
  useEffect(() => {
    if (staffId !== ANY_STAFF && service && !service.staff.some((s) => s.id === staffId)) {
      setStaffId(ANY_STAFF);
    }
  }, [service, staffId]);

  // --- availability for the visible period --------------------------------

  const range = useMemo(
    () => (anchor && today ? rangeFor(view, anchor, today) : null),
    [view, anchor, today],
  );

  useEffect(() => {
    if (!serviceId || !range) return;
    let live = true;

    setAvailability(null);
    setSlot(null);

    getAvailability(slug, serviceId, range.from, range.through, staffId || undefined)
      .then((loaded) => {
        if (live) setAvailability(loaded);
      })
      .catch(() => {
        if (live) setProblem('Could not load times. Try again in a moment.');
      });

    return () => {
      live = false;
    };
  }, [slug, serviceId, staffId, range]);

  /** Keyed by date, so every view looks a day up the same way. */
  const days = useMemo(() => {
    const map = new Map<string, Day>();
    for (const day of availability?.days ?? []) map.set(day.date, day);
    return map;
  }, [availability]);

  // --- period navigation ---------------------------------------------------

  function step(direction: -1 | 1) {
    if (!anchor) return;
    const next =
      view === 'month'
        ? addMonths(anchor, direction)
        : addDays(anchor, direction * (view === 'week' ? 7 : 1));
    setAnchor(next);
    // Keep the chosen day inside the period on screen, so the day view and the
    // heading never disagree about which date they are describing.
    if (view === 'day') setDate(next);
    else if (view === 'week') setDate(startOfWeek(next));
    else if (date && !sameMonth(date, next)) setDate(next);
  }

  /** Stepping back is pointless once the period already contains today. */
  const canStepBack = Boolean(
    anchor &&
    today &&
    (view === 'month'
      ? !sameMonth(anchor, today)
      : view === 'week'
        ? startOfWeek(anchor) > startOfWeek(today)
        : anchor > today),
  );

  const periodLabel = !anchor || !timeZone
    ? ''
    : view === 'month'
      ? monthLabel(anchor)
      : view === 'week'
        ? weekLabel(anchor, timeZone)
        : `${weekdayLong(dateToIso(anchor), timeZone)} ${dayAndMonth(dateToIso(anchor), timeZone)}`;

  // --- booking -------------------------------------------------------------

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!slot || !serviceId || sending) return;

    // Whoever the engine says can take this time. If the customer picked a
    // stylist, that is the one; otherwise the first qualified for this slot.
    const takenBy = staffId && slot.staffIds.includes(staffId) ? staffId : slot.staffIds[0];
    if (!takenBy) {
      setProblem('Nobody is available for that time any more. Pick another.');
      return;
    }

    setSending(true);
    setProblem(null);
    try {
      const result = await createBooking(slug, {
        serviceId,
        staffId: takenBy,
        startsAt: slot.startsAt,
        customer: phone.trim() ? { name, email, phone } : { name, email },
      });
      setBooked(result);
    } catch (error: unknown) {
      setProblem(bookingMessage(error));
      // Refresh, so the times the customer looks at next are the current ones.
      if (range) {
        getAvailability(slug, serviceId, range.from, range.through, staffId || undefined)
          .then(setAvailability)
          .catch(() => undefined);
      }
      setSlot(null);
    } finally {
      setSending(false);
    }
  }

  // --- rendering -----------------------------------------------------------

  if (loadError) {
    return (
      <main className={`${shell.page} ${shell.narrow}`}>
        <Link className={shell.wordmark} to="/">
          Whiteboard
        </Link>
        <h1 className={shell.title}>{loadError.title}</h1>
        <p className={shell.lede}>{loadError.detail}</p>
      </main>
    );
  }

  if (!catalog || !timeZone || !today || !anchor) {
    return (
      <main className={`${shell.page} ${shell.narrow}`}>
        <span className={shell.wordmark}>Whiteboard</span>
        <p className={shell.lede}>Loading…</p>
      </main>
    );
  }

  if (booked) {
    const manageUrl = `${window.location.origin}/${slug}/manage?token=${encodeURIComponent(
      booked.manageToken,
    )}`;
    return (
      <main className={`${shell.page} ${shell.narrow}`}>
        <Link className={shell.wordmark} to="/">
          Whiteboard
        </Link>
        <div className={styles.done}>
          <h1 className={styles.doneTitle}>You're booked</h1>
          <p className={shell.lede}>
            {fullMoment(booked.startsAt, timeZone)} at {catalog.tenant.name}, {timeZone}.
          </p>
          <p className={shell.lede}>
            Keep this link. It is the only way to change or cancel this appointment, and it is not
            shown again.
          </p>
          <a className={styles.manage} href={manageUrl}>
            {manageUrl}
          </a>
        </div>
      </main>
    );
  }

  const chosenDay = date ? days.get(date) : undefined;

  return (
    <main className={shell.page}>
      <Link className={shell.wordmark} to="/">
        Whiteboard
      </Link>

      <div className={styles.head}>
        <h1 className={styles.salon}>{catalog.tenant.name}</h1>
        <span className={styles.zone}>All times {timeZone}</span>
      </div>

      <div className={styles.controls}>
        <Select
          label="Service"
          value={serviceId}
          onChange={setServiceId}
          options={catalog.services.map((s) => ({
            value: s.id,
            label: `${s.name} · ${duration(s.durationMinutes)}`,
          }))}
        />
        <Select
          label="Preferred staff"
          value={staffId}
          disabled={!service || service.staff.length === 0}
          onChange={setStaffId}
          options={[
            { value: ANY_STAFF, label: 'Any' },
            ...(service?.staff ?? []).map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
      </div>

      <div className={styles.bar}>
        <div className={styles.period}>
          <button
            type="button"
            className={styles.step}
            onClick={() => step(-1)}
            disabled={!canStepBack}
            aria-label="Previous"
          >
            <svg width="7" height="12" viewBox="0 0 7 12" aria-hidden="true">
              <path d="M6 1L1 6l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.step}
            onClick={() => step(1)}
            aria-label="Next"
          >
            <svg width="7" height="12" viewBox="0 0 7 12" aria-hidden="true">
              <path d="M1 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
          <span className={styles.periodLabel}>{periodLabel}</span>
        </div>

        <div className={styles.views} role="group" aria-label="Calendar view">
          {VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              className={`${styles.view} ${view === option ? styles.viewOn : ''}`}
              aria-pressed={view === option}
              onClick={() => {
                setView(option);
                // Anchor on the chosen day so switching view keeps the
                // customer where they were rather than jumping to today.
                if (date) setAnchor(date);
              }}
            >
              {option[0]!.toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.calendar}>
        {availability?.noQualifiedStaff ? (
          <p className={shell.lede}>Nobody is set up for this service yet.</p>
        ) : view === 'month' ? (
          <MonthGrid
            anchor={anchor}
            today={today}
            selected={date}
            days={days}
            onPick={(picked) => {
              setDate(picked);
              setAnchor(picked);
              setView('day');
            }}
          />
        ) : view === 'week' ? (
          <WeekGrid
            anchor={anchor}
            today={today}
            timeZone={timeZone}
            days={days}
            selected={slot}
            onPick={(picked, chosen) => {
              setDate(picked);
              setSlot(chosen);
            }}
          />
        ) : (
          // No heading here: the period label above already names the day, and
          // repeating it is the sort of duplication that only shows up once you
          // look at the rendered page.
          <DayTimes day={chosenDay} timeZone={timeZone} selected={slot} onPick={setSlot} />
        )}
      </div>

      {!slot ? (
        <p className={styles.hint}>
          {view === 'month'
            ? 'Pick a day with times to see them.'
            : 'Pick a time to book it.'}
        </p>
      ) : null}

      {slot && service ? (
        <form className={styles.form} onSubmit={submit}>
          <p className={styles.chosen}>{timeOfDay(slot.startsAt, timeZone)}</p>
          <p className={styles.chosenMeta}>
            {weekdayLong(slot.startsAt, timeZone)} {dayAndMonth(slot.startsAt, timeZone)} ·{' '}
            {service.name}, {duration(service.durationMinutes)}
          </p>

          {problem ? <p className={styles.problem}>{problem}</p> : null}

          <div className={styles.fields}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="name">
                Your name
              </label>
              <input
                id="name"
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
                autoComplete="name"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={320}
                autoComplete="email"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="phone">
                Phone, if you want a reminder
              </label>
              <input
                id="phone"
                type="tel"
                className={styles.input}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={40}
                autoComplete="tel"
              />
            </div>
          </div>

          <button className={styles.submit} type="submit" disabled={sending}>
            {sending ? 'Booking…' : 'Book this time'}
          </button>
        </form>
      ) : null}
    </main>
  );
}
