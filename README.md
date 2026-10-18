# Weekly Schedule & Tasks: Vercel version (no GitHub needed)

A web app where each person creates an account, logs in, and manages their own weekly class schedule
and tasks. The pages are hosted on **Vercel**, the data is kept in a **Neon Postgres** database, so it
works from any device.

```
schedule-app/
├── vercel.json        Vercel settings (routes /api to the function, security headers, Singapore region)
├── package.json       dependencies (only "pg")
├── api/index.js       the Vercel Function: every /api/... request goes here
├── lib/handler.js     the API: accounts, tasks, classes
├── lib/db.js          database connection and tables (created automatically)
├── server.js          small local test server (not used on Vercel)
├── .env.example       example settings for testing on your own computer
└── public/            the web pages
    ├── index.html     schedule + tasks (login required)
    ├── login.html     log in / create account
    ├── style.css
    └── js/            api, auth, state, utils, tasks, schedule, download, app, login
```

Vercel needs either a Git host (GitHub, GitLab, Bitbucket) or its **command-line tool**. Because you do
not want GitHub, these steps use the command-line tool. It runs on your computer and uploads the folder.

## Deploy (about 15 minutes)

### 1. Install Node.js (one time)
Download the **LTS** version from https://nodejs.org and install it. To check, open a terminal
(Windows: "Command Prompt" or "PowerShell", Mac: "Terminal") and run `node -v`. It should show a number.

### 2. Make a free Vercel account
Sign up at https://vercel.com (email, Google, etc.). The free "Hobby" plan is meant for personal,
non-commercial use. Check Vercel's pricing page for current limits.

### 3. First upload
1. Unzip the project (keep the folders `api`, `lib` and `public` as they are).
2. In the terminal go into the folder, for example: `cd Downloads/schedule-app`
3. Run: `npx vercel`
4. It asks you to log in (a browser opens). Then answer:
   - Set up and deploy? **Y**
   - Which scope? pick your account
   - Link to existing project? **N**
   - Project name: for example `my-schedule`
   - Code directory: press **Enter** (`./`)
   - If it asks about changing settings: **N**

   It uploads and gives you a preview link. The pages will open, but creating an account will say
   *"The database is not connected yet"*. That is expected, because we have no database yet.

### 4. Create the database (free) and connect it
1. Open https://vercel.com/dashboard → your project → **Storage** tab.
2. Choose **Create Database** → **Neon** (Postgres) → pick the **Free** plan.
3. Region: choose **Singapore** (closest for most users in Asia). `vercel.json` runs the app in
   Singapore (`sin1`), and the database should be in the same region so the app is fast.
   If you pick another region for the database, change `"regions"` in `vercel.json` to the matching
   Vercel region.
4. Press **Connect Project** and select your project. Vercel adds the database address to the project
   automatically (`DATABASE_URL`, `POSTGRES_URL`). You do not need to copy any password.

The app creates its own tables the first time it runs. You do not need to run any SQL.

### 5. Publish the real version
Back in the terminal run: `npx vercel --prod`

It prints your public link, for example `https://my-schedule.vercel.app`. Open it, create an account,
and use the app. Share the link with anyone who should use it.

### Changing the app later
Edit the files, then run `npx vercel --prod` again.

## Test on your own computer (optional)
1. Copy `.env.example` to `.env` and put your Neon connection string in it (Neon dashboard → Connection string).
2. Run `npm install` then `npm run dev`, and open http://localhost:3000

## How accounts and security work
- Passwords are never stored. Only a salted **scrypt** hash is saved.
- After login the server gives the browser a random session token in an **HttpOnly, SameSite, Secure**
  cookie. Only a hash of the token is stored in the database.
- Every request for tasks or classes is checked against the logged-in user, so one account can never
  read or change another account's data.
- Login attempts are limited (10 wrong passwords for one username, or too many tries from one
  address, are blocked for 15 minutes). Sign-ups are limited per address. The counters are stored in the
  database, because Vercel Functions do not share memory.
- Strict browser security headers are sent (Content-Security-Policy, no framing, no sniffing), and
  requests from other websites are refused.
- All text shown on the page is escaped, so a task named `<script>` is displayed as text.
- The page files (`index.html`) are public, like any website. What is protected is the **data**: nothing
  loads without a valid login, and the page sends you to the login page.

Not included (could be added later): password reset by email, "delete my account", email verification,
and database backups (use the backup options in your Neon plan).

## If something goes wrong
- **"The database is not connected yet"**: finish step 4, then run `npx vercel --prod` again.
- **Create account / log in shows "Something went wrong on the server"**: open the Vercel dashboard →
  your project → **Logs** to see the exact error, and tell me what it says.
- **Page shows a plain 404 for /api/...**: check that `vercel.json` is in the folder you uploaded.
