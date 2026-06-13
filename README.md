# 🎮 Kids Games

A growing collection of mobile-friendly browser games for kids. Pure HTML5
canvas + vanilla JavaScript — no dependencies, no build step.

**Play online:** https://mokselim1.github.io/Kids-games/

## The games

### 🚀🐿️ Rocket Squirrel Rescue (`rocket-squirrel/`)

Explore a dark cave with your flashlight to bring your lost squirrel friends
home on a rocket! Tuned to be a fun challenge for a 6-year-old.

- 🔦 Your flashlight slowly runs down — grab **batteries** lying on the cave floor
- 💎 Find **5 diamonds** hidden at the end of tiny secret nooks (they only
  sparkle when your light gets close!)
- 🐿️ Rescue **3 caged squirrels**, each guarded by a friendly-scary **boss**
  (Grumpy Golem, Giant Cave Bat, Crystal King) — zap ⚡ them to win
- Rescued squirrels follow you and sniff out sparkle-trails toward hidden diamonds
- Every cave is different — a new world is generated each game

**Controls:** drag anywhere on the left of the screen to walk (virtual
joystick), tap ⚡ to zap. Desktop: WASD/arrows + space.

### 🦇🧛 Vampire Pac-Man (`vampire-pacman/`)

A spooky-but-friendly Pac-Man clone. Drink up blood drops while dodging four
vampire hunters; grab a blood vial to turn the tables and bite them back.

**Controls:** swipe on the maze or use the on-screen arrows. Desktop:
arrow keys/WASD.

## Running locally

Open `index.html` in any browser, or serve the folder
(`python3 -m http.server`) and open it on your phone.

## Deployment

Every push to `main` is mirrored to the `gh-pages` branch by a GitHub Actions
workflow and served by GitHub Pages.
