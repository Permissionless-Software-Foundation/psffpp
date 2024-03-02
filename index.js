/*
  This library implement PS010 specification:
  https://github.com/Permissionless-Software-Foundation/specifications/blob/master/ps009-multisig-approval.md
*/

// global libraries
import MultisigApproval from 'psf-multisig-approval'
const bitcore = require('bitcore-lib-cash')
const axios = require('axios')

// Local libraries
const NFTs = require('./lib/nfts')
const UtilLib = require('./lib/util')

class PSFFPP {
  constructor (localConfig = {}) {
    // Dependency Injection
    this.wallet = localConfig.wallet
    if (!this.wallet) {
      throw new Error('Instance of minimal-slp-wallet must be passed in as a property called \'wallet\', when initializing the psf-multisig-approval library.')
    }

    // The default IPFS gateway can be overwritten by the user when this library
    // is instantiated.
    this.ipfsGateway = localConfig.ipfsGateway
    if (!this.ipfsGateway) {
      this.ipfsGateway = 'https://p2wdb-gateway-678.fullstack.cash'
    }

    // Encapsulate dependencies
    this.bchjs = this.wallet.bchjs
    this.bitcore = bitcore
    this.axios = axios
    this.nfts = new NFTs(localConfig)
    this.util = new UtilLib(localConfig)
    this.ps009 = null // placeholder for Multisig Approval library.

    // Bind the this object to all subfunctions in this class
    this.getNftHolderInfo = this.getNftHolderInfo.bind(this)
    this.createMultisigAddress = this.createMultisigAddress.bind(this)
    this.getApprovalTx = this.getApprovalTx.bind(this)

    this.createPinClaim = this.createPinClaim.bind(this)

    // Create a transaction details cache, to reduce the number of API calls.
    this.txCache = {}
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
      this.ps009 = new MultisigApproval({ wallet: this.wallet })

      // Get the cost in PSF tokens to store 1MB
      const writePrice = await this.adapters.writePrice.getMcWritePrice()

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

  // This function retrieves the NFTs associated with a Group token ID. It then
  // tries to retrieve the BCH addresses and public keys of the holders of those
  // NFTs. It returns an object with all that information in it.
  // The function defaults to the PSF Minting Council, but any Group token ID
  // can be used.
  async getNftHolderInfo (groupTokenId = '8e8d90ebdb1791d58eba7acd428ff3b1e21c47fb7aba2ba3b5b815aa0fe7d6d5') {
    try {
      // console.log('groupTokenId: ', groupTokenId)

      const nfts = await this.nfts.getNftsFromGroup()
      // console.log('getNftHolderInfo() nfts: ', nfts)

      const addrs = await this.nfts.getAddrsFromNfts(nfts)
      // console.log('getNftHolderInfo() addrs: ', addrs)

      const { keys, keysNotFound } = await this.nfts.findKeys(addrs, nfts)

      return { keys, keysNotFound }
    } catch (err) {
      console.error('Error in getNftHolderInfo()')
      throw err
    }
  }

  // Generate a P2SH multisignature wallet from the public keys of the NFT holders.
  // The address for the wallet is returned.
  // The input for this function should be the `keys` output from
  // getNftHolderInfo()
  createMultisigAddress (inObj = {}) {
    try {
      const { keys } = inObj
      let requiredSigners = inObj.requiredSigners

      // Input validation
      if (!Array.isArray(keys)) {
        throw new Error('keys must be an array containing public keys')
      }

      // Isolate just an array of public keys.
      const pubKeys = []
      for (let i = 0; i < keys.length; i++) {
        const thisPair = keys[i]

        pubKeys.push(thisPair.pubKey)
      }

      // If the number of required signers is not specified, then default to
      // a 50% + 1 threashold.
      if (!requiredSigners) {
        requiredSigners = Math.floor(pubKeys.length / 2) + 1
      }

      // Multisig Address
      const msAddr = new bitcore.Address(pubKeys, requiredSigners)

      // Locking Script in hex representation.
      const scriptHex = new bitcore.Script(msAddr).toHex()

      const walletObj = {
        address: msAddr.toString(),
        scriptHex,
        publicKeys: pubKeys,
        requiredSigners
      }

      return walletObj
    } catch (err) {
      console.error('Error in createMultisigWallet()')
      throw err
    }
  }

  // Given a BCH address, scan its transaction history to find the latest
  // APPROVAL transaction. This function returns the TXID of the UPDATE
  // transaction that the APPROVAL transaction approves.
  // If no APPROVAL transaction can be found, then function returns null.
  // An optional input, filterTxids, is an array of transaction IDs to ignore. This can
  // be used to ignore/skip any known, fake approval transactions.
  async getApprovalTx (inObj = {}) {
    try {
      let address = inObj.address
      const { filterTxids } = inObj

      // Input validation
      if (address.includes('simpleledger:')) {
        address = this.bchjs.SLP.Address.toCashAddress(address)
      }
      if (!address.includes('bitcoincash:')) {
        throw new Error('Input address must start with bitcoincash: or simpleledger:')
      }

      // Get the transaction history for the address
      const txHistory = await this.wallet.getTransactions(address)
      // console.log('txHistory: ', JSON.stringify(txHistory, null, 2))

      // Loop through the transaction history
      for (let i = 0; i < txHistory.length; i++) {
        const thisTxid = txHistory[i]

        // const height = thisTxid.height
        const txid = thisTxid.tx_hash

        // Skip the txid if it is in the filter list.
        if (Array.isArray(filterTxids)) {
          const txidFound = filterTxids.find(x => x === txid)
          // console.log('txidFound: ', txidFound)
          if (txidFound) {
            continue
          }
        }

        // Get the transaction details for the transaction
        const txDetails = await this.util.getTxData(txid)
        // console.log('txDetails: ', JSON.stringify(txDetails, null, 2))
        // console.log(`txid: ${txid}`)

        const out2ascii = Buffer.from(txDetails.vout[0].scriptPubKey.hex, 'hex').toString('ascii')
        // console.log('out2ascii: ', out2ascii)

        // If the first output is not an OP_RETURN, then the tx can be discarded.
        if (!out2ascii.includes('APPROVE')) {
          continue
        }

        const updateTxid = out2ascii.slice(10)
        // console.log('updateTxid: ', updateTxid)

        const outObj = {
          approvalTxid: txid,
          updateTxid,
          approvalTxDetails: txDetails,
          opReturn: out2ascii
        }

        return outObj
      }

      return null
    } catch (err) {
      console.error('Error in getApprovedData()')
      throw err
    }
  }

  // This function will retrieve an update transaction, given its txid. It will
  // return an object with data about the transaction, including the CID and
  // timestamp values encoded in the transactions OP_RETURN.
  async getUpdateTx (inObj = {}) {
    try {
      const { txid } = inObj

      // Input validation
      if (!txid) {
        throw new Error('txid required')
      }

      // Get the transaction details for the transaction
      const txDetails = await this.util.getTxData(txid)
      // console.log('txDetails: ', JSON.stringify(txDetails, null, 2))
      // console.log(`txid: ${txid}`)

      let updateObj = {}
      try {
        const out2ascii = Buffer.from(txDetails.vout[0].scriptPubKey.hex, 'hex').toString('ascii')
        // console.log('out2ascii: ', out2ascii)

        const jsonStr = out2ascii.slice(4)
        // console.log('jsonStr: ', jsonStr)

        updateObj = JSON.parse(jsonStr)
      } catch (err) {
        throw new Error('Could not parse JSON inside the transaction')
      }

      updateObj.txid = txid
      updateObj.txDetails = txDetails

      return updateObj
    } catch (err) {
      console.error('Error in getUpdateTx()')
      throw err
    }
  }

  // Given an CID, this function will retrieve the update data from an IPFS
  // gateway.
  async getCidData (inObj = {}) {
    try {
      const { cid } = inObj

      // Input validation
      if (!cid) {
        throw new Error('cid a required input')
      }

      const urlStr = `${this.ipfsGateway}/ipfs/${cid}/data.json`
      // console.log('urlStr: ', urlStr)

      const request = await this.axios.get(urlStr)

      return request.data
    } catch (err) {
      console.error('Error in getCidData()')
      throw err
    }
  }

  // This function will validate the approval transaction.
  // This function will return true or false, to indicate the validity of the
  // approval transaction.
  // The input to this function is the output of several of the above function:
  // - approvalObj is the output of getApprovalTx()
  // - updateObj is the output of getUpdateTx()
  // - updateData is the IPFS CID data retrieved with getCidData()
  // - groupTokenId is optional. If not specified, it will default to the Group
  //   token used to generate the PSF Minting Council NFTs.
  async validateApproval (inObj = {}) {
    try {
      // console.log('inObj: ', JSON.stringify(inObj, null, 2))

      const { approvalObj, updateObj, updateData, groupTokenId } = inObj

      let validationResult = false

      // Input validation
      if (!approvalObj) {
        throw new Error('Output object of getApprovalTx() is expected as input to this function, as \'approvalObj\'')
      }
      if (!updateObj) {
        throw new Error('Output object of getUpdateTx() is expected as input to this function, as \'updateObj\'')
      }
      if (!updateData) {
        throw new Error('Update CID JSON data is expected as input to this function, as \'updateData\'')
      }

      // Regenerate the multisig address from the pubkeys in the update data.
      // Ensure it matches the input address to the approval transaction.
      const pubKeys = updateData.walletObj.publicKeys
      const requiredSigners = updateData.walletObj.requiredSigners
      const approvalInputAddr = approvalObj.approvalTxDetails.vin[0].address
      const msAddr = new this.bitcore.Address(pubKeys, requiredSigners).toString()
      if (msAddr !== approvalInputAddr) {
        console.log(`Approval TX input address (${approvalInputAddr}) does not match calculated multisig address ${msAddr}`)
        return validationResult
      }

      // Get public key data for each NFT holder, from the blockchain.
      const nftData = await this.getNftHolderInfo(groupTokenId)
      const tokenPubKeys = nftData.keys

      // Loop through the public keys from the token data, and count the matches.
      let matches = 0
      for (let i = 0; i < tokenPubKeys.length; i++) {
        const thisTokenPubKey = tokenPubKeys[i].pubKey

        // Loop through the public keys from the update data
        for (let j = 0; j < pubKeys.length; j++) {
          const thisUpdatePubKey = pubKeys[j]

          if (thisTokenPubKey === thisUpdatePubKey) {
            matches++
            break
          }
        }
      }

      // Set a threshold for success.
      let threshold = 2 // Minimum
      if (requiredSigners > threshold) threshold = requiredSigners

      // If the threshold of public keys match, then the approval transaction
      // has been validated.
      if (matches >= threshold) {
        validationResult = true
      }

      return validationResult
    } catch (err) {
      console.error('Error in validateApproval()')
      throw err
    }
  }
}

module.exports = PSFFPP
