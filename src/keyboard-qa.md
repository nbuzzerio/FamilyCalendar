# Keyboard experience QA

Use only the keyboard for this sequence. These questions concern comfort and expectations; automated browser regression evidence remains required separately.

1. Tab through the view buttons and Week period controls; activate previous/next and Today with Enter or Space, then Tab to the selected date. Does the order feel natural?
2. Use the date arrows, including crossing a month or year, then Shift+Tab back to select Month. Does the selected date and focus behavior match your expectations?
3. In Month, use previous/next, Today and date arrows. Is the focus indicator comfortable to follow at your usual screen width and appearance setting?
4. Select 3 Months, move through dates into the next month, and activate a date with Space. Does the selected-day event context feel coherent?
5. Switch back through Month and Week, then edit an event. Does the transition between navigation and editing feel intuitive?

## Automated evidence still required from Studio

The enrolled component tests assert one roving stop, selected/today state, year-boundary focus requests, native-key exclusions, retained date across views, compact range/heading agreement, stable status text, and accepted series-edit persistence with unrelated records intact. They do not emulate the browser DOM.

Host browser checks must assert actual Tab/Shift+Tab order; native Enter/Space activation; activeElement after previous/next/Today and all view switches; focus across month/year boundaries; accessibility-tree names/current/pressed state; no navigation from inputs/selects/textareas/dialogs; no repeated live-region mutations on draft edits; compact activation; Week/Month/3 Months narrow geometry; appearance switching; and preserved event/dialog interactions. The current browser contract exposes no agent execution command or editable host suite assets. These checks remain NOT_RUN until Studio provides execution and coverage evidence. Independent Astra High ticket review and cumulative pathway review remain required.
