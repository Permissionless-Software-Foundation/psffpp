/*
  This library implement PS010 specification:
  https://github.com/Permissionless-Software-Foundation/specifications/blob/master/ps009-multisig-approval.md
*/

// global libraries
import MultisigApproval from 'psf-multisig-approval'

// Local libraries

// Constants

// Lokad of a Pin Claim OP_RETURN (PS010 §5.1). The script prefix of a valid
// claim is `6a04` + this value.
const CLAIM_LOKAD = '00510000'

// Bytes in a megabyte, per PS010 §3 (decimal MB, not MiB).
const BYTES_PER_MB = 1000000

// The locked minimum charge, expressed in bytes: 100 KB (PS010 §3).
const MIN_CHARGE_BYTES = 100000

// BCH standard dust limit. An output below this value is uneconomical to
// spend and relaying nodes refuse to broadcast it ("dust" rejection). A
// pricing floor below the dust limit would quote amounts that could never be
// paid, so the minimum charge is always at least this many satoshis.
const DUST_SATS = 546

const PSF_HARDCODE_WRITE_PRICE = 0.03570889
const WRITE_PRICE_ADDR = 'bitcoincash:qrwe6kxhvu47ve6jvgrf2d93w0q38av7s5xm9xfehr'
const PSF_HARDCODE_WRITE_PRICE_HISTORY = [
  {
    writePrice: 0.03570889,
    height: 893165
  },
  {
    writePrice: 0.08335233,
    blockHeight: 780917
  }
]

class PSFFPP {
  constructor (localConfig = {}) {
    // Dependency Injection
    this.wallet = localConfig.wallet
    if (!this.wallet) {
      throw new Error('Instance of minimal-slp-wallet must be passed in as a property called \'wallet\', when initializing the psf-multisig-approval library.')
    }

    // Allow user to pass in alternative IPFS gateway.
    this.ipfsGateway = localConfig.ipfsGateway
    if (!this.ipfsGateway) {
      this.ipfsGateway = 'https://free-bch.fullstack.cash'
    }

    // Encapsulate dependencies
    this.bchjs = this.wallet.bchjs
    this.ps009 = null // placeholder for Multisig Approval library.

    // Bind the this object to all subfunctions in this class
    this._initPs009 = this._initPs009.bind(this)
    this._buildClaimScript = this._buildClaimScript.bind(this)
    this._broadcastClaim = this._broadcastClaim.bind(this)
    this.createPinClaim = this.createPinClaim.bind(this)
    this.createPinClaimBCH = this.createPinClaimBCH.bind(this)
    this.getMcWritePrice = this.getMcWritePrice.bind(this)
    this.getWritePriceHistory = this.getWritePriceHistory.bind(this)

    // State
    this.currentWritePrice = null
    this.priceRetrievalSucceeded = false
    this.currentWritePriceHistory = null
    this.priceHistoryRetrievalSucceeded = false
    this.filterTxids = []
  }

  // Initialize the PS009 Multisig Approval library if it hasn't already been
  // initialized.
  async _initPs009 () {
    if (!this.ps009) {
      const inObj = {
        wallet: this.wallet,
        ipfsGateway: this.ipfsGateway
      }
      // console.log('inObj: ', inObj)
      this.ps009 = new MultisigApproval(inObj)
    }

    return true
  }

  // Build the OP_RETURN script of a Pin Claim:
  //   OP_RETURN | 00510000 | paymentTxid(32B) | cid | filename
  //
  // PS010 §5.1-5.2: field 2 is the raw 32 bytes of the BCH payment txid that
  // paid for the pin. Both the (deprecated) PSF proof-of-burn path and the BCH
  // payment path go through this helper, so the two cannot diverge.
  //
  // Returns the compiled script, as a Buffer (scriptPubKey of vout[0]).
  _buildClaimScript (inObj = {}) {
    const { paymentTxid, cid, filename } = inObj

    // Input validation
    if (!paymentTxid) {
      throw new Error('paymentTxid required to build a pin claim.')
    }
    if (typeof paymentTxid !== 'string' || !/^[0-9a-fA-F]{64}$/.test(paymentTxid)) {
      throw new Error(`paymentTxid must be a 32 byte (64 hex character) txid. Got: ${paymentTxid}`)
    }
    if (!cid) {
      throw new Error('cid required to generate pin claim.')
    }
    if (!filename) {
      throw new Error('filename required to generate pin claim.')
    }

    // The OP_RETURN, with the payment txid in field 2.
    const script = [
      this.bchjs.Script.opcodes.OP_RETURN,
      Buffer.from(CLAIM_LOKAD, 'hex'),
      Buffer.from(paymentTxid, 'hex'),
      Buffer.from(cid),
      Buffer.from(filename)
    ]

    // Compile the script array into a bitcoin-compliant script Buffer.
    const data = this.bchjs.Script.encode(script)

    return data
  }

  // Build, sign, and broadcast a Pin Claim transaction that carries the claim
  // OP_RETURN for the given payment txid.
  //
  // This helper takes control of the wallet: it spends the biggest BCH UTXO of
  // the wallet and sends the remainder back to the wallet address. It returns
  // the claim txid. It does no pricing, and it does not move any tokens.
  async _broadcastClaim (inObj = {}) {
    const { paymentTxid, cid, filename } = inObj

    // Build the claim OP_RETURN. Input validation happens in _buildClaimScript().
    const data = this._buildClaimScript({ paymentTxid, cid, filename })

    const bchjs = this.bchjs
    const addr = this.wallet.walletInfo.address
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

    // Add the OP_RETURN output.
    transactionBuilder.addOutput(data, 0)

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
    const hex = tx.toHex().toString()
    // console.log(`TX hex: ${hex}`)

    // Broadcast transation to the network
    const claimTxid = await this.wallet.broadcast({ hex })
    // console.log(`Claim Transaction ID: ${claimTxid}`)
    // console.log(`https://blockchair.com/bitcoin-cash/transaction/${claimTxid}`)

    return claimTxid
  }

  // Given information about a file, this function will generate a Pin Claim.
  // This function takes controls of the wallet and uses it to broadcast two
  // transactions: a Proof-of-Burn (pobTxid) and a Pin Claim (claimTxid). The
  // function returns an object with the transaction ID of those two transacions.
  //
  // @deprecated PS010 v2.0.0 removes PSF proof-of-burn as a payment method
  // (spec §8.2). Use createPinClaimBCH() instead: the user pays sats to the
  // pin-service payout address, and that payment txid goes in field 2 of the
  // claim. This burn path is retained only until it is deleted in M5.
  async createPinClaim (inObj = {}) {
    let targetAddr

    try {
      const { cid, filename, fileSizeInMegabytes } = inObj

      // Input validation
      if (!cid) {
        throw new Error('cid required to generate pin claim.')
      }
      if (!filename) {
        throw new Error('filename required to generate pin claim.')
      }
      if (!fileSizeInMegabytes) {
        throw new Error('fileSizeInMegabytes size in megabytes required to generate pin claim.')
      }

      // Initialize the wallet
      await this.wallet.initialize()

      // Initialize the PS009 library
      await this._initPs009()

      // Get the cost in PSF tokens to store 1MB
      // const writePrice = await this.getMcWritePrice()
      const writePrice = await this.wallet.getPsfWritePrice()

      // Create a proof-of-burn (PoB) transaction
      // const WRITE_PRICE = 0.08335233 // Cost in PSF tokens to pin 1MB
      const PSF_TOKEN_ID = '38e97c5d7d3585a2cbf3f9580c82ca33985f9cb0845d4dcce220cb709f9538b0'

      // Get the address of the wallet.
      const addr = this.wallet.walletInfo.address
      targetAddr = addr

      // Calculate the write cost
      const dataCost = writePrice * fileSizeInMegabytes
      const minCost = writePrice
      let actualCost = minCost
      if (dataCost > minCost) actualCost = dataCost
      console.log(`Burning ${actualCost} PSF tokens for ${fileSizeInMegabytes} MB of data.`)

      const pobTxid = await this.wallet.burnTokens(actualCost, PSF_TOKEN_ID)
      // console.log(`Proof-of-burn TX: ${pobTxid}`)

      // Wait for the indexer to update before get utxos.
      await this.bchjs.Util.sleep(6000)

      // Generate the Pin Claim TX, with the proof-of-burn txid in field 2.
      const claimTxid = await this._broadcastClaim({ paymentTxid: pobTxid, cid, filename })

      return {
        pobTxid,
        claimTxid
      }
    } catch (err) {
      console.error(`Error in psffpp/createPinClaim() with target addr ${targetAddr}`)
      throw err
    }
  }

  // Generate a Pin Claim that references a BCH payment (PS010 v2.0.0 §5-6).
  //
  // The user has already paid the required sats to the pin-service payout
  // address; `paymentTxid` is that payment transaction. This function builds
  // and broadcasts the claim OP_RETURN with the payment txid in field 2.
  //
  // There is no pricing and no token logic here: the amount paid is validated
  // by the pin-service (spec §7), not by the client.
  //
  // Returns { paymentTxid, claimTxid }.
  async createPinClaimBCH (inObj = {}) {
    try {
      const { cid, filename, paymentTxid } = inObj

      // Input validation
      if (!cid) {
        throw new Error('cid required to generate pin claim.')
      }
      if (!filename) {
        throw new Error('filename required to generate pin claim.')
      }
      if (!paymentTxid) {
        throw new Error('paymentTxid required to generate a BCH pin claim.')
      }

      // Initialize the wallet, so the claim TX can be funded.
      await this.wallet.initialize()

      // Build, sign, and broadcast the claim TX.
      const claimTxid = await this._broadcastClaim({ paymentTxid, cid, filename })

      return {
        paymentTxid,
        claimTxid
      }
    } catch (err) {
      console.error('Error in psffpp/createPinClaimBCH()')
      throw err
    }
  }

  // Get the write price set by the PSF Minting Council.
  // This function assumes the transaction history retrieved from the Cash
  // Stack is sorted in descending order with the biggest (newest) block
  // in the first element in the transaction history array.
  async getMcWritePrice () {
    // Hard codeded value. 3/2/24
    // This value is returned if there are any issues returning the write price.
    // It should be higher than actual fee, so that any writes will propegate to
    // the nodes that successfully retrieved the current write price.
    let writePrice = PSF_HARDCODE_WRITE_PRICE

    try {
      // Return the saved write price if this function has already been called once.
      if (this.currentWritePrice && this.priceRetrievalSucceeded) return this.currentWritePrice

      await this._initPs009()

      // Find the PS009 approval transaction the addresses tx history.
      console.log('\nSearching blockchain for updated write price...')
      const approvalObj = await this.ps009.getApprovalTx({
        address: WRITE_PRICE_ADDR,
        filterTxids: this.filterTxids
      })
      // console.log('approvalObj: ', JSON.stringify(approvalObj, null, 2))

      // Throw an error if no approval transaction can be found in the
      // transaction history.
      if (approvalObj === null) {
        throw new Error(`APPROVAL transaction could not be found in the TX history of ${WRITE_PRICE_ADDR}. Can not reach consensus on write price.`)
      }

      const { approvalTxid, updateTxid } = approvalObj
      console.log(`New approval txid found (${approvalTxid}), validating...`)

      // Get the CID from the update transaction.
      const updateObj = await this.ps009.getUpdateTx({ txid: updateTxid })
      // console.log(`updateObj: ${JSON.stringify(updateObj, null, 2)}`)
      const { cid } = updateObj

      // Resolve the CID into JSON data from the IPFS gateway.
      const updateData = await this.ps009.getCidData({ cid })
      // console.log(`updateData: ${JSON.stringify(updateData, null, 2)}`)

      // Validate the approval transaction
      const approvalIsValid = await this.ps009.validateApproval({
        approvalObj,
        updateObj,
        updateData
      })

      if (approvalIsValid) {
        console.log('Approval TX validated.')
        // console.log('updateData: ', updateData)

        // Return the write price from the update data.
        writePrice = updateData.p2wdbWritePrice || updateData.writePrice

        this.priceRetrievalSucceeded = true
      } else {
        // Approval transaction failed validation.
        console.log(`Approval TX was found to be invalid: ${approvalTxid}`)

        // Add this invalid TXID to the filter array so that it is skipped.
        this.filterTxids.push(approvalTxid)

        // Continue looking for the correct approval transaction by recursivly
        // calling this function.
        writePrice = await this.getMcWritePrice()
      }
    } catch (err) {
      console.error('Error in getMcWritePrice(): ', err)
      console.log(`Using hard-coded, safety value of ${writePrice} PSF tokens per write.`)
    }

    // Save the curent write price to the state.
    if (this.priceRetrievalSucceeded) {
      this.currentWritePrice = writePrice
    }
    return writePrice
  }

  // Get the write price history from the PSF Minting Council.
  // Where getMcWritePrice() gets the current write price, this function
  // returns an array of objects. Each object contains a validated
  // price change, and the block height when the change took effect.
  async getWritePriceHistory () {
    // Hard codeded value. 3/2/24
    // This value is returned if there are any issues returning the write price.
    // It should be higher than actual fee, so that any writes will propagate to
    // the nodes that successfully retrieved the current write price.
    // let writePrice = PSF_HARDCODE_WRITE_PRICE
    const writePriceHistory = []

    try {
      // Return the saved write price if this function has already been called once.
      if (this.currentWritePriceHistory && this.priceHistoryRetrievalSucceeded) {
        return this.currentWritePriceHistory
      }

      await this._initPs009()

      // Find the PS009 approval transaction the addresses tx history.
      console.log('\nSearching blockchain for PSF write price update history...')
      const approvals = await this.ps009.getAllApprovalTxs({
        address: WRITE_PRICE_ADDR,
        filterTxids: this.filterTxids
      })
      // console.log('approvals: ', JSON.stringify(approvals, null, 2))

      // Throw an error if no approval transaction can be found in the
      // transaction history.
      if (!approvals || !approvals.length) {
        throw new Error(`APPROVAL transaction could not be found in the TX history of ${WRITE_PRICE_ADDR}. Can not reach consensus on write price.`)
      }

      for (let i = 0; i < approvals.length; i++) {
        const approvalObj = approvals[i]

        // Retrieve the block height for the transaction. This data was made
        // available in bch-api 2.6.2.
        const height = approvalObj.approvalTxDetails.height
        if (!height) {
          throw new Error('TX block height not available. Be sure your back end is using bch-api 2.6.2 or later.')
        }

        const { approvalTxid, updateTxid } = approvalObj
        console.log(`Validating approval txid ${approvalTxid}...`)

        // Get the CID from the update transaction.
        const updateObj = await this.ps009.getUpdateTx({ txid: updateTxid })
        // console.log(`updateObj: ${JSON.stringify(updateObj, null, 2)}`)
        const { cid } = updateObj

        // Resolve the CID into JSON data from the IPFS gateway.
        const updateData = await this.ps009.getCidData({ cid })
        // console.log(`updateData: ${JSON.stringify(updateData, null, 2)}`)

        // Validate the approval transaction
        const approvalIsValid = await this.ps009.validateApproval({
          approvalObj,
          updateObj,
          updateData
        })

        if (approvalIsValid) {
          console.log('Approval TX validated.')
          // console.log('updateData: ', updateData)

          // Return the write price from the update data.
          const writePrice = updateData.p2wdbWritePrice || updateData.writePrice

          const entry = {
            writePrice,
            height
          }

          writePriceHistory.push(entry)
          console.log(`writePriceHistory: ${JSON.stringify(writePriceHistory, null, 2)}`)
        } else {
          // Approval transaction failed validation.
          console.log(`Approval TX was found to be invalid: ${approvalTxid}`)

          // Add this invalid TXID to the filter array so that it is skipped.
          this.filterTxids.push(approvalTxid)
        }
      }

      this.priceHistoryRetrievalSucceeded = true
      this.currentWritePriceHistory = writePriceHistory

      return writePriceHistory
    } catch (err) {
      console.error('Error in getWritePriceHistory(): ', err)
      console.log('Returning hard-coded write price history.')
      return PSF_HARDCODE_WRITE_PRICE_HISTORY
    }
  }
}

// Fee schedule math for PS010 v2.0.0 (BCH payment model).
//
//   requiredSatsBCH({ fileSizeBytes, satsPerMb }) =
//       max( ceil( fileSizeBytes / 1e6 * satsPerMb ),
//            ceil( 0.1 * satsPerMb ),
//            546 )
//
// The second term is the locked 100 KB minimum charge (PS010 §3). The floor is a
// pricing rule that lives inside this helper; callers MUST NOT re-derive a floor
// of their own. The third term dust-bounds the floor: a quote below the BCH dust
// limit (546 sats) can never be paid, because the broadcast node rejects it.
// Operators who set satsPerMb low enough that the 100 KB charge sits under the
// dust limit still get a spendable quote.
//
// NOTE: PS010 §3 defines this function once, in the shared psffpp-payments
// library, and has both the announcer and the pin-service import it from there.
// Until that library ships, this is the client-side copy of the same definition
// (the pin-service carries its own copy of the identical formula). Do not let
// the two drift: the unit tests pin the floor boundaries and the integer-math
// behaviour.
export function requiredSatsBCH (inObj = {}) {
  const { fileSizeBytes, satsPerMb } = inObj

  // Input validation. Throw rather than quoting a NaN/undefined price.
  if (typeof fileSizeBytes !== 'number' || !Number.isFinite(fileSizeBytes) || fileSizeBytes < 0) {
    throw new Error('requiredSatsBCH() fileSizeBytes must be a finite number >= 0')
  }
  if (typeof satsPerMb !== 'number' || !Number.isFinite(satsPerMb) || satsPerMb <= 0) {
    throw new Error('requiredSatsBCH() satsPerMb must be a finite number > 0')
  }

  // Metered charge. Integer multiplication first, to avoid floating point drift
  // (e.g. 100000 / 1e6 * 2000 = 200.00000000000003 in IEEE 754, which would
  // ceil to 201 and overcharge a file that is exactly 100 KB).
  const meteredSats = Math.ceil((fileSizeBytes * satsPerMb) / BYTES_PER_MB)

  // 100 KB minimum charge. Same trick: satsPerMb / 10, not 0.1 * satsPerMb.
  // The floor is additionally bounded below by the dust limit, so that a
  // low satsPerMb can never produce an unpayable quote.
  const floorSats = Math.max(
    Math.ceil(satsPerMb / (BYTES_PER_MB / MIN_CHARGE_BYTES)),
    DUST_SATS
  )

  return Math.max(meteredSats, floorSats)
}

// Also expose the fee-schedule helper as a static property of the class, so
// that consumers which only import the default export can reach it without a
// named import.
PSFFPP.requiredSatsBCH = requiredSatsBCH

// module.exports = PSFFPP
export default PSFFPP
