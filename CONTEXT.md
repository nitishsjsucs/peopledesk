# PeopleDesk

An employee self-service desk for a synthetic company: it answers policy questions from versioned policy documents with citations, and it carries out a few information-changing requests (support tickets, orientation bookings) only after the requesting person approves them. Every person, policy and number is synthetic.

## People and access

**Employee**:
A person in the synthetic organization, with exactly one role (employee, manager or HR admin), a region, a department and at most one manager.
_Avoid_: user, staff member

**Principal**:
The employee a request acts as, resolved from a verified identity, together with that employee's role, clearance and identity kind.
_Avoid_: user, caller, account

**Identity**:
Who Cloudflare Access says is making the request: a user (an email address) or a service token (a machine credential named by its Client ID).
_Avoid_: login, account

**Identity link**:
A mapping from a real Access email or service token onto a seeded employee, so a real person or an eval token can act as that employee.

**Persona**:
One of six seeded employees with a defined situation (a new hire with or without an orientation booking, a tenured employee, a manager with or without new hires, an HR admin), used for dev login and eval cases.

**Clearance**:
The highest audience rank a principal may read: rank 1 for employees, 2 for managers, 3 for HR admins.
_Avoid_: access level, permission level

**Directory slice**:
The people a principal may refer to by name: nobody for an employee, their direct reports for a manager, every new hire with an onboarding plan for an HR admin.
_Avoid_: org chart, contacts

**Eval window**:
The period in production during which service-token identities are accepted, opened only to run the evaluation and closed afterwards.

## Policies

**Policy document**:
A policy with a stable id (POL-001 to POL-100), a title, a category and an audience; it has one or more versions.
_Avoid_: policy file, article

**Policy version**:
One numbered revision of a policy document, with an effective range and a change summary.
_Avoid_: revision, edition

**Audience**:
Who a policy document is written for: all employees (rank 1), managers (rank 2) or HR (rank 3).

**Effective range**:
The half-open period from a version's effective-from date up to, but not including, its successor's effective-from date; open-ended for the latest version.

**Business date**:
The date against which effective ranges, onboarding status and upcoming sessions are judged; fixed at 2026-10-01 locally and the real date in production.
_Avoid_: today, now, as-of date (in prose)

**Current version**:
The version of a document whose effective range contains the business date. A **superseded version** ended before it; a **scheduled version** starts after it.

**Fact**:
One numeric rule stated in a policy version (a cap, a deadline, a rate, a notice period), the unit an eval answer is checked against.

**Restricted value**:
A fact value from a managers or HR document that, by construction, appears in no document a lower-clearance reader can see.

**Distractor**:
A number in a policy that is not a fact (a form number, a review cadence), present so answers cannot be found by looking for any number.

**Ambiguity group**:
Two or three documents that share a kind of fact, so a generic question ("How much is the stipend?") cannot be answered without asking which one is meant.

**Passage**:
One section of one policy version, returned for a question together with its document, version and effective dates.
_Avoid_: chunk, snippet, hit

**Citation**:
A passage an answer is grounded in, shown with its document title, id, version, section and effective dates.
_Avoid_: reference, source link

## Conversations

**Conversation**:
A chat thread owned by one employee; nobody else can read or write it.
_Avoid_: session, chat

**Turn**:
One message from the employee and the single result the desk returns for it.

**Turn result**:
The outcome of a turn, of exactly one kind: answer, clarify, refuse, tool result, approval required, or error.

**Refusal**:
A fixed reply that does not reveal why; "not found" and "not permitted" read the same, so a refusal never says whether a restricted document or person exists, and the titles and content of restricted documents are never disclosed. (Policy ids are sequential, so the gaps in the ids a person can list are visible.)

**Router**:
The model role that decides what a message is (a policy question, a tool request, unclear, out of scope) without ever seeing policy text.

**Composer**:
The model role that writes an answer from labeled passages only, and can neither call tools nor cite anything it was not given.

## Requests and approvals

**Tool**:
One of six typed operations the desk exposes to the chat and to outside MCP clients: four read tools and two proposing tools.

**Pending action**:
A proposed information-changing request (a new support ticket or an orientation booking) that writes nothing until its requester approves it.
_Avoid_: draft, request (alone), job

**Proposal**:
Creating a pending action, from chat, a request form or an MCP client; all three use the same checks.

**Approval**:
The requesting person's explicit confirmation, given as a user identity in the desk's own UI, that executes a pending action exactly once.
_Avoid_: confirmation, sign-off

**Rejection**:
The requester declining a pending action; a service token may reject but never approve.

**Expiry**:
A pending action that was neither approved nor rejected within 15 minutes; it can no longer be approved.

**Supersede**:
Replacing a pending action with an edited one; the old one is rejected and points to its replacement.

**Outcome**:
What an approval produced: executed (the ticket or booking exists) or failed with a reason such as session full or already booked.

**Support ticket**:
A request to IT, payroll, benefits, facilities, HR or access management, owned by the employee who raised it.

**Onboarding plan**:
A new hire's checklist of twelve tasks with owners and due dates, plus a buddy and a target completion date.

**Orientation session**:
A scheduled, capacity-limited introduction session, virtual or in person, for a region or for everyone.

**Booking**:
One employee's seat in one orientation session; an employee holds at most one booking.

## Evaluation

**Eval case**:
One question asked by one persona, with an expected outcome and a category: answerable, outdated document, ambiguous, unauthorized or action request.

**Grounded answer**:
An answer that states every expected value, cites the current version of the right document and no superseded or scheduled one, and has at least one cited passage that contains those values.

**groundedAnswerAccuracy**:
The share of answerable and outdated-document cases that received a grounded answer.

**overallPassRate**:
The share of all 200 cases that passed their own category's rule.

**Leak**:
A restricted value, restricted document or another person's record appearing in what an unauthorized persona is shown.

**Write without approval**:
Any ticket or booking that appeared during an eval run, which never approves anything.

**Dataset validity window**:
The 14 days from the business date a dataset was generated for, during which no version changes status and no session has started, so its eval cases remain correct.
