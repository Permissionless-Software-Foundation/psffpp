/*
  This library implement PS010 specification:
  https://github.com/Permissionless-Software-Foundation/specifications/blob/master/ps009-multisig-approval.md
*/

// global libraries
import MultisigApproval from 'psf-multisig-approval'

// Local libraries

class PSFFPP {
  constructor (localConfig = {}) {
    // Dependency Injection
    this.wallet = localConfig.wallet
    if (!this.wallet) {
      throw new Error('Instance of minimal-slp-wallet must be passed in as a property called \'wallet\', when initializing the psf-multisig-approval library.')
    }

    // Encapsulate dependencies
    this.bchjs = this.wallet.bchjs
    this.ps009 = null // placeholder for Multisig Approval library.

    // Bind the this object to all subfunctions in this class
    this.initPs009 = this.initPs009.bind(this)
    this.createPinClaim = this.createPinClaim.bind(this)
  }

  // Initialize the PS009 Multisig Approval library if it hasn't already been
  // initialized.
  async initPs009 () {
    if (!this.ps009) {
      this.ps009 = new MultisigApproval({ wallet: this.wallet })
    }

    return true
  }

  // Given information about a file, this function will generate a Pin Claim,
  // and return the transaction hex that can then be broadcast to the network.
  async createPinClaim (inObj = {}) {
    try {
      const { cid, filename, fileSizeInMegabytes } = inObj

      // Input validation
      if (!cid) {
        throw new Error('File CID required to generate pin claim.')
      }
      if (!filename) {
        throw new Error('Filename required to generate pin claim.')
      }
      if (!fileSizeInMegabytes) {
        throw new Error('File size in megabytes required to generate pin claim.')
      }

      // Initialize the wallet
      await this.wallet.initialize()

      // Initialize the PS009 library
      await this.initPs009()

      // Get the cost in PSF tokens to store 1MB
      const writePrice = await this.ps009.getMcWritePrice()

      // Create a proof-of-burn (PoB) transaction
      // const WRITE_PRICE = 0.08335233 // Cost in PSF tokens to pin 1MB
      const PSF_TOKEN_ID = '38e97c5d7d3585a2cbf3f9580c82ca33985f9cb0845d4dcce220cb709f9538b0'

      // Calculate the write cost
      const dataCost = writePrice * fileSizeInMegabytes
      const minCost = writePrice
      let actualCost = minCost
      if (dataCost > minCost) actualCost = dataCost
      console.log(`Burning ${actualCost} PSF tokens for ${fileSizeInMegabytes} MB of data.`)

      const pobTxid = await this.wallet.burnTokens(actualCost, PSF_TOKEN_ID)
      console.log(`Proof-of-burn TX: ${pobTxid}`)

      // Get info and libraries from the wallet.
      const addr = this.wallet.walletInfo.address
      const bchjs = this.wallet.bchjs
      const wif = this.wallet.walletInfo.privateKey

      // Get a UTXO to spend to generate the pin claim TX.
      let utxos = await this.wallet.getUtxos()
      utxos = utxos.bchUtxos
      const utxo = bchjs.Utxo.findBiggestUtxo(utxos)

      // instance of transaction builder
      const transactionBuilder = new bchjs.TransactionBuilder()

      const originalAmount = utxo.value
      const vout = utxo.tx_pos
      const txid = utxo.tx_hash

      // add input with txid and index of vout
      transactionBuilder.addInput(txid, vout)

      // TODO: Compute the 1 sat/byte fee.
      const fee = 500

      // BEGIN - Construction of OP_RETURN transaction.

      // Add the OP_RETURN to the transaction.
      const script = [
        bchjs.Script.opcodes.OP_RETURN,
        Buffer.from('00510000', 'hex'),
        Buffer.from(pobTxid, 'hex'),
        Buffer.from(cid),
        Buffer.from(filename)
      ]

      // Compile the script array into a bitcoin-compliant hex encoded string.
      const data = bchjs.Script.encode(script)

      // Add the OP_RETURN output.
      transactionBuilder.addOutput(data, 0)

      // END - Construction of OP_RETURN transaction.

      // Send the same amount - fee.
      transactionBuilder.addOutput(addr, originalAmount - fee)

      // Create an EC Key Pair from the user-supplied WIF.
      const ecPair = bchjs.ECPair.fromWIF(wif)

      // Sign the transaction with the HD node.
      let redeemScript
      transactionBuilder.sign(
        0,
        ecPair,
        redeemScript,
        transactionBuilder.hashTypes.SIGHASH_ALL,
        originalAmount
      )

      // build tx
      const tx = transactionBuilder.build()

      // output rawhex
      const hex = tx.toHex()
      // console.log(`TX hex: ${hex}`);
      // console.log(` `);

      return hex
    } catch (err) {
      console.error('Error in ps010/createPinClaim()')
      throw err
    }
  }
}

// module.exports = PSFFPP
export default PSFFPP
