# CULT DAO Burn Tracker

Standalone public burn tracker for CULT DAO. It does not connect to a wallet.

## What it shows

- Burned CULT supply, contributed CULT, burned percentage, and total supply.
- A compact latest-burn strip directly below the supply summary, expandable to the latest 10 burns.
- Top 10 CULT return contributors, based on direct CULT transfers into the dCULT staking contract.
- Top 10 CULT burners, based on transfers into the configured burn wallets.
- Etherscan links for token, burn wallets, staking contract, wallets, and transactions. In the top-10 rows, the wallet text links to the wallet and the right-side icon links to that wallet's latest indexed burn or contribution transaction.

## Run locally

```sh
python3 -m http.server 5174 --bind 127.0.0.1
```

Then open `http://127.0.0.1:5174/`.

## Notes

- CULT token: `0xf0f9d895aca5c8678f706fb8216fa22957685a13`
- dCULT staking / returns contract: `0x2d77b594b9bbaed03221f7c63af8c4307432daf1`
- Burn wallets:
  - `0x000000000000000000000000000000000000dEaD`
  - `0xdEAD000000000000000042069420694206942069`
- The all-time event index starts at CULT creation block `14093760`, from transaction `0x9b6bc8e16ea2575c54a0abdc96604f50cf4e75c9dd463bef9ce92cc04381d3c9`.
- Current burned supply is read directly from burn-wallet balances. The recent burns and leaderboard are built from `Transfer` logs into those burn wallets and cached in the browser.
- The return-contributor leaderboard is built from CULT `Transfer` logs into the dCULT staking contract, excluding normal dCULT deposit transactions.
