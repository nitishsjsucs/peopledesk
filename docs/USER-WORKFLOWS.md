# User workflows

How each kind of person moves through PeopleDesk, as the app works after the 2026-10-15 workflow round. The personas are the six seeded employees from `/dev/login` (all synthetic). The steps are covered by the web and Worker tests, and the main ones were also driven by a scripted browser (Playwright) against `npm run dev` with these personas, at 1280px and 375px wide. None of it was checked in production.

Two rules hold in every workflow:

- Nothing that changes a record happens until the requesting person presses Approve on the request's card. A form, chat and an MCP client can only propose; the server checks every proposal and every approval.
- Each step of a request has its own URL (`?review=`, `?edit=`, `?from=` on `/requests/ticket` and `/requests/orientation`), so a reload, Back or a shared link shows the request as the server has it now.

## Personas

| Persona | Employee | Situation |
|---|---|---|
| New hire, not booked | Nadia Fernandes (E0025), US | In onboarding, no orientation booking |
| New hire, booked | Gabriel Kowalski (E0022), IN | In onboarding, booked into ORI-008 |
| Tenured employee | Emeka Adeyemi (E0023), IN | No onboarding plan |
| Manager with new hires | Deepa Foster (E0007), US | 12 direct reports, 5 in onboarding |
| Manager without new hires | Chen Varma (E0014), US | Direct reports, none in onboarding |
| HR admin | Kenji Nakamura (E0016), IN | Sees everyone with an onboarding plan (30 people) |

Locally, a reviewer signs in as any of them; in production, Cloudflare Access signs a person in and an identity link maps them to an employee.

## Everyone

### Sign in locally, or switch persona

1. Open `/dev/login` (or follow "Switch persona" in the header, or the sign-in link on a signed-out page).
2. Pick a persona. PeopleDesk opens the page you came from (`?next=`), or Home.
3. If no personas load, the page says to run `npm run seed:local`. If the token request fails, the page shows the status and the server's message.

### When the session ends or the network drops

1. A request that answers 401 after the app has loaded shows one banner: "Your session has ended. Reload the page to sign in again." with Reload (and "Pick a persona" locally). Error banners offer Reload instead of Try again for a 401.
2. An identity with no employee record sees that it is not linked and should ask the administrator to link it; there is no reload advice and no navigation.
3. A request that got no response says PeopleDesk could not be reached; an HTML error page from a proxy says PeopleDesk is temporarily unavailable, with its status.
4. In production the header offers "Sign out" (Cloudflare Access logout).

### Ask a policy question

1. Open Chat and type a question, or pick a suggestion. A suggestion clicked twice still starts one conversation.
2. While PeopleDesk works, the composer is disabled; after 5 seconds the page shows the elapsed time and that answers can take up to a minute.
3. The answer cites its sources as chips (title, document, version, effective date). Focus returns to the message box if you sent from it or from a suggestion.
4. Open a chip to read the cited passage in a dialog. Tab stays inside it; Escape, Close, the backdrop or the version link closes it and returns focus to the chip.
5. A screen reader hears "PeopleDesk is working on it" and then the new reply, but not a transcript loaded from history.
6. If a send fails, Retry sends it again under the same message. If the rate limit is reached, Retry and Send wait for the countdown shown under the box. If a previous reply is still being prepared, the page waits for it (up to a minute), shows it, and keeps Retry for the new message.
7. On a phone the conversation list folds behind "Conversations (N)"; a link to a conversation that does not exist (or is someone else's) says so, and a message sent there starts a new conversation.

### Open a support ticket from the form

1. New ticket (`/requests/ticket`): choose a category, write a subject and description, pick a priority (Low, Normal, High), and optionally a related policy (suggestions list the policies you can read).
2. Review request. A problem is named in plain words under its field ("Subject needs at least 5 characters."), one summary lists the fields to fix, and focus moves to the first one. A related policy you cannot read is flagged under that field.
3. The review step (`?review=<id>`) shows exactly what will be written, with Approve, Reject and Edit and the time left. A reload shows the same card.
4. Edit opens the prefilled form (`?edit=<id>`); Update request replaces the old request, and the page moves to the new request's review step. Back shows the old request as "Replaced by an edited request", with a link to the new one.
5. Approve. The card shows "Done: ticket TKT-000151 was created." with "View in My tickets", and focus moves to that outcome. Reject shows that nothing was submitted, with "Start again with these details" (`?from=<id>`).
6. If five requests are already waiting, the refusal links to My requests.

### Make a request in chat and approve it

1. Ask in chat ("Please open an IT ticket, my laptop will not boot"). The reply is an approval card.
2. Approve on the card, or Edit to open the form; the form and the review step after it offer "Back to conversation".
3. The conversation records the outcome ("Approved and done: TKT-000153." or "Approved and done: booked into ORI-006.").
4. Reopening the conversation later shows each card in its current state (approved, rejected, replaced or expired), with its next step.

### Approve from a link (an MCP client's `approvalUrl`)

1. Open `/actions?focus=<id>`. The page loads your requests, scrolls to that card, highlights it and moves keyboard focus to it.
2. Approve or Reject there. A request that is not yours says it was not found among yours, with a link to all your requests.
3. With no requests at all, the page links to a new ticket and to chat.

### Follow your tickets

1. My tickets lists the tickets you opened, labeled as the form labels them (IT, HR (general), In progress).
2. The status filter is part of the URL (`/tickets?status=open`), so it survives a reload and Back. A filter with no tickets offers to show all statuses.

### Read policies

1. Policies lists what you can read at today's version. Search and category are part of the URL, and the list is asked for once typing pauses; Back from a document returns to the same filtered list.
2. Nothing matching offers Clear filters and Ask in chat.
3. A document shows its version timeline and what changed from the previous version. The current version notes a scheduled version ("Version N takes effect on <date>.") with a link; a superseded version links to the current one.
4. A version that does not exist (`/v/abc`, `/v/99`) says so and links to the current version. A document above your clearance reads "Policy not found", the same as a missing one.

## New hire, not booked (Nadia)

1. Home shows "Book orientation" (you have not booked your session yet) and "My onboarding" with your percent complete.
2. Book orientation lists sessions in your region and Global first (the Region filter has the others and "All regions"). Click a session's title to choose it; full sessions cannot be chosen.
3. Review request without a session says "Choose a session." and moves focus to the first open session.
4. Review, Edit or Approve as in the ticket workflow. The approved card names the attendee, the session and its start (in the scripted run: "Done: Nadia Fernandes (E0025) is booked into New Hire Orientation (UK, virtual) (ORI-003), starting 2026-10-19 10:00 UTC.", a session picked on the edit step, which shows all regions) with "View onboarding".
5. Onboarding shows your checklist and that you are booked. If the session filled up first, the card offers "Pick another session".

## New hire, booked (Gabriel)

1. Home shows "Your orientation" with the session and start time instead of a booking action.
2. Orientation says "You're booked into New Hire Orientation (US, in person) (ORI-008) on Oct 31, 2026 16:00 UTC, Austin Office, Training Room 2." with a link to Onboarding, and no form.
3. Onboarding shows the same booking above the checklist.

## Tenured employee (Emeka)

1. Home offers Ask a question, New ticket, My tickets and Policies; no orientation or onboarding card.
2. Orientation explains that sessions are for people in onboarding and links to Policies and Chat; there is no form.
3. Onboarding says there is no plan and links to Chat and a new ticket.

## Manager with new hires (Deepa)

1. Home says how many reports still need a session ("3 people need an orientation session") and offers Onboarding for your direct reports.
2. Onboarding summarizes your reports in onboarding ("5 in onboarding · 3 without orientation · 1 with blocked tasks") and filters them: All, Not booked, Has blocked tasks.
3. Each row shows the person's percent complete, blocked tasks and booking. Select a name to see their checklist; while it loads the pane says so, and a failure offers Try again. On a phone the list comes first and selecting scrolls to the checklist.
4. "Book orientation" on an unbooked row opens the booking form with that person chosen (`?employee=E0024`), all regions shown.
5. Review and approve as above. Reports who are already booked are not offered.

## Manager without new hires (Chen)

1. Home has no orientation action; Onboarding says no one you support is in onboarding.
2. Orientation says the same and links to Onboarding; there is no form.

## HR admin (Kenji)

1. Home and Onboarding cover everyone in onboarding, with the same summary, filters and Book links as a manager.
2. Orientation lets HR choose any unbooked person in onboarding as the attendee.

## Changed on 2026-10-15

- **Request steps have URLs.** Before, a reload after Edit and Update showed the stale edit form for a request already replaced, and its Update failed with a conflict; a reload on the review step dropped the card and invited a duplicate request. Now `?review=`, `?edit=` and `?from=` read the request from the server, and an edit of a decided request shows what happened instead of a form.
- **Approval cards show the outcome and the next step.** Decided cards kept three disabled buttons and no way forward; an expired card even disabled Edit. Now each outcome links to the next step, focus moves to it, a 409 or 410 shows the true state instead of a generic error, and the countdown no longer speaks every second. The chat note for a booking names the session instead of the booking's internal id.
- **Orientation knows who can book.** The tenured employee and a manager without reports in onboarding got a form whose only result was a refusal, a failed team load read as "No one in onboarding needs a booking", and the booked new hire could not see his session anywhere. A new read-only route, `GET /api/orientation-booking`, returns only the caller's own booking. The picker has a region filter, labels as click targets and loading and error states.
- **Chat is harder to break.** A double click made two conversations, switching showed the old transcript with the composer enabled, a dead link posted to a dead id, Retry duplicated the message, and a rate limit or a reply still in progress left the person stuck.
- **Chat works by keyboard and screen reader.** Focus fell to the page after every reply, the source drawer did not trap focus or return it, and the whole transcript was a live region.
- **Session and connection problems say what to do.** A 401 and a 403 both read "session expired, reload", a dropped connection showed "Failed to fetch", and dev login always went to `/`. Now each case has its own message and next step, and the header has Switch persona or Sign out (the Sign out link was not checked in production).
- **The app reads well and works on a phone.** Light-theme primary buttons had dark text on blue (2.45:1) and the faint text was 3.67:1; both now pass 4.5:1. There is a skip link, a title per page, one h1 per page and focus on the new page after navigation; the brand no longer reloads the app; and at 375px all seven nav links are visible instead of scrolling sideways.
- **Onboarding is an overview, and Home fits the person.** HR saw 30 names with only a booked pill and no way to act; a failed checklist showed Loading forever; switching people showed the previous checklist. Home offered Schedule orientation to people who could not book.
- **Tickets explain problems in plain words.** zod's own messages ("Too small: expected string to have >=5 characters") and a raw server string are replaced by field messages, a summary and focus on the first problem; labels are the same everywhere; the status filter survives a reload.
- **Policies keep their filters.** Back from a document reset the search, every keystroke fetched the list, and a bad version link showed Loading forever or a Try again that could not help.
