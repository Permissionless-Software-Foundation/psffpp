/*
  Generic utility functions that might be used in multiple places of the library.
*/

class UtilLib {
  constructor (localConfig = {}) {
    // Dependecy Injection
    this.wallet = localConfig.wallet
    if (!this.wallet) {
      throw new Error('Instance of minimal-slp-wallet must be passed in as a property called \'wallet\', when initializing the util library.')
    }

    // Bind the 'this' object to all subfunctions.
    this.getTxData = this.getTxData.bind(this)

    // Create a transaction details cache, to reduce the number of API calls.
    this.txCache = {}
  }

  // Given a transaction ID, retrieve the transaction details. If the details
  // have already been downloaded, then they will be stored in a local cache.
  // The cache speeds things up and reduces the number of API calls.
  async getTxData (txid) {
    try {
      if (!txid) {
        throw new Error('txid (transactoin ID) required')
      }

      // Try to get the transaction details from the cache
      let txDetails = this.txCache[txid]

      // Download from the full node if details are not in the cache.
      if (!txDetails) {
        // Get the transaction details from the full node
        txDetails = await this.wallet.getTxData([txid])
        txDetails = txDetails[0]

        // Add the details to the cache
        this.txCache[txid] = txDetails
      }

      return txDetails
    } catch (err) {
      console.error('Error in getTxData()')
      throw err
    }
  }
}

module.exports = UtilLib
