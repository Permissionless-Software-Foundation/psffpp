/*
  Integration tests for the main library.
*/

// Global npm libraries
const SlpWallet = require('minimal-slp-wallet')
const assert = require('chai').assert

// Local libraries
const MultisigApproval = require('../../index')

describe('#psf-multisig-approval', () => {
  let uut

  before(async () => {
    const wallet = new SlpWallet(undefined, {
      interface: 'consumer-api',
      // restURL: 'https://bch-consumer-anacortes-wa-usa.fullstackcash.nl'
      restURL: 'https://free-bch.fullstack.cash'
    })
    await wallet.walletInfoPromise

    uut = new MultisigApproval({ wallet })
  })

  describe('#getNftHolderInfo', () => {
    it('should get address and pubkeys for Minting Council NFT holders', async () => {
      const result = await uut.getNftHolderInfo()
      // console.log('result: ', result)

      // Assert expected properties exist
      assert.property(result, 'keys')
      assert.property(result, 'keysNotFound')

      // Assert that each property is an array.
      assert.isArray(result.keys)
      assert.isArray(result.keysNotFound)
    })
  })

  describe('#createMultisigAddress', () => {
    it('should generate a multisig address from token holder info', async () => {
      const tokenHolderInfo = await uut.getNftHolderInfo()

      const keys = tokenHolderInfo.keys

      const result = await uut.createMultisigAddress({ keys })
      // console.log('result: ', result)

      assert.property(result, 'address')
      assert.property(result, 'scriptHex')
      assert.property(result, 'publicKeys')
      assert.property(result, 'requiredSigners')
    })
  })

  describe('#getApprovalTx', () => {
    it('should retrieve the latest APPROVAL transaction from an address', async () => {
      const address = 'bitcoincash:qrwe6kxhvu47ve6jvgrf2d93w0q38av7s5xm9xfehr'

      const result = await uut.getApprovalTx({ address })
      // const result = await uut.getApprovalTx({ address, filterTxids: ['a63f9fbcc901316e6e89f5a8caaad6b2ab268278b29866c6c22088bd3ab93900'] })
      // console.log('result: ', result)

      assert.equal(result.updateTxid.length, 64)
    })
  })

  describe('#getUpdateTx', () => {
    it('should retrieve an update transaction', async () => {
      const txid = 'f8ea1fcd4481adfd62c6251c6a4f63f3d5ac3d5fdcc38b350d321d93254df65f'

      const result = await uut.getUpdateTx({ txid })
      // console.log('result: ', result)

      // Assert returned object has expected properties
      assert.property(result, 'cid')
      assert.property(result, 'ts')
      assert.property(result, 'txid')
      assert.property(result, 'txDetails')
    })
  })

  describe('#getCidData', () => {
    it('should get JSON data from an IPFS gateway', async () => {
      const cid = 'bafybeib5d6s6t3tq4lhwp2ocvz7y2ws4czgkrmhlhv5y5aeyh6bqrmsxxi'
      const result = await uut.getCidData({ cid })
      // console.log('result: ', result)

      // Assert expected properties exist
      assert.property(result, 'groupId')
      assert.property(result, 'keys')
      assert.property(result, 'walletObj')
      assert.property(result, 'multisigAddr')
      assert.property(result, 'p2wdbWritePrice')
    })
  })

  describe('#validateApproval', () => {
    it('should validate a valid approval transaction', async () => {
      const address = 'bitcoincash:qrwe6kxhvu47ve6jvgrf2d93w0q38av7s5xm9xfehr'
      const approvalObj = await uut.getApprovalTx({ address })

      const txid = 'f8ea1fcd4481adfd62c6251c6a4f63f3d5ac3d5fdcc38b350d321d93254df65f'
      const updateObj = await uut.getUpdateTx({ txid })

      const cid = 'bafybeib5d6s6t3tq4lhwp2ocvz7y2ws4czgkrmhlhv5y5aeyh6bqrmsxxi'
      const updateData = await uut.getCidData({ cid })

      const inObj = { approvalObj, updateObj, updateData }
      const result = await uut.validateApproval(inObj)
      // console.log('result: ', result)

      assert.equal(result, true)
    })
  })
})
