import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { dateKey, expandEvents, isRecurrenceRule, type CalendarEvent, type RecurrenceFrequency } from "./events";
import { monthDays, upcomingEvents, weekDays, navigationDate, moveDate, watchToday } from "./calendar";
import { labelTextColor } from "./labels";
import { LabelManager } from "./LabelManager";
import { AppearanceSelector } from "./AppearanceSelector";
import { eventStore, labelStore, commit } from "./sync/calendar-data";
import { SyncPanel } from "./SyncPanel";
import { DinnerRoster } from "./DinnerRoster";

export function App() {
  const [events, setEvents] = useState(() => eventStore.list());
  const [labels, setLabels] = useState(() => labelStore.list());
  const [labelId, setLabelId] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState(() => dateKey(new Date()));
  const [eventTime, setEventTime] = useState("");
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("Never");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [notice, setNotice] = useState("");
  const editOriginal = useRef<CalendarEvent | undefined>(undefined);
  const [error, setError] = useState("");
  const [endDateError, setEndDateError] = useState("");
  const [today, setToday] = useState(() => new Date());
  const [navigation, setNavigation] = useState(() => navigationDate(new Date()));
  const [view, updateView] = useState<"week" | "month" | "three-months">(() => {
    try {
      const saved = window.localStorage.getItem("family-calendar-view");
      if (saved === "month" || saved === "three-months") return saved;
    } catch { /* Keep navigation available when storage is blocked. */ }
    return "week";
  });
  const [viewError, setViewError] = useState("");
  function setView(next: "week" | "month" | "three-months") {
    updateView(next);
    try {
      window.localStorage.setItem("family-calendar-view", next);
      setViewError("");
    } catch {
      setViewError("Calendar view changed, but could not be saved. It may reset on reload.");
    }
  }
  const [compactStart, setCompactStart] = useState(() => navigationDate(new Date()).date);
  const period = view === "three-months" ? compactStart : navigation.date;
  const month = new Date(period.getFullYear(), period.getMonth(), 1, 12);
  const selectedDate = dateKey(navigation.date);
  // Astra ea0da20c: selection must remain reachable when returning to 3 Months.
  function reconcileCompactRange(date: Date) {
    setCompactStart(current => {
      const start = new Date(current.getFullYear(), current.getMonth(), 1, 12);
      const end = new Date(current.getFullYear(), current.getMonth() + 3, 1, 12);
      return date < start || date >= end ? date : current;
    });
  }
  const setSelectedDate = (key: string) => {
    const next = navigationDate(new Date(`${key}T12:00:00`));
    setNavigation(next);
    reconcileCompactRange(next.date);
  };
  const dateFocus = useRef<string | null>(null);
  const dateControls = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!dateFocus.current) return;
    dateControls.current.get(dateFocus.current)?.focus();
    dateFocus.current = null;
  });
  function dateKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(event.key in steps) && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = new Date(date);
    if (event.key === "Home") next.setDate(1);
    else if (event.key === "End") next.setMonth(next.getMonth() + 1, 0);
    else next.setDate(next.getDate() + steps[event.key]);
    const key = dateKey(next);
    dateFocus.current = key;
    setSelectedDate(key);
  }
  function dateProps(date: Date) {
    const key = dateKey(date);
    return {
      "data-calendar-date": key,
      ref: (control: HTMLButtonElement | null) => { if (control) dateControls.current.set(key, control); else dateControls.current.delete(key); },
      tabIndex: selectedDate === key ? 0 : -1,
      "aria-pressed": selectedDate === key,
      onClick: () => setSelectedDate(key),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => dateKeyDown(event, date),
    };
  }
  const move = (amount: number, unit: "week" | "month" | "year") => {
    setNavigation(current => moveDate(current, amount, unit));
    setCompactStart(current => moveDate(navigationDate(view === "three-months" ? current : navigation.date), amount, unit).date);
  };
  function goToday() {
    const now = new Date();
    setToday(now);
    setNavigation(navigationDate(now));
    setCompactStart(now);
  }
  useEffect(() => watchToday(setToday, {
    now: () => new Date(),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: timer => window.clearTimeout(timer as number | undefined),
    listen: callback => {
      const visible = () => { if (document.visibilityState === "visible") callback(); };
      window.addEventListener("focus", callback);
      document.addEventListener("visibilitychange", visible);
      return () => {
        window.removeEventListener("focus", callback);
        document.removeEventListener("visibilitychange", visible);
      };
    },
  }), []);
  const titleInput = useRef<HTMLInputElement>(null);
  const endDateInput = useRef<HTMLInputElement>(null);
  const editTrigger = useRef<HTMLElement | null>(null);
  const focusPending = useRef(false);
  function restoreFocus() {
    focusPending.current = true;
  }
  // Check connectivity after React removes any occurrences affected by the edit.
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    if (editTrigger.current?.isConnected) editTrigger.current.focus();
    else titleInput.current?.focus();
    editTrigger.current = null;
  });
  useEffect(() => {
    const refresh = () => { setEvents(eventStore.list()); setLabels(labelStore.list()); };
    window.addEventListener("calendar-update", refresh);
    return () => window.removeEventListener("calendar-update", refresh);
  }, []);
  function mutate(action: () => void, after: () => void) {
    commit(action, () => { setEvents(eventStore.list()); setError(""); after(); }, error => {
      setError(error.message); setNotice("");
    });
  }
  function editEvent(occurrence: CalendarEvent, trigger?: HTMLElement) {
    editTrigger.current = trigger ?? null;
    const event = events.find(item => item.id === occurrence.id) ?? occurrence;
    editOriginal.current = event;
    setFrequency(event.recurrence?.frequency ?? "Never"); setEndDate(event.recurrence?.endDate ?? "");
    setEditing(event.id); setTitle(event.title); setEventDate(event.date); setEventTime(event.time ?? "");
    setNotes(event.notes ?? "");
    setLabelId(event.labelId ?? "");
    setNotice(""); setError(""); setEndDateError("");
    titleInput.current?.focus();
  }
  function eventActions(event: CalendarEvent) {
    return <div className="event-actions">
      <button type="button" onClick={click => editEvent(event, click?.currentTarget)} aria-label={`Edit ${event.title}`}>Edit</button>
      <button type="button" onClick={() => {
        if (!window.confirm(`Delete "${event.title}"${event.recurrence && event.recurrence.frequency !== "Never" ? " and all occurrences" : ""}? This cannot be undone.`)) return;
        mutate(() => eventStore.delete(event.id, events.find(item => item.id === event.id)), () => {
          if (editing === event.id) { setEditing(null); setTitle(""); setEventTime(""); setNotes(""); setLabelId(""); setFrequency("Never"); setEndDate(""); }
          setNotice("Event deleted.");
          setEndDateError("");
          editTrigger.current = null;
          restoreFocus();
        });
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
  function recurrenceIndicator(event: CalendarEvent) {
    return event.recurrence && event.recurrence.frequency !== "Never" ?
      <span className="recurrence-indicator">Repeats {event.recurrence.frequency.toLowerCase()}</span> : null;
  }
  function renderEvent(event: CalendarEvent) {
    return <li key={`${event.id}:${event.date}`}>
      <time dateTime={event.time ? `${event.date}T${event.time}` : event.date}>{event.date} · {event.time ?? "All day"}</time> {event.title}{" "}
      {eventActions(event)}
      {eventLabel(event)}
      {recurrenceIndicator(event)}
      {eventNotes(event)}
    </li>;
  }
  const days = weekDays(navigation.date);
  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const upcoming = upcomingEvents(events, dateKey(today));
  const monthTitle = (date: Date) => date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const threeMonths = Array.from({ length: 3 }, (_, index) => new Date(month.getFullYear(), month.getMonth() + index, 1, 12));
  const visibleDays = view === "week" ? days : view === "month" ? monthDays(month) : threeMonths.flatMap(date => monthDays(date));
  const visibleEvents = expandEvents(events, dateKey(visibleDays[0]), dateKey(visibleDays[visibleDays.length - 1]));
  const selectedEvents = expandEvents(events, selectedDate, selectedDate);

  return (
    <main>
      <header className="calendar-header"><h1>Family Calendar</h1><SyncPanel /></header>
      <AppearanceSelector />
      <p>A private calendar for our family.</p>
      <nav className="view-selector" aria-label="Calendar view">
        <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>Week</button>
        <button type="button" aria-pressed={view === "month"} onClick={() => setView("month")}>Month</button>
        <button type="button" aria-pressed={view === "three-months"} onClick={() => { reconcileCompactRange(navigation.date); setView("three-months"); }}>3 Months</button>
      </nav>
      {viewError && <p role="alert">{viewError}</p>}
      <p className="visually-hidden" role="status" aria-atomic="true">{view === "week" ? `Week of ${formatDate(days[0])}` : view === "month" ? monthTitle(month) : `${monthTitle(threeMonths[0])} through ${monthTitle(threeMonths[2])}`}. Selected date {formatDate(navigation.date)}.</p>
      {view === "week" ?
      <section className="weekly-calendar" aria-labelledby="weekly-calendar-heading">
        <header className="week-header">
          <h2 id="weekly-calendar-heading">{dateKey(days[0]) === dateKey(weekDays(today)[0]) ? "This week" : "Week"}</h2>
          <p>{formatDate(days[0])} – {formatDate(days[6])}</p>
        </header>
        <nav className="week-navigation" aria-label="Week navigation">
          <button type="button" onClick={() => move(-1, "week")}>Previous week</button>
          <button type="button" onClick={goToday}><span className="visually-hidden">Today: </span>This week</button>
          <button type="button" onClick={() => move(1, "week")}>Next week</button>
        </nav>

        <ol className="week-days">
          {days.map((date) => {
            const isToday = date.toDateString() === today.toDateString();
            return (
              <li key={dateKey(date)} className={`day${isToday ? " day-today" : ""}`}>
                <h3>
                  <button type="button" className="calendar-date" {...dateProps(date)} aria-label={formatDate(date)}><time dateTime={dateKey(date)} aria-current={isToday ? "date" : undefined}>
                    <span className="day-name">{date.toLocaleDateString("en-US", { weekday: "long" })}</span>
                    <span className="day-date">{date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </time></button>
                  {isToday && <span className="today-label">Today</span>}
                </h3>
                {visibleEvents.some(event => event.date === dateKey(date)) ?
                  <ul className="day-events">{visibleEvents.filter(event => event.date === dateKey(date)).map(event =>
                    <li key={`${event.id}:${event.date}`}>
                      <time dateTime={event.time ? `${event.date}T${event.time}` : event.date}>{event.time ?? "All day"}</time>
                      <span>{event.title}</span>
                      {eventLabel(event)}
                      {recurrenceIndicator(event)}
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
        <h2 id="monthly-calendar-heading">{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
        <nav className="week-navigation" aria-label="Month navigation">
          <button type="button" onClick={() => move(-1, "month")}>Previous month</button>
          <button type="button" onClick={goToday}>Today</button>
          <button type="button" onClick={() => move(1, "month")}>Next month</button>
        </nav>
        <p className="month-help">Select an event to edit it. On smaller screens, dates are listed in order.</p>
        <div className="month-scroll" role="region" aria-label="Monthly calendar dates">
          <div className="month-weekdays" aria-hidden="true">
            {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => <span key={day}>{day}</span>)}
          </div>
          <ol className="month-days">
            {monthDays(month).map(date => {
              const key = dateKey(date);
              const isToday = key === dateKey(today);
              const dayEvents = visibleEvents.filter(event => event.date === key);
              return <li key={key} className={`month-day${date.getMonth() !== month.getMonth() ? " outside-month" : ""}${isToday ? " day-today" : ""}`}>
                <h3><button type="button" className="calendar-date" {...dateProps(date)}><time dateTime={key} aria-current={isToday ? "date" : undefined} aria-label={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}>
                  {date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </time></button>{isToday && <span className="today-label">Today</span>}</h3>
                <ul className="day-events">{dayEvents.map(event => <li key={`${event.id}:${event.date}`}>
                  <button type="button" className="month-event" onClick={click => editEvent(event, click?.currentTarget)} aria-label={`Edit ${event.title}`}>
                    <time dateTime={event.time ? `${event.date}T${event.time}` : event.date}>{event.time ?? "All day"}</time>
                    <span>{event.title}</span>
                    {eventLabel(event)}
                  </button>
                  {recurrenceIndicator(event)}
                  {eventActions(event)}
                  {eventNotes(event)}
                </li>)}</ul>
              </li>;
            })}
          </ol>
        </div>
      </section> :
      <section className="three-month-calendar" aria-labelledby="three-month-calendar-heading">
        <h2 id="three-month-calendar-heading">{monthTitle(threeMonths[0])} – {monthTitle(threeMonths[2])}</h2>
        <nav className="week-navigation" aria-label="Three-month navigation">
          <button type="button" onClick={() => move(-3, "month")}>Previous 3 months</button>
          <button type="button" onClick={goToday}>Today</button>
          <button type="button" onClick={() => move(3, "month")}>Next 3 months</button>
        </nav>
        <p id="compact-help">Select a date to see all its events and edit or delete them. Use arrow keys to select and move between dates across months; Home and End move to its first and last dates.</p>
        <div className="three-months">
          {threeMonths.map(calendarMonth => <section className="compact-month" key={dateKey(calendarMonth)} aria-labelledby={`compact-${dateKey(calendarMonth)}`}>
            <h3 id={`compact-${dateKey(calendarMonth)}`}>{monthTitle(calendarMonth)}</h3>
            <div className="compact-weekdays" aria-hidden="true">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(day => <span key={day}>{day}</span>)}
            </div>
            <ol className="compact-days" aria-label={monthTitle(calendarMonth)} aria-describedby="compact-help">
              {monthDays(calendarMonth).map(date => {
                const key = dateKey(date);
                const inMonth = date.getMonth() === calendarMonth.getMonth();
                const dayEvents = inMonth ? visibleEvents.filter(event => event.date === key) : [];
                const fullDate = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
                return <li key={key} className={inMonth ? "compact-day" : "compact-day outside-month"}>
                  {inMonth ? <button type="button" className="compact-date" aria-label={`${fullDate}: ${dayEvents.length} ${dayEvents.length === 1 ? "event" : "events"}`} {...dateProps(date)} aria-controls="selected-day-events">
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
          <h3 id="selected-day-heading">Events for {selectedDate}</h3>
          {selectedEvents.length ? <ul>{selectedEvents.map(renderEvent)}</ul> : <p>No events scheduled</p>}
        </section>
      </section>}
      <section aria-labelledby="upcoming-events-heading">
        <h2 id="upcoming-events-heading">Upcoming events</h2>
        {upcoming.length ? <ul>{upcoming.map(renderEvent)}</ul> : <p>No events scheduled</p>}
        <p>Events from today onward, across all weeks. Repeating occurrences are shown through one year from today.</p>
      </section>
      <section aria-labelledby="manage-events-heading">
        <h2 id="manage-events-heading">{editing ? "Edit event" : "Add event"}</h2>
        <form className="event-form" onSubmit={event => {
          event.preventDefault();
          if (frequency !== "Never" && !isRecurrenceRule({ frequency, ...(endDate ? { endDate } : {}) }, eventDate)) {
            setEndDateError("Enter a valid repeat end date on or after the event start date, or leave it blank for no end date.");
            setError(""); setNotice("");
            endDateInput.current?.focus();
            return;
          }
          setEndDateError("");
          const original = events.find(item => item.id === editing);
          if (editing && (frequency !== "Never" || (original?.recurrence && original.recurrence.frequency !== "Never")) &&
            !window.confirm(`Save changes to the entire series "${original?.title ?? title}"? All occurrences of this series will be affected.`)) return;
          mutate(() => {
            const input = { title, date: eventDate, notes, ...(frequency === "Never" && !(editing && editOriginal.current?.recurrence?.frequency === "Never") ? {} : { recurrence: { frequency, ...(endDate ? { endDate } : {}) } }), ...(labelId ? { labelId } : {}), ...(eventTime ? { time: eventTime } : {}) };
            if (editing) eventStore.update(editing, input, editOriginal.current);
            else eventStore.create(input);
          }, () => { setEditing(null); setTitle(""); setEventTime(""); setNotes(""); setLabelId(""); setFrequency("Never"); setEndDate(""); setNotice(editing ? "Event updated." : "Event added."); restoreFocus(); });
        }}>
          <label>Title <input ref={titleInput} required value={title} onChange={event => setTitle(event.target.value)} /></label>{" "}
          <label>Date <input required type="date" value={eventDate} onChange={event => setEventDate(event.target.value)} /></label>{" "}
          <label>Time (optional) <input type="time" value={eventTime} onChange={event => setEventTime(event.target.value)} aria-describedby="event-time-help" /></label>
          <p id="event-time-help" className="form-help">Leave time blank for an all-day event. Times use your local clock.</p>
          <label>Repeat
            <select aria-describedby="recurrence-help" value={frequency} onChange={event => { setFrequency(event.target.value as RecurrenceFrequency); setEndDateError(""); if (event.target.value === "Never") setEndDate(""); }}>
              {["Never", "Daily", "Weekly", "Monthly", "Yearly"].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          {frequency !== "Never" && <label>Repeat until (optional, inclusive)
            <input ref={endDateInput} type="date" value={endDate} aria-invalid={endDateError ? true : undefined} aria-describedby={`recurrence-end-help${endDateError ? " recurrence-end-error" : ""}`} onChange={event => setEndDate(event.target.value)} />
          </label>}
          {frequency !== "Never" && <p id="recurrence-end-help" className="form-help">Leave blank for no end date. Includes occurrences on this date; it must be on or after the event start date.</p>}
          {endDateError && <p id="recurrence-end-error" role="alert">{endDateError}</p>}
          <p id="recurrence-help" className="form-help">Editing or deleting a repeating event changes all occurrences of the entire series. Individual occurrences and future-only changes are not supported.</p>
          <label>Person or category (optional)
            <select value={labelId} onChange={event => setLabelId(event.target.value)}>
              <option value="">No label</option>
              {labelId && !labels.some(label => label.id === labelId) && <option value={labelId}>Historical label ({labelId})</option>}
              {labels.map(label => <option key={label.id} value={label.id}>{label.kind}: {label.name}</option>)}
            </select>
          </label>
          <label className="notes-field">Notes (optional)
            <textarea rows={4} value={notes} onChange={event => setNotes(event.target.value)} />
          </label>
          <button type="submit">{editing ? "Save event" : "Add event"}</button>{" "}
          {editing && <button type="button" onClick={() => { setEditing(null); setTitle(""); setEventTime(""); setNotes(""); setLabelId(""); setFrequency("Never"); setEndDate(""); setError(""); setEndDateError(""); restoreFocus(); }}>Cancel</button>}
        </form>
        {error && <p role="alert">{error}</p>}
        <p role="status">{notice}</p>
        {events.some(event => event.date < dateKey(today)) && <>
          <h3>Past events</h3>
          <ul>{events.filter(event => event.date < dateKey(today)).map(renderEvent)}</ul>
        </>}
      </section>
      <DinnerRoster labels={labels} />
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
