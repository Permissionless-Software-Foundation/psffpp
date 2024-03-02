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

describe('#MultisigApproval.js', () => {
  let sandbox
  // let mockData
  let uut
  let wallet

  // before(async () => {
  //   wallet = new SlpWallet(undefined, { interface: 'consumer-api' })
  //   await wallet.walletInfoPromise
  // })

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

  describe('#createPinClaim', () => {
    it('should publish a pin claim on the blockchain', async () => {
      await uut.initPs009()

      // Mock dependencies and force desired code path
      console.log('uut.ps009: ', uut.ps009)
      sandbox.stub(uut.ps009, 'getMcWritePrice').resolves(0.08335233)

      const inObj = {
        cid: 'bafkreih7eeixbkyvabqdde4g5mdourjidxpsgf6bgz6f7ouxqr24stg6f4',
        filename: 'test.txt',
        fileSizeInMegabytes: 0.1
      }

      const result = await uut.createPinClaim(inObj)
      console.log('result: ', result)

      // assert.equal(result, 'fake-txid')
    })

    // it('should catch, report, and throw errors', async () => {
    //   try {
    //     uut.SlpWallet = class SlpWallet { constructor () { throw new Error('test error') }}
    //
    //     await uut.createPinClaim()
    //
    //     assert.fail('Unexpected code path')
    //   } catch (err) {
    //     // console.log('err.message: ', err.message)
    //     assert.include(err.message, 'test error')
    //   }
    // })
  })
})
