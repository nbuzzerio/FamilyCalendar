export function App() {
  return (
    <main>
      <h1>Family Calendar</h1>
      <p>A private calendar for our family.</p>
      <section aria-labelledby="upcoming-events-heading">
        <h2 id="upcoming-events-heading">Upcoming events</h2>
        <p>No events scheduled</p>
        <p>Your family's upcoming events will appear here.</p>
      </section>
      <section aria-labelledby="planning-tips-heading">
        <h2 id="planning-tips-heading">Planning tips</h2>
        <ul>
          <li>Add events in your usual calendar.</li>
          <li>Check this page together each week.</li>
        </ul>
      </section>
    </main>
  );
}
