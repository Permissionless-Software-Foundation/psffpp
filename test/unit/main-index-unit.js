/*
  Unit tests for the main index.js library file.
*/

// npm libraries
// const mockDataLib = require('./mocks/main-index-mocks')

import { assert } from 'chai'
import sinon from 'sinon'
// const cloneDeep = require('lodash.clonedeep')
// const SlpWallet = require('minimal-slp-wallet')

// Mocking data libraries.

// Local libraries
import PSFFPP from '../../index.js'
import { MockBchWallet } from '../mocks/wallet.js'
import mockWritePrice from '../mocks/write-price-mocks.js'

describe('#PSFFPP-index.js', () => {
  let sandbox
  // let mockData
  let uut
  let wallet

  beforeEach(() => {
    // Restore the sandbox before each test.
    sandbox = sinon.createSandbox()

    // Clone the mock data.
    // mockData = cloneDeep(mockDataLib)

    wallet = new MockBchWallet()

    uut = new PSFFPP({ wallet })
  })

  afterEach(() => sandbox.restore())

  describe('#constructor', () => {
    it('should throw an error if wallet is not passed', () => {
      try {
        uut = new PSFFPP()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Instance of minimal-slp-wallet must be passed in as a property called \'wallet\', when initializing the psf-multisig-approval library.')
      }
    })
  })

  describe('#getMcWritePrice', () => {
    it('should validate a new approval transaction', async () => {
      await uut._initPs009()

      // Mock dependencies and force desired code path.
      sandbox.stub(uut.ps009, 'getApprovalTx').resolves(mockWritePrice.approvalObj01)
      sandbox.stub(uut.ps009, 'getUpdateTx').resolves(mockWritePrice.updateObj01)
      sandbox.stub(uut.ps009, 'getCidData').resolves(mockWritePrice.validationData01)
      sandbox.stub(uut.ps009, 'validateApproval').resolves(true)

      const result = await uut.getMcWritePrice()
      // console.log('result: ', result)

      assert.equal(result, 0.08335233)
    })

    it('should recursivly call itself to find the next approval tx', async () => {
      await uut._initPs009()

      // Mock dependencies and force desired code path.
      sandbox.stub(uut.ps009, 'getApprovalTx').resolves(mockWritePrice.approvalObj01)
      sandbox.stub(uut.ps009, 'getUpdateTx').resolves(mockWritePrice.updateObj01)
      sandbox.stub(uut.ps009, 'getCidData').resolves(mockWritePrice.validationData01)
      sandbox.stub(uut.ps009, 'validateApproval')
        .onCall(0).resolves(false)
        .onCall(1).resolves(true)

      const result = await uut.getMcWritePrice()
      // console.log('result: ', result)

      assert.equal(result, 0.08335233)
    })

    it('should return safety price if no approval tx can be found', async () => {
      await uut._initPs009()

      // Mock dependencies and force desired code path.
      sandbox.stub(uut.ps009, 'getApprovalTx').resolves(null)

      const result = await uut.getMcWritePrice()
      // console.log('result: ', result)

      // assert.equal(result, 0.08335233)
      assert.equal(result, 0.03570889)
    })

    it('should throw error and return safety price if wallet is not initialized', async () => {
      // Mock dependencies and force desired code path.
      sandbox.stub(uut, '_initPs009').rejects(new Error('test error'))

      const result = await uut.getMcWritePrice()
      // console.log('result: ', result)

      // assert.equal(result, 0.08335233)
      assert.equal(result, 0.03570889)
    })
  })

  describe('#createPinClaim', () => {
    // it('should publish a pin claim on the blockchain', async () => {
    //   await uut._initPs009()

    //   // Mock dependencies and force desired code path
    //   sandbox.stub(uut, 'getMcWritePrice').resolves(0.08335233)
    //   sandbox.stub(uut.bchjs.Util, 'sleep').resolves(true)

    //   const inObj = {
    //     cid: 'bafkreih7eeixbkyvabqdde4g5mdourjidxpsgf6bgz6f7ouxqr24stg6f4',
    //     filename: 'test.txt',
    //     fileSizeInMegabytes: 0.1
    //   }

    //   const result = await uut.createPinClaim(inObj)
    //   // console.log('result: ', result)

    //   assert.property(result, 'pobTxid')
    //   assert.property(result, 'claimTxid')
    // })

    // it('should catch, report, and throw errors', async () => {
    //   try {
    //     await uut._initPs009()

    //     // Mock dependencies and force desired code path
    //     sandbox.stub(uut, 'getMcWritePrice').rejects(new Error('test error'))

    //     const inObj = {
    //       cid: 'bafkreih7eeixbkyvabqdde4g5mdourjidxpsgf6bgz6f7ouxqr24stg6f4',
    //       filename: 'test.txt',
    //       fileSizeInMegabytes: 0.1
    //     }

    //     await uut.createPinClaim(inObj)

    //     assert.fail('Unexpected code path')
    //   } catch (err) {
    //     // console.log('err.message: ', err.message)
    //     assert.include(err.message, 'test error')
    //   }
    // })

    it('should throw error if CID is not included', async () => {
      try {
        await uut.createPinClaim()

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'cid required to generate pin claim.')
      }
    })

    it('should throw error if filename is not included', async () => {
      try {
        await uut.createPinClaim({
          cid: 'fake-cide'
        })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'filename required to generate pin claim.')
      }
    })

    it('should throw error if file size is not included', async () => {
      try {
        await uut.createPinClaim({
          cid: 'fake-cide',
          filename: 'fake-filename'
        })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'fileSizeInMegabytes size in megabytes required to generate pin claim.')
      }
    })
  })
})
