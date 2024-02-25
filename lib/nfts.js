/*
  This library contains code for handling NFT and Group SLP tokens. Specifically
  it has functions around looking up the NFTs related to a Group token, then
  retrieving data on the holders of those NFTs.
*/

class NFTs {
  constructor (localConfig = {}) {
    this.wallet = localConfig.wallet
    if (!this.wallet) {
      throw new Error('Instance of minimal-slp-wallet must be passed in as a property called \'wallet\', when initializing the nfts.js library.')
    }
  }

  // Retrieve a list of NFTs from the Group token that spawned them.
  // The default value is the PSF Minting Council Group token.
  async getNftsFromGroup (groupId = '8e8d90ebdb1791d58eba7acd428ff3b1e21c47fb7aba2ba3b5b815aa0fe7d6d5') {
    try {
      const groupData = await this.wallet.getTokenData(groupId)
      // console.log('groupData: ', groupData)

      const nfts = groupData.genesisData.nfts

      return nfts
    } catch (err) {
      console.error('Error in getNftsFromGroup()')
      throw err
    }
  }

  // This function expects an array of strings as input. Each element in the
  // input array is expected to be the Token ID of the an NFT. The address
  // holding each NFT is looked up on the blockchain. The array of returned
  // addresses are filtered for duplicates, before being returned.
  async getAddrsFromNfts (nfts = []) {
    try {
      let addrs = []

      // Loop through each NFT Token ID in the array.
      for (let i = 0; i < nfts.length; i++) {
        const thisNft = nfts[i]

        // console.log('getAddrsFromNfts() this.wallet.bchjs.restURL: ', this.wallet.bchjs.restURL)

        const nftData = await this.wallet.getTokenData(thisNft, true)
        // console.log('getAddrsFromNfts() nftData: ', nftData)

        if (!nftData.genesisData.nftHolder) {
          throw new Error(`SLP indexer data does not include a holder address for this NFT. nftData: ${JSON.stringify(nftData, null, 2)}`)
        }

        addrs.push(nftData.genesisData.nftHolder)
      }

      // Remove duplicate addresses
      addrs = [...new Set(addrs)]

      return addrs
    } catch (err) {
      console.error('Error in getAddrsFromNfts(): ', err)
      throw err
    }
  }

  // The input to this function is the output of getNftsFromGroup() and
  // getAddrsFromNfts(). It expects two arrays of strings, one an array of
  // NFT Token IDs, the other an array of addresses holding those NFTs.
  //
  // For each address, it attempts to lookup the public key for that address.
  // It returns an object with a keys and keysNotFound property:
  // - keys - Object containing address and public key
  // - keysNotFound - Array of addresses whos public keys could not be found.
  async findKeys (addrs, nfts) {
    // It is assumed that element 1 in the addrs array is associated with
    // element 1 in the nfts array.

    try {
      const keys = []
      const keysNotFound = []

      for (let i = 0; i < addrs.length; i++) {
        const thisAddr = addrs[i]
        const thisNft = nfts[i]

        // console.log('findKeys() thisAddr: ', thisAddr)
        // console.log('this.wallet: ', this.wallet)
        // console.log('this.wallet.interface: ', this.wallet.interface)
        // console.log('this.wallet.restURL: ', this.wallet.restURL)

        // Get public Key for reciever from the blockchain.
        const publicKey = await this.wallet.getPubKey(thisAddr)
        // console.log(`publicKey: ${JSON.stringify(publicKey, null, 2)}`)

        if (publicKey.includes('not found')) {
          keysNotFound.push(thisAddr)
        } else {
          keys.push({
            addr: thisAddr,
            pubKey: publicKey,
            nft: thisNft
          })
        }
      }

      return { keys, keysNotFound }
    } catch (err) {
      console.error('Error in findKeys()')
      throw err
    }
  }
}

module.exports = NFTs
