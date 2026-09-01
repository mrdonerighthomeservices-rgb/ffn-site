/* ============================================================
   FFN free-member gate.

   As of Sept 2026 this checks a REAL server-verified login (a signed
   session cookie set by /api/login or /api/signup, checked
   by /api/whoami) -- not a localStorage flag anybody
   could set by hand in their browser console. That is a real
   improvement, but it is still only as strong as the login system behind
   it: there is no email verification and no password-reset flow yet, so
   treat this as "real access control for casual browsing," not a bank-
   grade login. Don't oversell it beyond that to visitors either --
   copy on this site says "join" and "log in," never "verified" or
   "secure."

   Two ways a page uses this file:

   1. FULL-PAGE GATE (default). Just add this before </body>:
        <script>window.FFN_GATE_MSG = "...";</script>  (optional)
        <script src="ffn-gate.js" defer></script>
      Blocks the whole page behind a join screen until whoami confirms a
      real logged-in session.

   2. PARTIAL / PREVIEW GATE. Set window.FFN_GATE_MANUAL = true before
      loading this file to skip the automatic full-page gate, then use
      FFNGate.isMember() (returns a Promise<boolean>) and
      FFNGate.showFullPage(msg) / FFNGate.buildCard(msg) from your own
      page script. isMember() caches its result for the rest of the page
      load, so calling it more than once is cheap. See golden-nuggets.html,
      education.html, and jokes.html for examples.

   Both modes also swap the header buttons for anyone already logged in.
   A member does not need "Join Free" or "Log In" in their face on every
   page, so this file finds the .nav-cta box in the header and, once
   whoami confirms a real session, replaces those two buttons with
   Premium, Get Involved, and Log Out. This runs on every page that
   loads this file, gate or no gate.
   ============================================================ */
window.FFNGate = (function () {
  var memberPromise = null;

  function isMember() {
    if (!memberPromise) {
      memberPromise = fetch('/api/whoami', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : { member: false }; })
        .then(function (data) { return !!data.member; })
        .catch(function () {
          // Network or server hiccup -- fail CLOSED for a gate (don't grant
          // access on an error), but don't leave the caller hanging.
          return false;
        });
    }
    return memberPromise;
  }

  function buildCard(msg) {
    var msgText = msg ||
      'This part of the site is for members. Joining is always free, takes about a minute, and nothing is ever charged.';
    var div = document.createElement('div');
    div.className = 'ffn-gate-card';
    div.innerHTML =
      '<p class="eyebrow" style="margin-bottom:8px;">Free Member Perk</p>' +
      '<h2>Join Free to Keep Looking Around</h2>' +
      '<p>' + msgText + '</p>' +
      '<a class="btn solid" href="join.html">Join Free</a>' +
      '<p class="fine">Already have an account? <a href="login.html">Log in</a>.</p>';
    return div;
  }

  function showFullPage(msg) {
    document.body.classList.add('ffn-gated');
    var overlay = document.createElement('div');
    overlay.className = 'ffn-gate-overlay';
    overlay.appendChild(buildCard(msg));
    document.body.appendChild(overlay);
    return overlay;
  }

  function autoFullPageGate() {
    var msg = window.FFN_GATE_MSG;
    function run() {
      isMember().then(function (member) {
        if (!member) showFullPage(msg);
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  // A member does not need to be sold on joining or logging in, they
  // already did both. Swap those two header buttons for options that
  // actually matter once somebody is signed in: going Premium, and
  // Get Involved, which covers mentoring and volunteering. Support
  // stays either way, and Log Out replaces the spot Join Free had.
  function swapHeaderForMember() {
    var box = document.querySelector('.nav-cta');
    if (!box) return;
    var join = box.querySelector('a[href="join.html"], a[href="/join.html"]');
    var login = box.querySelector('a[href="login.html"], a[href="/login.html"]');
    if (!join && !login) return; // already swapped, or not the usual header

    if (join) {
      join.textContent = 'Premium';
      join.setAttribute('href', 'pricing.html');
    }
    if (login) {
      login.textContent = 'Get Involved';
      login.setAttribute('href', 'get-involved.html');
      login.classList.remove('solid');
      var out = document.createElement('a');
      out.className = 'btn';
      out.href = '#';
      out.textContent = 'Log Out';
      out.addEventListener('click', function (ev) {
        ev.preventDefault();
        fetch('/api/logout', { credentials: 'same-origin' }).then(function () {
          window.location.href = 'index.html';
        });
      });
      login.insertAdjacentElement('afterend', out);
    }
  }

  function runHeaderSwap() {
    function go() {
      isMember().then(function (member) {
        if (member) swapHeaderForMember();
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', go);
    } else {
      go();
    }
  }

  if (!window.FFN_GATE_MANUAL) autoFullPageGate();
  runHeaderSwap();

  return { isMember: isMember, buildCard: buildCard, showFullPage: showFullPage };
})();
