const dotenv = require('dotenv')
const commander = require('commander')
const express = require('express')
const RingCentral = require('ringcentral-js-concise')
const fs = require('fs')
const path = require('path')
const bodyParser = require('body-parser')
const axios = require('axios')
const R = require('ramda')

const pkg = require('./package.json')

dotenv.config()
const tokenFile = path.join(__dirname, '.token')
const rc = new RingCentral(
  process.env.GLIP_CLIENT_ID,
  process.env.GLIP_CLIENT_SECRET,
  process.env.GLIP_API_SERVER
)
if (fs.existsSync(tokenFile)) { // restore token
  rc.token(JSON.parse(fs.readFileSync(tokenFile, 'utf-8')))
}

const sendGlipMessage = async (groupId, text, attachments) => {
  try {
    await rc.post('/restapi/v1.0/glip/posts', { groupId, text, attachments })
  } catch (e) {
    console.error(e.response.data)
  }
}

const getStockMessage = async symbol => {
  try {
    const r = await axios.get(`https://www.quandl.com/api/v3/datasets/WIKI/${symbol}.json?api_key=hWMcYrZQW1uL-G5C6Grn&start_date=2018-01-01`)
    const dataset = r.data.dataset
    const price = dataset.data[0][4]
    const entries = R.slice(0, 6, dataset.data)
    const text = `${dataset.name.split(' Prices, ')[0]} **$${price}**`
    return {
      text,
      attachments: [{
        type: 'Card',
        fallback: text,
        fields: R.map(entry => ({
          title: entry[0],
          value: '$' + entry[4],
          style: 'Short'
        }), entries)
      }]
    }
  } catch (e) {
    return { text: `**${symbol}** is not a known stock symbol` }
  }
}

const app = express()
app.use(bodyParser.json())
app.get('/oauth', async (req, res) => {
  try {
    await rc.authorize({ code: req.query.code, redirect_uri: `${process.env.GLIP_BOT_SERVER}/oauth` })
  } catch (e) {
    console.error(e.response.data)
  }
  fs.writeFileSync(tokenFile, JSON.stringify(rc.token())) // save token
  res.send('')
})
app.post('/webhook', async (req, res) => {
  const message = req.body.body
  if (message && message.type === 'TextMessage') {
    if (message.text === 'ping') {
      await sendGlipMessage(message.groupId, 'pong')
    }
    if (message.text.startsWith('stock ')) {
      const stockSymbol = message.text.substring(6).trim().toUpperCase()
      const stockMessage = await getStockMessage(stockSymbol)
      await sendGlipMessage(message.groupId, stockMessage.text, stockMessage.attachments)
    }
  }
  res.set('validation-token', req.get('validation-token'))
  res.send('')
})

commander.version(pkg.version).option('-p --port <port>', 'Specify port').parse(process.argv)
app.listen(commander.port || 3000)
