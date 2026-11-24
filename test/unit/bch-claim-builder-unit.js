/*
  Unit tests for the PS010 v2.0.0 BCH claim builder:

  - _buildClaimScript(): the Pin Claim OP_RETURN, shared by the (deprecated)
    proof-of-burn path and the BCH payment path.
  - createPinClaimBCH(): builds + broadcasts a claim that references a BCH
    payment txid. No pricing, no token logic.
  - requiredSatsBCH(): the client-side copy of the pinned pin-service fee
    schedule (PS010 §3), including the locked 100 KB floor.
*/

import { assert } from 'chai'
import sinon from 'sinon'

// Local libraries
import PSFFPP, { requiredSatsBCH } from '../../index.js'
import { MockBchWallet } from '../mocks/wallet.js'

// A 32-byte payment txid, in the byte order it is written to the chain.
const PAYMENT_TXID = 'aa'.repeat(32)
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const FILENAME = 'example.txt'

describe('#BCH-claim-builder', () => {
  let sandbox
  let uut
  let wallet

  beforeEach(() => {
    sandbox = sinon.createSandbox()

    wallet = new MockBchWallet()
    uut = new PSFFPP({ wallet })
  })

  afterEach(() => sandbox.restore())

  describe('#_buildClaimScript', () => {
    it('should build the PS010 claim OP_RETURN', () => {
      const result = uut._buildClaimScript({ paymentTxid: PAYMENT_TXID, cid: CID, filename: FILENAME })

      assert.isTrue(Buffer.isBuffer(result))

      const hex = result.toString('hex')

      // Lokad: OP_RETURN + 4-byte push of 00510000 (PS010 §5.1).
      assert.isTrue(hex.startsWith('6a0400510000'))

      // Field 2: a 32-byte push of the payment txid.
      const field2Offset = '6a0400510000'.length
      assert.equal(hex.slice(field2Offset, field2Offset + 2), '20')
      assert.equal(hex.slice(field2Offset + 2, field2Offset + 66), PAYMENT_TXID)

      // Fields 3 and 4: length-prefixed UTF-8 CID and filename.
      const expected = '6a0400510000' +
        '20' + PAYMENT_TXID +
        Buffer.from([Buffer.byteLength(CID)]).toString('hex') +
        Buffer.from(CID).toString('hex') +
        Buffer.from([Buffer.byteLength(FILENAME)]).toString('hex') +
        Buffer.from(FILENAME).toString('hex')

      assert.equal(hex, expected)
    })

    it('should reject a payment txid that is not 32 bytes', () => {
      try {
        uut._buildClaimScript({ paymentTxid: 'abcd', cid: CID, filename: FILENAME })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'paymentTxid must be a 32 byte (64 hex character) txid')
      }
    })

    it('should throw if payment txid is not included', () => {
      try {
        uut._buildClaimScript({ cid: CID, filename: FILENAME })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'paymentTxid required to build a pin claim.')
      }
    })

    it('should throw if CID is not included', () => {
      try {
        uut._buildClaimScript({ paymentTxid: PAYMENT_TXID, filename: FILENAME })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'cid required to generate pin claim.')
      }
    })

    it('should throw if filename is not included', () => {
      try {
        uut._buildClaimScript({ paymentTxid: PAYMENT_TXID, cid: CID })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'filename required to generate pin claim.')
      }
    })
  })

  describe('#createPinClaimBCH', () => {
    it('should build and broadcast a claim with the payment txid in field 2', async () => {
      const result = await uut.createPinClaimBCH({
        cid: CID,
        filename: FILENAME,
        paymentTxid: PAYMENT_TXID
      })

      assert.equal(result.paymentTxid, PAYMENT_TXID)
      // The mock wallet returns a fixed value from broadcast().
      assert.equal(result.claimTxid, 'fake-txid')
    })

    it('should not touch the PSF token path', async () => {
      const burnSpy = sandbox.spy(wallet, 'burnTokens')
      const priceSpy = sandbox.spy(wallet, 'getPsfWritePrice')

      await uut.createPinClaimBCH({ cid: CID, filename: FILENAME, paymentTxid: PAYMENT_TXID })

      assert.isFalse(burnSpy.called, 'burnTokens() must not be called')
      assert.isFalse(priceSpy.called, 'getPsfWritePrice() must not be called')
    })

    it('should throw if payment txid is not included', async () => {
      try {
        await uut.createPinClaimBCH({ cid: CID, filename: FILENAME })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'paymentTxid required to generate a BCH pin claim.')
      }
    })

    it('should throw if CID is not included', async () => {
      try {
        await uut.createPinClaimBCH({ filename: FILENAME, paymentTxid: PAYMENT_TXID })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'cid required to generate pin claim.')
      }
    })

    it('should throw if filename is not included', async () => {
      try {
        await uut.createPinClaimBCH({ cid: CID, paymentTxid: PAYMENT_TXID })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'filename required to generate pin claim.')
      }
    })

    it('should catch, report, and throw errors', async () => {
      try {
        sandbox.stub(uut, '_broadcastClaim').rejects(new Error('test error'))

        await uut.createPinClaimBCH({ cid: CID, filename: FILENAME, paymentTxid: PAYMENT_TXID })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'test error')
      }
    })
  })

  describe('#createPinClaim (deprecated burn path)', () => {
    it('should use the shared claim builder with the proof-of-burn txid', async () => {
      sandbox.stub(wallet, 'getPsfWritePrice').resolves(1)
      sandbox.stub(wallet, 'burnTokens').resolves(PAYMENT_TXID)
      sandbox.stub(uut.bchjs.Util, 'sleep').resolves(true)
      const broadcastStub = sandbox.stub(uut, '_broadcastClaim').resolves('claim-txid')

      const result = await uut.createPinClaim({
        cid: CID,
        filename: FILENAME,
        fileSizeInMegabytes: 1
      })

      assert.equal(result.pobTxid, PAYMENT_TXID)
      assert.equal(result.claimTxid, 'claim-txid')

      // The burn path and the BCH path must build the claim identically.
      assert.isTrue(broadcastStub.calledOnce)
      assert.deepEqual(broadcastStub.firstCall.args[0], {
        paymentTxid: PAYMENT_TXID,
        cid: CID,
        filename: FILENAME
      })
    })
  })

  describe('#requiredSatsBCH', () => {
    it('should charge the dust-bounded floor for small files', () => {
      // 50 KB with a 2000 sats/MB rate → 100 KB floor of ceil(0.1 * 2000) = 200,
      // bounded below by the 546-sat dust limit.
      assert.equal(requiredSatsBCH({ fileSizeBytes: 50000, satsPerMb: 2000 }), 546)
    })

    it('should charge the dust-bounded floor for an empty file', () => {
      assert.equal(requiredSatsBCH({ fileSizeBytes: 0, satsPerMb: 2000 }), 546)
    })

    it('should charge the dust-bounded floor at exactly 100 KB, without floating point drift', () => {
      // 100000 / 1e6 * 2000 = 200.00000000000003 in IEEE 754, which would ceil
      // to 201 if the naive formula were used. The floor must be met exactly,
      // and it must not fall below the dust limit.
      assert.equal(requiredSatsBCH({ fileSizeBytes: 100000, satsPerMb: 2000 }), 546)
    })

    it('should not let a high satsPerMb sink below its own 100 KB floor', () => {
      // At 6000 sats/MB the 100 KB floor (600) already exceeds the dust limit,
      // so the floor rule wins.
      assert.equal(requiredSatsBCH({ fileSizeBytes: 50000, satsPerMb: 6000 }), 600)
    })

    it('should meter files above the dust threshold', () => {
      // 300 KB at 2000 sats/MB = 600 sats, above the 546-sat dust floor.
      assert.equal(requiredSatsBCH({ fileSizeBytes: 300000, satsPerMb: 2000 }), 600)
      assert.equal(requiredSatsBCH({ fileSizeBytes: 1000000, satsPerMb: 2000 }), 2000)
      assert.equal(requiredSatsBCH({ fileSizeBytes: 2500000, satsPerMb: 2000 }), 5000)
    })

    it('should cross from the dust floor into metered pricing at 546 sats', () => {
      // At 2000 sats/MB, metered amount reaches 546 sats at 273,000 bytes.
      // 273,000 bytes = 546 sats, equal to the dust floor.
      assert.equal(requiredSatsBCH({ fileSizeBytes: 273000, satsPerMb: 2000 }), 546)
      // 273,001 bytes = 546.002 sats → 547, above the floor.
      assert.equal(requiredSatsBCH({ fileSizeBytes: 273001, satsPerMb: 2000 }), 547)
    })

    it('should floor the current PSFFPP production rate at the dust limit', () => {
      // The production rate of 5084 sats/MB gives a 100 KB floor of 509 sats,
      // which is below the dust limit — the dust bound must lift it to 546.
      assert.equal(requiredSatsBCH({ fileSizeBytes: 100000, satsPerMb: 5084 }), 546)
      // Small files below ~107 KB stay at the dust floor.
      assert.equal(requiredSatsBCH({ fileSizeBytes: 1000, satsPerMb: 5084 }), 546)
    })

    it('should round up metered amounts above the dust floor', () => {
      // 100001 bytes at 6000 sats/MB = 600.006 sats → 601 (above the 546 dust floor).
      assert.equal(requiredSatsBCH({ fileSizeBytes: 100001, satsPerMb: 6000 }), 601)
      // 123456 bytes at 7000 sats/MB = 864.192 sats → 865.
      assert.equal(requiredSatsBCH({ fileSizeBytes: 123456, satsPerMb: 7000 }), 865)
    })

    it('should match the pinned pin-service formula', () => {
      // Parity check against the definition in PS010 §3, as implemented by
      // ipfs-file-pin-service src/use-cases/required-sats.js. Integer
      // multiplication first, so the two copies cannot drift. Both copies
      // dust-bound the floor at 546.
      const sizes = [0, 1, 1000, 50000, 99999, 100000, 100001, 150000, 999999, 1000000, 12345678]
      const rates = [1, 100, 2000, 2500, 100000]
      const DUST_SATS = 546

      for (const satsPerMb of rates) {
        for (const fileSizeBytes of sizes) {
          const expected = Math.max(
            Math.ceil((fileSizeBytes * satsPerMb) / 1000000),
            Math.ceil(satsPerMb / 10),
            DUST_SATS
          )

          assert.equal(
            requiredSatsBCH({ fileSizeBytes, satsPerMb }),
            expected,
            `mismatch for ${fileSizeBytes} bytes at ${satsPerMb} sats/MB`
          )
        }
      }
    })

    it('should throw on an unusable file size', () => {
      try {
        requiredSatsBCH({ fileSizeBytes: '1000', satsPerMb: 2000 })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'fileSizeBytes must be a finite number')
      }
    })

    it('should throw on an unusable rate', () => {
      try {
        requiredSatsBCH({ fileSizeBytes: 1000, satsPerMb: 0 })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'satsPerMb must be a finite number')
      }
    })

    it('should be reachable from the default export as a static property', () => {
      assert.equal(PSFFPP.requiredSatsBCH, requiredSatsBCH)
    })
  })
})
