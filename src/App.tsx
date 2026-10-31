import { useEffect, useRef, useState } from "react";
import { dateKey, eventStore, type CalendarEvent } from "./events";
import { monthDays, upcomingEvents, weekDays } from "./calendar";
import { labelStore, labelTextColor } from "./labels";
import { LabelManager } from "./LabelManager";
import { AppearanceSelector } from "./AppearanceSelector";

export function App() {
  const [events, setEvents] = useState(() => eventStore.list());
  const [labels, setLabels] = useState(() => labelStore.list());
  const [labelId, setLabelId] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState(() => dateKey(new Date()));
  const [eventTime, setEventTime] = useState("");
  const [notes, setNotes] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [view, setView] = useState<"week" | "month" | "three-months">("week");
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const refresh = () => { setEvents(eventStore.list()); setLabels(labelStore.list()); };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  function mutate(action: () => void) {
    try {
      action();
      setEvents(eventStore.list());
      setError("");
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save event.");
      setNotice("");
      return false;
    }
  }
  function editEvent(event: CalendarEvent) {
    setEditing(event.id); setTitle(event.title); setEventDate(event.date); setEventTime(event.time ?? "");
    setNotes(event.notes ?? "");
    setLabelId(labels.some(label => label.id === event.labelId) ? event.labelId! : "");
    setNotice(""); setError("");
    titleInput.current?.focus();
  }
  function eventActions(event: CalendarEvent) {
    return <div className="event-actions">
      <button type="button" onClick={() => editEvent(event)} aria-label={`Edit ${event.title}`}>Edit</button>
      <button type="button" onClick={() => {
        if (!window.confirm(`Delete "${event.title}"? This cannot be undone.`)) return;
        if (mutate(() => eventStore.delete(event.id))) {
          if (editing === event.id) { setEditing(null); setTitle(""); setEventTime(""); setNotes(""); setLabelId(""); }
          setNotice("Event deleted.");
        }
      }} aria-label={`Delete ${event.title}`}>Delete</button>
    </div>;
  }
  function eventNotes(event: CalendarEvent) {
    return event.notes?.trim() ? <details className="event-notes">
      <summary>Notes<span className="visually-hidden"> for {event.title}</span></summary>
      <p>{event.notes}</p>
    </details> : null;
  }
  function eventLabel(event: CalendarEvent) {
    const label = labels.find(label => label.id === event.labelId);
    return label ? <span className="label-badge" style={{ backgroundColor: label.color, color: labelTextColor(label.color) }}>
      {label.kind}: {label.name}
    </span> : null;
  }
  function renderEvent(event: CalendarEvent) {
    return <li key={event.id}>
      <time dateTime={event.time ? `${event.date}T${event.time}` : event.date}>{event.date} · {event.time ?? "All day"}</time> {event.title}{" "}
      {eventActions(event)}
      {eventLabel(event)}
      {eventNotes(event)}
    </li>;
  }
  const today = new Date();
  const days = weekDays(today, weekOffset);
  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const upcoming = upcomingEvents(events, dateKey(today));
  const monthTitle = (date: Date) => date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const threeMonths = Array.from({ length: 3 }, (_, index) => new Date(month.getFullYear(), month.getMonth() + index, 1, 12));
  const selectedEvents = events.filter(event => event.date === selectedDate);
  function moveThreeMonths(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1, 12);
    setMonth(next);
    setSelectedDate(dateKey(next));
  }

  return (
    <main>
      <h1>Family Calendar</h1>
      <AppearanceSelector />
      <p>A private calendar for our family.</p>
      <nav className="view-selector" aria-label="Calendar view">
        <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>Week</button>
        <button type="button" aria-pressed={view === "month"} onClick={() => setView("month")}>Month</button>
        <button type="button" aria-pressed={view === "three-months"} onClick={() => {
          setView("three-months");
          // Keep a chosen date when returning to the same visible range.
          const rangeEnd = new Date(month.getFullYear(), month.getMonth() + 3, 1, 12);
          if (selectedDate < dateKey(month) || selectedDate >= dateKey(rangeEnd)) {
            setSelectedDate(dateKey(month));
          }
        }}>3 Months</button>
      </nav>
      {view === "week" ?
      <section className="weekly-calendar" aria-labelledby="weekly-calendar-heading">
        <header className="week-header">
          <h2 id="weekly-calendar-heading">{weekOffset === 0 ? "This week" : "Week"}</h2>
          <p>{formatDate(days[0])} – {formatDate(days[6])}</p>
        </header>
        <nav className="week-navigation" aria-label="Week navigation">
          <button type="button" onClick={() => setWeekOffset(offset => offset - 1)}>Previous week</button>
          <button type="button" onClick={() => setWeekOffset(0)}>This week</button>
          <button type="button" onClick={() => setWeekOffset(offset => offset + 1)}>Next week</button>
        </nav>
        <p className="visually-hidden" role="status">Week of {formatDate(days[0])}</p>
        <ol className="week-days">
          {days.map((date) => {
            const isToday = date.toDateString() === today.toDateString();
            return (
              <li key={dateKey(date)} className={`day${isToday ? " day-today" : ""}`}>
                <h3>
                  <time dateTime={dateKey(date)} aria-current={isToday ? "date" : undefined}>
                    <span className="day-name">{date.toLocaleDateString("en-US", { weekday: "long" })}</span>
                    <span className="day-date">{date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </time>
                  {isToday && <span className="today-label">Today</span>}
                </h3>
                {events.some(event => event.date === dateKey(date)) ?
                  <ul className="day-events">{events.filter(event => event.date === dateKey(date)).map(event =>
                    <li key={event.id}>
                      <time dateTime={event.time ? `${event.date}T${event.time}` : event.date}>{event.time ?? "All day"}</time>
                      <span>{event.title}</span>
                      {eventLabel(event)}
                      {eventActions(event)}
                      {eventNotes(event)}
                    </li>)}</ul> :
                  <p className="day-empty">No events scheduled</p>}
              </li>
            );
          })}
        </ol>
      </section> : view === "month" ?
      <section className="monthly-calendar" aria-labelledby="monthly-calendar-heading">
        <h2 id="monthly-calendar-heading" aria-live="polite">{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
        <nav className="week-navigation" aria-label="Month navigation">
          <button type="button" onClick={() => setMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1, 12))}>Previous month</button>
          <button type="button" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1, 12))}>Today</button>
          <button type="button" onClick={() => setMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1, 12))}>Next month</button>
        </nav>
        <p className="month-help">Select an event to edit it. Scroll horizontally on smaller screens to see the full week.</p>
        <div className="month-scroll" role="region" aria-label="Monthly calendar dates" tabIndex={0}>
          <div className="month-weekdays" aria-hidden="true">
            {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => <span key={day}>{day}</span>)}
          </div>
          <ol className="month-days">
            {monthDays(month).map(date => {
              const key = dateKey(date);
              const isToday = key === dateKey(today);
              const dayEvents = events.filter(event => event.date === key);
              return <li key={key} className={`month-day${date.getMonth() !== month.getMonth() ? " outside-month" : ""}${isToday ? " day-today" : ""}`}>
                <h3><time dateTime={key} aria-current={isToday ? "date" : undefined} aria-label={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}>
                  {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </time>{isToday && <span className="today-label">Today</span>}</h3>
                <ul className="day-events">{dayEvents.map(event => <li key={event.id}>
                  <button type="button" className="month-event" onClick={() => editEvent(event)} aria-label={`Edit ${event.title}`}>
                    <time dateTime={event.time ? `${event.date}T${event.time}` : event.date}>{event.time ?? "All day"}</time>
                    <span>{event.title}</span>
                    {eventLabel(event)}
                  </button>
                  {eventActions(event)}
                  {eventNotes(event)}
                </li>)}</ul>
              </li>;
            })}
          </ol>
        </div>
      </section> :
      <section className="three-month-calendar" aria-labelledby="three-month-calendar-heading">
        <h2 id="three-month-calendar-heading" aria-live="polite">{monthTitle(threeMonths[0])} – {monthTitle(threeMonths[2])}</h2>
        <nav className="week-navigation" aria-label="Three-month navigation">
          <button type="button" onClick={() => moveThreeMonths(-3)}>Previous 3 months</button>
          <button type="button" onClick={() => {
            setMonth(new Date(today.getFullYear(), today.getMonth(), 1, 12));
            setSelectedDate(dateKey(today));
          }}>Today</button>
          <button type="button" onClick={() => moveThreeMonths(3)}>Next 3 months</button>
        </nav>
        <p>Select a date to see all its events and edit or delete them.</p>
        <div className="three-months">
          {threeMonths.map(calendarMonth => <section className="compact-month" key={dateKey(calendarMonth)} aria-labelledby={`compact-${dateKey(calendarMonth)}`}>
            <h3 id={`compact-${dateKey(calendarMonth)}`}>{monthTitle(calendarMonth)}</h3>
            <div className="compact-weekdays" aria-hidden="true">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(day => <span key={day}>{day}</span>)}
            </div>
            <ol className="compact-days">
              {monthDays(calendarMonth).map(date => {
                const key = dateKey(date);
                const inMonth = date.getMonth() === calendarMonth.getMonth();
                const dayEvents = inMonth ? events.filter(event => event.date === key) : [];
                const fullDate = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
                return <li key={key} className={inMonth ? "compact-day" : "compact-day outside-month"}>
                  {inMonth ? <button type="button" className="compact-date" aria-label={`${fullDate}: ${dayEvents.length} ${dayEvents.length === 1 ? "event" : "events"}`} aria-pressed={selectedDate === key} aria-controls="selected-day-events" onClick={() => setSelectedDate(key)}>
                    <time dateTime={key} aria-current={key === dateKey(today) ? "date" : undefined}>{date.getDate()}</time>
                    {dayEvents.length > 0 && <>
                      <span className="event-dots" aria-hidden="true">{dayEvents.slice(0, 3).map(event => <span key={event.id} className="event-dot" style={{ backgroundColor: labels.find(label => label.id === event.labelId)?.color ?? "#536259" }} />)}</span>
                      <span className="compact-count" aria-hidden="true">{dayEvents.length}</span>
                    </>}
                  </button> : <span className="compact-adjacent" aria-label={fullDate}>{date.getDate()}</span>}
                </li>;
              })}
            </ol>
          </section>)}
        </div>
        <section id="selected-day-events" className="selected-day-events" aria-labelledby="selected-day-heading">
          <h3 id="selected-day-heading" aria-live="polite">Events for {selectedDate}</h3>
          {selectedEvents.length ? <ul>{selectedEvents.map(renderEvent)}</ul> : <p>No events scheduled</p>}
        </section>
      </section>}
      <section aria-labelledby="upcoming-events-heading">
        <h2 id="upcoming-events-heading">Upcoming events</h2>
        {upcoming.length ? <ul>{upcoming.map(renderEvent)}</ul> : <p>No events scheduled</p>}
        <p>Saved events from today onward, across all weeks.</p>
      </section>
      <section aria-labelledby="manage-events-heading">
        <h2 id="manage-events-heading">{editing ? "Edit event" : "Add event"}</h2>
        <form className="event-form" onSubmit={event => {
          event.preventDefault();
          if (mutate(() => {
            const input = { title, date: eventDate, notes, ...(labels.some(label => label.id === labelId) ? { labelId } : {}), ...(eventTime ? { time: eventTime } : {}) };
            if (editing) eventStore.update(editing, input);
            else eventStore.create(input);
          })) { setEditing(null); setTitle(""); setEventTime(""); setNotes(""); setLabelId(""); setNotice(editing ? "Event updated." : "Event added."); }
        }}>
          <label>Title <input ref={titleInput} required value={title} onChange={event => setTitle(event.target.value)} /></label>{" "}
          <label>Date <input required type="date" value={eventDate} onChange={event => setEventDate(event.target.value)} /></label>{" "}
          <label>Time (optional) <input type="time" value={eventTime} onChange={event => setEventTime(event.target.value)} aria-describedby="event-time-help" /></label>
          <p id="event-time-help" className="form-help">Leave time blank for an all-day event. Times use your local clock.</p>
          <label>Person or category (optional)
            <select value={labels.some(label => label.id === labelId) ? labelId : ""} onChange={event => setLabelId(event.target.value)}>
              <option value="">No label</option>
              {labels.map(label => <option key={label.id} value={label.id}>{label.kind}: {label.name}</option>)}
            </select>
          </label>
          <label className="notes-field">Notes (optional)
            <textarea rows={4} value={notes} onChange={event => setNotes(event.target.value)} />
          </label>
          <button type="submit">{editing ? "Save event" : "Add event"}</button>{" "}
          {editing && <button type="button" onClick={() => { setEditing(null); setTitle(""); setEventTime(""); setNotes(""); setLabelId(""); setError(""); }}>Cancel</button>}
        </form>
        {error && <p role="alert">{error}</p>}
        <p role="status">{notice}</p>
        {events.some(event => event.date < dateKey(today)) && <>
          <h3>Past events</h3>
          <ul>{events.filter(event => event.date < dateKey(today)).map(renderEvent)}</ul>
        </>}
      </section>
      <LabelManager labels={labels} onChange={() => setLabels(labelStore.list())} />
      <section aria-labelledby="planning-tips-heading">
        <h2 id="planning-tips-heading">Planning tips</h2>
        <ul>
          <li>Add family plans using the Add event form.</li>
          <li>Check this page together each week.</li>
        </ul>
      </section>
    </main>
  );
}
