# Warhammer Sim

Practice games of Warhammer 40,000 (11th edition) on your PC: your Tyranids against a computer-controlled
2000-point Ultramarines army (Easy / Normal / Hard).

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5180 in your browser.

## Other commands

- `npm test` — rules and full-game tests
- `npm run build-data` — rebuild the rules from the Wahapedia CSVs in `data/raw`
- `npm run build` — typecheck and production build

See `docs/design.md` for what it does and the rules decisions made.
