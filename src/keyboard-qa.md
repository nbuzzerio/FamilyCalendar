# Keyboard experience QA

Use only the keyboard for this sequence. These questions concern comfort and expectations; automated browser regression evidence remains required separately.

1. Tab through the view buttons and Week period controls; activate previous/next and Today with Enter or Space, then Tab to the selected date. Does the order feel natural?
2. Use the date arrows, including crossing a month or year, then Shift+Tab back to select Month. Does the selected date and focus behavior match your expectations?
3. In Month, use previous/next, Today and date arrows. Is the focus indicator comfortable to follow at your usual screen width and appearance setting?
4. Select 3 Months, move through dates into the next month, and activate a date with Space. Does the selected-day event context feel coherent?
5. Switch back through Month and Week, then edit an event. Does the transition between navigation and editing feel intuitive?

## Automated evidence still required from Studio

Repair attribution: Astra review `ea0da20c91824fdba0f7f05336e6c469`, finding 0. Date selection now reconciles the compact range in every view, and entering 3 Months also reconciles it, retaining a range that contains the selection. Deterministic enrolled regressions cover January 1 → Week/Month → ArrowLeft → December 31 → 3 Months, reverse movement, all arrow directions, upper-range crossings, repeated view switches, exact range endpoints, selected-day headings and exactly one selected roving stop. A separate Today regression asserts the displayed period, heading, selected control and today marker together in every view. These tests preserve list/button semantics and assert absence of conflicting grid roles. Focus spies establish requested focus only.

The repair's browser contract was inspected: only test/build execution is exposed to the agent; the protected browser runner executes after Studio checkpointing. No current-repair native browser results or independent review are available during this implementation turn. Studio must run the responsive, calendar-interactions and calendar-journey suites and independent Astra High ticket/cumulative review against the repaired checkpoint. Existing host adapter expectations for the exact name “This week” and bounded compact arrows need Studio alignment with the current accessible name and cross-boundary requirements before those assertions can establish acceptance. This requires a separate Studio-owned suite decision, not changes to project scripts or protected runner assets.

The enrolled component tests assert one roving stop, selected/today state, year-boundary focus requests, native-key exclusions, retained date across views, compact range/heading agreement, stable status text, and accepted series-edit persistence with unrelated records intact. They do not emulate the browser DOM.

Host browser checks must assert actual Tab/Shift+Tab order; native Enter/Space activation; activeElement after previous/next/Today and all view switches; focus across month/year boundaries; accessibility-tree names/current/pressed state; no navigation from inputs/selects/textareas/dialogs; no repeated live-region mutations on draft edits; compact activation; Week/Month/3 Months narrow geometry; appearance switching; and preserved event/dialog interactions. The current browser contract exposes no agent execution command or editable host suite assets. These checks remain NOT_RUN until Studio provides execution and coverage evidence. Independent Astra High ticket review and cumulative pathway review remain required.
