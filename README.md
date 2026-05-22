# Trivia Game

Local multiplayer trivia on **phones** (any number of players). Questions come from [The Trivia API](https://the-trivia-api.com/).

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server on a machine on your Wi‑Fi:

   ```bash
   npm start
   ```

3. On each phone, open the URL printed in the terminal (e.g. `http://192.168.1.x:3000`).
4. On one phone, **create a room** and share the code or QR (this device is setup only — not a player).
5. On each playing phone, **join** with a name. The setup phone **starts** the game when ready.

## How it works

- **Create room** — on a setup phone: get a 4-letter code and QR (you are not added as a player).
- **Join room** — on each playing phone: enter code and name (including the person who created the room, on a second device).
- **Start game** — only from the setup phone that created the room, once at least one player has joined.
- **Each round**, players vote from **4 categories** (least played so far; previous category never repeated).
- **Difficulty increases** over the game: easy → medium → hard.
- Everyone sees questions and scores on their phone; answers are tapped on the same device.
- If **all players leave** mid-game, the room **pauses** until someone rejoins with the room code.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `QUESTIONS_PER_GAME` | `10` | Number of rounds |
| `VOTE_TIME_SEC` | `15` | Seconds for category voting |
| `ANSWER_TIME_SEC` | `20` | Seconds per question |
| `REVEAL_TIME_SEC` | `4` | Seconds before next vote |
| `TRIVIA_API_KEY` | — | Optional API key ([The Trivia API](https://the-trivia-api.com/)) |

## Network note

All phones must be on the **same Wi‑Fi** as the machine running `npm start`.

## License / attribution

Questions from [The Trivia API](https://the-trivia-api.com/) (CC BY-NC 4.0). Credit is shown in the app.
