/*
  Unit tests for the nfts.js utility library.
*/

// npm libraries
const chai = require('chai')
const sinon = require('sinon')
// const cloneDeep = require('lodash.clonedeep')
const SlpWallet = require('minimal-slp-wallet')

// Locally global variables.
const assert = chai.assert

// Mocking data libraries.
// const mockDataLib = require('./mocks/util-mocks')

// Unit under test
const NftsLib = require('../../lib/nfts')

describe('#NFTs', () => {
  let sandbox
  // let mockData
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
    // mockData = cloneDeep(mockDataLib)

    uut = new NftsLib({ wallet })
  })

  afterEach(() => sandbox.restore())

  describe('#constructor', () => {
    it('should throw an error if wallet is not passed', () => {
      try {
        uut = new NftsLib()
        console.log('uut: ', uut)

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Instance of minimal-slp-wallet must be passed in as a property called \'wallet\', when initializing the nfts.js library.')
      }
    })
  })

  describe('#getNftsFromGroup', () => {
    it('should get NFT token IDs from a Group token', async () => {
      // Mock dependencies and force desired code path
      sandbox.stub(uut.wallet, 'getTokenData').resolves({
        genesisData: {
          nfts: ['a', 'b', 'c']
        }
      })

      const result = await uut.getNftsFromGroup('fake-group-id')

      assert.isArray(result)
    })

    it('should catch and throw errors', async () => {
      try {
        // Mock dependencies and force desired code path
        sandbox.stub(uut.wallet, 'getTokenData').rejects(new Error('test error'))

        await uut.getNftsFromGroup()

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'test error')
      }
    })
  })

  describe('#getAddrsFromNfts', () => {
    it('should should return addresses associated with each NFT', async () => {
      // Mock dependencies and force desired code path.
      sandbox.stub(uut.wallet, 'getTokenData').resolves({
        genesisData: {
          nftHolder: 'sam'
        }
      })

      const nfts = ['a']

      const result = await uut.getAddrsFromNfts(nfts)

      assert.isArray(result)
      assert.equal(result[0], 'sam')
    })

    it('should catch and throw errors', async () => {
      try {
        // Force an error
        sandbox.stub(uut.wallet, 'getTokenData').rejects(new Error('test error'))

        const nfts = ['a']

        await uut.getAddrsFromNfts(nfts)

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'test error')
      }
    })

    it('should throw an error if Cash Stack server does not return nftHolder property', async () => {
      try {
        // Mock dependencies and force desired code path.
        sandbox.stub(uut.wallet, 'getTokenData').resolves({
          genesisData: {}
        })

        const nfts = ['a']

        await uut.getAddrsFromNfts(nfts)

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'SLP indexer data does not include a holder address for this NFT.')
      }
    })
  })

  describe('#findKeys', () => {
    it('should collect public keys for an addresses', async () => {
      const addrs = ['bitcoincash:qzwahhjldv0qsecfxlmcenzvkjv9rlv9au2hcfggl6']
      const nfts = ['fb707a9d8a4d6ba47ef0c510714ca46d4523cd29c8f4e3fd6a63a85edb8b05d2']

      // Mock dependencies and force desired code path.
      sandbox.stub(uut.wallet, 'getPubKey').resolves('02055962631b236ddcd2c17cd0b711f12438b93bcf01b206cadb351cc3e6e3e269')

      const result = await uut.findKeys(addrs, nfts)
      // console.log('result: ', result)

      // Assert expected properties exist
      assert.property(result, 'keys')
      assert.property(result, 'keysNotFound')

      // Assert that each property is an array.
      assert.isArray(result.keys)
      assert.isArray(result.keysNotFound)

      // Assert expected values exist
      assert.equal(result.keys[0].addr, 'bitcoincash:qzwahhjldv0qsecfxlmcenzvkjv9rlv9au2hcfggl6')
      assert.equal(result.keys[0].pubKey, '02055962631b236ddcd2c17cd0b711f12438b93bcf01b206cadb351cc3e6e3e269')
    })

    it('should handle address without a public key', async () => {
      const addrs = ['bitcoincash:qzwahhjldv0qsecfxlmcenzvkjv9rlv9au2hcfggl6']
      const nfts = ['fb707a9d8a4d6ba47ef0c510714ca46d4523cd29c8f4e3fd6a63a85edb8b05d2']

      // Mock dependencies and force desired code path.
      sandbox.stub(uut.wallet, 'getPubKey').resolves('not found')

      const result = await uut.findKeys(addrs, nfts)
      // console.log('result: ', result)

      // Assert expected properties exist
      assert.property(result, 'keys')
      assert.property(result, 'keysNotFound')

      // Assert that each property is an array.
      assert.isArray(result.keys)
      assert.isArray(result.keysNotFound)

      // Assert expected values exist
      assert.equal(result.keysNotFound[0], 'bitcoincash:qzwahhjldv0qsecfxlmcenzvkjv9rlv9au2hcfggl6')
    })

    it('should catch and throw errors', async () => {
      try {
        await uut.findKeys()

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'Cannot read')
      }
    })
  })
})
