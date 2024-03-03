# psffpp

PSFFPP = [Permissionless Software Foundation](https://psfoundation.info) [File Pinning Protocol](https://psffpp.com).

This is an npm library for node.js. It implements the [PS010 specification for the PSF File Pinning Protocol](https://github.com/Permissionless-Software-Foundation/specifications/blob/master/ps009-multisig-approval.md). The main consumers of this library is:
- [p2wdb-image-upload-backend](https://github.com/Permissionless-Software-Foundation/p2wdb-image-upload-backend) uses it generate Pin Claims for file uploads as demonstrated at [upload.psfoundation.info](https://upload.psfoundation.info).
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

## Get the Write Price

Retrieve the current cost-per-megabyte in PSF tokens, for writing data to the network.

*Note: The minimum cost is 1MB, even if you upload a file smaller than that to the file pinning network.*

```javascript
const writePrice = await psffpp.getMcWritePrice()
console.log(writePrice)

/*
  0.08335233
*/
```

## Create a Pin Claim

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


# License
[MIT](LICENSE.md)
