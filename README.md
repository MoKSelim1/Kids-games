# 🦇 Vampire Pac-Man

A spooky-but-friendly, mobile-first Pac-Man clone. You're a little vampire
flitting through a haunted maze, drinking up blood drops while dodging a
squad of vampire hunters.

## How to play

- **Goal:** drink every blood drop 🩸 in the maze to survive the night.
- **Blood vials** (the big pulsing drops in the corners) turn the tables —
  the hunters panic and you can bite them for bonus points (200, 400, 800, 1600 in a chain).
- A **goblet of wine 🍷** appears in the middle of the maze twice per night for bonus points.
- Use the **tunnel** on the middle row to wrap around the maze.
- Extra life at 10,000 points. Each night (level) gets a little faster.

## Controls

| Platform | Controls |
|----------|----------|
| Phone / tablet | Swipe anywhere on the maze (you can steer without lifting your finger), or tap the on-screen arrows |
| Desktop | Arrow keys or WASD |

## The hunters

- **Van Crimson** (red) — chases you relentlessly.
- **Lady Silver** (white) — flies ahead to ambush you.
- **Friar Moss** (green) — unpredictable flanker.
- **Old Ember** (orange) — brave from afar, cowardly up close.

## Running it

No build step, no dependencies — it's plain HTML5 canvas + vanilla JS.

- Open `index.html` in any browser, **or**
- serve the folder (`python3 -m http.server`) and open it on your phone, **or**
- enable GitHub Pages for this repo and play it from anywhere.

Sound can be muted with the 🔊 button. Best score is saved on the device.
