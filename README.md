# psffpp

PSFFPP = [Permissionless Software Foundation](https://psfoundation.info) [File Pinning Protocol](https://psffpp.com).

This is an npm library for node.js. It implements the [PS010 specification for the PSF File Pinning Protocol](https://github.com/Permissionless-Software-Foundation/specifications/blob/master/ps009-multisig-approval.md). Version 2 of the protocol (PS010 v2.0.0) pays for pins in BCH, not PSF tokens. The main consumers of this library is:

- [ipfs-file-pin-service](https://github.com/Permissionless-Software-Foundation/ipfs-file-pin-service) uses it to verify Pin Claims before pinning the files.
- [psf-bch-wallet](https://github.com/Permissionless-Software-Foundation/psf-bch-wallet) is a command-line UI that uses this library to add files to the network.

## Instancing Library
This library depends on the [minimal-slp-wallet](https://www.npmjs.com/package/minimal-slp-wallet) and [psf-multisig-approval](https://www.npmjs.com/package/psf-multisig-approval) libraries. An instance of minimal-slp-wallet is expected to be injected into this library when it is instantiated. Here is an example:

```javascript
import SlpWallet from 'minimal-slp-wallet'
import PSFFPP from 'psffpp'

async function start() {
  // Instance the BCH wallet
  const wallet = new SlpWallet(undefined, {
    interface: 'consumer-api',
    restURL: 'https://free-bch.fullstack.cash'
  })
  await wallet.initialize()

  // Instance this library
  const psffpp = new PSFFPP({wallet})
}
start()
```

## Get the Write Price (PSF token burn — DEPRECATED)

**Deprecated:** PSF-token pricing is not used by PS010 v2.0.0. See
"Quote the required sats" below for the BCH fee schedule.

Retrieve the current cost-per-megabyte in PSF tokens, for writing data to the network.

*Note: The minimum cost is 1MB, even if you upload a file smaller than that to the file pinning network.*

```javascript
const writePrice = await psffpp.getMcWritePrice()
console.log(writePrice)

/*
  0.08335233
*/
```

## Create a Pin Claim with a BCH payment (PS010 v2.0.0)

PS010 v2.0.0 replaces the PSF-token proof-of-burn with a plain BCH payment: the
user sends the required satoshis to the pin-service payout address, then a Pin
Claim is published with that **payment txid** in field 2 of the OP_RETURN
(claim format unchanged). The pin-service validates the payment; this library
does not price or validate anything.

`createPinClaimBCH()` builds, signs, and broadcasts only the claim transaction:

```javascript
const { paymentTxid, claimTxid } = await psffpp.createPinClaimBCH({
  cid: 'bafkreih7eeixbkyvabqdde4g5mdourjidxpsgf6bgz6f7ouxqr24stg6f4',
  filename: 'test.txt',
  paymentTxid: 'f1ff81aaac7f755875306e31c9137b2bb010587feffeb4c7d42b462ef08db0df'
})
```

The claim OP_RETURN is unchanged from PS010 §5:

```text
6a04 00510000 | 20 <32B payment txid> | <len cid> <cid> | <len filename> <filename>
```

Both this path and the deprecated burn path go through the same internal
`_buildClaimScript()` helper, so the two can not diverge.

## Quote the required sats

The fee schedule (PS010 §3) is a pure function, exported alongside the class:

```javascript
import PSFFPP, { requiredSatsBCH } from 'psffpp'

const satsRequired = requiredSatsBCH({
  fileSizeBytes: 100000,
  satsPerMb: 2000 // from GET {pinService}/ipfs/payment-address
})
console.log(satsRequired) // 200
```

    requiredSatsBCH({ fileSizeBytes, satsPerMb }) =
        max( ceil( fileSizeBytes / 1e6 * satsPerMb ),
             ceil( 0.1 * satsPerMb ) )

The second term is the locked 100 KB minimum charge. The floor is a pricing rule
that lives inside this helper: do not re-derive one in client code.

*Note: PS010 §3 defines this function once, in the shared `psffpp-payments`
library. Until that library ships, this export is the client-side copy of the
same definition.*

## Create a Pin Claim (PSF token burn) — DEPRECATED

**Deprecated:** PS010 v2.0.0 removes PSF-token proof-of-burn as a payment method
(spec §8.2). Use `createPinClaimBCH()` instead. `createPinClaim()` and the PS009
write-price helpers (`getMcWritePrice()`, `getWritePriceHistory()`) are retained
only until they are deleted in M5.

Files are pinned in a two-step process:
1. Upload the file to the [IPFS](https://ipfs.io) network, which returns a [CID](https://docs.ipfs.tech/concepts/content-addressing/).
2. A Pin Claim is generated on the BCH blockchain using the IPFS CID.

Generating a Pin Claim is also a two-step process:
1. Calculate the cost of pinning the file (in PSF tokens), then burn that amount to generate a Proof-of-Burn (proof of payment). This is a transaction on the blockchain. and is returned as `pobTxid`.
2. Generate a Pin Claim transaction that includes the `pobTxid`, the CID, and the filename. This is a second transaction on the blockchain, and is returned as `claimTxid`.

A Pin Claim can be generated with this library:

```javascript
const pinObj = {
  cid: 'bafkreih7eeixbkyvabqdde4g5mdourjidxpsgf6bgz6f7ouxqr24stg6f4',
  filename: 'test.txt',
  fileSizeInMegabytes: 0.1
}

const {pobTxid, claimTxid} = await psffpp.createPinClaim(pinObj)
console.log('pobTxid: ', pobTxid)
console.log('claimTxid: ', claimTxid)

/*
pobTxid: f1ff81aaac7f755875306e31c9137b2bb010587feffeb4c7d42b462ef08db0df
claimTxid: db338fdb7edc6ce6685c9897a9d9fd6f0e26d194bf12e1c87470b7dc2103a3e3
*/
```

## Get Write Price History (PSF token burn — DEPRECATED)

The write price changs over time. This function returns an array of objects, where each object returns the price change and the block height the change went into effect.

```javascript
const writeHistory = await psffpp.getWritePriceHistory()
console.log(writeHistory)

/*
[
  { writePrice: 0.03570889, height: 893165 },
  { writePrice: 0.08335233, height: 780917 }
]
*/
```

# License
[MIT](LICENSE.md)
