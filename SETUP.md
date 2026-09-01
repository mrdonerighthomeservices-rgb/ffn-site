# Getting the site connected — from an iPad

Everything here is flat. No folders. One file gets renamed at the end,
and that is the only fiddly part.

## Step 1 — unzip on the iPad
Open the **Files** app, find `ffn-site-flat.zip` in Downloads, press and
hold it, choose **Uncompress**. You now have a folder with 36 files in it.

## Step 2 — upload them to GitHub
- In Safari go to **github.com/mrdonerighthomeservices-rgb/ffn-site**
- Tap **Add file**, then **Upload files**
- Tap **choose your files** → **Choose Files** → find the unzipped folder
- Tap **Select** in the corner, then tap every file (or **Select All**)
- Tap **Open**, scroll down, tap **Commit changes**

If it will not take all 36 at once, do it in two batches. Order does not
matter.

## Step 3 — move one file into a folder
This is the only step that is not obvious.

- In the repository, tap the file **api.js**
- Tap the **pencil** icon (edit)
- At the top there is a box with the filename `api.js` in it. Tap in that
  box and change it to exactly:

      netlify/functions/api.js

- Scroll down, tap **Commit changes**

Typing the slashes is what creates the folders. GitHub does this for you.

## Step 4 — point Netlify at the repository
- Log into Netlify, open your site (poetic-puffpuff-b16951)
- **Site configuration** → **Build & deploy**
- Find the option to link a Git repository, choose **GitHub**
- Pick **ffn-site**
- Netlify reads `netlify.toml` on its own; you should not have to type any
  build settings in

## Step 5 — already done, nothing to do
Both passphrases are already set in Netlify:
- `FFN_ADMIN_KEY` = `LunkerBoard2026!Jonny` (the one you type on the jokes
  approval page)
- `FFN_SESSION_SECRET` = a long random string you never see or type

## Step 6 — email for joke submissions
Site configuration → **Forms** → **Form notifications** → Add
notification → Email notification → your email. Skip if already done.

## Step 7 — check it worked
Netlify builds automatically once linked. Watch the deploy log; it should
run `npm install` and finish green. Then:

- Go to `/join.html` and make a real test account
- Go to `/golden-nuggets.html` in that same browser — no join wall
- Open a private/incognito window — the wall SHOULD be there
- Go to `/login.html` in that window, log in, wall goes away
- Submit a test joke on `/jokes.html`, then approve it at
  `/admin-jokes.html` using the passphrase above

## After it works — one cleanup
The `ffn-site` repository came out **Public**. Nothing secret is in it
(the passwords live in Netlify, not in these files), so this is tidiness
rather than an emergency. To change it: repository **Settings** → scroll
to the bottom → **Change repository visibility** → Private.

## About future updates
Once this is linked, any change I hand you is a small batch of files you
re-upload here, and Netlify publishes it on its own. I cannot push into
GitHub from my end — my workspace blocks outbound connections to GitHub —
so the personal access token does not help from here. It would work from
a Mac or PC if you ever get one.
