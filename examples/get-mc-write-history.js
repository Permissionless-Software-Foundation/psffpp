/* >
  This example shows how to get the write price update history.
*/

import SlpWallet from 'minimal-slp-wallet'
import PSFFPP from '../index.js'

async function start () {
  try {
    let now = new Date()
    console.log('Start time: ', now.toLocaleString())

    // Instance the BCH wallet
    const wallet = new SlpWallet(undefined, {
      interface: 'consumer-api',
      // restURL: 'https://free-bch.fullstack.cash'
      // restURL: 'https://dev-consumer.psfoundation.info'
      restURL: 'http://localhost:5015'
    })
    await wallet.initialize()

    // Instance this library
    const psffpp = new PSFFPP({ wallet })

    now = new Date()
    console.log(`1st write price lookup started at ${now.toLocaleString()}`)

    // Get the current write price
    const writePrice = await psffpp.getWritePriceHistory()
    console.log('1st writePrice: ', writePrice)

    now = new Date()
    console.log(`2nd write price lookup started at ${now.toLocaleString()}`)

    // Get the current write price
    const writePrice2 = await psffpp.getWritePriceHistory()
    console.log('2nd writePrice: ', writePrice2)

    now = new Date()
    console.log(`Finished at ${now.toLocaleString()}`)
  } catch (err) {
    console.error(err)
  }
}

start()
