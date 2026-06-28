# CULT DAO Burn Tracker

Standalone public burn tracker for CULT DAO. It does not connect to a wallet.

## Run locally

```sh
python3 -m http.server 5174 --bind 127.0.0.1
```

Then open `http://127.0.0.1:5174/`.

## Notes

- CULT token: `0xf0f9d895aca5c8678f706fb8216fa22957685a13`
- Burn wallets:
  - `0x000000000000000000000000000000000000dEaD`
  - `0xdEAD000000000000000042069420694206942069`
- The all-time event index starts at CULT creation block `14093760`, from transaction `0x9b6bc8e16ea2575c54a0abdc96604f50cf4e75c9dd463bef9ce92cc04381d3c9`.
- Current burned supply is read directly from burn-wallet balances. The recent burns and leaderboard are built from `Transfer` logs into those burn wallets and cached in the browser.
