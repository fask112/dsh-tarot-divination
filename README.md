# dsh-tarot-divination

Tarot readings inside DeepSeek Harness: a card table you can watch, a tool the model uses to interpret, and a history you can look back on.

## What it does

**A reading table.** Asking for a reading opens an overlay where the deck is shuffled, cut, and dealt face down. Every card can be flipped by clicking it, and the reading ends on the drawn cards with their positions, orientation, meaning, and a plain-language summary of what the spread says.

**Two tools.**

- `tarot_reading` — draws a spread and returns each card's position, name, orientation, keywords, and meaning. The model writes the interpretation; the tool only draws. Spreads: `single`, `three` (past/present/future, the default), `cross5`, `celtic`.
- `tarot_history` — lists, reads, and annotates past readings. `list` shows readings newest first, `get` returns one reading's full spread, `review` appends a note about what actually happened.

**Card art.** All 78 faces are Rider-Waite-Smith images; each card also has its own reverse. Art is embedded in the bundle as base64, so a reading works offline with no image host and no extra requests.

## Install

```sh
dsh plugin add dsh-tarot-divination
```

Or from a local checkout, point the plugin manager at this directory. The package declares `dsh.bundle`, so it installs as a profile bundle; the overlay and the chat cards load with the page.

## Data

Readings are stored per user at `$DSH_HOME/tarot/readings.json`, capped at the 200 most recent. Nothing is sent anywhere.

## Notes

- Face-down cards share one neutral back so the deck does not reveal what was dealt; a card's own reverse appears only after it has been drawn.
- Reversed cards are drawn about 35% of the time; `allowReversed: false` turns that off.
- The plugin draws cards and quotes their meanings. It does not make medical, legal, or financial predictions, and a reading is not a substitute for advice from a professional.

## License

MIT
