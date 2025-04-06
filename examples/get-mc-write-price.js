/*>
  This example shows how to get the current write price set by the PSF Minting Council.
*/

import SlpWallet from 'minimal-slp-wallet'
import PSFFPP from '../index.js'

async function start() {
  try {
    // Instance the BCH wallet
    const wallet = new SlpWallet(undefined, {
      interface: 'consumer-api',
      restURL: 'https://free-bch.fullstack.cash'
    })
    await wallet.initialize()

    // Instance this library
    const psffpp = new PSFFPP({wallet})

    // Get the current write price
    const writePrice = await psffpp.getMcWritePrice()
    console.log('writePrice: ', writePrice)
    
    
  } catch(err) {
    console.error(err)
  }
}

start()
