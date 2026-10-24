import { useEffect, useRef, useState } from "react";
import { dateKey, eventStore, type CalendarEvent } from "./events";
import { upcomingEvents, weekDays } from "./calendar";
import { labelStore, labelTextColor } from "./labels";
import { LabelManager } from "./LabelManager";

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
  function eventActions(event: CalendarEvent) {
    return <div className="event-actions">
      <button type="button" onClick={() => {
        setEditing(event.id); setTitle(event.title); setEventDate(event.date); setEventTime(event.time ?? "");
        setNotes(event.notes ?? "");
        setLabelId(labels.some(label => label.id === event.labelId) ? event.labelId! : "");
        setNotice(""); setError("");
        titleInput.current?.focus();
      }} aria-label={`Edit ${event.title}`}>Edit</button>
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

  return (
    <main>
      <h1>Family Calendar</h1>
      <p>A private calendar for our family.</p>
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
      </section>
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
