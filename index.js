/*
  This library implement PS010 specification:
  https://github.com/Permissionless-Software-Foundation/specifications/blob/master/ps009-multisig-approval.md
*/

// global libraries
import MultisigApproval from 'psf-multisig-approval'

// Local libraries

// Constants
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
    this.createPinClaim = this.createPinClaim.bind(this)
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

  // Given information about a file, this function will generate a Pin Claim.
  // This function takes controls of the wallet and uses it to broadcast two
  // transactions: a Proof-of-Burn (pobTxid) and a Pin Claim (climTxid). The
  // function returns an object with the transaction ID of those two transacions.
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

      // Get info and libraries from the wallet.
      const addr = this.wallet.walletInfo.address
      targetAddr = addr
      const bchjs = this.wallet.bchjs
      const wif = this.wallet.walletInfo.privateKey

      // Calculate the write cost
      const dataCost = writePrice * fileSizeInMegabytes
      const minCost = writePrice
      let actualCost = minCost
      if (dataCost > minCost) actualCost = dataCost
      console.log(`Burning ${actualCost} PSF tokens for ${fileSizeInMegabytes} MB of data.`)

      const pobTxid = await this.wallet.burnTokens(actualCost, PSF_TOKEN_ID)
      // console.log(`Proof-of-burn TX: ${pobT  xid}`)

      // Wait for the indexer to update before get utxos.
      await this.bchjs.Util.sleep(6000)

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
      const hex = tx.toHex().toString()
      // console.log(`TX hex: ${hex}`)

      // Broadcast transation to the network
      const claimTxid = await this.wallet.broadcast({ hex })
      // console.log(`Claim Transaction ID: ${claimTxid}`)
      // console.log(`https://blockchair.com/bitcoin-cash/transaction/${claimTxid}`)

      return {
        pobTxid,
        claimTxid
      }
    } catch (err) {
      console.error(`Error in psffpp/createPinClaim() with target addr ${targetAddr}`)
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

// module.exports = PSFFPP
export default PSFFPP
