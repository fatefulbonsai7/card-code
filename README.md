# Card Code

A card puzzle for a class, played on Chromebooks. The teacher puts a four-digit code on
the board; everyone else opens this page, types the code and a first name, and races to
crack three codes.

No app, no accounts, no QR codes, no laptop running a server.

**Play:** <https://fatefulbonsai7.github.io/card-code/>

---

## What the class does

There are 26 cards: A–Z, numbered 1–26, each with a shape and a colour. The game hides a
code — four of those cards. You are given clues about it and have to name the four.

> Round 1 has 4 clues. Round 2 has 5. Round 3 has 6.

| | |
|---|---|
| Right answer | 100 points, plus a bonus for being early (60, 45, 35, 25, 20, 15, 10…) |
| Wrong answer | −20 points, and you can try again |
| Hint | −20 points if you solve, nothing if you don't. It names a card that is **not** in the code |

Every clue is true. Together they leave exactly one possible code. And **every clue is
needed** — take any one away and at least two codes would still fit, so there is nothing
in the list to skip. That is why round 3 is not the easy one.

Clues look like this:

- *The four numbers add up to 68.*
- *Exactly one of the four cards is a circle.*
- *The second-highest number is even.*
- *No two of the four numbers differ by 1.*

---

## Running it in your own class

You need two free things: somewhere to serve the page, and somewhere to keep the room.

### 1. The page

Any static host works. On GitHub: fork this repo, then **Settings → Pages → Deploy from a
branch → main / (root)**. Your game lives at `https://<your-name>.github.io/card-code/`.
The teacher's screen is the same address with `host.html` on the end.

### 2. The room (5 minutes, no card)

A static page cannot hold a lobby on its own, so the room lives in a free Firebase
Realtime Database.

1. <https://console.firebase.google.com> → **Add project** → any name → no Analytics.
2. **Build → Realtime Database → Create Database** → any region → **start in test mode**.
3. Open the **Rules** tab and replace everything with:
   ```json
   { "rules": { "games": { "$code": { ".read": true, ".write": true } } } }
   ```
4. Copy the database URL at the top of the **Data** tab, something like
   `https://your-project-default-rtdb.firebaseio.com`.
5. Put it in `config.js`:
   ```js
   window.CARD_CODE_FIREBASE = "https://your-project-default-rtdb.firebaseio.com";
   ```
6. Commit and push. GitHub Pages redeploys in a minute.

Without step 5 the game still runs, but only across tabs of one browser — enough to try
it, not enough for a class.

### 3. In the lesson

1. Open `…/host.html` on the projector and press **Host a game**.
2. Put the four-digit code on the board. Students open the main address and type it.
3. Wait until everyone is in the room list, then **Start round 1**.
4. When the last student has solved it or given up, **Reveal the answer**. The reveal panel
   says what each clue eliminated, which is the part worth discussing.
5. Three rounds, then the final table.

---

## How the puzzles are made

Each puzzle is generated and **proved before it is shipped**: all the clues must be true
of the answer, they must leave exactly one of the 14,950 possible four-card codes, and
every clue must be load-bearing. A set that fails any of that is never written to disk.

The four cards are a set, not a sequence, so clues talk about *the second-lowest
number* rather than *the second card you tapped*. No clue ever tells you a number
outright: position is given as a property (prime, odd, a multiple of 3) or through
sums and counts, so the four numbers have to be worked out.

The 300 sets are precomputed. The game code picks one (`code % 300`), so two codes can
share a set of puzzles; nobody has ever noticed, and it keeps the data file small.

---

## Honest limits

- **A curious student with developer tools can find the answers.** The answer file is
  public; it is only downloaded when a round is revealed, so a casual look at the network
  tab shows a number rather than a code, but someone who knows the file name can read
  ahead. Fine for a maths lesson, not fine with a prize on it.
- **The database is open to anyone with the URL.** It holds first names and scores for a
  lesson. Use a project of its own and put nothing else in it.
- **The teacher's tab is the clock.** If the laptop sleeps, the order of solving is
  recorded late. Keep the projector tab in front.
- **First names only**, and only for the length of the game. Nothing else is collected.

## Editing it

Everything is plain HTML, CSS and JavaScript — no build step, no dependencies. `data/`
holds the puzzles. Add `?g=1234` to a student link to fill the code in for them.
