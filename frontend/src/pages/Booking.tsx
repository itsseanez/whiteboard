// The booking flow: pick a service, pick a day, pick a time, give a name.
//
// Two things worth knowing about how this talks to the API.
//
// First, it asks for a 14-day window once per service rather than one day at a
// time. The day strip then shows which days are actually open before the
// customer clicks a shut one, and switching days costs no request. The
// endpoint caps a range at 31 days, so 14 is well inside it.
//
// Second, `startsAt` goes back to the booking endpoint as the exact string the
// availability response gave out. It is never parsed into a Date and
// re-serialised. The engine offers instants; the booking endpoint matches on
// the instant; a round trip through the browser's Date is a chance to lose
// precision or shift a zone for no benefit.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  ApiError,
  createBooking,
  getAvailability,
  getCatalog,
  type Availability,
  type Booked,
  type Catalog,
  type Service,
  type Slot,
} from '../api';
import {
  dateRange,
  dateToIso,
  dayAndMonth,
  dayOfMonth,
  duration,
  fullMoment,
  timeOfDay,
  weekdayLong,
  weekdayShort,
} from '../format';

const WINDOW_DAYS = 14;

/** A 409 means the world moved, and each cause needs its own sentence. */
function bookingMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'slot_taken') {
      return 'Someone else just took that time. The list below is up to date.';
    }
    if (error.code === 'slot_not_available') {
      return 'That time is no longer free. Pick another from the list below.';
    }
    if (error.status === 400) {
      return 'Check the details above and try again.';
    }
  }
  return 'Something went wrong booking that time. Try again in a moment.';
}

export default function Booking() {
  const { slug = '' } = useParams();

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
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
        setServiceId(loaded.services[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setLoadError(
          error instanceof ApiError && error.status === 404
            ? 'No salon at this address.'
            : 'Could not load this salon. Try again in a moment.',
        );
      });
    return () => {
      live = false;
    };
  }, [slug]);

  const timeZone = catalog?.tenant.timeZone;
  const service: Service | undefined = catalog?.services.find((s) => s.id === serviceId);

  // The days the strip offers. Computed in the salon's zone, so "today" is the
  // salon's today — a customer in Kennesaw at 20:00 is looking at tomorrow in
  // Vienna, and the strip has to say so.
  const dates = useMemo(
    () => (timeZone ? dateRange(timeZone, WINDOW_DAYS) : []),
    [timeZone],
  );

  useEffect(() => {
    if (!date && dates[0]) setDate(dates[0]);
  }, [dates, date]);

  // --- availability for the whole window ----------------------------------

  const from = dates[0];
  const through = dates[dates.length - 1];

  useEffect(() => {
    if (!serviceId || !from || !through) return;
    let live = true;

    setAvailability(null);
    setSlot(null);

    getAvailability(slug, serviceId, from, through, staffId ?? undefined)
      .then((loaded) => {
        if (live) setAvailability(loaded);
      })
      .catch(() => {
        if (live) setProblem('Could not load times. Try again in a moment.');
      });

    return () => {
      live = false;
    };
  }, [slug, serviceId, staffId, from, through]);

  const dayFor = useCallback(
    (wanted: string) => availability?.days.find((d) => d.date === wanted),
    [availability],
  );

  const today = date ? dayFor(date) : undefined;
  const slots = today?.status === 'open' ? today.slots : [];

  // --- booking ------------------------------------------------------------

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
      // Refresh, so the list the customer looks at next is the current one.
      if (serviceId && from && through) {
        getAvailability(slug, serviceId, from, through, staffId ?? undefined)
          .then(setAvailability)
          .catch(() => undefined);
      }
      setSlot(null);
    } finally {
      setSending(false);
    }
  }

  // --- rendering ----------------------------------------------------------

  if (loadError) {
    return (
      <main className="page">
        <Link className="wordmark" to="/">
          Whiteboard
        </Link>
        <h1 className="date">
          <span>Not found</span>
        </h1>
        <p className="lede">{loadError}</p>
      </main>
    );
  }

  if (!catalog || !timeZone) {
    return (
      <main className="page">
        <span className="wordmark">Whiteboard</span>
      </main>
    );
  }

  if (booked) {
    const manageUrl = `${window.location.origin}/${slug}/manage?token=${encodeURIComponent(booked.manageToken)}`;
    return (
      <main className="page">
        <Link className="wordmark" to="/">
          {catalog.tenant.name}
        </Link>
        <div className="done">
          <h1>You're booked</h1>
          <dl>
            <div>
              <dt>Service</dt>
              <dd>{service?.name}</dd>
            </div>
            <div>
              <dt>When</dt>
              <dd>{fullMoment(booked.startsAt, timeZone)}</dd>
            </div>
            <div>
              <dt>Ends</dt>
              <dd>{timeOfDay(booked.endsAt, timeZone)}</dd>
            </div>
            <div>
              <dt>With</dt>
              <dd>{service?.staff.find((m) => m.id === booked.staffId)?.name}</dd>
            </div>
          </dl>
          <p className="manage">
            To change or cancel this appointment, keep this link — it is the only copy:
            <br />
            <a href={manageUrl}>{manageUrl}</a>
          </p>
        </div>
      </main>
    );
  }

  const headingDate = date ?? from ?? '';

  return (
    <main className="page">
      <Link className="wordmark" to="/">
        {catalog.tenant.name}
      </Link>

      <h1 className="date">
        <span>{headingDate ? weekdayLong(dateToIso(headingDate), timeZone) : ''}</span>
        <span className="month">
          {headingDate ? dayAndMonth(dateToIso(headingDate), timeZone) : ''}
        </span>
      </h1>

      <div className="days">
        {dates.map((candidate) => {
          const day = dayFor(candidate);
          return (
            <button
              key={candidate}
              type="button"
              className="day"
              aria-pressed={candidate === date}
              data-shut={day?.status === 'closed'}
              onClick={() => {
                setDate(candidate);
                setSlot(null);
              }}
            >
              <span className="dow">{weekdayShort(dateToIso(candidate), timeZone)}</span>
              <span className="dom">{dayOfMonth(dateToIso(candidate), timeZone)}</span>
            </button>
          );
        })}
      </div>

      {catalog.services.length > 1 && (
        <div className="field">
          <h2>Service</h2>
          <div className="choices">
            {catalog.services.map((option) => (
              <button
                key={option.id}
                type="button"
                className="choice"
                aria-pressed={option.id === serviceId}
                onClick={() => {
                  setServiceId(option.id);
                  setStaffId(null);
                  setSlot(null);
                }}
              >
                {option.name}
                <span className="mins">{duration(option.durationMinutes)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {service && service.staff.length > 1 && (
        <div className="field">
          <h2>Stylist</h2>
          <div className="choices">
            <button
              type="button"
              className="choice"
              aria-pressed={staffId === null}
              onClick={() => {
                setStaffId(null);
                setSlot(null);
              }}
            >
              Anyone
            </button>
            {service.staff.map((member) => (
              <button
                key={member.id}
                type="button"
                className="choice"
                aria-pressed={member.id === staffId}
                onClick={() => {
                  setStaffId(member.id);
                  setSlot(null);
                }}
              >
                {member.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {service && service.staff.length === 0 && (
        <p className="note">
          Nobody is set up to perform {service.name} yet, so there is nothing to book.
        </p>
      )}

      {availability === null && <p className="empty">Looking for free times…</p>}

      {availability !== null && slots.length === 0 && (
        <p className="empty">
          {today?.status === 'closed'
            ? 'Closed on this day. Try another from the strip above.'
            : 'Nothing free on this day. Try another from the strip above.'}
        </p>
      )}

      {slots.length > 0 && (
        <ul className="times">
          {slots.map((candidate) => {
            const who = service?.staff.filter((m) => candidate.staffIds.includes(m.id)) ?? [];
            return (
              <li key={candidate.startsAt}>
                <button
                  type="button"
                  className="slot"
                  aria-pressed={candidate.startsAt === slot?.startsAt}
                  onClick={() => setSlot(candidate)}
                >
                  <span className="at">{timeOfDay(candidate.startsAt, timeZone)}</span>
                  <span className="who">{who.map((m) => m.name).join(', ')}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {problem && <p className="note">{problem}</p>}

      {slot && (
        <form className="booking" onSubmit={submit}>
          <h2>{timeOfDay(slot.startsAt, timeZone)}</h2>
          <p className="when">
            {service?.name}, until {timeOfDay(slot.endsAt, timeZone)}
          </p>

          <label>
            <span>Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              autoComplete="name"
            />
          </label>

          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={320}
              autoComplete="email"
            />
          </label>

          <label>
            <span>
              Phone <span className="optional">optional</span>
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={40}
              autoComplete="tel"
            />
          </label>

          <button className="go" type="submit" disabled={sending}>
            {sending ? 'Booking…' : 'Book this time'}
          </button>
        </form>
      )}
    </main>
  );
}
