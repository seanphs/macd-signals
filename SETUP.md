# Setting up the MACD Signals site

This guide takes you from nothing to a working website in about 30 minutes. Everything in it is
free. You do the clicks in your web browser. Where the assistant on your PC can do a step for
you, the guide says so.

Words used below:

- **GitHub**: a website that stores project files, runs small jobs on them and hosts web pages.
- **Repository**: one project's folder on GitHub. Ours is named `macd-signals`.
- **Commit**: saving a change in a repository, with a short note about it.
- **Workflow**: a job GitHub runs for you. Ours is named "Update prices and publish".
- **GitHub Pages**: GitHub's free website hosting. It turns the `site` folder into a website.
- **main**: the name of the one line of saved changes in the repository. Everything goes there.

## Do I need a GitHub account?

Yes. You need one free GitHub account. It owns the repository, runs the nightly job and hosts the
site. People who only visit the site do not need an account.

## Step 1: Create a GitHub account

If you already have a GitHub account, skip to Step 2 and use that username wherever `<username>`
appears below. This PC is already signed in to GitHub as `seanphs`, so with that account the
site will be `https://seanphs.github.io/macd-signals/`. Do not create a second account: git on
this PC remembers the first one, and an upload to a repository owned by a different account is
refused.

1. Open https://github.com/signup in your browser.
2. Follow the prompts: an email address, a password and a username. (You can also click
   **Continue with Google**.)
3. Pick the username with care. It becomes part of your site address:
   `https://<username>.github.io/macd-signals/`. Lowercase letters and digits are safest.
4. Verify your email address when GitHub asks. GitHub does not let you create a repository until
   the address is verified.
5. If GitHub asks about plans, choose the free one.

## Step 2: Create the repository

1. Sign in at https://github.com.
2. In the upper-right corner, click the **+** icon, then click **New repository**.
3. In **Repository name**, type `macd-signals` (lowercase, with a hyphen).
4. Leave the description empty, or type something like "MACD and RSI signals".
5. Choose **Public**. The free plan hosts websites only from public repositories. Public means
   anyone can see the files; they contain nothing personal.
6. Leave **Add a README file** unticked, and leave the .gitignore and license choices at
   **None**. The repository must be empty, because all the files are coming from your PC.
7. Click **Create repository**.
8. You now see a page headed "Quick setup". Leave it open.

## Step 3: Put the files in the repository

Pick one of the two options. Option A is easier.

### Option A: the assistant uploads the files with git (recommended)

Git is the tool that sends files to GitHub. It is already installed on this PC.

1. On your PC, tell the assistant: "Push the project in D:\MACD_Web to my new GitHub repository
   https://github.com/<username>/macd-signals" (with your real username).
2. The assistant will ask what name and email to attach to the saved changes. These are shown
   publicly in the repository, so use your GitHub username as the name. For the email, use the
   private address GitHub gives you: on GitHub, open **Settings** → **Emails**, tick
   **Keep my email addresses private**, and copy the address ending in
   `@users.noreply.github.com`. The assistant must set exactly these two values for this
   repository (the `git config` lines below) and not use the name and email git already holds
   on this PC, because those include a personal email address that would otherwise be published.
3. When the assistant sends the files, a browser window opens on your screen asking you to sign
   in to GitHub. Sign in.
4. A page may then ask you to let "Git Credential Manager" use your account. Click the green
   **Authorize** button. This happens once; git remembers it on this PC.
5. On github.com, reload the repository page. You should see the files, including a `.github`
   folder, a `site` folder, `universe.txt` and `fetch_data.py`.

For the record, these are the commands the assistant runs (you do not need to type them):

```
cd D:\MACD_Web
git init -b main
git config user.name "<username>"
git config user.email "<id>+<username>@users.noreply.github.com"
git add .
git commit -m "First upload"
git remote add origin https://github.com/<username>/macd-signals.git
git push -u origin main
```

### Option B: upload through the browser

1. On your PC, open the folder `D:\MACD_Web` in File Explorer.
2. Open the `site` folder inside it. If it contains a folder named `data`, delete that `data`
   folder (it is generated data; GitHub makes its own every night). Go back up to `D:\MACD_Web`.
   If there is a folder named `__pycache__`, delete it too.
3. In the browser, on the "Quick setup" page of the repository, click the link
   **uploading an existing file**. (If the repository already has files in it, click the
   **Add file** dropdown instead, then **Upload files**.)
4. In File Explorer, click once inside `D:\MACD_Web`, press Ctrl+A to select everything, then
   drag the selection onto the upload area in the browser. (You can also click
   **choose your files**, but that picks files one folder at a time; dragging keeps the folders.)
5. Wait until the list under the upload area shows every file. Check that these are all there:
   `.github/workflows/update.yml`, `.github/last-run.txt`, `.gitignore`, `fetch_data.py`,
   `universe.txt`, `site/index.html`, `site/app.js`, `site/style.css`, `README.md`, `SETUP.md`
   and `docs/SPEC.md`.
6. In the **Commit message** box, type `First upload`.
7. Make sure **Commit directly to the main branch** is selected.
8. Click **Commit changes**. (If the button says **Propose changes**, the wrong choice is
   selected in step 7; fix that first.)
9. If `.github` or `.gitignore` is missing from the repository afterwards (some browsers skip
   names that start with a dot), add them by hand:
   1. Click the **Add file** dropdown, then **Create new file**.
   2. In the name box, type `.github/workflows/update.yml`. Typing the `/` creates the folders.
   3. On your PC, open `D:\MACD_Web\.github\workflows\update.yml` in Notepad, select all
      (Ctrl+A), copy (Ctrl+C), and paste (Ctrl+V) into the big box in the browser.
   4. Click **Commit changes...**, then **Commit changes**.
   5. Do the same for `.github/last-run.txt` (its whole content is the single word `never`) and
      for `.gitignore`.

## Step 4: Turn on GitHub Pages

The job can only publish the site if GitHub Pages is switched on and set to use the job. Without
this step the first run fails with "Get Pages site failed".

1. On the repository page, click the **Settings** tab in the top row. (If the row is too narrow,
   it is under **More**.)
2. In the left sidebar, under "Code, planning, and automation", click **Pages**.
3. Under **Build and deployment**, open the **Source** dropdown and choose **GitHub Actions**.
4. There is no Save button. The choice applies as soon as you pick it. Ignore the suggested
   workflows GitHub offers under the dropdown; the repository already has one.

## Step 5: Run the job once by hand

1. Click the **Actions** tab.
2. In the left column, click **Update prices and publish**.
3. On the right, above the empty list of runs, click **Run workflow**. A small box opens showing
   the branch `main`. Click the green **Run workflow** button inside it.
4. After a few seconds a run appears in the list. Click it to watch. It takes about 5 to 15
   minutes: most of the time is spent downloading the 800 tickers one by one.
5. What "green" looks like: the two boxes "Fetch prices and compute signals" and "Publish to
   GitHub Pages" both get a green check mark, and so does the run in the list. On the run's
   Summary page there is a box titled "Nightly price update" with one line like
   `fetched 790  stale 3  failed 2  last_bar 2026-10-29  elapsed 312s`. A handful of failed
   tickers is normal.
6. A red X means something failed. Click the red box, read the message, and look it up in the
   Troubleshooting table in README.md.

## Step 6: Open your site

1. The site address is `https://<username>.github.io/macd-signals/`.
2. You can also find it in two places. On the run's Summary page, the "Publish to GitHub Pages"
   box shows the address as a link. And under **Settings** → **Pages**, the page says
   "Your site is live at" and has a **Visit site** button.
3. If the address shows a "404" page right after the run, wait a few minutes and reload.
   GitHub says publishing can take up to 10 minutes.

## Step 7: Enter your tickers and keep the link

1. On the first visit, the page shows the list editor with two boxes: **Holdings** (what you
   own) and **Watch** (what you are keeping an eye on).
2. Type tickers separated by spaces or commas, in any case, for example `aapl msft brk.b`. Click
   **Save list**. Or click **Load an example list** to see the dashboard with sample tickers
   first.
3. Your list is saved in this browser and in the page address. Press Ctrl+D to bookmark the page,
   or click **Copy link** and paste the link somewhere safe. Opening that link on another device
   brings up the same list.
4. If the page shows a line starting "Not in the data set", that ticker is not in
   `universe.txt` yet. Step 8 adds it.

## Step 8: Adding tickers later

1. On GitHub, open the repository and click `universe.txt`.
2. Click the pencil icon (**Edit file**) at the top right of the file.
3. Scroll to the bottom, to the line `# Added by the owner`, and type each new ticker on its
   own line. Use Yahoo's spelling: `BRK-B`, not `BRK.B`.
4. Click **Commit changes...**, then **Commit changes** in the box that opens.
5. The new tickers are downloaded by the next nightly run. To get them sooner, repeat step 5
   above.

## What happens from now on

- The job runs on its own every Monday to Friday evening (US time). You do not need to do
  anything.
- Each successful run writes the date into `.github/last-run.txt`. GitHub counts that as
  activity and keeps the schedule switched on. (GitHub switches off schedules in public
  repositories that have had no activity for 60 days.)
- If the Actions tab ever shows the workflow as disabled, click **Update prices and publish** in
  the left column, click **Enable workflow**, and run it by hand once.
- The README.md file explains the page, the files and what to do when something goes wrong.

Nothing on the site is financial advice. It shows what an indicator is doing; what you do with
that is your decision.
