/*
  Unit tests for the main index.js library file.
*/

// npm libraries
const assert = require('chai').assert
const sinon = require('sinon')
const cloneDeep = require('lodash.clonedeep')
const SlpWallet = require('minimal-slp-wallet')

// Mocking data libraries.

// Local libraries
const MultisigApproval = require('../../index')
const mockDataLib = require('./mocks/main-index-mocks')

describe('#MultisigApproval.js', () => {
  let sandbox
  let mockData
  let uut
  let wallet

  before(async () => {
    wallet = new SlpWallet(undefined, { interface: 'consumer-api' })
    await wallet.walletInfoPromise
  })

  beforeEach(() => {
    // Restore the sandbox before each test.
    sandbox = sinon.createSandbox()

    // Clone the mock data.
    mockData = cloneDeep(mockDataLib)

    uut = new MultisigApproval({ wallet })
  })

  afterEach(() => sandbox.restore())

  describe('#constructor', () => {
    it('should throw an error if wallet is not passed', () => {
      try {
        uut = new MultisigApproval()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Instance of minimal-slp-wallet must be passed in as a property called \'wallet\', when initializing the psf-multisig-approval library.')
      }
    })

    it('should have encapsulated dependencies', () => {
      assert.property(uut, 'nfts')
    })
  })

  describe('#getNftHolderInfo', () => {
    it('should get info about NFTs associated with a group token', async () => {
      // Mock dependencies and force desired code path
      sandbox.stub(uut.nfts, 'getNftsFromGroup').resolves()
      sandbox.stub(uut.nfts, 'getAddrsFromNfts').resolves()
      sandbox.stub(uut.nfts, 'findKeys').resolves({ keys: [], keysNotFound: [] })

      const result = await uut.getNftHolderInfo()

      assert.property(result, 'keys')
      assert.property(result, 'keysNotFound')
      assert.isArray(result.keys)
      assert.isArray(result.keysNotFound)
    })

    it('should catch, report, and throw errors', async () => {
      try {
        // Mock dependencies and force desired code path
        sandbox.stub(uut.nfts, 'getNftsFromGroup').rejects(new Error('test error'))

        await uut.getNftHolderInfo()

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'test error')
      }
    })
  })

  describe('#createMultisigAddress', () => {
    it('should generate a P2SH multisig address', async () => {
      const result = await uut.createMultisigAddress({ keys: mockData.pubkeys01 })
      // console.log('result: ', result)

      // Assert that expected properties exist
      assert.property(result, 'address')
      assert.property(result, 'scriptHex')
      assert.property(result, 'publicKeys')
      assert.property(result, 'requiredSigners')

      // Assert that expected address is generated
      assert.equal(result.address, 'bitcoincash:pqntzt6wcp38h8ud68wjnwh437uek76lhvhlwcm4fj')
    })

    it('should catch, report, and throw errors', async () => {
      try {
        await uut.createMultisigAddress()

        assert.fail('unexpected result')
      } catch (err) {
        assert.include(err.message, 'keys must be an array containing public keys')
      }
    })
  })

  describe('#getApprovalTx', () => {
    it('should return object with update txid', async () => {
      // Mock dependencies and force desired code path.
      sandbox.stub(uut.wallet, 'getTransactions').resolves(mockData.txHistory01)
      sandbox.stub(uut.util, 'getTxData').resolves(mockData.approvalTxDetails01)

      const address = 'bitcoincash:fake-addr'

      const result = await uut.getApprovalTx({ address })
      // console.log('result: ', result)

      // Assert that the returned object has the expected properties.
      assert.property(result, 'approvalTxid')
      assert.property(result, 'updateTxid')
      assert.property(result, 'approvalTxDetails')
      assert.property(result, 'opReturn')

      // Assert that TXIDs are returned.
      assert.equal(result.updateTxid.length, 64)
      assert.equal(result.approvalTxid.length, 64)
    })

    it('should handle SLP addresses', async () => {
      // Mock dependencies and force desired code path.
      sandbox.stub(uut.wallet, 'getTransactions').resolves(mockData.txHistory01)
      sandbox.stub(uut.util, 'getTxData').resolves(mockData.approvalTxDetails01)

      const address = 'simpleledger:qpq4uxk6vc2hn3rw8tevpm570xgs22e6rskpzpenqg'

      const result = await uut.getApprovalTx({ address })
      // console.log('result: ', result)

      // Assert that the returned object has the expected properties.
      assert.property(result, 'approvalTxid')
      assert.property(result, 'updateTxid')
      assert.property(result, 'approvalTxDetails')
      assert.property(result, 'opReturn')

      // Assert that TXIDs are returned.
      assert.equal(result.updateTxid.length, 64)
      assert.equal(result.approvalTxid.length, 64)
    })

    it('should skip a TXID in the filter list', async () => {
      // Mock dependencies and force desired code path.
      sandbox.stub(uut.wallet, 'getTransactions').resolves(mockData.txHistory02)
      sandbox.stub(uut.util, 'getTxData').resolves(mockData.approvalTxDetails01)

      const address = 'bitcoincash:fake-addr'

      const result = await uut.getApprovalTx({
        address,
        filterTxids: ['095b299da0be5bb2367e62a5628cef603c7d6e709dd72f532632e9c0acf665d3']
      })
      // console.log('result: ', result)

      // Assert that the returned object has the expected properties.
      assert.property(result, 'approvalTxid')
      assert.property(result, 'updateTxid')
      assert.property(result, 'approvalTxDetails')
      assert.property(result, 'opReturn')

      // Assert that TXIDs are returned.
      assert.equal(result.updateTxid.length, 64)
      assert.equal(result.approvalTxid.length, 64)
    })

    it('should skip a TXID if it does contain APPROVAL in the OP_RETURN', async () => {
      // Mock dependencies and force desired code path.
      sandbox.stub(uut.wallet, 'getTransactions').resolves(mockData.txHistory02)
      sandbox.stub(uut.util, 'getTxData')
        .onCall(0).resolves(mockData.updateTxDetails01)
        .onCall(1).resolves(mockData.approvalTxDetails01)

      const address = 'bitcoincash:fake-addr'

      const result = await uut.getApprovalTx({
        address
      })
      // console.log('result: ', result)

      // Assert that the returned object has the expected properties.
      assert.property(result, 'approvalTxid')
      assert.property(result, 'updateTxid')
      assert.property(result, 'approvalTxDetails')
      assert.property(result, 'opReturn')

      // Assert that TXIDs are returned.
      assert.equal(result.updateTxid.length, 64)
      assert.equal(result.approvalTxid.length, 64)
    })

    it('should return null if approval TX can not be found', async () => {
      // Mock dependencies and force desired code path.
      sandbox.stub(uut.wallet, 'getTransactions').resolves(mockData.txHistory01)
      sandbox.stub(uut.util, 'getTxData').resolves(mockData.updateTxDetails01)

      const address = 'bitcoincash:fake-addr'

      const result = await uut.getApprovalTx({ address })
      // console.log('result: ', result)

      assert.equal(result, null)
    })

    it('should throw an error if invalid address format is used', async () => {
      try {
        const address = 'fake-addr'

        await uut.getApprovalTx({ address })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'Input address must start with bitcoincash: or simpleledger:')
      }
    })
  })

  describe('#getUpdateTx', () => {
    it('should get data from an update transaction', async () => {
      // Mock dependencies and force desired code path
      sandbox.stub(uut.util, 'getTxData').resolves(mockData.updateTxDetails01)

      const txid = 'f8ea1fcd4481adfd62c6251c6a4f63f3d5ac3d5fdcc38b350d321d93254df65f'

      const result = await uut.getUpdateTx({ txid })
      // console.log('result: ', result)

      // Assert returned object has expected properties
      assert.property(result, 'cid')
      assert.property(result, 'ts')
      assert.property(result, 'txid')
      assert.property(result, 'txDetails')
    })

    it('should throw an error if a txid is given as input', async () => {
      try {
        await uut.getUpdateTx()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'txid required')
      }
    })

    it('should throw an error if OP_RETURN can not be decoded', async () => {
      try {
        // Mock dependencies and force desired code path
        mockData.updateTxDetails01.vout[0].scriptPubKey.hex = '0123456789abcdef'
        sandbox.stub(uut.util, 'getTxData').resolves(mockData.updateTxDetails01)

        const txid = 'f8ea1fcd4481adfd62c6251c6a4f63f3d5ac3d5fdcc38b350d321d93254df65f'

        await uut.getUpdateTx({ txid })

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Could not parse JSON inside')
      }
    })
  })

  describe('#getCidData', () => {
    it('should resolve CID data from an IPFS gateway', async () => {
      // Mock dependencies and force desired code path
      sandbox.stub(uut.axios, 'get').resolves({ data: mockData.updateData01 })

      const cid = 'bafybeib5d6s6t3tq4lhwp2ocvz7y2ws4czgkrmhlhv5y5aeyh6bqrmsxxi'

      const result = await uut.getCidData({ cid })
      // console.log('result: ', result)

      // Assert that expected properties exist
      assert.property(result, 'groupId')
      assert.property(result, 'keys')
      assert.property(result, 'walletObj')
      assert.property(result, 'multisigAddr')
      assert.property(result, 'p2wdbWritePrice')
    })

    it('should throw an error if CID is not specified', async () => {
      try {
        await uut.getCidData()

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'cid a required input')
      }
    })
  })

  describe('#validateApproval', () => {
    it('should validate a valid approval transaction', async () => {
      // Mock dependencies and force desired code path
      sandbox.stub(uut, 'getNftHolderInfo').resolves(mockData.tokenHolderInfo01)

      const inObj = {
        approvalObj: mockData.approvalObj01,
        updateObj: mockData.updateObj01,
        updateData: mockData.updateData01
      }

      const result = await uut.validateApproval(inObj)

      assert.equal(result, true)
    })

    it('should throw an error if approvalObj is not specified', async () => {
      try {
        await uut.validateApproval()

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'Output object of getApprovalTx() is expected as input to this function, as \'approvalObj\'')
      }
    })

    it('should throw an error if updateObj is not specified', async () => {
      try {
        const inObj = {
          approvalObj: mockData.approvalObj01
        }

        await uut.validateApproval(inObj)

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'Output object of getUpdateTx() is expected as input to this function, as \'updateObj\'')
      }
    })

    it('should throw an error if updateData is not specified', async () => {
      try {
        const inObj = {
          approvalObj: mockData.approvalObj01,
          updateObj: mockData.updateObj01
        }

        await uut.validateApproval(inObj)

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'Update CID JSON data is expected as input to this function, as \'updateData\'')
      }
    })

    it('should return false if addresses do not match', async () => {
      // Mock dependencies and force desired code path
      mockData.approvalObj01.approvalTxDetails.vin[0].address = 'bitcoincash:fake-addr'

      const inObj = {
        approvalObj: mockData.approvalObj01,
        updateObj: mockData.updateObj01,
        updateData: mockData.updateData01
      }

      const result = await uut.validateApproval(inObj)

      assert.equal(result, false)
    })
  })
})
