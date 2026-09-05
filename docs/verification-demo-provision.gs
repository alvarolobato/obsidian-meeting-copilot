/**
 * Provisioning for the Google OAuth verification demo (see google-verification.md §6).
 *
 * Idempotent: every function checks before it writes, so re-run it freely after a
 * botched take. Nothing here is destructive.
 *
 * SETUP
 *   1. script.google.com → new project, signed in as a MHIA Store super admin.
 *   2. Services (+) → add "Admin SDK API"  (identifier: AdminDirectory)
 *                   → add "Calendar API"   (identifier: Calendar)
 *   3. Run `provisionAll`, approve the consent prompt, read the log (Cmd+Enter).
 *
 * The demo signs in as alvaro@mhiastore.com, who is HIMSELF a member of the group.
 * That is the one risky part of this cast — see `checkBaseline` at the bottom.
 */

var DOMAIN = "mhiastore.com";
var GROUP = "testgroup@" + DOMAIN;

/** The signed-in demo user. Also a group member — deliberate, see checkBaseline. */
var DEMO_USER = "alvaro@" + DOMAIN;

/**
 * Group members, in the order they should read on camera.
 *
 * `guess` is what the app shows with NO scopes granted — humanizeEmailName()
 * splits the local part on [._+-] and title-cases it. The gap between `guess`
 * and `name` is the entire evidence of the video, so it is spelled out here.
 */
var MEMBERS = [
  { email: "alvaro@" + DOMAIN,   given: "Alvaro",      family: "Lobato Moreno", guess: "Alvaro"   },
  { email: "mjpartal@" + DOMAIN, given: "Maria Jose",  family: "Partal",        guess: "Mjpartal" },
  { email: "alberto@" + DOMAIN,  given: "Alberto",     family: "Lobato",        guess: "Alberto"  },
];

var EVENT_TITLE = "Q3 planning review";

// ---------------------------------------------------------------------------

function provisionAll() {
  MEMBERS.forEach(ensureUser);
  MEMBERS.forEach(function (m) { ensureMember(m.email); });
  ensureEvent();
  Logger.log("");
  checkBaseline();
}

/** Create the account only if it is missing. Existing accounts are left alone —
 *  this never renames or re-passwords a real user. */
function ensureUser(m) {
  try {
    var existing = AdminDirectory.Users.get(m.email);
    var full = existing.name.fullName;
    if (full !== m.given + " " + m.family) {
      Logger.log("!  %s exists as \"%s\" — the cards say \"%s %s\". Fix one or the other.",
                 m.email, full, m.given, m.family);
    } else {
      Logger.log("ok %s exists (%s)", m.email, full);
    }
    return;
  } catch (e) {
    // Not found — fall through and create.
  }

  var password = Utilities.getUuid();
  AdminDirectory.Users.insert({
    primaryEmail: m.email,
    name: { givenName: m.given, familyName: m.family },
    password: password,
    changePasswordAtNextLogin: false,
  });
  Logger.log("+  created %s (%s %s)", m.email, m.given, m.family);
  Logger.log("   temp password: %s", password);
}

function ensureMember(email) {
  try {
    AdminDirectory.Members.get(GROUP, email);
    Logger.log("ok %s already in %s", email, GROUP);
    return;
  } catch (e) {
    // Not a member — fall through and add.
  }
  AdminDirectory.Members.insert({ email: email, role: "MEMBER" }, GROUP);
  Logger.log("+  added %s to %s", email, GROUP);
}

/**
 * One event, one guest: the group.
 *
 * Created through the API rather than the Calendar UI because
 * mapAttendeesExpanded() prefers Calendar's own attendee.displayName over any
 * lookup — if Calendar supplies a name, NO API call happens and the demo proves
 * nothing. Inserting with a bare email keeps the guest list nameless.
 */
function ensureEvent() {
  var found = findDemoEvent();
  if (found) {
    Logger.log("ok event \"%s\" exists on %s", EVENT_TITLE, found.start.dateTime);
    return;
  }

  // Tomorrow at 10:00 local — inside the agenda's default look-ahead window.
  var start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  var end = new Date(start.getTime() + 60 * 60 * 1000);

  var ev = Calendar.Events.insert({
    summary: EVENT_TITLE,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    attendees: [{ email: GROUP }],   // bare email, no displayName
  }, "primary");

  Logger.log("+  created \"%s\" at %s", EVENT_TITLE, start);
  return ev;
}

function findDemoEvent() {
  var from = new Date();
  from.setDate(from.getDate() - 1);
  var to = new Date();
  to.setDate(to.getDate() + 14);

  var res = Calendar.Events.list("primary", {
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    q: EVENT_TITLE,
    singleEvents: true,
  });
  var items = res.items || [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].summary === EVENT_TITLE) return items[i];
  }
  return null;
}

/**
 * THE IMPORTANT ONE. Prints the guest list exactly as the Calendar API returns
 * it — which is exactly what the plugin sees before any scope is granted.
 *
 * The demo signs in as alvaro@, who is also in testgroup@. If Calendar has added
 * him to the event as his own attendee entry (with a displayName), the baseline
 * shot shows TWO rows — one of them already correctly named — instead of the
 * single nameless "Testgroup" row the shot list depends on.
 *
 * PASS: exactly one attendee, testgroup@mhiastore.com, with no displayName.
 * FAIL: anything else. Fixes, in order of preference:
 *   1. Delete the extra attendee entry from the event (Calendar UI → remove guest).
 *   2. Organize the event from a different account in the domain.
 *   3. Sign the demo in as a non-member account.
 */
function checkBaseline() {
  var ev = findDemoEvent();
  if (!ev) {
    Logger.log("FAIL  no \"%s\" event found — run provisionAll first.", EVENT_TITLE);
    return;
  }

  var attendees = ev.attendees || [];
  Logger.log("Guest list as the plugin will see it:");
  attendees.forEach(function (a) {
    Logger.log("   %s%s%s",
      a.email,
      a.displayName ? "  displayName=\"" + a.displayName + "\"" : "  (no displayName)",
      a.self ? "  [self]" : "");
  });

  var ok = attendees.length === 1
        && attendees[0].email.toLowerCase() === GROUP
        && !attendees[0].displayName;

  if (ok) {
    Logger.log("PASS  one nameless group row — the baseline shot will read \"Testgroup\".");
  } else {
    Logger.log("FAIL  expected exactly one attendee (%s) with no displayName.", GROUP);
    Logger.log("      See the fixes in this function's comment.");
  }

  Logger.log("");
  Logger.log("After the group scope, expect these guessed labels:");
  MEMBERS.forEach(function (m) {
    Logger.log("   %s → \"%s\"   then → \"%s %s\"", m.email, m.guess, m.given, m.family);
  });
}
